/*\
title: $:/plugins/rimir/cascade-palette/widgets/cascade-palette-widget.js
type: application/javascript
module-type: widget

Cascade Palette widget — keyboard-driven cascading command palette.

This file is the orchestrator: it constructs the widget instance, owns
the shared state, builds the DOM tree, wires global event listeners
and rootWidget message handlers, and pulls in subsystem methods from
sibling cp-*.js library modules.

Subsystem files (each patches CascadePaletteWidget.prototype):

  cp-constants     module-top symbols (tag names, messages, defaults).
  cp-filters       filter subsystem: pills that narrow stage data.
  cp-visibility    visibility subsystem: pills that hide root entries.
  cp-input-prefix  shared input-grammar dispatcher across both kinds.
  cp-views         declarative view tiddlers, tree strategies, sorting.
  cp-leaders       key + idle-window leader gestures, flash anim.
  cp-pick-presets  pick-mode commit/return + preset save/apply.
  cp-preset-pills  preset-pill strip: load + render + per-pill details.
  cp-stack         stage stack ops + factories + recompute pipeline.
  cp-items         cascade-item builder + scribe bound-value plumbing.
  cp-actions       filter eval, variable building, navigator routing.
  cp-rendering     DOM: breadcrumb, input, results, per-row, details.
  cp-keyboard      3-tier keyboard dispatcher + section handlers.
  cp-firing        Enter/Ctrl-Enter dispatch + edit mode + drill.

Focus sections: input | menu | details + the strip sections that are
currently populated (preset, visibility, filter, view). Tab cycles focus. The stage stack lives in `this.stack`;
the active stage is `topStage()`. Filter stages are populated by
evaluating `ca-next-scope`; action stages are populated by
`ca-entity-type` filtering against $:/tags/rimir/cascade-palette/action.

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
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

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
        // Active filters (data-narrowing constraints) — array of filter-
        // instance records. Persists within session across palette close/
        // reopen. Cleared by Ctrl-DEL (which clears both strips) or by
        // the "Reset filters" leader. Filter expressions fold into
        // evaluateFilterStage via _composeFilterSuffix.
        this.filters = [];
        this.filterFocusIdx = 0;
        // Active visibility rules (structural hiding constraints) — array
        // of visibility-instance records. Same lifecycle as filters but
        // their predicates apply only to root-entry visibility checks
        // (via _visibilityHidesEntry in isEntryVisible).
        this.visibilities = [];
        this.visibilityFocusIdx = 0;
        // Context tiddler captured at openPalette time (the tiddler that
        // owned focus or sat at the top of $:/HistoryList). Exposed to
        // filter evaluation as the variable <<context-tiddler>>.
        this.contextTiddler = "";
        // Views (declarative root-stage strategies). Discovered once via
        // _loadViews() on first openPalette. activeView is the title of
        // the currently-selected view tiddler; null when no views shipped.
        // Session-only — page reload returns to ca-view-default.
        this.views = [];
        this.activeView = null;
        this._viewsLoaded = false;
        // Focus index within the view strip — meaningful while
        // this.focus === "view".
        this.viewFocusIdx = 0;
        // Leaders (declarative key+idle gestures). Loaded lazily on first
        // openPalette and cached for the session. `_leaderTimer` is the
        // pending idle-window timeout; non-null means a leader is mid-press.
        // `_leaderFiring` is a transient flag set during leader-action
        // invocation — read by _setActiveView / _pushFilter / _pushVisibility
        // to decide whether to play the flash animation.
        this._leadersCache = null;
        this._leaderTimer = null;
        this._leaderPending = null;   // the leader meta currently mid-press
        this._leaderFiring = false;
        // Mini-prompt mode for "Save preset". Shape similar to editMode.
        this.saveMode = null;
        // Pick-mode return-target — set when a pick-mode view is entered,
        // restored on commit or cancel.
        this._pickModeReturnTo = null;
        // Preset-strip cache + focus index. The strip sits above the view
        // strip and offers one-key apply for each saved preset. Cache is
        // invalidated via _invalidatePresetPills on relevant wiki changes.
        this._presetPills = null;
        this.presetFocusIdx = 0;
        // Active-preset tracking. Set on _applyPreset / _capturePreset;
        // cleared on Ctrl-DEL (reset constraints) and on deletion of the
        // active preset. `activePresetBaseline` snapshots the canonical
        // state at apply/save time so _isActivePresetDirty can detect
        // user edits afterwards.
        this.activePresetTitle = null;
        this.activePresetBaseline = null;
    };

    CascadePaletteWidget.prototype = Object.create(Widget.prototype);

    // Install subsystem methods. Each module exports a single function
    // that takes the prototype and patches its methods onto it. Order
    // doesn't matter for installation (methods are stand-alone), but
    // the subsystems form a runtime dependency graph at invocation
    // time — e.g. cp-filters / cp-visibility call `this.recomputeStage`
    // (from cp-stack) and `this._flashElement` (from cp-leaders).
    require("$:/plugins/rimir/cascade-palette/widgets/cp-filters")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-visibility")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-input-prefix")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-views")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-leaders")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-pick-presets")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-preset-pills")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-stack")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-items")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-actions")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-rendering")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-keyboard")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-firing")(CascadePaletteWidget.prototype);

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

        // Preset strip — thin row of pills, one per saved preset. Sits
        // above the view strip and overflows horizontally on a wide
        // screen. Hidden via `rcp-has-presets` on the popup when no
        // presets exist. tabindex=-1 stays out of native Tab order — we
        // drive cycling ourselves.
        this.presetStripEl = this.document.createElement("div");
        this.presetStripEl.className = "rcp-preset-strip";
        this.presetStripEl.setAttribute("tabindex", "-1");

        // View strip — thin row of pills naming each registered view,
        // sitting between the constraint strips and the input. Hidden via
        // the `rcp-has-views` class on the popup when fewer than two
        // views are declared (a single-view setup is the default and
        // showing one pill would just add visual noise).
        this.viewStripEl = this.document.createElement("div");
        this.viewStripEl.className = "rcp-view-strip";
        this.viewStripEl.setAttribute("tabindex", "-1");

        // View-config strip — read-only pills depicting the active view's
        // primitives (roots / children / leaf / label filters). Hidden
        // via `rcp-has-view-config` on the popup when the active view
        // declares no primitives. Not focusable in this pass — the strip
        // is informational so the implicit structure of the active view
        // is externally visible.
        this.viewConfigStripEl = this.document.createElement("div");
        this.viewConfigStripEl.className = "rcp-view-config-strip";

        // Visibility strip — pills that hide root entries (predicate
        // filters). Sits ABOVE the filter strip in the visual hierarchy
        // because "removal" reads as a more drastic operation than
        // "narrowing". Revealed via `rcp-has-visibility` on the popup
        // when at least one visibility rule is active.
        this.visibilityStripEl = this.document.createElement("div");
        this.visibilityStripEl.className = "rcp-visibility-strip";
        this.visibilityStripEl.setAttribute("tabindex", "-1");

        // Filter strip — pills that intersect every stage's data filter.
        // Sits between visibility and input. Revealed via
        // `rcp-has-filters` on the popup. tabindex=-1 keeps it out of
        // native Tab order — we drive Tab cycling ourselves.
        this.filterStripEl = this.document.createElement("div");
        this.filterStripEl.className = "rcp-filter-strip";
        this.filterStripEl.setAttribute("tabindex", "-1");

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
        this.hintEl.textContent = C.HINT_INPUT;

        // Perf footer — opt-in via $:/config/rimir/cascade-palette/show-perf-footer.
        // Shows recompute / render timings + item counts. Hidden by default
        // (display:none until renderPerfFooter decides to show it).
        this.perfFooterEl = this.document.createElement("div");
        this.perfFooterEl.className = "rcp-perf-footer";
        this.perfFooterEl.style.display = "none";

        popup.appendChild(this.breadcrumbEl);
        popup.appendChild(this.presetStripEl);
        popup.appendChild(this.visibilityStripEl);
        popup.appendChild(this.filterStripEl);
        popup.appendChild(this.viewStripEl);
        popup.appendChild(this.viewConfigStripEl);
        popup.appendChild(this.inputEl);
        popup.appendChild(this.resultsEl);
        popup.appendChild(this.previewEl);
        popup.appendChild(this.hintEl);
        popup.appendChild(this.perfFooterEl);
        this.backdropEl.appendChild(popup);

        parent.insertBefore(this.backdropEl, nextSibling);
        this.domNodes.push(this.backdropEl);

        this.inputEl.addEventListener("input", function () {
            // While editing a bound value or naming a save, the input IS
            // the value editor — typing must not re-filter the results.
            if (self.editMode || self.saveMode) return;
            var stage = self.topStage();
            if (!stage) return;
            stage.query = self.inputEl.value;
            stage.selectedIndex = 0;
            self.recomputeStage(stage);
            self.renderStage();
            // Leader detection runs first — leader-pending state takes
            // precedence over the constraint-prefix cue.
            var leaderPending = self._updateLeaderCue();
            if (!leaderPending) {
                // Visual cue when the input matches a filter/visibility
                // prefix: input picks up a coloured underline and the
                // hint footer changes to "↵ commit".
                self._updateConstraintPrefixCue();
            }
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

        // Filter strip — click on background focuses; pill click focuses
        // + selects (per-pill handler in _renderFilterStrip).
        this.filterStripEl.addEventListener("mousedown", function (e) {
            if (e.target === self.filterStripEl) self.setFocus("filter");
        });
        this.filterStripEl.addEventListener("focus", function () {
            if (self.focus !== "filter") {
                self.focus = "filter";
                self._applyFocusAttr();
            }
        });

        // Visibility strip — same shape.
        this.visibilityStripEl.addEventListener("mousedown", function (e) {
            if (e.target === self.visibilityStripEl) self.setFocus("visibility");
        });
        this.visibilityStripEl.addEventListener("focus", function () {
            if (self.focus !== "visibility") {
                self.focus = "visibility";
                self._applyFocusAttr();
            }
        });

        // View strip — same shape as the constraint strips. Background
        // click focuses; pill click activates that view (handled per-pill
        // in _renderViewStrip).
        this.viewStripEl.addEventListener("mousedown", function (e) {
            if (e.target === self.viewStripEl) self.setFocus("view");
        });
        this.viewStripEl.addEventListener("focus", function () {
            if (self.focus !== "view") {
                self.focus = "view";
                self._applyFocusAttr();
            }
        });

        // Preset strip — background click focuses; pill click applies
        // that preset (handled per-pill in _renderPresetStrip).
        this.presetStripEl.addEventListener("mousedown", function (e) {
            if (e.target === self.presetStripEl) self.setFocus("preset");
        });
        this.presetStripEl.addEventListener("focus", function () {
            if (self.focus !== "preset") {
                self.focus = "preset";
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
                if (changes[C.POPUP_WIDTH_CONFIG]) {
                    self.applyPopupWidth();
                }
                // Always-on toggle response: visibility derives from
                // (ctrlHeld || always-on). When the config flips, recompute
                // before the stage re-render so the drawer shows/hides
                // atomically with the toggle row's bound value updating.
                if (changes[C.DETAILS_ALWAYS_ON_CONFIG]) {
                    self._updateDetailsVisibility();
                }
                // Invalidate the details cache when the displayed tiddler
                // changes — its rendered template DOM is now stale.
                if (self._detailsCache && changes[self._detailsCache.title]) {
                    self._detailsCache = null;
                }
                // Invalidate preset pills if any preset-tagged tiddler
                // changed (created/edited/deleted). Cheap heuristic: scan
                // changed titles for the preset tag on the current value;
                // also invalidate if the changed title was previously known
                // as a preset (covers deletion).
                var presetTagName = C.PRESET_TAG;
                var presetsChanged = false;
                Object.keys(changes).forEach(function (title) {
                    if (presetsChanged) return;
                    var cached = self._presetPills;
                    if (cached) {
                        for (var i = 0; i < cached.length; i++) {
                            if (cached[i].title === title) {
                                presetsChanged = true;
                                return;
                            }
                        }
                    }
                    var t = self.wiki.getTiddler(title);
                    var tags = (t && t.fields && t.fields.tags) || [];
                    if (tags.indexOf(presetTagName) >= 0) {
                        presetsChanged = true;
                    }
                });
                if (presetsChanged) {
                    self._invalidatePresetPills();
                    // If the active preset got deleted, clear the marker
                    // (and its baseline) so the strip stops claiming it.
                    if (self.activePresetTitle &&
                        !self.wiki.tiddlerExists(self.activePresetTitle)) {
                        self.activePresetTitle = null;
                        self.activePresetBaseline = null;
                    }
                    if (self.open) self._renderPresetStrip();
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

        // Register global hotkey + message handlers on rootWidget. Each
        // handler is the thin glue between a TW message and the matching
        // subsystem entry point. The unwiring guards (removeEventListener
        // before re-add) keep refresh-safe.
        if ($tw.rootWidget) {
            if (self._openHandler) {
                $tw.rootWidget.removeEventListener(C.OPEN_MESSAGE, self._openHandler);
            }
            self._openHandler = function () {
                self.openPalette();
                return false;
            };
            $tw.rootWidget.addEventListener(C.OPEN_MESSAGE, self._openHandler);
            // Reset-constraints message: wipes both strips. Bound to
            // Ctrl-DEL globally and to the `Reset constraints` leader.
            if (self._resetConstraintsHandler) {
                $tw.rootWidget.removeEventListener(C.RESET_CONSTRAINTS_MESSAGE, self._resetConstraintsHandler);
            }
            self._resetConstraintsHandler = function () {
                self._clearAllFilters();
                self._clearAllVisibility();
                return false;
            };
            $tw.rootWidget.addEventListener(C.RESET_CONSTRAINTS_MESSAGE, self._resetConstraintsHandler);
            // Reset-filters / reset-visibility — single-strip variants.
            if (self._resetFiltersHandler) {
                $tw.rootWidget.removeEventListener(C.RESET_FILTERS_MESSAGE, self._resetFiltersHandler);
            }
            self._resetFiltersHandler = function () {
                self._clearAllFilters();
                return false;
            };
            $tw.rootWidget.addEventListener(C.RESET_FILTERS_MESSAGE, self._resetFiltersHandler);
            if (self._resetVisibilityHandler) {
                $tw.rootWidget.removeEventListener(C.RESET_VISIBILITY_MESSAGE, self._resetVisibilityHandler);
            }
            self._resetVisibilityHandler = function () {
                self._clearAllVisibility();
                return false;
            };
            $tw.rootWidget.addEventListener(C.RESET_VISIBILITY_MESSAGE, self._resetVisibilityHandler);
            // Add-filter / add-visibility: takes a `filter` / `visibility`
            // parameter naming the constraint tiddler to add. Pre-fills the
            // input with the constraint's prefix so the user can type the
            // arg and hit Enter to commit.
            if (self._addFilterHandler) {
                $tw.rootWidget.removeEventListener(C.ADD_FILTER_MESSAGE, self._addFilterHandler);
            }
            self._addFilterHandler = function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.filter) || "";
                if (title) self._addFilterByTitle(title);
                return false;
            };
            $tw.rootWidget.addEventListener(C.ADD_FILTER_MESSAGE, self._addFilterHandler);
            if (self._addVisibilityHandler) {
                $tw.rootWidget.removeEventListener(C.ADD_VISIBILITY_MESSAGE, self._addVisibilityHandler);
            }
            self._addVisibilityHandler = function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.visibility) || "";
                if (title) self._addVisibilityByTitle(title);
                return false;
            };
            $tw.rootWidget.addEventListener(C.ADD_VISIBILITY_MESSAGE, self._addVisibilityHandler);
            // set-filter / set-visibility: leader-driven explicit-arg push.
            // Skips the interactive prefill — the leader supplies the arg.
            if (self._setFilterHandler) {
                $tw.rootWidget.removeEventListener(C.SET_FILTER_MESSAGE, self._setFilterHandler);
            }
            self._setFilterHandler = function (event) {
                var p = (event && event.paramObject) || {};
                var title = p.filter || (event && event.param) || "";
                var arg = p.arg !== undefined ? p.arg : "";
                if (!title) return false;
                var metas = self._loadFilterTiddlers();
                for (var i = 0; i < metas.length; i++) {
                    if (metas[i].title === title) {
                        self._pushFilter(self._buildFilterInstance(metas[i], arg));
                        break;
                    }
                }
                return false;
            };
            $tw.rootWidget.addEventListener(C.SET_FILTER_MESSAGE, self._setFilterHandler);
            if (self._setVisibilityHandler) {
                $tw.rootWidget.removeEventListener(C.SET_VISIBILITY_MESSAGE, self._setVisibilityHandler);
            }
            self._setVisibilityHandler = function (event) {
                var p = (event && event.paramObject) || {};
                var title = p.visibility || (event && event.param) || "";
                var arg = p.arg !== undefined ? p.arg : "";
                if (!title) return false;
                var metas = self._loadVisibilityTiddlers();
                for (var i = 0; i < metas.length; i++) {
                    if (metas[i].title === title) {
                        self._pushVisibility(self._buildVisibilityInstance(metas[i], arg));
                        break;
                    }
                }
                return false;
            };
            $tw.rootWidget.addEventListener(C.SET_VISIBILITY_MESSAGE, self._setVisibilityHandler);
            // set-view: leader-driven (and click-equivalent) view switch.
            if (self._setViewHandler) {
                $tw.rootWidget.removeEventListener(C.SET_VIEW_MESSAGE, self._setViewHandler);
            }
            self._setViewHandler = function (event) {
                var p = (event && event.paramObject) || {};
                var viewTitle = p.view || (event && event.param) || "";
                if (viewTitle) self._setActiveView(viewTitle);
                return false;
            };
            $tw.rootWidget.addEventListener(C.SET_VIEW_MESSAGE, self._setViewHandler);
            // apply-preset / save-preset / recall-preset.
            if (self._applyPresetHandler) {
                $tw.rootWidget.removeEventListener(C.APPLY_PRESET_MESSAGE, self._applyPresetHandler);
            }
            self._applyPresetHandler = function (event) {
                var p = (event && event.paramObject) || {};
                var presetTitle = p.preset || (event && event.param) || "";
                if (presetTitle) self._applyPreset(presetTitle);
                return false;
            };
            $tw.rootWidget.addEventListener(C.APPLY_PRESET_MESSAGE, self._applyPresetHandler);
            if (self._savePresetHandler) {
                $tw.rootWidget.removeEventListener(C.SAVE_PRESET_MESSAGE, self._savePresetHandler);
            }
            self._savePresetHandler = function () {
                self.enterSaveMode();
                return false;
            };
            $tw.rootWidget.addEventListener(C.SAVE_PRESET_MESSAGE, self._savePresetHandler);
            if (self._recallPresetHandler) {
                $tw.rootWidget.removeEventListener(C.RECALL_PRESET_MESSAGE, self._recallPresetHandler);
            }
            self._recallPresetHandler = function () {
                // Recall focuses the preset pill strip — the user can
                // then ← → to a pill and Enter to apply. Falls back to
                // input focus when no presets exist.
                if (self._presetPillCount && self._presetPillCount() > 0) {
                    self.setFocus("preset");
                } else {
                    self.setFocus("input");
                }
                return false;
            };
            $tw.rootWidget.addEventListener(C.RECALL_PRESET_MESSAGE, self._recallPresetHandler);
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

    /* ---------- open / close / focus ---------- */

    CascadePaletteWidget.prototype.applyPopupWidth = function () {
        // Config stores the bare numeric percentage; we append "vw". Sub-20
        // values would be unusable; cap at 95 to leave a safe edge.
        var raw = this.wiki.getTiddlerText(C.POPUP_WIDTH_CONFIG, "50") || "50";
        var n = parseFloat(raw);
        if (isNaN(n)) n = 50;
        if (n < 20) n = 20;
        if (n > 95) n = 95;
        this.popupEl.style.width = n + "vw";
    };

    CascadePaletteWidget.prototype.openPalette = function () {
        this._loadViews();
        this.open = true;
        this.stack = [this.buildRootStage()];
        this.focus = "input";
        this.detailsTemplateIdx = 0;
        this._detailsCache = null;
        this.detailsOpen = this.isDetailsAlwaysOn();
        // Capture the tiddler the user was working on before the hotkey
        // fired — exposed to filter/visibility expressions and actions as
        // <<context-tiddler>>. Filters/visibilities themselves persist
        // across close/reopen within session; they are NOT reset here.
        this.contextTiddler = this._captureContextTiddler();
        this.recomputeStage(this.topStage());
        this.applyPopupWidth();
        this.backdropEl.style.display = "flex";
        this._renderPresetStrip();
        this._renderViewStrip();
        this._renderVisibilityStrip();
        this._renderFilterStrip();
        this.renderStage();
        this._applyFocusAttr();
        if (this.detailsOpen) this.renderDetails();
        var self = this;
        setTimeout(function () {
            self.inputEl.focus();
        }, 0);
    };

    // Best-effort discovery of the tiddler the user was looking at when
    // the palette opened. We prefer an explicit `[data-tiddler-title]`
    // ancestor of the actually-focused element (most reliable — that's
    // where the user's attention is), and fall back to the top of
    // $:/HistoryList (TW's own "currently-open" tracker). Returns "" if
    // nothing matches — callers must treat empty as "no context".
    CascadePaletteWidget.prototype._captureContextTiddler = function () {
        try {
            var el = (this.document && this.document.activeElement) || null;
            while (el && el !== this.document.body) {
                if (el.dataset && el.dataset.tiddlerTitle) {
                    return el.dataset.tiddlerTitle;
                }
                el = el.parentElement;
            }
        } catch (err) { /* ignore — DOM access can fail in oddball contexts */ }
        try {
            var hist = this.wiki.getTiddlerData("$:/HistoryList", { title: "" });
            // HistoryList is a $tw.utils tiddler-as-data deck; the most
            // recent entry has the largest index. getTiddlerData decodes
            // the JSON array.
            if (Array.isArray(hist) && hist.length) {
                var last = hist[hist.length - 1];
                if (last && last.title) return String(last.title);
            }
        } catch (err) { /* ignore */ }
        return "";
    };

    CascadePaletteWidget.prototype.isDetailsAlwaysOn = function () {
        var raw = this.wiki.getTiddlerText(C.DETAILS_ALWAYS_ON_CONFIG, C.DEFAULT_FALSE_VALUE);
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
        // Cancel any pending leader timer + clear cue state so reopening
        // doesn't inherit a half-fired leader.
        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);
            this._leaderTimer = null;
        }
        this._leaderPending = null;
        if (this.inputEl) {
            this.inputEl.classList.remove("rcp-input-leader-match");
        }
        this._pickModeReturnTo = null;
        this.saveMode = null;
        this.hidePreview();
        this.backdropEl.style.display = "none";
    };

    // Move focus between the palette sections. Browser-level focus moves
    // to the section's DOM node (so keyboard events flow there); this.focus
    // is the canonical state; the popup's data-focus attribute is the
    // visual cue.
    CascadePaletteWidget.prototype.setFocus = function (section) {
        if (section !== "input" && section !== "menu" &&
            section !== "details" && section !== "filter" &&
            section !== "visibility" && section !== "view" &&
            section !== "preset") return;
        // Don't allow focusing a strip with no pills — it would be a dead
        // end visually and a confusing Tab destination.
        if (section === "filter" && (!this.filters || this.filters.length === 0)) {
            section = "input";
        }
        if (section === "visibility" && (!this.visibilities || this.visibilities.length === 0)) {
            section = "input";
        }
        // Same for the view strip when fewer than two VISIBLE views —
        // there's nothing to navigate between. Pick-mode views are
        // hidden so they don't count.
        if (section === "view" && this._visibleViews().length < 2) {
            section = "input";
        }
        // Same for the preset strip when no presets exist.
        if (section === "preset" && this._presetPillCount() === 0) {
            section = "input";
        }
        // Don't focus the details pane when the drawer isn't actually
        // visible — `detailsOpen` can be true while the drawer is hidden
        // (e.g. always-on with empty menu). The visual state is the truth.
        if (section === "details" && !this._isDetailsVisible()) {
            section = "input";
        }
        var prevFocus = this.focus;
        if (this.focus === section) {
            this._applyFocusAttr();
            return;
        }
        this.focus = section;
        this._applyFocusAttr();
        if (section === "input") this.inputEl.focus();
        else if (section === "menu") this.resultsEl.focus();
        else if (section === "details") this.previewEl.focus();
        else if (section === "preset") {
            var presetCount = this._presetPillCount();
            if (this.presetFocusIdx >= presetCount) {
                this.presetFocusIdx = Math.max(0, presetCount - 1);
            }
            this.presetStripEl.focus();
            this._renderPresetStrip();
            this._maybeRenderPresetHelp();
        } else if (section === "filter") {
            if (this.filterFocusIdx >= this.filters.length) {
                this.filterFocusIdx = Math.max(0, this.filters.length - 1);
            }
            this.filterStripEl.focus();
            this._renderFilterStrip();
            this._maybeRenderFilterHelp();
        } else if (section === "visibility") {
            if (this.visibilityFocusIdx >= this.visibilities.length) {
                this.visibilityFocusIdx = Math.max(0, this.visibilities.length - 1);
            }
            this.visibilityStripEl.focus();
            this._renderVisibilityStrip();
            this._maybeRenderVisibilityHelp();
        } else if (section === "view") {
            // Initialise focus index to the currently-active view so arrow
            // motion starts from the user's current location, not always
            // from the first pill. Indices are into the visible-views
            // list (pick-mode views are skipped).
            var activeIdx = this._indexOfActiveView();
            if (activeIdx >= 0) this.viewFocusIdx = activeIdx;
            var visibleCount = this._visibleViews().length;
            if (this.viewFocusIdx >= visibleCount) {
                this.viewFocusIdx = Math.max(0, visibleCount - 1);
            }
            this.viewStripEl.focus();
            this._renderViewStrip();
            this._maybeRenderViewHelp();
        }
        // Re-render the strip when focus changes so pill-focused styling
        // updates (focused class only on pills of the focused strip).
        if (prevFocus === "filter" || section === "filter") {
            this._renderFilterStrip();
        }
        if (prevFocus === "visibility" || section === "visibility") {
            this._renderVisibilityStrip();
        }
        if (prevFocus === "view" || section === "view") {
            this._renderViewStrip();
        }
        if (prevFocus === "preset" || section === "preset") {
            this._renderPresetStrip();
        }
        // Leaving a strip-focus while details is open: the pane was showing
        // strip help — refresh it to show the current menu selection so
        // the user gets per-row preview again.
        var stripFoci = { filter: 1, visibility: 1, view: 1, preset: 1 };
        if (stripFoci[prevFocus] && !stripFoci[section] && this.detailsOpen) {
            this.renderDetails();
        }
    };

    CascadePaletteWidget.prototype._applyFocusAttr = function () {
        if (this.popupEl) this.popupEl.dataset.focus = this.focus;
        this._renderHint();
    };

    CascadePaletteWidget.prototype._renderHint = function () {
        if (!this.hintEl) return;
        if (this.editMode) {
            this.hintEl.textContent = C.HINT_EDIT;
            return;
        }
        if (this.focus === "menu")            this.hintEl.textContent = C.HINT_MENU;
        else if (this.focus === "details")    this.hintEl.textContent = C.HINT_DETAILS;
        else if (this.focus === "filter")     this.hintEl.textContent = C.HINT_FILTER;
        else if (this.focus === "visibility") this.hintEl.textContent = C.HINT_VISIBILITY;
        else if (this.focus === "view")       this.hintEl.textContent = C.HINT_VIEW;
        else if (this.focus === "preset") {
            // Per-pill hint variants. The trailing "+" pill (idx ===
            // pills.length) gets a save-specific hint; on real presets,
            // the message is overwrite-aware when the focused pill IS
            // the active preset.
            var pills = this._loadPresetPills();
            if (this.presetFocusIdx === pills.length) {
                this.hintEl.textContent = C.HINT_PRESET_PLUS;
            } else {
                var focused = pills[this.presetFocusIdx];
                if (focused && focused.title === this.activePresetTitle) {
                    this.hintEl.textContent = this._isActivePresetDirty()
                        ? C.HINT_PRESET_ACTIVE_DIRTY
                        : C.HINT_PRESET_ACTIVE;
                } else {
                    this.hintEl.textContent = C.HINT_PRESET;
                }
            }
        }
        else                                  this.hintEl.textContent = C.HINT_INPUT;
    };

    exports["cascade-palette"] = CascadePaletteWidget;
})();
