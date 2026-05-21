/*\
title: $:/plugins/rimir/cascade-palette/widgets/cascade-palette-widget.js
type: application/javascript
module-type: widget

Cascade Palette widget — keyboard-driven cascading command palette.

Three-section focus model: input | menu | details. Tab cycles focus
between sections. The stage stack lives in `this.stack`; the active
stage is `topStage()`. Filter stages are populated by evaluating
`ca-next-scope`; action stages are populated by `ca-entity-type`
filtering against `$:/tags/rimir/cascade-palette/action`.

Item kinds (per `ca-kind` field on entry/action/setting):
  leaf    — Enter fires `ca-actions` and closes
  drill   — Right-arrow / Enter pushes a new stage via `ca-next-scope`
  toggle  — Space flips a bound boolean
  number  — +/- nudge a bound number; Space opens edit-mode
  text    — Space pushes value into input for editing
  item    — synthetic kind for dynamic filter results

Bindings (toggle/number/text) follow scribe convention:
  ca-bind-tiddler, ca-bind-field, optional ca-bind-path (JSON sub-path)

See doc/protocol.tid for the full authoring guide and worked examples.
\*/
(function () {
    "use strict";

    var Widget = require("$:/core/modules/widgets/widget.js").widget;

    // ---- TW message dispatched by the keyboard shortcut binding ----
    var OPEN_MESSAGE = "rimir-cascade-palette-open";

    // ---- Tags consumed by the engine ----
    var ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";
    var ACTION_TAG = "$:/tags/rimir/cascade-palette/action";
    var SETTING_TAG = "$:/tags/rimir/cascade-palette/setting";
    var DIAGNOSTIC_TAG = "$:/tags/rimir/cascade-palette/diagnostic";
    var TEMPLATE_TAG = "$:/tags/rimir/cascade-palette/template";

    // ---- Config tiddler titles ----
    var GROUPING_CONFIG = "$:/config/rimir/cascade-palette/grouping-enabled";
    var SOFT_DEPTH_CONFIG = "$:/config/rimir/cascade-palette/soft-depth-warning";
    var POPUP_WIDTH_CONFIG = "$:/config/rimir/cascade-palette/popup-width";
    var MAX_RESULTS_CONFIG = "$:/config/rimir/cascade-palette/max-results";
    var DETAILS_ALWAYS_ON_CONFIG = "$:/config/rimir/cascade-palette/details-always-on";

    // ---- Defaults for nullable / fallback fields ----
    var DEFAULT_ORDER = 100;
    var DEFAULT_MAX_RESULTS = 30;
    var DEFAULT_SOFT_DEPTH = 10;
    var DEFAULT_TRUE_VALUE = "yes";
    var DEFAULT_FALSE_VALUE = "no";
    var DEFAULT_STEP = 1;
    var DEFAULT_STEP_MEDIUM = 5;
    var DEFAULT_STEP_LARGE = 20;
    var DEFAULT_BIND_TYPE = "text/plain";

    // ---- Bind-type names with special handling ----
    // String-array binds get list-membership semantics on toggle (the toggle's
    // trueValue is treated as a list element, not a scalar replacement).
    var STRING_ARRAY_TYPE = "application/x-string-array";

    // ---- Footer hint text per palette mode ----
    // Section-specific hints surface the relevant gestures inline. Common
    // gestures (Tab cycle, ↵ fire, Ctrl-↵ fire+stay, hold Ctrl preview)
    // appear in every variant so the user always sees the escape hatches.
    var HINT_INPUT   = "Tab section · ↓ menu · ↵ fire · Ctrl-↵ fire+stay · Esc close · hold Ctrl preview";
    var HINT_MENU    = "Tab section · ↑↓ select · → drill · ← back · Space toggle/edit · +/- adjust · ↵ fire · Esc input · hold Ctrl preview";
    var HINT_DETAILS = "Tab section · ↑↓ scroll · Esc input · ↵ fire";
    var HINT_EDIT    = "↵ commit · Esc cancel";

    var CascadePaletteWidget = function (parseTreeNode, options) {
        this.initialise(parseTreeNode, options);
        this.open = false;
        this.stack = [];
        // editMode is non-null while the user is editing a bound text/number
        // value directly in the search input. Shape: { item, savedQuery,
        // savedSelectedIndex }. Set by enterEditMode, cleared by exitEditMode.
        this.editMode = null;
        // Details visibility is derived from two sources:
        //   ctrlHeld     — user is holding Ctrl right now
        //   always-on    — config tiddler $:/config/rimir/.../details-always-on
        // The drawer is shown if EITHER is true. `detailsOpen` is the
        // computed visibility flag (kept as a single boolean for ease of
        // callers); recompute via _updateDetailsVisibility.
        this.detailsOpen = false;
        this.ctrlHeld = false;
        // Three-section focus model: input | menu | details. The active
        // section gets the browser-level focus AND a visual cue via the
        // [data-focus="..."] attribute on popupEl. Default "input" on open.
        this.focus = "input";
        // Active template tab when multiple templates apply to the picked
        // item. Reset on selection change.
        this.detailsTemplateIdx = 0;
        // Cached rendered template DOM. Shape: { title, templateIdx, dom }.
        // Hit on repeated renders of the same row (e.g. holding Ctrl while
        // not navigating); invalidated when the cached title's tiddler
        // changes (via the wiki change hook) and on selection change to a
        // different row.
        this._detailsCache = null;
    };

    CascadePaletteWidget.prototype = Object.create(Widget.prototype);

    /* ---------- lifecycle ---------- */

    CascadePaletteWidget.prototype.render = function (parent, nextSibling) {
        this.parentDomNode = parent;
        this.computeAttributes();
        this.execute();

        var self = this;

        this.backdropEl = this.document.createElement("div");
        this.backdropEl.className = "rcp-backdrop";
        this.backdropEl.style.display = "none";

        var popup = this.document.createElement("div");
        popup.className = "rcp-popup";
        this.popupEl = popup;

        this.breadcrumbEl = this.document.createElement("div");
        this.breadcrumbEl.className = "rcp-breadcrumb";

        this.inputEl = this.document.createElement("input");
        this.inputEl.className = "rcp-input";
        this.inputEl.type = "text";
        this.inputEl.placeholder = "Type to filter…";
        this.inputEl.setAttribute("autocomplete", "off");
        this.inputEl.setAttribute("spellcheck", "false");

        this.resultsEl = this.document.createElement("ul");
        this.resultsEl.className = "rcp-results";
        // tabindex=-1 keeps the element out of the browser's native Tab
        // order (we drive Tab cycling ourselves) but allows programmatic
        // focus and keyboard events.
        this.resultsEl.setAttribute("tabindex", "-1");

        this.previewEl = this.document.createElement("div");
        this.previewEl.className = "rcp-preview";
        this.previewEl.setAttribute("tabindex", "-1");

        this.hintEl = this.document.createElement("div");
        this.hintEl.className = "rcp-hint";
        this.hintEl.textContent = HINT_INPUT;

        popup.appendChild(this.breadcrumbEl);
        popup.appendChild(this.inputEl);
        popup.appendChild(this.resultsEl);
        popup.appendChild(this.previewEl);
        popup.appendChild(this.hintEl);
        this.backdropEl.appendChild(popup);

        parent.insertBefore(this.backdropEl, nextSibling);
        this.domNodes.push(this.backdropEl);

        this.inputEl.addEventListener("input", function () {
            // While editing a bound value, the input IS the value editor —
            // typing must not re-filter the results.
            if (self.editMode) return;
            var stage = self.topStage();
            if (!stage) return;
            stage.query = self.inputEl.value;
            stage.selectedIndex = 0;
            self.recomputeStage(stage);
            self.renderStage();
        });

        // Keydown/keyup live on the popup (not the input) so they reach us
        // regardless of which section currently has browser focus. Events
        // bubble up from the focused descendant (input/results/preview)
        // — preventDefault on the event still works in the bubble phase.
        popup.addEventListener("keydown", function (e) {
            // Ctrl-hold contributes to details visibility (see
            // _updateDetailsVisibility). Auto-repeat keys (with ctrlKey=true)
            // are dispatched to handleKeydown normally.
            if (e.key === "Control" && !e.repeat && !self.editMode) {
                self.ctrlHeld = true;
                self._updateDetailsVisibility();
            }
            self.handleKeydown(e);
        });

        popup.addEventListener("keyup", function (e) {
            if (e.key === "Control") {
                self.ctrlHeld = false;
                self._updateDetailsVisibility();
            }
        });

        // If the user Alt-Tabs out or clicks away while holding Ctrl, the
        // keyup won't reach the popup — clear the held flag defensively
        // on input blur. _updateDetailsVisibility honours always-on.
        this.inputEl.addEventListener("blur", function () {
            if (self.ctrlHeld) {
                self.ctrlHeld = false;
                self._updateDetailsVisibility();
            }
        });

        // Focus sync: when the browser focus enters an element, mirror that
        // into our `this.focus` state and re-render so the visual cue moves.
        this.inputEl.addEventListener("focus", function () {
            if (self.focus !== "input") {
                self.focus = "input";
                self._applyFocusAttr();
            }
        });

        // Results and preview don't natively take focus on click — wire it
        // manually. mousedown not click, so the row's own mousedown handler
        // (which fires the selection) doesn't race with focus changes.
        this.resultsEl.addEventListener("mousedown", function (e) {
            // Row clicks are handled per-row; this captures clicks on the
            // <ul> background.
            if (e.target === self.resultsEl) self.setFocus("menu");
        });
        this.resultsEl.addEventListener("focus", function () {
            if (self.focus !== "menu") {
                self.focus = "menu";
                self._applyFocusAttr();
            }
        });
        this.previewEl.addEventListener("mousedown", function () {
            self.setFocus("details");
        });
        this.previewEl.addEventListener("focus", function () {
            if (self.focus !== "details") {
                self.focus = "details";
                self._applyFocusAttr();
            }
        });

        this.backdropEl.addEventListener("mousedown", function (e) {
            if (e.target === self.backdropEl) self.close();
        });

        // React live to config changes: the user can be editing the width
        // (or other UI-affecting config) from within the open palette and
        // expect the popup to resize/refresh on each step. We re-apply width
        // immediately and re-render the current stage so settings rows show
        // their new bound value.
        if (!self._wikiChangeHook) {
            self._wikiChangeHook = function (changes) {
                if (changes[POPUP_WIDTH_CONFIG]) {
                    self.applyPopupWidth();
                }
                // Always-on toggle response: visibility derives from
                // (ctrlHeld || always-on). When the config flips, recompute
                // before the stage re-render so the drawer shows/hides
                // atomically with the toggle row's bound value updating.
                if (changes[DETAILS_ALWAYS_ON_CONFIG]) {
                    self._updateDetailsVisibility();
                }
                // Invalidate the details cache when the displayed tiddler
                // changes — its rendered template DOM is now stale.
                if (self._detailsCache && changes[self._detailsCache.title]) {
                    self._detailsCache = null;
                }
                if (self.open) {
                    // Any tiddler change while open might affect a bound
                    // setting row's displayed value — cheap to re-render.
                    self.recomputeStage(self.topStage());
                    self.renderStage();
                }
            };
            this.wiki.addEventListener("change", self._wikiChangeHook);
        }

        // Register global hotkey handler.
        if ($tw.rootWidget) {
            if (self._openHandler) {
                $tw.rootWidget.removeEventListener(OPEN_MESSAGE, self._openHandler);
            }
            self._openHandler = function () {
                self.openPalette();
                return false;
            };
            $tw.rootWidget.addEventListener(OPEN_MESSAGE, self._openHandler);
        } else if (console && console.warn) {
            console.warn("[cascade-palette] $tw.rootWidget unavailable at render time");
        }
    };

    CascadePaletteWidget.prototype.execute = function () {
        // No attributes yet.
    };

    CascadePaletteWidget.prototype.refresh = function () {
        return false;
    };

    /* ---------- open / close / stack ---------- */

    CascadePaletteWidget.prototype.applyPopupWidth = function () {
        // Config stores the bare numeric percentage; we append "vw". Sub-20
        // values would be unusable; cap at 95 to leave a safe edge.
        var raw = this.wiki.getTiddlerText(POPUP_WIDTH_CONFIG, "50") || "50";
        var n = parseFloat(raw);
        if (isNaN(n)) n = 50;
        if (n < 20) n = 20;
        if (n > 95) n = 95;
        this.popupEl.style.width = n + "vw";
    };

    CascadePaletteWidget.prototype.openPalette = function () {
        this.open = true;
        this.stack = [this.buildRootStage()];
        this.focus = "input";
        this.detailsTemplateIdx = 0;
        this._detailsCache = null;
        this.detailsOpen = this.isDetailsAlwaysOn();
        this.recomputeStage(this.topStage());
        this.applyPopupWidth();
        this.backdropEl.style.display = "flex";
        this.renderStage();
        this._applyFocusAttr();
        if (this.detailsOpen) this.renderDetails();
        var self = this;
        setTimeout(function () {
            self.inputEl.focus();
        }, 0);
    };

    CascadePaletteWidget.prototype.isDetailsAlwaysOn = function () {
        var raw = this.wiki.getTiddlerText(DETAILS_ALWAYS_ON_CONFIG, DEFAULT_FALSE_VALUE);
        var s = String(raw || "").toLowerCase().trim();
        return s === "yes" || s === "true" || s === "on" || s === "1";
    };

    // Recompute detailsOpen from its two sources (ctrlHeld OR always-on).
    // Toggles drawer visibility accordingly. Safe to call any time; idempotent.
    CascadePaletteWidget.prototype._updateDetailsVisibility = function () {
        var shouldShow = this.ctrlHeld || this.isDetailsAlwaysOn();
        if (shouldShow && !this.detailsOpen) {
            this.detailsOpen = true;
            this.renderDetails();
        } else if (!shouldShow && this.detailsOpen) {
            this.detailsOpen = false;
            this.hidePreview();
        }
    };

    CascadePaletteWidget.prototype.close = function () {
        this.open = false;
        this.stack = [];
        this.detailsOpen = false;
        this.hidePreview();
        this.backdropEl.style.display = "none";
    };

    /* ---------- focus model ---------- */

    // Move focus between the three palette sections. Browser-level focus
    // moves to the section's DOM node (so keyboard events flow there);
    // this.focus is the canonical state; the popup's data-focus attribute
    // is the visual cue. Calling without args is a no-op safety.
    CascadePaletteWidget.prototype.setFocus = function (section) {
        if (section !== "input" && section !== "menu" && section !== "details") return;
        if (this.focus === section) {
            this._applyFocusAttr();
            return;
        }
        this.focus = section;
        this._applyFocusAttr();
        if (section === "input") this.inputEl.focus();
        else if (section === "menu") this.resultsEl.focus();
        else if (section === "details") this.previewEl.focus();
    };

    CascadePaletteWidget.prototype._applyFocusAttr = function () {
        if (this.popupEl) this.popupEl.dataset.focus = this.focus;
        this._renderHint();
    };

    CascadePaletteWidget.prototype._renderHint = function () {
        if (!this.hintEl) return;
        if (this.editMode) {
            this.hintEl.textContent = HINT_EDIT;
            return;
        }
        if (this.focus === "menu")    this.hintEl.textContent = HINT_MENU;
        else if (this.focus === "details") this.hintEl.textContent = HINT_DETAILS;
        else                          this.hintEl.textContent = HINT_INPUT;
    };

    CascadePaletteWidget.prototype.topStage = function () {
        return this.stack.length ? this.stack[this.stack.length - 1] : null;
    };

    CascadePaletteWidget.prototype.pushStage = function (stage) {
        this.stack.push(stage);
        var softDepth = this.getSoftDepthWarning();
        if (this.stack.length > softDepth && console && console.warn) {
            console.warn(
                "[cascade-palette] stack depth", this.stack.length,
                "exceeds soft warning", softDepth, "— possible cascade loop?"
            );
        }
        this.recomputeStage(stage);
        this.renderStage();
    };

    CascadePaletteWidget.prototype.getSoftDepthWarning = function () {
        var raw = this.wiki.getTiddlerText(SOFT_DEPTH_CONFIG, String(DEFAULT_SOFT_DEPTH));
        var n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? DEFAULT_SOFT_DEPTH : n;
    };

    CascadePaletteWidget.prototype.popStage = function () {
        if (this.stack.length <= 1) {
            this.close();
            return;
        }
        this.stack.pop();
        // Recompute the now-top stage so it reflects any state that changed
        // while we were in the deeper stage (e.g. visibility filters can
        // turn entries on/off after Switch Apps changes active-app).
        var top = this.topStage();
        if (top) this.recomputeStage(top);
        this.renderStage();
    };

    CascadePaletteWidget.prototype.popToDepth = function (depth) {
        // Truncate to keep stages [0..depth].
        if (depth < 0) depth = 0;
        if (depth >= this.stack.length) return;
        this.stack.length = depth + 1;
        // Same refresh logic as popStage — the target stage may have been
        // computed when state was different.
        var top = this.topStage();
        if (top) this.recomputeStage(top);
        this.renderStage();
    };

    /* ---------- stage construction ---------- */

    CascadePaletteWidget.prototype.buildRootStage = function () {
        return {
            kind: "root",
            title: "Root",
            query: "",
            selectedIndex: 0,
            items: [],            // all entries, unfiltered
            results: [],          // entries after query filter
            parentPicked: null,
            entityType: null
        };
    };

    CascadePaletteWidget.prototype.buildFilterStage = function (entry, parentPicked) {
        var entityType = entry.nextEntityType || null;
        // ca-items-from takes precedence over ca-next-scope. Warn once
        // when both are present to flag authoring mistakes — the engine
        // picks items-from but the author probably means one or the other.
        if (entry.itemsFrom && entry.nextScope && console && console.warn) {
            console.warn(
                "[cascade-palette] both ca-items-from and ca-next-scope on",
                entry.title, "— ca-items-from wins"
            );
        }
        var stage = {
            kind: "filter",
            title: entry.nextTitle || entry.name || "Stage",
            query: "",
            selectedIndex: 0,
            // Either-or — `itemsFromFilter` produces synthetic items, plain
            // `filter` produces items from tiddler titles. evaluateFilterStage
            // dispatches.
            filter: entry.itemsFrom ? "" : entry.nextScope,
            itemsFromFilter: entry.itemsFrom || "",
            // `nextDefaultAction` on a drill entry fires when the user hits
            // Enter on an item in this stage AND no entity-type default action
            // is discoverable (typical for enum-picker stages: items are bare
            // strings, no action menu).
            stageDefaultAction: entry.nextDefaultAction || "",
            // Discovered entity-type default action — fired by Enter on a
            // dynamic item when no stageDefaultAction.
            entityDefaultActions: this.lookupEntityDefaultActions(entityType),
            // When the parent drill set `ca-next-as-link`, this stage's
            // results are forced into plain-item rendering — cascade-aware
            // detection in evaluateFilterStage is suppressed.
            asLink: !!entry.nextAsLink,
            items: [],
            results: [],
            parentPicked: parentPicked || null,
            entityType: entityType
        };
        return stage;
    };

    CascadePaletteWidget.prototype.buildActionMenuStage = function (parentPicked, entityType, title) {
        return {
            kind: "actions",
            title: title || parentPicked || "Actions",
            query: "",
            selectedIndex: 0,
            items: [],
            results: [],
            parentPicked: parentPicked,
            entityType: entityType
        };
    };

    // Synthetic confirmation stage. Spec:
    //   title: breadcrumb title (e.g. "Restore default for Grouping")
    //   consequence: human text shown in the details drawer pre-confirm
    //   actions: wikitext fired when the user picks Confirm
    //   vars (optional): variable map to inject when the Confirm leaf fires
    //                    its actions. Lets ca-confirm leaves preserve their
    //                    parent-picked / picked context across the confirm
    //                    stage (which otherwise has no parent context).
    // The stage pops on either choice (handled in fireSelected). Selection
    // defaults to Cancel so accidental Enter does nothing.
    CascadePaletteWidget.prototype.buildConfirmStage = function (spec) {
        var confirmItem = {
            title: "",
            name: "Confirm",
            hint: "",
            icon: "",
            kind: "leaf",
            order: 10,
            group: "",
            actions: spec.actions || "",
            isItem: false
        };
        var cancelItem = {
            title: "",
            name: "Cancel",
            hint: "",
            icon: "",
            kind: "leaf",
            order: 20,
            group: "",
            actions: "",
            isItem: false
        };
        return {
            kind: "confirm",
            title: spec.title || "Confirm",
            query: "",
            selectedIndex: 1,  // default to Cancel — safer for accidental Enter
            items: [confirmItem, cancelItem],
            results: [confirmItem, cancelItem],
            actionVars: spec.vars || null,
            parentPicked: null,
            entityType: null,
            consequenceText: spec.consequence || ""
        };
    };

    /* ---------- result computation ---------- */

    CascadePaletteWidget.prototype.recomputeStage = function (stage) {
        if (stage.kind === "root") {
            stage.items = this.sortEntries(this.loadEntries());
        } else if (stage.kind === "filter") {
            stage.items = this.evaluateFilterStage(stage);
        } else if (stage.kind === "actions") {
            stage.items = this.sortEntries(this.loadActionsForType(stage.entityType));
        } else if (stage.kind === "confirm") {
            // Items are pre-built by buildConfirmStage; nothing to recompute.
            stage.results = stage.items.slice();
            return;
        }
        this.applyQueryToStage(stage);
    };

    CascadePaletteWidget.prototype.loadActionsForType = function (entityType) {
        var self = this;
        // Actions matching the entity type OR globals (ca-entity-type: *).
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]] +[!is[draft]]"
        );
        return titles
            .map(function (title) {
                return self.readCascadeFields(title);
            })
            .filter(function (a) {
                var t = self.getActionEntityType(a.title);
                return t === entityType || t === "*";
            });
    };

    CascadePaletteWidget.prototype.getActionEntityType = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        return f["ca-entity-type"] || "";
    };

    CascadePaletteWidget.prototype.lookupEntityDefaultActions = function (entityType) {
        if (!entityType) return null;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]]"
        );
        for (var i = 0; i < titles.length; i++) {
            var t = self.wiki.getTiddler(titles[i]);
            var f = (t && t.fields) || {};
            var fType = f["ca-entity-type"];
            var fDefault = f["ca-default"];
            if (fType === entityType && fDefault === "yes") {
                return {
                    title: titles[i],
                    actions: f["ca-actions"] || "",
                    kind: f["ca-kind"] || "leaf"
                };
            }
        }
        return null;
    };

    CascadePaletteWidget.prototype.applyQueryToStage = function (stage) {
        var filtered = this.filterByQuery(stage.items, stage.query);
        var maxResults = this.getMaxResults();
        // Reorder into visual (grouped) sequence when grouping is enabled,
        // so keyboard nav's linear `selectedIndex` matches the rendered row
        // order. With grouping off, keep the items' natural sort.
        var ordered = this.isGroupingEnabled() ? this.reorderByGroup(filtered) : filtered;
        stage.results = ordered.slice(0, maxResults);
        if (stage.selectedIndex >= stage.results.length) {
            stage.selectedIndex = Math.max(0, stage.results.length - 1);
        }
    };

    CascadePaletteWidget.prototype.isGroupingEnabled = function () {
        var raw = this.wiki.getTiddlerText(GROUPING_CONFIG, DEFAULT_TRUE_VALUE);
        var s = String(raw || "").toLowerCase().trim();
        return s !== "no" && s !== "false" && s !== "off" && s !== "0";
    };

    CascadePaletteWidget.prototype.reorderByGroup = function (items) {
        var groupOrder = [];
        var buckets = Object.create(null);
        items.forEach(function (item) {
            var g = item.group || "";
            if (!(g in buckets)) {
                buckets[g] = [];
                groupOrder.push(g);
            }
            buckets[g].push(item);
        });
        var out = [];
        groupOrder.forEach(function (g) {
            for (var i = 0; i < buckets[g].length; i++) out.push(buckets[g][i]);
        });
        return out;
    };

    CascadePaletteWidget.prototype.loadEntries = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ENTRY_TAG + "]]"
        );
        return titles
            .map(function (title) {
                return self.readCascadeFields(title);
            })
            .filter(function (entry) {
                return self.isEntryVisible(entry.title);
            });
    };

    // Honour `ca-visibility-filter`. If the field is present and the filter
    // returns no results, the entry is hidden. Used by catalogues to gate
    // entries on global state (e.g. "Current App" visible only when an
    // appify-app is active).
    CascadePaletteWidget.prototype.isEntryVisible = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var visFilter = f["ca-visibility-filter"];
        if (!visFilter) return true;
        try {
            var results = this.wiki.filterTiddlers(visFilter);
            return results.length > 0;
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-visibility-filter error on",
                    title, "—", err && err.message
                );
            }
            return true; // keep visible on filter error
        }
    };

    CascadePaletteWidget.prototype.readCascadeFields = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        return this._buildCascadeItem(f, title);
    };

    // Build a cascade item from an object of ca-* properties. Used by both
    // readCascadeFields (where the object is a tiddler's field map) and
    // ca-items-from synthesis (where the object is parsed-JSON from a
    // user filter). Synthetic items have empty title — downstream code
    // that touches title must early-return on empty.
    CascadePaletteWidget.prototype.readCascadeFromObject = function (obj) {
        var title = obj["title"] || "";  // synthetic items carry no backing tiddler
        var item = this._buildCascadeItem(obj, title);
        item.isSynthetic = !title;
        return item;
    };

    CascadePaletteWidget.prototype._buildCascadeItem = function (f, title) {
        var orderRaw = f["ca-order"];
        var order = orderRaw !== undefined && orderRaw !== ""
            ? parseFloat(orderRaw)
            : DEFAULT_ORDER;
        if (isNaN(order)) order = DEFAULT_ORDER;
        return {
            title: title,
            name: f["ca-name"] || title || "",
            hint: f["ca-hint"] || "",
            icon: f["ca-icon"] || "",
            kind: f["ca-kind"] || "leaf",
            order: order,
            group: title ? this.resolveGroup(title, f) : (f["ca-group"] || ""),
            actions: f["ca-actions"] || "",
            nextScope: f["ca-next-scope"] || "",
            // `ca-items-from`: drill items can synthesise their child stage
            // from a filter that returns JSON-encoded item shapes (one per
            // result). Mutually exclusive with `ca-next-scope`; if both
            // present, ca-items-from wins.
            itemsFrom: f["ca-items-from"] || "",
            nextTitle: f["ca-next-title"] || "",
            nextEntityType: f["ca-next-entity-type"] || "",
            nextDefaultAction: f["ca-next-default-action"] || "",
            // When `yes`, the next-stage filter results are rendered as
            // plain item rows (no chevron, Enter navigates) even if the
            // result tiddlers carry `ca-kind`. Diagnostic listings use
            // this so loaded entries/actions don't look drillable.
            nextAsLink: (f["ca-next-as-link"] || "").toLowerCase() === "yes",
            // Scribe-style binding used by `ca-kind: toggle` (and future
            // edit kinds). `bindPath` is a comma-separated walk into the
            // field text when it's JSON. `bindType` selects a scribetype
            // handler (default text/plain — pass-through). Setting a richer
            // type like application/x-string-array enables list-membership
            // semantics on toggle and provides array round-tripping for
            // text/number/date kinds.
            bindTiddler: f["ca-bind-tiddler"] || "",
            bindField: f["ca-bind-field"] || "text",
            bindPath: f["ca-bind-path"] || "",
            bindType: f["ca-bind-type"] ||
                ((f["ca-kind"] === "date") ? "application/x-tw-date" : DEFAULT_BIND_TYPE),
            trueValue: f["ca-true-value"] || DEFAULT_TRUE_VALUE,
            falseValue: f["ca-false-value"] || DEFAULT_FALSE_VALUE,
            // Numeric edit-kind config. `min`/`max` are nullable so callers
            // can opt into the slider rendering by setting both. Step
            // magnitudes are layered by modifier: bare key = step, Shift =
            // stepMedium, Ctrl = stepLarge.
            minValue: this._parseNumOrNull(f["ca-min"]),
            maxValue: this._parseNumOrNull(f["ca-max"]),
            step: this._parseNumOrDefault(f["ca-step"], DEFAULT_STEP),
            stepMedium: this._parseNumOrDefault(f["ca-step-medium"], DEFAULT_STEP_MEDIUM),
            stepLarge: this._parseNumOrDefault(f["ca-step-large"], DEFAULT_STEP_LARGE),
            defaultValue: this._parseNumOrNull(f["ca-default-value"]),
            // Suffix appended to the displayed value (e.g. "vw" for a width
            // setting). Storage stays bare numeric; consumers concatenate
            // when applying.
            unit: f["ca-unit"] || "",
            // Date display format — TW format-date template string. Used by
            // `ca-kind: date` row rendering. Default `DD.MM.YYYY` (German);
            // override with e.g. `YYYY-0MM-0DD` or `DDth MMM YYYY`.
            dateFormat: f["ca-date-format"] || "DD.MM.YYYY",
            // Confirm-on-fire (P3): when `ca-confirm: yes` is set on a leaf,
            // fireSelected wraps its actions in a confirm-stage instead of
            // firing them directly. consequence-text supports the standard
            // stage substitution variables.
            confirm: (f["ca-confirm"] || "").toLowerCase() === "yes",
            confirmConsequence: f["ca-confirm-consequence"] || "",
            // Post-fire behaviour for leaves. Default = close palette. "pop"
            // = fire action, pop one stage, keep palette open — useful for
            // sub-drills that act as pickers (e.g. ref / enum single-select
            // inside a multi-field edit flow): user picks a value, lands
            // back on the parent stage to continue editing other fields.
            afterFire: (f["ca-after-fire"] || "").toLowerCase(),
            isItem: false,           // entries / actions vs dynamic items
            isSynthetic: false       // overridden by readCascadeFromObject
        };
    };

    CascadePaletteWidget.prototype._parseNumOrNull = function (raw) {
        if (raw === undefined || raw === null || raw === "") return null;
        var n = parseFloat(raw);
        return isNaN(n) ? null : n;
    };

    CascadePaletteWidget.prototype._parseNumOrDefault = function (raw, fallback) {
        var n = this._parseNumOrNull(raw);
        return n === null ? fallback : n;
    };

    /* ---------- bound-value read/write ----------

    The toggle / number / text / date kinds read and write a single value
    via a scribe-style binding:
        ca-bind-tiddler   target tiddler title
        ca-bind-field     target field (default "text")
        ca-bind-path      optional comma-separated walk inside the JSON
                          value of the field (e.g. "prefs,layout")
        ca-bind-type      scribetype handler name (default "text/plain")

    Value flow on READ:
        field text (or sub-path value) → handler.fromField() → display value
    Value flow on WRITE:
        UI value → handler.toField() → field text (or sub-path value)

    The handler is resolved lazily via $tw.modules. Unknown bind-types
    fall back to text/plain (string pass-through) so missing scribe plugin
    or typos don't break edit kinds.

    \-------------------------------------------- */

    // Lazily-cached scribetype handler map. Built on first access; if scribe
    // is loaded later (unlikely but defensive), this re-fetches.
    CascadePaletteWidget.prototype._scribeHandlers = function () {
        if (!this._scribeHandlersCache) {
            this._scribeHandlersCache = $tw.modules.getModulesByTypeAsHashmap("scribetype") || {};
        }
        return this._scribeHandlersCache;
    };

    CascadePaletteWidget.prototype._handlerFor = function (bindType) {
        var handlers = this._scribeHandlers();
        return handlers[bindType] || handlers[DEFAULT_BIND_TYPE] || null;
    };

    // Read the raw value at the item's bind target — field text in whole-
    // field mode, or the JSON-decoded sub-path value. No type conversion.
    CascadePaletteWidget.prototype._readBoundRaw = function (item) {
        if (!item.bindTiddler) return undefined;
        var t = this.wiki.getTiddler(item.bindTiddler);
        if (!t) return undefined;
        var fieldText = t.fields[item.bindField];
        if (fieldText === undefined) return undefined;
        if (!item.bindPath) return fieldText;
        try {
            var node = JSON.parse(fieldText);
            var parts = item.bindPath.split(",");
            for (var i = 0; i < parts.length; i++) {
                if (node === null || node === undefined) return undefined;
                node = node[parts[i]];
            }
            return node;
        } catch (err) {
            return undefined;
        }
    };

    CascadePaletteWidget.prototype.readBoundValue = function (item) {
        var raw = this._readBoundRaw(item);
        if (raw === undefined) return undefined;
        var handler = this._handlerFor(item.bindType);
        if (handler && typeof handler.fromField === "function") {
            try {
                return handler.fromField(raw);
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] bind-type", item.bindType,
                        "fromField error on", item.bindTiddler, "—",
                        err && err.message
                    );
                }
                return undefined;
            }
        }
        return raw;
    };

    CascadePaletteWidget.prototype.writeBoundValue = function (item, value) {
        if (!item.bindTiddler) return;
        var handler = this._handlerFor(item.bindType);
        var converted = value;
        if (handler && typeof handler.toField === "function") {
            try {
                converted = handler.toField(value);
            } catch (err) {
                // Bad input from the user — surface and abort the write so
                // the previous value stays intact.
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] bind-type", item.bindType,
                        "toField rejected input", JSON.stringify(value),
                        "—", err && err.message
                    );
                }
                throw err;
            }
        }
        if (!item.bindPath) {
            // Whole-field write. Strings go in verbatim; non-strings are
            // JSON-serialised (matches scribe.js writeFromState behaviour).
            var existing = this.wiki.getTiddler(item.bindTiddler);
            var fields = { title: item.bindTiddler };
            if (converted === undefined || converted === null) {
                fields[item.bindField] = "";
            } else if (typeof converted === "string") {
                fields[item.bindField] = converted;
            } else {
                fields[item.bindField] = JSON.stringify(converted);
            }
            this.wiki.addTiddler(new $tw.Tiddler(
                (existing && existing.fields) || {},
                fields
            ));
            return;
        }
        // Sub-path write — read JSON, mutate, serialize back. Walks ahead
        // create intermediate objects so deep paths into a missing tree
        // still resolve.
        var t = this.wiki.getTiddler(item.bindTiddler);
        var fieldText = t && t.fields[item.bindField];
        var root;
        try {
            root = fieldText ? JSON.parse(fieldText) : {};
        } catch (err) {
            root = {};
        }
        var parts = item.bindPath.split(",");
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var key = parts[i];
            if (node[key] === undefined || node[key] === null || typeof node[key] !== "object") {
                node[key] = {};
            }
            node = node[key];
        }
        node[parts[parts.length - 1]] = converted;
        var newFields = { title: item.bindTiddler };
        newFields[item.bindField] = JSON.stringify(root, null, 4);
        this.wiki.addTiddler(new $tw.Tiddler(
            (t && t.fields) || {},
            newFields
        ));
    };

    // An item is "overridden" when its bound tiddler exists in the wiki
    // store AND is also defined as a shadow — meaning the user has saved
    // a real tiddler over the plugin's shadow. Pure shadows (untouched
    // defaults) and user-only tiddlers (no shadow source) are not
    // overridden in this sense.
    CascadePaletteWidget.prototype.isOverridden = function (item) {
        if (!item || !item.bindTiddler) return false;
        return this.wiki.tiddlerExists(item.bindTiddler) &&
            this.wiki.isShadowTiddler(item.bindTiddler);
    };

    // Read the shadow's value for a bound item — i.e. what the value
    // would be if the override were deleted. Uses the boot-time
    // shadowTiddlers map (semi-private API) since `wiki.getTiddler`
    // resolves overrides first.
    CascadePaletteWidget.prototype.getDefaultValue = function (item) {
        if (!item || !item.bindTiddler) return undefined;
        var src = $tw.boot && $tw.boot.shadowTiddlers && $tw.boot.shadowTiddlers[item.bindTiddler];
        if (!src || !src.tiddler) return undefined;
        var fields = src.tiddler.fields || {};
        return fields[item.bindField];
    };

    // Boolean coercion: a stored value matches "true" if it equals the
    // item's trueValue OR a common truthy literal. Defensive against
    // legacy values like `true` vs `yes`.
    CascadePaletteWidget.prototype.readNumberValue = function (item) {
        var raw = this.readBoundValue(item);
        if (raw === undefined || raw === null || raw === "") {
            return item.defaultValue !== null ? item.defaultValue : 0;
        }
        var n = parseFloat(raw);
        if (isNaN(n)) return item.defaultValue !== null ? item.defaultValue : 0;
        return n;
    };

    CascadePaletteWidget.prototype.clampNumber = function (item, n) {
        if (item.minValue !== null && n < item.minValue) n = item.minValue;
        if (item.maxValue !== null && n > item.maxValue) n = item.maxValue;
        return n;
    };

    CascadePaletteWidget.prototype.stepMagnitudeFor = function (item, e) {
        if (e.ctrlKey) return item.stepLarge;
        if (e.shiftKey) return item.stepMedium;
        return item.step;
    };

    CascadePaletteWidget.prototype.isToggleOn = function (item) {
        var v = this.readBoundValue(item);
        if (v === undefined || v === null || v === "") {
            // Fall back: treat unset as off by default.
            return false;
        }
        // List-membership semantics: when bound to a string-array field,
        // the toggle's trueValue is one element of a multi-value set.
        // "on" = trueValue is currently in the list. Bare bind types use
        // scalar comparison.
        if (item.bindType === STRING_ARRAY_TYPE) {
            var list = String(v).split(/\s+/).filter(function (s) { return s; });
            var needle = String(item.trueValue);
            return list.indexOf(needle) !== -1;
        }
        if (typeof v === "boolean") return v;
        var s = String(v).toLowerCase();
        return s === String(item.trueValue).toLowerCase() ||
            s === "yes" || s === "true" || s === "on" || s === "1";
    };

    // Resolve the cluster label for an item. Explicit `ca-group` wins.
    // Otherwise derive from the shadow source: look up the owning plugin
    // tiddler and use its `name` field (the lowercase short name from
    // plugin.info). Falls back to the plugin title with the `$:/plugins/`
    // prefix stripped if the plugin has no `name`. Non-shadow (user-
    // authored) tiddlers get "" — they share an unnamed cluster which
    // renders as "Other" when mixed with named groups.
    CascadePaletteWidget.prototype.resolveGroup = function (title, fields) {
        if (fields && fields["ca-group"]) return fields["ca-group"];
        var src = this.wiki.getShadowSource ? this.wiki.getShadowSource(title) : null;
        if (!src) return "";
        var pluginTid = this.wiki.getTiddler(src);
        if (pluginTid && pluginTid.fields && pluginTid.fields.name) {
            return pluginTid.fields.name;
        }
        return src.replace(/^\$:\/plugins\//, "");
    };

    CascadePaletteWidget.prototype.evaluateFilterStage = function (stage) {
        // ca-items-from path: filter returns one JSON-string per synthetic
        // item. Each parsed object is treated as a fully-formed cascade-item
        // spec (the same shape readCascadeFields normally extracts from a
        // tiddler's fields).
        if (stage.itemsFromFilter) {
            return this._evaluateItemsFromStage(stage);
        }
        if (!stage.filter) return [];
        var variables = this.buildStageVariables(stage, null);
        var titles;
        try {
            titles = this.wiki.filterTiddlers(
                stage.filter,
                this.makeFakeWidget(variables)
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] filter error in stage", stage.title,
                    err && err.message
                );
            }
            return [];
        }
        var self = this;
        var asLink = stage.asLink;
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var fields = (t && t.fields) || {};
            // Cascade-aware detection: if the result tiddler carries
            // `ca-kind`, treat it as a real entry/action (drill or leaf).
            // The parent drill can opt out via `ca-next-as-link: yes` —
            // useful for diagnostic lists where the user wants to OPEN
            // each tiddler, not drill into it.
            if (!asLink && fields["ca-kind"]) {
                return self.readCascadeFields(title);
            }
            // Plain dynamic item — prefer `caption` field for the displayed
            // name, but keep the raw title for the right-aligned column.
            var caption = fields.caption || "";
            return {
                title: title,
                name: caption || title,
                rawTitle: title,
                hint: "",
                kind: "item",
                order: DEFAULT_ORDER,
                group: self.resolveGroup(title, fields),
                isItem: true
            };
        });
    };

    // ca-items-from: evaluate the filter, parse each result as JSON, build
    // a cascade item per parsed object. Parse errors are logged once per
    // result and the item is skipped — partial results survive bad JSON.
    CascadePaletteWidget.prototype._evaluateItemsFromStage = function (stage) {
        var variables = this.buildStageVariables(stage, null);
        var jsonStrings;
        try {
            jsonStrings = this.wiki.filterTiddlers(
                stage.itemsFromFilter,
                this.makeFakeWidget(variables)
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] ca-items-from filter error in stage",
                    stage.title, "—", err && err.message
                );
            }
            return [];
        }
        var self = this;
        var items = [];
        jsonStrings.forEach(function (str) {
            if (!str || !str.trim()) return;
            var obj;
            try {
                obj = JSON.parse(str);
            } catch (parseErr) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-items-from JSON parse error in stage",
                        stage.title, "—", parseErr && parseErr.message,
                        "input:", str.length > 80 ? str.slice(0, 80) + "..." : str
                    );
                }
                return;
            }
            if (!obj || typeof obj !== "object") return;
            items.push(self.readCascadeFromObject(obj));
        });
        return items;
    };

    // Build the full variable map exposed to filter and action contexts.
    // - `query` — current stage's input text
    // - `picked` — the just-picked item (null for filter eval, set for actions)
    // - `parent-picked` — pick from the stage one back
    // - `stage-N-picked` — pick from stage index N (0 = root). For root entries
    //   we don't have a picked title, so `stage-0-picked` is "".
    CascadePaletteWidget.prototype.buildStageVariables = function (stage, picked) {
        var vars = {
            "query": stage.query || "",
            "picked": picked || "",
            "parent-picked": stage.parentPicked || ""
        };
        // Walk the stack to expose stage-N-picked. The current stage's
        // own pick is captured via `picked` above; we record parent picks
        // from the actual stack history.
        for (var i = 0; i < this.stack.length; i++) {
            var s = this.stack[i];
            vars["stage-" + i + "-picked"] = s.parentPicked || "";
        }
        return vars;
    };

    CascadePaletteWidget.prototype.makeFakeWidget = function (variables) {
        // Delegate to TW core's Widget.prototype.makeFakeWidgetWithVariables:
        // it layers `variables` on top of this widget's parent chain (so
        // both injected literals AND $:/tags/Macro-tagged \function defs
        // imported by the startup `\import` pragma resolve correctly), and
        // — crucially — propagates `makeFakeWidgetWithVariables` onto the
        // returned fake widget. Filter prefixes `:filter`, `:map`, `:reduce`,
        // `:sortsub` all call back into this method to spawn per-iteration
        // child widgets. A plain object stub would throw "is not a function".
        return this.makeFakeWidgetWithVariables(variables);
    };

    /* ---------- navigator routing ----------

    Our widget mounts via a startup module into document.body, OUTSIDE the
    page's main widget tree. So actions invoked from this widget bubble up
    via our (rootWidget) parent and NEVER reach the navigator widget that
    lives inside the page tree. That breaks `<$action-navigate>`, `tm-edit-
    tiddler`, `tm-close-tiddler` and friends — all the navigator-routed
    messages — even though `tm-save-wiki` etc. still work because they have
    handlers at rootWidget level.

    Fix: find the navigator widget in `$tw.pageWidgetNode`'s subtree at
    action-fire time, and invoke the action wikitext with the navigator as
    parentWidget. Events then bubble naturally into the navigator and its
    handlers fire.

    Falls back to `$tw.rootWidget` if no navigator is found (so messages with
    global handlers like `tm-save-wiki` still work).

    \--------------------------------------- */

    // Walk the page widget tree to find a suitable action-parent. We prefer
    // the deepest `statewrap` widget (where `statewrapContext` lives — required
    // by `$action-statewrap-navigate` to resolve channels). The statewrap
    // sits INSIDE the appify-app, so picking it gives both statewrap context
    // and any ancestor navigators (events bubble UP through appify-app and
    // beyond). Falls back to navigator, then rootWidget.
    //
    // Why we don't use appify-app: `getStatewrapContext` (in rimir/statewrap
    // utils.js) walks `parentWidget` UP looking for `w.statewrapContext`.
    // The context property is set on the `statewrap` widget itself, not on
    // its ancestor appify-app. Parenting an action to appify-app means walking
    // up from appify-app — which never visits statewrap (it's a descendant).
    CascadePaletteWidget.prototype.findActionParent = function () {
        if (!$tw.pageWidgetNode) return $tw.rootWidget || null;
        var statewrap = null;
        var navigator = null;
        var visited = new Set();
        function walk(w) {
            if (!w || visited.has(w)) return;
            visited.add(w);
            if (w.parseTreeNode) {
                if (w.parseTreeNode.type === "statewrap") {
                    statewrap = w;  // capture deepest
                } else if (w.parseTreeNode.type === "navigator" && !navigator) {
                    navigator = w;
                }
            }
            if (w.children) {
                for (var i = 0; i < w.children.length; i++) {
                    walk(w.children[i]);
                }
            }
        }
        walk($tw.pageWidgetNode);
        return statewrap || navigator || $tw.rootWidget || null;
    };

    CascadePaletteWidget.prototype.invokeViaNavigator = function (actionString, variables) {
        if (!actionString) return;
        var parent = this.findActionParent() || this;
        try {
            var parser = this.wiki.parseText(
                "text/vnd.tiddlywiki",
                actionString,
                { parentWidget: parent }
            );
            var widgetNode = this.wiki.makeWidget(parser, {
                parentWidget: parent,
                document: $tw.fakeDocument,
                variables: variables || {}
            });
            var container = $tw.fakeDocument.createElement("div");
            widgetNode.render(container, null);
            widgetNode.invokeActions(this, null);
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] action invocation failed:",
                    err && err.message,
                    err
                );
            }
        }
    };

    CascadePaletteWidget.prototype.filterByQuery = function (items, query) {
        if (!query) return items.slice();
        var q = query.toLowerCase();
        return items.filter(function (item) {
            return item.name.toLowerCase().indexOf(q) !== -1
                || (item.hint && item.hint.toLowerCase().indexOf(q) !== -1);
        });
    };

    CascadePaletteWidget.prototype.sortEntries = function (items) {
        return items.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
    };

    CascadePaletteWidget.prototype.getMaxResults = function () {
        var raw = this.wiki.getTiddlerText(MAX_RESULTS_CONFIG, String(DEFAULT_MAX_RESULTS));
        var n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? DEFAULT_MAX_RESULTS : n;
    };

    /* ---------- rendering ---------- */

    CascadePaletteWidget.prototype.renderStage = function () {
        this.renderBreadcrumb();
        this.renderInput();
        this.renderResults();
    };

    CascadePaletteWidget.prototype.renderBreadcrumb = function () {
        while (this.breadcrumbEl.firstChild) {
            this.breadcrumbEl.removeChild(this.breadcrumbEl.firstChild);
        }
        var self = this;
        this.stack.forEach(function (stage, i) {
            if (i > 0) {
                var sep = self.document.createElement("span");
                sep.className = "rcp-breadcrumb-sep";
                sep.textContent = " › ";
                self.breadcrumbEl.appendChild(sep);
            }
            var seg = self.document.createElement("span");
            seg.className = "rcp-breadcrumb-seg";
            if (i < self.stack.length - 1) {
                seg.classList.add("rcp-breadcrumb-clickable");
                seg.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    self.popToDepth(i);
                    self.inputEl.focus();
                });
            }
            seg.textContent = stage.title;
            self.breadcrumbEl.appendChild(seg);
        });
    };

    CascadePaletteWidget.prototype.renderInput = function () {
        var stage = this.topStage();
        if (!stage) return;
        this.inputEl.value = stage.query || "";
    };

    CascadePaletteWidget.prototype.renderResults = function () {
        while (this.resultsEl.firstChild) {
            this.resultsEl.removeChild(this.resultsEl.firstChild);
        }
        var stage = this.topStage();
        if (!stage) return;
        if (stage.results.length === 0) {
            var emptyEl = this.document.createElement("li");
            emptyEl.className = "rcp-empty";
            emptyEl.textContent = "No results";
            this.resultsEl.appendChild(emptyEl);
            return;
        }
        var self = this;
        this._selectedRowEl = null;

        // Headers suppressed when all results belong to a single group
        // (matches breadcrumb-hide-on-root behaviour). `stage.results` is
        // already reordered into visual-group sequence by `applyQueryToStage`,
        // so a single pass with prev-group tracking is enough.
        var groupingOn = this.isGroupingEnabled();
        var distinct = {};
        var distinctCount = 0;
        stage.results.forEach(function (item) {
            var g = item.group || "";
            if (!(g in distinct)) { distinct[g] = true; distinctCount++; }
        });
        var showHeaders = groupingOn && distinctCount > 1;
        var prevGroup = null;

        stage.results.forEach(function (item, i) {
            var g = item.group || "";
            if (showHeaders && g !== prevGroup) {
                var headerEl = self.document.createElement("li");
                headerEl.className = "rcp-group-header";
                headerEl.textContent = g || "Other";
                self.resultsEl.appendChild(headerEl);
                prevGroup = g;
            }
            self._appendResultRow(item, i, stage);
        });

        if (self._selectedRowEl && self._selectedRowEl.scrollIntoView) {
            self._selectedRowEl.scrollIntoView({ block: "nearest" });
        }
        // Preview drawer mirrors the selected row — refresh content whenever
        // the result list re-renders (arrow nav, stage push/pop, etc.).
        if (this.detailsOpen) this.renderDetails();
    };

    /* Row rendering is split into three phases per row:
       - icon slot (left)     — _renderRowIcon
       - name (centre, flex)  — always rendered inline
       - value slot (right)   — _renderRowValue, dispatches by kind
       The dispatcher (_appendResultRow) also handles the row container,
       selection state, click handler, and chevron for drill rows. */

    CascadePaletteWidget.prototype._appendResultRow = function (item, i, stage) {
        var self = this;
        var rowEl = this.document.createElement("li");
        rowEl.className =
            "rcp-row" + (i === stage.selectedIndex ? " rcp-row-selected" : "");
        if (item.kind === "drill") rowEl.classList.add("rcp-row-drill");
        if (item.kind === "toggle") rowEl.classList.add("rcp-row-toggle");
        // Hover help — ca-hint is shown as a subtitle in some rows but is
        // ALSO surfaced as the native HTML tooltip on every row, so even
        // settings rows (which use the right slot for the bound value) get
        // discoverable help text.
        if (item.hint) rowEl.title = item.hint;

        this._renderRowIcon(rowEl, item);

        var nameEl = this.document.createElement("span");
        nameEl.className = "rcp-row-name";
        nameEl.textContent = item.name;
        rowEl.appendChild(nameEl);

        this._renderRowValue(rowEl, item);

        // Overridden-default marker — small dot after the value, before any
        // chevron. Only meaningful for bindable kinds.
        if (this.isOverridden(item)) {
            var dotEl = this.document.createElement("span");
            dotEl.className = "rcp-row-overridden";
            dotEl.textContent = "●";
            dotEl.title = "Overridden — DEL to restore default";
            rowEl.appendChild(dotEl);
        }

        if (item.kind === "drill") {
            var chevronEl = this.document.createElement("span");
            chevronEl.className = "rcp-row-chevron";
            chevronEl.textContent = "›";
            rowEl.appendChild(chevronEl);
        }

        rowEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            stage.selectedIndex = i;
            self.setFocus("menu");
            self.fireSelected(e.shiftKey);
        });

        if (i === stage.selectedIndex) {
            this._selectedRowEl = rowEl;
        }
        this.resultsEl.appendChild(rowEl);
    };

    // For toggles, a checkbox glyph occupies the icon slot. For other kinds,
    // ca-icon takes the slot. Slot is shared so the visual column lines up.
    CascadePaletteWidget.prototype._renderRowIcon = function (rowEl, item) {
        if (item.kind === "toggle") {
            var on = this.isToggleOn(item);
            var cbEl = this.document.createElement("span");
            cbEl.className = "rcp-row-checkbox" + (on ? " rcp-row-checkbox-on" : "");
            cbEl.textContent = on ? "☑" : "☐";
            rowEl.appendChild(cbEl);
            return;
        }
        if (item.icon) {
            var iconEl = this.document.createElement("span");
            iconEl.className = "rcp-row-icon";
            iconEl.textContent = item.icon;
            rowEl.appendChild(iconEl);
        }
    };

    // Right-aligned slot — dispatches by kind. Kept as a sequence of small
    // helpers so adding a new kind (Phase D's slider/enum etc.) doesn't
    // require touching the dispatcher.
    CascadePaletteWidget.prototype._renderRowValue = function (rowEl, item) {
        switch (item.kind) {
            case "toggle": this._renderToggleValue(rowEl, item); return;
            case "text":   this._renderTextValue(rowEl, item); return;
            case "number": this._renderNumberValue(rowEl, item); return;
            case "date":   this._renderDateValue(rowEl, item); return;
        }
        // Drill carrying a binding (e.g. ref/enum picker sub-drill in a
        // field-edit flow): surface the currently-bound value on the right
        // so the user can see their pick without having to drill in again.
        if (item.kind === "drill" && item.bindTiddler && item.bindField) {
            this._renderBoundDrillValue(rowEl, item);
            return;
        }
        // Non-edit kinds.
        if (item.isItem && item.rawTitle && item.rawTitle !== item.name) {
            var titleEl = this.document.createElement("span");
            titleEl.className = "rcp-row-title";
            titleEl.textContent = item.rawTitle;
            titleEl.title = item.rawTitle;
            rowEl.appendChild(titleEl);
            return;
        }
        if (item.hint) {
            var hintEl = this.document.createElement("span");
            hintEl.className = "rcp-row-hint";
            hintEl.textContent = item.hint;
            rowEl.appendChild(hintEl);
        }
    };

    CascadePaletteWidget.prototype._renderToggleValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var displayed = raw === undefined || raw === null || raw === ""
            ? "(unset)"
            : (this.isToggleOn(item) ? item.trueValue : item.falseValue);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value";
        valueEl.textContent = displayed;
        rowEl.appendChild(valueEl);
    };

    // Resolve a tiddler reference to a human caption — prefer the target
    // tiddler's `caption` field; fall back to the raw title.
    CascadePaletteWidget.prototype._displayRef = function (val) {
        if (!val) return "";
        var t = this.wiki.getTiddler(String(val));
        var caption = t && t.fields && t.fields.caption;
        return caption ? String(caption) : String(val);
    };

    CascadePaletteWidget.prototype._renderBoundDrillValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var text;
        if (raw === undefined || raw === null || raw === "") {
            text = "(unset)";
        } else if (Array.isArray(raw)) {
            // string-array multi-select: comma-join captions for compactness.
            var self = this;
            text = raw.length
                ? raw.map(function (v) { return self._displayRef(v); }).join(", ")
                : "(unset)";
        } else {
            text = this._displayRef(String(raw)) || "(unset)";
        }
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-text";
        valueEl.textContent = text;
        valueEl.title = text;
        rowEl.appendChild(valueEl);
    };

    CascadePaletteWidget.prototype._renderTextValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var text = raw === undefined || raw === null ? "(unset)" : String(raw);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-text";
        valueEl.textContent = text;
        valueEl.title = text;  // full value on hover when truncated
        rowEl.appendChild(valueEl);
    };

    CascadePaletteWidget.prototype._renderDateValue = function (rowEl, item) {
        var raw = this._readBoundRaw(item);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-date";
        if (raw === undefined || raw === null || raw === "") {
            valueEl.textContent = "(unset)";
            rowEl.appendChild(valueEl);
            return;
        }
        // Format the stored TW date string via the item's ca-date-format.
        // Falls back to whatever fromField produces if formatting fails.
        var formatted = "";
        try {
            var d = $tw.utils.parseDate(String(raw));
            if (d && !isNaN(d.getTime())) {
                formatted = $tw.utils.formatDateString(d, item.dateFormat || "DD.MM.YYYY");
            }
        } catch (err) { /* fall through */ }
        if (!formatted) {
            formatted = this.readBoundValue(item) || String(raw);
        }
        valueEl.textContent = formatted;
        valueEl.title = formatted;
        rowEl.appendChild(valueEl);
    };

    CascadePaletteWidget.prototype._renderNumberValue = function (rowEl, item) {
        var nVal = this.readNumberValue(item);
        var hasRange = item.minValue !== null && item.maxValue !== null
            && item.maxValue > item.minValue;
        if (hasRange) {
            var barWrap = this.document.createElement("span");
            barWrap.className = "rcp-row-slider";
            var fillEl = this.document.createElement("span");
            fillEl.className = "rcp-row-slider-fill";
            var frac = (nVal - item.minValue) / (item.maxValue - item.minValue);
            if (frac < 0) frac = 0;
            if (frac > 1) frac = 1;
            fillEl.style.width = (frac * 100) + "%";
            barWrap.appendChild(fillEl);
            rowEl.appendChild(barWrap);
        }
        var numEl = this.document.createElement("span");
        numEl.className = "rcp-row-value";
        numEl.textContent = String(nVal) + (item.unit || "");
        rowEl.appendChild(numEl);
    };

    /* ---------- details drawer ----------

    Rendered in three layers:
      1. Help block — `ca-help` (multiline) falls back to `ca-hint`.
         Rendered as a styled lead-in when present.
      2. Template body — wikitext tiddler tagged TEMPLATE_TAG whose
         `ca-template-applies` filter accepts the picked tiddler. Multiple
         matches → tab strip; the active tab's template is rendered with
         `currentTiddler = picked.title` so the wikitext can transclude
         fields freely.
      3. Fields-table fallback — when no template applies AND there's no
         help text, fall back to the raw key/value table (the v0.1 model).

    Rendered DOM is cached on `this._detailsCache` keyed by (title,
    templateIdx) so navigating away and back doesn't re-parse wikitext.
    Invalidation: selection change to a different title, template tab
    change, wiki change on the cached title (see _wikiChangeHook).

    \------------------------------------ */

    CascadePaletteWidget.prototype.renderDetails = function () {
        var stage = this.topStage();
        if (!stage || !stage.results.length) {
            this.hidePreview();
            return;
        }
        var picked = stage.results[stage.selectedIndex];
        if (!picked || !picked.title) {
            this.hidePreview();
            return;
        }

        // Reset template-tab index when the selected row changes.
        if (this._detailsCache && this._detailsCache.title !== picked.title) {
            this.detailsTemplateIdx = 0;
        }

        while (this.previewEl.firstChild) {
            this.previewEl.removeChild(this.previewEl.firstChild);
        }

        var headerEl = this.document.createElement("div");
        headerEl.className = "rcp-preview-title";
        headerEl.textContent = picked.title;
        this.previewEl.appendChild(headerEl);

        // Confirm-stage consequence banner — surfaces what DEL or Enter
        // will do. Pre-empts both help text and templates so the user
        // sees the destructive consequence first.
        if (stage.kind === "confirm" && stage.consequenceText) {
            var consEl = this.document.createElement("div");
            consEl.className = "rcp-details-consequence";
            consEl.textContent = stage.consequenceText;
            this.previewEl.appendChild(consEl);
        }

        var helpText = this._resolveHelpText(picked);
        if (helpText) {
            var helpEl = this.document.createElement("div");
            helpEl.className = "rcp-details-help";
            helpEl.textContent = helpText;
            this.previewEl.appendChild(helpEl);
        }

        // Overridden-default banner — surfaces the shadow value so the user
        // knows what DEL would restore. Bindable kinds only.
        if (this.isOverridden(picked)) {
            var defaultValue = this.getDefaultValue(picked);
            var defEl = this.document.createElement("div");
            defEl.className = "rcp-details-default";
            defEl.textContent = "Default: " + (defaultValue === undefined || defaultValue === ""
                ? "(empty)" : String(defaultValue));
            this.previewEl.appendChild(defEl);
        }

        var templates = this.findTemplatesFor(picked.title);
        var renderedTemplate = false;

        if (templates.length > 0) {
            // Clamp template index to current set.
            if (this.detailsTemplateIdx >= templates.length) {
                this.detailsTemplateIdx = 0;
            }
            if (templates.length > 1) {
                this.previewEl.appendChild(this._buildTemplateTabStrip(templates));
            }
            var bodyEl = this._renderTemplateBody(picked.title, templates[this.detailsTemplateIdx]);
            if (bodyEl) {
                this.previewEl.appendChild(bodyEl);
                renderedTemplate = true;
            }
        }

        // Fields-table fallback only when nothing else applies.
        if (!renderedTemplate && !helpText) {
            this._appendFieldsTable(picked.title);
        }

        this.popupEl.classList.add("rcp-previewing");
    };

    CascadePaletteWidget.prototype.hidePreview = function () {
        this.popupEl.classList.remove("rcp-previewing");
    };

    CascadePaletteWidget.prototype._resolveHelpText = function (item) {
        if (!item) return "";
        // Synthetic items (ca-items-from) have no backing tiddler; the
        // help text lives on the item itself rather than as ca-help on
        // a real tiddler.
        if (!item.title) return item.hint || "";
        var t = this.wiki.getTiddler(item.title);
        var f = (t && t.fields) || {};
        // ca-help (multiline, long-form) wins over ca-hint (subtitle/tooltip).
        return f["ca-help"] || f["ca-hint"] || item.hint || "";
    };

    // Discover applicable templates for a given tiddler title. A template
    // tiddler is tagged TEMPLATE_TAG; `ca-template-applies` is a filter
    // evaluated with `currentTiddler` bound to the picked title — if the
    // filter returns the picked title, the template applies. Missing
    // filter → universal template (applies to everything). Sorted by
    // `ca-order` ascending.
    CascadePaletteWidget.prototype.findTemplatesFor = function (title) {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + TEMPLATE_TAG + "]]"
        );
        var matches = [];
        titles.forEach(function (tplTitle) {
            var t = self.wiki.getTiddler(tplTitle);
            var f = (t && t.fields) || {};
            var applies = f["ca-template-applies"];
            if (applies) {
                try {
                    var results = self.wiki.filterTiddlers(
                        applies,
                        self.makeFakeWidget({ currentTiddler: title })
                    );
                    if (results.indexOf(title) === -1) return;
                } catch (err) {
                    if (console && console.warn) {
                        console.warn(
                            "[cascade-palette] ca-template-applies error on",
                            tplTitle, "—", err && err.message
                        );
                    }
                    return;
                }
            }
            var orderRaw = f["ca-order"];
            var order = orderRaw !== undefined && orderRaw !== ""
                ? parseFloat(orderRaw) : DEFAULT_ORDER;
            if (isNaN(order)) order = DEFAULT_ORDER;
            matches.push({
                title: tplTitle,
                name: f["ca-template-name"] || tplTitle.split("/").pop(),
                order: order
            });
        });
        matches.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        return matches;
    };

    CascadePaletteWidget.prototype._buildTemplateTabStrip = function (templates) {
        var self = this;
        var stripEl = this.document.createElement("div");
        stripEl.className = "rcp-details-tabs";
        templates.forEach(function (tpl, idx) {
            var tabEl = self.document.createElement("span");
            tabEl.className = "rcp-details-tab" +
                (idx === self.detailsTemplateIdx ? " rcp-details-tab-active" : "");
            tabEl.textContent = tpl.name;
            tabEl.title = tpl.title;
            tabEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.detailsTemplateIdx = idx;
                self._detailsCache = null;  // template changed → invalidate
                self.setFocus("details");
                self.renderDetails();
            });
            stripEl.appendChild(tabEl);
        });
        return stripEl;
    };

    // Render a template tiddler's wikitext with `currentTiddler` bound to
    // the picked title. Uses the standard TW transclude-style: parse the
    // template, make a widget tree, render to a real DOM container, return
    // the container. Cached by (title, templateIdx).
    CascadePaletteWidget.prototype._renderTemplateBody = function (pickedTitle, template) {
        var cache = this._detailsCache;
        if (cache && cache.title === pickedTitle &&
            cache.templateIdx === this.detailsTemplateIdx &&
            cache.dom) {
            return cache.dom;
        }
        var container = this.document.createElement("div");
        container.className = "rcp-details-template";
        try {
            var parser = this.wiki.parseTiddler(template.title);
            var widgetNode = this.wiki.makeWidget(parser, {
                parentWidget: this.findActionParent() || $tw.rootWidget,
                document: this.document,
                variables: { currentTiddler: pickedTitle }
            });
            widgetNode.render(container, null);
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] template render error",
                    template.title, "—", err && err.message
                );
            }
            container.textContent = "(template render error: " +
                (err && err.message) + ")";
        }
        this._detailsCache = {
            title: pickedTitle,
            templateIdx: this.detailsTemplateIdx,
            dom: container
        };
        return container;
    };

    CascadePaletteWidget.prototype._appendFieldsTable = function (title) {
        var t = this.wiki.getTiddler(title);
        if (!t) {
            var noEl = this.document.createElement("div");
            noEl.className = "rcp-preview-empty";
            noEl.textContent = "(no tiddler — likely a transient filter result)";
            this.previewEl.appendChild(noEl);
            return;
        }
        var fields = t.fields || {};
        var keys = Object.keys(fields)
            .filter(function (k) { return k !== "title"; })
            .sort(function (a, b) {
                if (a === "text") return 1;
                if (b === "text") return -1;
                return a.localeCompare(b);
            });
        if (keys.length === 0) {
            var nf = this.document.createElement("div");
            nf.className = "rcp-preview-empty";
            nf.textContent = "(no fields besides title)";
            this.previewEl.appendChild(nf);
            return;
        }
        var dl = this.document.createElement("dl");
        dl.className = "rcp-preview-fields";
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = fields[k];
            var str = v === null || v === undefined ? "" : String(v);
            var dt = this.document.createElement("dt");
            dt.textContent = k;
            var dd = this.document.createElement("dd");
            dd.textContent = str;
            if (k === "text") dd.classList.add("rcp-preview-body");
            dl.appendChild(dt);
            dl.appendChild(dd);
        }
        this.previewEl.appendChild(dl);
    };

    /* ---------- keyboard ---------- */

    /* The keyboard model is a 3-tier dispatcher:
       1. Edit-mode short-circuit — when the input is a value editor,
          only Enter (commit) and Esc (cancel) are intercepted.
       2. Global keys — Tab/Shift-Tab (cycle focus), Enter/Ctrl-Enter
          (fire). These apply regardless of focused section.
       3. Section-specific keys — routed by `this.focus`.

       Within section-specific routing, Esc has consistent "exit current
       context" semantics:
         - in input:   close the palette entirely
         - in menu:    return focus to input
         - in details: return focus to input
    */

    CascadePaletteWidget.prototype.handleKeydown = function (e) {
        var stage = this.topStage();
        if (!stage) return;

        // Tier 1 — edit mode short-circuit.
        if (this.editMode) {
            this._handleKeydownEdit(e);
            return;
        }

        // Tier 2 — global section-cycling and fire gestures.
        if (e.key === "Tab") {
            e.preventDefault();
            this._cycleFocus(e.shiftKey ? -1 : 1);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            // Ctrl-Enter keeps palette open after firing. Shift-Enter kept
            // as a silent alias for back-compat (deprecated; remove in
            // v0.3).
            this.fireSelected(e.ctrlKey || e.shiftKey);
            return;
        }

        // Tier 3 — section-specific.
        switch (this.focus) {
            case "input":   this._handleKeydownInput(e, stage); return;
            case "menu":    this._handleKeydownMenu(e, stage); return;
            case "details": this._handleKeydownDetails(e, stage); return;
        }
    };

    CascadePaletteWidget.prototype._handleKeydownEdit = function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            this.exitEditMode(true);
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            this.exitEditMode(false);
            return;
        }
        // All other keys (typing, cursor movement) fall through to native
        // input behaviour.
    };

    CascadePaletteWidget.prototype._handleKeydownInput = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            // Esc in input always closes — the user is at the "top" of the
            // palette mental model and Esc means "I'm done".
            this.close();
            return;
        }
        if (e.key === "ArrowDown") {
            // Step into the menu only if there's something to select.
            if (stage.results.length > 0) {
                e.preventDefault();
                this.setFocus("menu");
            }
        }
        // Typing is handled by the input event listener.
    };

    CascadePaletteWidget.prototype._handleKeydownMenu = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (stage.selectedIndex > 0) {
                stage.selectedIndex -= 1;
                this.renderResults();
            } else {
                // Moving up past the top row returns focus to the input
                // so the user can refine the query without an extra Tab.
                this.setFocus("input");
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (stage.selectedIndex < stage.results.length - 1) {
                stage.selectedIndex += 1;
                this.renderResults();
            }
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            this.drillSelected();
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            this.popStage();
            return;
        }
        if (e.key === " " || e.code === "Space") {
            var picked = stage.results[stage.selectedIndex];
            if (picked) {
                if (picked.kind === "toggle") {
                    e.preventDefault();
                    this.fireToggle(stage, picked, true);  // keepOpen
                    return;
                }
                if (picked.kind === "text" || picked.kind === "number" ||
                    picked.kind === "date") {
                    e.preventDefault();
                    this.enterEditMode(picked);
                    return;
                }
            }
        }
        // +/- on a number row — adjust by step (Shift = mid, Ctrl = large).
        // Match on `e.code` so it works regardless of US/DE/etc. keyboard
        // layout: the physical "=/+" or "-/_" key (or numpad ±) always
        // triggers. "Shift to get +" on US layouts is absorbed naturally —
        // what matters is the physical key, not the produced character.
        var isPlusKey = e.code === "Equal" || e.code === "NumpadAdd";
        var isMinusKey = e.code === "Minus" || e.code === "NumpadSubtract";
        if (isPlusKey || isMinusKey) {
            var pickedN = stage.results[stage.selectedIndex];
            if (pickedN && pickedN.kind === "number") {
                e.preventDefault();
                var mag = this.stepMagnitudeFor(pickedN, e);
                this.fireNumber(stage, pickedN, isPlusKey ? mag : -mag);
                return;
            }
            if (pickedN && pickedN.kind === "date") {
                e.preventDefault();
                // Modifier layering matches number kind:
                //   bare = day, Shift = month, Ctrl = year.
                // (Ctrl-shift is treated as Ctrl — year wins; ergonomics.)
                var unit = e.ctrlKey ? "year" : (e.shiftKey ? "month" : "day");
                var sign = isPlusKey ? 1 : -1;
                this.fireDate(stage, pickedN, unit, sign);
                return;
            }
        }
        // DEL/Backspace on a row — push a confirm-drill stage for either
        // (a) restoring an overridden setting's default, or (b) deleting a
        // dynamic user-created tiddler in a diagnostic list. Shadow-only
        // items in either case are silent no-ops (cannot delete a shadow).
        if (e.key === "Delete" || e.key === "Backspace") {
            var pickedDel = stage.results[stage.selectedIndex];
            if (!pickedDel) return;
            if (this.isOverridden(pickedDel)) {
                e.preventDefault();
                this._pushRestoreDefaultConfirm(pickedDel);
                return;
            }
            if (pickedDel.isItem &&
                this.wiki.tiddlerExists(pickedDel.title) &&
                !this.wiki.isShadowTiddler(pickedDel.title)) {
                e.preventDefault();
                this._pushDeleteTiddlerConfirm(pickedDel);
                return;
            }
            // Shadow-only or no-override — silently no-op.
        }
    };

    CascadePaletteWidget.prototype._pushRestoreDefaultConfirm = function (item) {
        var defaultValue = this.getDefaultValue(item);
        var defaultDisplay = defaultValue === undefined || defaultValue === ""
            ? "(empty)" : String(defaultValue);
        this.pushStage(this.buildConfirmStage({
            title: "Restore default for " + (item.name || item.title),
            consequence: "DEL will delete the override at `" + item.bindTiddler +
                "`, restoring the shadow default: " + defaultDisplay,
            actions: '<$action-deletetiddler $tiddler="' +
                this._escapeAttr(item.bindTiddler) + '"/>'
        }));
    };

    CascadePaletteWidget.prototype._pushDeleteTiddlerConfirm = function (item) {
        // Cheap backlink count — informative without rendering the list.
        var backlinkCount = 0;
        try {
            backlinkCount = this.wiki.filterTiddlers(
                "[all[tiddlers]backlinks[]]",
                this.makeFakeWidget({ currentTiddler: item.title })
            ).length;
        } catch (err) { /* ignore */ }
        this.pushStage(this.buildConfirmStage({
            title: "Delete tiddler " + item.title,
            consequence: "This will permanently delete `" + item.title +
                "`. Backlinks: " + backlinkCount + ".",
            actions: '<$action-deletetiddler $tiddler="' +
                this._escapeAttr(item.title) + '"/>'
        }));
    };

    // Escape a tiddler title for safe inclusion in a wikitext attribute
    // value bounded by double quotes. TW titles can include `"`, `\`, etc.;
    // wikitext attributes follow JS-string-like escaping.
    CascadePaletteWidget.prototype._escapeAttr = function (s) {
        if (!s) return "";
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    };

    CascadePaletteWidget.prototype._handleKeydownDetails = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            // Cycle template tabs when multi-template is active. Otherwise
            // fall through and let the native pane stay still.
            var picked = stage.results[stage.selectedIndex];
            if (!picked) return;
            var templates = this.findTemplatesFor(picked.title);
            if (templates.length <= 1) return;
            e.preventDefault();
            var delta = e.key === "ArrowRight" ? 1 : -1;
            this.detailsTemplateIdx =
                (this.detailsTemplateIdx + delta + templates.length) % templates.length;
            this._detailsCache = null;
            this.renderDetails();
            return;
        }
        // ArrowUp/Down let the browser scroll the pane natively.
    };

    // Cycle focus across the active sections. Details is included only
    // when the drawer is open; otherwise the cycle is input ↔ menu.
    CascadePaletteWidget.prototype._cycleFocus = function (delta) {
        var order = this.detailsOpen
            ? ["input", "menu", "details"]
            : ["input", "menu"];
        var idx = order.indexOf(this.focus);
        if (idx < 0) idx = 0;
        idx = (idx + delta + order.length) % order.length;
        this.setFocus(order[idx]);
    };

    /* ---------- selection handling ---------- */

    // `keepOpen` (set via Shift-Enter / Shift-Click) fires the action but
    // leaves the palette visible so the user can chain more picks. The
    // current stage gets recomputed afterwards in case the action mutated
    // anything visible (e.g. Mark Done changes a task's status field).
    CascadePaletteWidget.prototype.fireSelected = function (keepOpen) {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // Confirm stages: leaf fires its actions (Cancel = no-op) and then
        // pops the stage. Never close-on-fire, regardless of keepOpen — the
        // user expects to return to the previous stage. Action vars captured
        // when the stage was built (e.g. parent-picked from a ca-confirm
        // trigger) are passed through so referenced entities resolve.
        if (stage.kind === "confirm" && picked.kind === "leaf") {
            if (picked.actions) {
                this.invokeViaNavigator(picked.actions, stage.actionVars || {});
            }
            this.popStage();
            return;
        }

        // 1. Leaf entry/action item — fire ca-actions.
        if (picked.kind === "leaf" && picked.actions) {
            // ca-confirm: wrap the leaf's actions in a confirm-drill rather
            // than firing immediately. The confirm stage's Confirm leaf
            // carries the original actions; Cancel is a no-op. Substitution
            // variables (picked, parent-picked, …) are resolved inside the
            // consequence text via the wiki filter substitution, NOT here —
            // the consequence is a plain string passed to buildConfirmStage.
            if (picked.confirm) {
                var vars = this.buildStageVariables(stage, picked.title);
                this.pushStage(this.buildConfirmStage({
                    title: picked.name || "Confirm",
                    consequence: this._substituteVars(
                        picked.confirmConsequence, vars
                    ),
                    actions: picked.actions,
                    vars: vars
                }));
                return;
            }
            this.fireLeafAction(stage, picked, keepOpen);
            return;
        }
        // 2. Drill entry/action item — push the next stage.
        //    (Shift modifier has no effect — drilling doesn't close anyway.)
        if (picked.kind === "drill") {
            this.drillSelected();
            return;
        }
        // 2b. Toggle — flip the bound boolean. Enter closes (unless
        //     keepOpen), Space always keeps open (handled in handleKeydown).
        if (picked.kind === "toggle") {
            this.fireToggle(stage, picked, keepOpen);
            return;
        }
        // 3. Dynamic filter-stage item (an entity result OR enum value).
        if (picked.isItem) {
            var vars = this.buildStageVariables(stage, picked.title);
            // Action wikitext (entity-default or stage-default) is authored
            // assuming `<<parent-picked>>` is the entity reference — that's
            // the convention when the user has drilled into the action menu
            // (parentPicked is set to the entity). For direct-Enter firing
            // (the user never opened the action menu), parentPicked is the
            // outer-stage pick (or null), so the same action wikitext would
            // navigate to "". Bind parent-picked to the picked instance so
            // both paths invoke the action against the same target.
            vars["parent-picked"] = picked.title;
            // 3a. Stage has a default action declared by the parent drill.
            if (stage.stageDefaultAction) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(stage.stageDefaultAction, vars);
                });
                return;
            }
            // 3b. Stage's entity type has a default action (ca-default:yes).
            if (stage.entityDefaultActions && stage.entityDefaultActions.actions) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(
                        stage.entityDefaultActions.actions, vars
                    );
                });
                return;
            }
            // 3c. No default — fall back to navigate.
            this.afterAction(stage, keepOpen, function () {
                this.invokeViaNavigator(
                    '<$action-navigate $to=<<picked>>/>',
                    { picked: picked.title }
                );
            });
            return;
        }
        // 4. Anything else — just close (Shift modifier ignored).
        if (!keepOpen) this.close();
    };

    // Replace `<<name>>` tokens in a string with values from a variable map.
    // Used for ca-confirm-consequence text and similar one-shot substitutions
    // where running a full TW wikitext parse would be overkill. Only `<<x>>`
    // is recognised — `$(x)$` and other TW idioms are left alone.
    CascadePaletteWidget.prototype._substituteVars = function (text, vars) {
        if (!text) return "";
        return String(text).replace(/<<([^>]+)>>/g, function (full, name) {
            var v = vars && vars[name];
            return v === undefined || v === null ? "" : String(v);
        });
    };

    CascadePaletteWidget.prototype.fireToggle = function (stage, item, keepOpen) {
        var self = this;
        var current = this.isToggleOn(item);
        // String-array bindings: toggle list-membership of trueValue
        // rather than swapping in trueValue/falseValue scalar literals.
        // The scribetype's toField turns the rebuilt space-separated
        // string back into a JSON array on write.
        var next;
        if (item.bindType === STRING_ARRAY_TYPE) {
            var raw = this.readBoundValue(item) || "";
            var list = String(raw).split(/\s+/).filter(function (s) { return s; });
            var needle = String(item.trueValue);
            if (current) {
                list = list.filter(function (s) { return s !== needle; });
            } else if (list.indexOf(needle) === -1) {
                list.push(needle);
            }
            next = list.join(" ");
        } else {
            next = current ? item.falseValue : item.trueValue;
        }
        // afterAction expects a doAction callback. We close-or-stay via the
        // same shared helper so behaviour stays uniform with leaf/item paths.
        this.afterAction(stage, keepOpen, function () {
            self.writeBoundValue(item, next);
        });
    };

    // Number editing — +/- adjust by step; Shift = stepMedium; Ctrl = stepLarge.
    // Always keeps the palette open: numbers are rarely a one-shot commit
    // (you usually want to nudge a few times), and there's no "fire and
    // close" semantic that would feel right.
    CascadePaletteWidget.prototype.fireNumber = function (stage, item, delta) {
        var current = this.readNumberValue(item);
        var next = this.clampNumber(item, current + delta);
        if (next === current) return;  // already at clamp
        this.writeBoundValue(item, String(next));
        // Value read live in _appendResultRow; just re-render.
        this.renderResults();
    };

    /* ---------- date editing ----------

    The `date` kind uses the same modifier scaffolding as `number`:
        bare +/-  = ±day      × ca-step-day (default 1)
        Shift +/- = ±month    × ca-step-month (default 1)
        Ctrl +/-  = ±year     × ca-step-year (default 1)
    Space enters text edit-mode with the current value pre-filled in the
    scribetype's display format. Smart parser accepts ISO / German /
    today / tomorrow / yesterday / ±N[d|w|m|y] — handled in scribetype.

    Storage round-trips via the configured scribetype (default
    application/x-tw-date for `ca-kind: date`). If no bind-type is set,
    we fall back to that default so authors don't have to repeat it on
    every date item.

    \-------------------------------------------- */

    // Lazily-cached date-helpers module (shared with the scribetypes).
    // Returns null when scribe isn't loaded — date kind silently no-ops.
    CascadePaletteWidget.prototype._dateHelpers = function () {
        if (this._dateHelpersCache === undefined) {
            try {
                this._dateHelpersCache = require(
                    "$:/plugins/rimir/scribe/modules/scribetypes/_date-helpers.js"
                );
            } catch (err) {
                this._dateHelpersCache = null;
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] scribe plugin not loaded — " +
                        "ca-kind: date silently disabled. Add rimir/scribe."
                    );
                }
            }
        }
        return this._dateHelpersCache;
    };

    // Per-item +/- steps. Reuses ca-step / ca-step-medium / ca-step-large
    // semantics: ca-step-day defaults to 1, etc. Authors can override per
    // item if they want e.g. "+/- 7 days at a time".
    CascadePaletteWidget.prototype._dateStepFor = function (item, unit) {
        var t = item.title ? this.wiki.getTiddler(item.title) : null;
        var f = (t && t.fields) || (item.title ? {} : item._raw || {});
        var key = "ca-step-" + unit;
        var raw = f[key];
        var n = this._parseNumOrNull(raw);
        return n === null ? 1 : n;
    };

    // Read the current date as a JS Date object, or null if unset.
    // Empty field → null; caller treats null as "start from today".
    CascadePaletteWidget.prototype.readDateValue = function (item) {
        var raw = this._readBoundRaw(item);
        if (raw === undefined || raw === null || raw === "") return null;
        var helpers = this._dateHelpers();
        if (!helpers) return null;
        return helpers.fromTwDate(raw);
    };

    CascadePaletteWidget.prototype.fireDate = function (stage, item, unit, sign) {
        var helpers = this._dateHelpers();
        if (!helpers) return;
        var current = this.readDateValue(item);
        // Empty-value semantics: + starts from today, - also from today.
        if (!current) current = new Date(new Date().setHours(0, 0, 0, 0));
        var step = this._dateStepFor(item, unit) * sign;
        var next;
        if (unit === "day")        next = helpers.addDays(current, step);
        else if (unit === "month") next = helpers.addMonths(current, step);
        else if (unit === "year")  next = helpers.addMonths(current, step * 12);
        else return;
        var storage = helpers.toTwDate(next);
        if (storage === undefined) return;
        // Write the TW UTC date string directly via _readBoundRaw's inverse —
        // bypassing the scribetype since we already produced storage form.
        // (Calling writeBoundValue with a display string would re-parse it.)
        this._writeRawAtField(item, storage);
        this.renderResults();
    };

    // Write a pre-converted value directly at the field/sub-path, skipping
    // the scribetype toField pass. Used by edit kinds that have already done
    // the conversion themselves (e.g. fireDate has the TW date string ready).
    CascadePaletteWidget.prototype._writeRawAtField = function (item, value) {
        if (!item.bindTiddler) return;
        if (!item.bindPath) {
            var existing = this.wiki.getTiddler(item.bindTiddler);
            var fields = { title: item.bindTiddler };
            fields[item.bindField] = String(value);
            this.wiki.addTiddler(new $tw.Tiddler(
                (existing && existing.fields) || {},
                fields
            ));
            return;
        }
        var t = this.wiki.getTiddler(item.bindTiddler);
        var fieldText = t && t.fields[item.bindField];
        var root;
        try { root = fieldText ? JSON.parse(fieldText) : {}; }
        catch (e) { root = {}; }
        var parts = item.bindPath.split(",");
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var k = parts[i];
            if (node[k] === undefined || node[k] === null || typeof node[k] !== "object") {
                node[k] = {};
            }
            node = node[k];
        }
        node[parts[parts.length - 1]] = value;
        var newFields = { title: item.bindTiddler };
        newFields[item.bindField] = JSON.stringify(root, null, 4);
        this.wiki.addTiddler(new $tw.Tiddler(
            (t && t.fields) || {},
            newFields
        ));
    };

    /* ---------- edit mode (text + direct-set numbers) ----------

    Enter edit mode by hitting Space on a `text` or `number` row. The
    palette's input element repurposes itself as a value editor:
      - the current bound value is pushed into the input
      - the input text gets selected for quick-replace
      - normal filter-on-type is suspended
      - the hint footer changes to "↵ commit · Esc cancel"
      - the result list dims (rcp-editing class on popup)

    Enter writes the value back (with clamping for numbers) and exits.
    Esc discards and exits. Tab/arrows are inert in edit mode.

    \---------------------------------------------------------- */

    CascadePaletteWidget.prototype.enterEditMode = function (item) {
        var stage = this.topStage();
        if (!stage) return;
        // Edit mode and preview drawer are mutually exclusive — drop the
        // preview if it was up so the editor can use the full popup.
        if (this.detailsOpen) {
            this.detailsOpen = false;
            this.hidePreview();
        }
        var raw = this.readBoundValue(item);
        var initial = "";
        if (item.kind === "number") {
            initial = String(this.readNumberValue(item));
        } else if (raw !== undefined && raw !== null) {
            initial = String(raw);
        }
        this.editMode = {
            item: item,
            savedQuery: stage.query || "",
            savedSelectedIndex: stage.selectedIndex
        };
        this.inputEl.value = initial;
        this.inputEl.placeholder = "Editing: " + (item.name || item.title);
        this.popupEl.classList.add("rcp-editing");
        this.hintEl.textContent = HINT_EDIT;
        // Select-all so a single keypress replaces the value, but the user
        // can also use Home/End/arrows to position the cursor for partial
        // edits.
        var self = this;
        setTimeout(function () { self.inputEl.select(); }, 0);
    };

    CascadePaletteWidget.prototype.exitEditMode = function (commit) {
        if (!this.editMode) return;
        var em = this.editMode;
        var raw = this.inputEl.value;
        if (commit) {
            if (em.item.kind === "number") {
                var n = parseFloat(raw);
                if (!isNaN(n)) {
                    this.writeBoundValue(em.item, String(this.clampNumber(em.item, n)));
                }
                // If unparseable, silently discard — feels safer than writing
                // garbage to a config tiddler.
            } else {
                // Date kind (and text kind) write through the scribetype.
                // For date, the smart parser throws on garbage input; we
                // catch and stay in edit mode so the user can fix the typo
                // rather than losing their input.
                try {
                    this.writeBoundValue(em.item, raw);
                } catch (err) {
                    this.inputEl.classList.add("rcp-edit-error");
                    this.hintEl.textContent = "✗ " +
                        (err && err.message ? err.message : "invalid input") +
                        " — fix and ↵ to retry, Esc to cancel";
                    // Keep editMode active; let user retry.
                    return;
                }
            }
        }
        this.editMode = null;
        this.inputEl.classList.remove("rcp-edit-error");
        var stage = this.topStage();
        if (stage) {
            stage.query = em.savedQuery;
            stage.selectedIndex = em.savedSelectedIndex;
            this.recomputeStage(stage);
        }
        this.inputEl.value = em.savedQuery;
        this.inputEl.placeholder = "Type to filter…";
        this.popupEl.classList.remove("rcp-editing");
        this._renderHint();
        this.renderStage();
    };

    CascadePaletteWidget.prototype.fireLeafAction = function (stage, action, keepOpen) {
        // In an action-menu stage, leaf-action `<<picked>>` is the entity
        // the menu acts on (the parent-picked). Otherwise (root entry leaf),
        // `<<picked>>` is the action's own title — only meaningful if the
        // action references itself, which is unusual.
        var pickedTitle = stage.kind === "actions"
            ? (stage.parentPicked || "")
            : action.title;
        var vars = this.buildStageVariables(stage, pickedTitle);
        // ca-after-fire="pop" overrides the default close-on-fire: invoke
        // the action, pop this stage, and keep the palette open on the
        // previous stage. Used by single-select sub-drills (ref / enum
        // picker leaves inside a create/edit flow) so the user lands back
        // on the field-edit stage with their pick already applied.
        if (action.afterFire === "pop") {
            var self = this;
            self.invokeViaNavigator(action.actions, vars);
            setTimeout(function () {
                if (!self.open) return;
                self.popStage();
            }, 0);
            return;
        }
        this.afterAction(stage, keepOpen, function () {
            this.invokeViaNavigator(action.actions, vars);
        });
    };

    // Shared post-action helper: invoke the action, then either close the
    // palette (default) OR recompute + re-render the current stage to
    // reflect any state the action may have mutated (keepOpen=true).
    CascadePaletteWidget.prototype.afterAction = function (stage, keepOpen, doAction) {
        if (!keepOpen) {
            this.close();
            doAction.call(this);
            return;
        }
        // Run the action first; then refresh current stage so any state
        // changes the action triggered are reflected immediately.
        doAction.call(this);
        var self = this;
        // Defer recompute slightly — most TW actions are synchronous, but
        // statewrap/listops widgets schedule writes that take effect on the
        // next microtask. A 0ms timeout lets pending writes land first.
        setTimeout(function () {
            if (!self.open) return;
            self.recomputeStage(stage);
            self.renderStage();
        }, 0);
    };

    CascadePaletteWidget.prototype.drillSelected = function () {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // Drill entry/action → push filter stage. parent-picked propagation:
        //   - From root: no parent-picked (entries don't have one).
        //   - From action menu: keep the menu's parent-picked (the entity).
        //   - From filter (e.g. nested cascade entry): keep current parent.
        // Either `ca-next-scope` or `ca-items-from` qualifies the drill.
        if (picked.kind === "drill" && (picked.nextScope || picked.itemsFrom)) {
            var parentPicked = stage.kind === "actions"
                ? (stage.parentPicked || null)
                : (stage.parentPicked || null);
            this.pushStage(this.buildFilterStage(picked, parentPicked));
            return;
        }

        // Drill on a dynamic entity result → push action menu stage.
        // Silent no-op when the stage has no entityType (e.g. a diagnostic
        // listing) — these stages drill via $action-navigate from fireSelected
        // instead.
        if (picked.isItem) {
            if (!stage.entityType) return;
            this.pushStage(this.buildActionMenuStage(
                picked.title,
                stage.entityType,
                picked.title
            ));
            return;
        }
        // Tab on a leaf is a no-op.
    };

    exports["cascade-palette"] = CascadePaletteWidget;
})();
