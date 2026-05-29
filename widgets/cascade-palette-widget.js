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
  cp-utils         stateless helpers (sanitiseConstraintArg, parseNum*,
                   detectInputPrefix, buildConstraintInstance).
  cp-filters       filter subsystem: pills that narrow stage data.
  cp-visibility    visibility subsystem: pills that hide root entries.
  cp-input-prefix  shared input-grammar dispatcher (delegates to cp-utils).
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

Prototype-extension contract:

The widget constructor sets ~25 instance fields (see the five logical
groups in the constructor below). Modules read/write these as the
de-facto cross-module API. Notable shared state — touch with care:

  this.stack[]               cp-stack OWNS  | every cp-* reads
  this.editMode              cp-firing OWNS | cp-keyboard guards on it
  this.focus                 cp-keyboard OWNS | every renderer reads
  this.filters[] / visibilities[] / reachPills[] / fieldPills[]
                             cp-{filters,visibility,reach-pills,field-pills}
                             OWN (each its own array)
  this._leaderFiring         cp-leaders OWNS — but READ by:
                             cp-filters._pushFilter, cp-visibility._pushVisibility,
                             cp-field-pills._pushField, cp-views._setActiveView
                             (decides whether to play a flash animation)
  this._pickModeReturnTo     cp-pick-presets OWNS | cp-firing + cp-keyboard read
  this.contextTiddler        cp-actions builds it | every filter-eval consumes
  this._presetPills/_leadersCache/_rowIconsCache/_filterTiddlersCache/_visibilityTiddlersCache
                             Each owning module's _load* fn manages cache +
                             _invalidate* helper; wiki change hook below
                             clears them on relevant tag changes.

Cross-module method calls (informal interface — coupling lives in WHICH
methods are called WHEN, not in any explicit type):

  recomputeStage / popStage / pushStage   (cp-stack) — called from cp-firing,
                                          cp-keyboard, cp-filters, cp-visibility,
                                          cp-reach-pills, cp-field-pills, cp-leaders
  invokeViaNavigator (cp-actions)         called from cp-firing, cp-leaders,
                                          cp-row-icons, cp-pick-presets
  makeFakeWidget (cp-actions)             called from EVERY filter-eval site
                                          (24 callsites — see cp-actions.js:206
                                          for the makeFakeWidgetWithVariables
                                          invariant)
  buildStageVariables (cp-actions)        called before every action-fire to
                                          assemble <<query>> / <<picked>> / ...
  setFocus / _setFocus (cp-keyboard)      called from cp-leaders, cp-pick-presets,
                                          cp-firing, cp-views
  _flashElement (cp-leaders)              called from every pill-push path
  _refreshPresetActiveCue (cp-pick-presets) called after constraint/view
                                          mutations to keep the active-preset
                                          marker honest

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
        // the "Reset filters" leader. Filter pills apply globally across
        // every producer via `_applyFilterSuffix` (cp-filters.js), which
        // exempts virtual menu entries (tag[ENTRY_TAG]) from narrowing
        // by default — to filter virtual entries, use the input query.
        this.filters = [];
        this.filterFocusIdx = 0;
        // Active visibility rules (structural hiding constraints) — array
        // of visibility-instance records. Same lifecycle as filters but
        // their predicates apply only to root-entry visibility checks
        // (via _visibilityHidesEntry in isEntryVisible).
        this.visibilities = [];
        this.visibilityFocusIdx = 0;
        // Active reach pills (search scope — where in the tree the
        // matcher walks). Same lifecycle / push-remove grammar as
        // filters; consumed by _activeReachMode() (cp-reach-pills.js)
        // and routed to cp-deep-search.js's BFS walker.
        this.reachPills = [];
        this.reachFocusIdx = 0;
        // Active field pills (search input fields — which item-keys the
        // matcher reads). Same lifecycle / push-remove grammar; consumed
        // by _activeFieldNames() (cp-field-pills.js). None active = each
        // row's ca-search-fields / global default kicks in.
        this.fieldPills = [];
        this.fieldFocusIdx = 0;
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
        // Focus index within the leader pill strip — meaningful while
        // this.focus === "leader".
        this.leaderFocusIdx = 0;
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
    // cp-utils is a stateless library — no prototype patch — but we
    // pre-require it so the dependent modules (cp-filters, cp-visibility,
    // cp-input-prefix, cp-items) find it cached in the module loader.
    require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");
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
    require("$:/plugins/rimir/cascade-palette/widgets/cp-row-icons")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-rendering")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-side-preview")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-keyboard")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-firing")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-reach-pills")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-field-pills")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-deep-search")(CascadePaletteWidget.prototype);

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

        // View-config strip — pills depicting the active view's
        // primitives (roots / children / leaf / label filters). Hidden
        // via `rcp-has-view-config` on the popup when the active view
        // declares no primitives. Focusable: in the Tab cycle for pill
        // sections. Initial state on focus is "compact" (one summary row);
        // Enter/Space/→ expands to the full stacked per-layer layout, Esc
        // collapses back.
        this.viewConfigStripEl = this.document.createElement("div");
        this.viewConfigStripEl.className = "rcp-view-config-strip";
        this.viewConfigStripEl.setAttribute("tabindex", "-1");
        this.viewConfigFocusIdx = 0;
        this.viewConfigExpanded = false;

        // Leader strip — pills surfacing the keyed gestures (e.g. `x`,
        // `>`, `s`, `r`). Hidden via `rcp-has-leaders` on the popup when
        // no leader is visible for the active view (per-view scope via
        // `ca-leader-views`). Focusable for click + keyboard activation,
        // mirroring the typed-gesture path.
        this.leaderStripEl = this.document.createElement("div");
        this.leaderStripEl.className = "rcp-leader-strip";
        this.leaderStripEl.setAttribute("tabindex", "-1");

        // Visibility strip — pills that hide root entries (predicate
        // filters). Sits ABOVE the filter strip in the visual hierarchy
        // because "removal" reads as a more drastic operation than
        // "narrowing". Revealed via `rcp-has-visibility` on the popup
        // when at least one visibility rule is active.
        this.visibilityStripEl = this.document.createElement("div");
        this.visibilityStripEl.className = "rcp-visibility-strip";
        this.visibilityStripEl.setAttribute("tabindex", "-1");

        // Reach strip — pills that widen WHERE the search input walks
        // (subtree under the current stage vs. the whole active view).
        // Revealed via `rcp-has-reach` on the popup. Sits between the
        // visibility and filter strips in the visual stack — semantic
        // grouping: visibility narrows what's seen, reach + fields
        // configure the search axis, filter narrows the data set.
        this.reachStripEl = this.document.createElement("div");
        this.reachStripEl.className = "rcp-reach-strip";
        this.reachStripEl.setAttribute("tabindex", "-1");

        // Fields strip — pills that decide WHICH item fields the
        // matcher reads (name / hint / description / aliases /
        // searchText / author-defined). Revealed via `rcp-has-fields`.
        // Sits next to the reach strip — both configure the search
        // axis, just on different dimensions.
        this.fieldStripEl = this.document.createElement("div");
        this.fieldStripEl.className = "rcp-fields-strip";
        this.fieldStripEl.setAttribute("tabindex", "-1");

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

        this.detailEl = this.document.createElement("div");
        this.detailEl.className = "rcp-detail-drawer";
        this.detailEl.setAttribute("tabindex", "-1");

        this.hintEl = this.document.createElement("div");
        this.hintEl.className = "rcp-hint";
        this.hintEl.textContent = C.HINT_INPUT;

        // Perf footer — opt-in via $:/config/rimir/cascade-palette/show-perf-footer.
        // Shows recompute / render timings + item counts. Hidden by default
        // (display:none until renderPerfFooter decides to show it).
        this.perfFooterEl = this.document.createElement("div");
        this.perfFooterEl.className = "rcp-perf-footer";
        this.perfFooterEl.style.display = "none";

        // Cascade column — wraps every "cascade UI" element so the popup
        // can split horizontally into [cascade | side-preview] when an
        // entry/action drilled into the current stage registered a
        // `ca-preview-template`. Without the side preview, the cascade
        // column occupies 100% of the popup; with it, the popup-width
        // stays fixed and the column shrinks to 50%. The popup itself is
        // now flex-row at the outer layer (see styles.tid).
        this.cascadeColEl = this.document.createElement("div");
        this.cascadeColEl.className = "rcp-cascade-col";
        this.cascadeColEl.appendChild(this.breadcrumbEl);
        this.cascadeColEl.appendChild(this.presetStripEl);
        this.cascadeColEl.appendChild(this.visibilityStripEl);
        this.cascadeColEl.appendChild(this.reachStripEl);
        this.cascadeColEl.appendChild(this.fieldStripEl);
        this.cascadeColEl.appendChild(this.filterStripEl);
        this.cascadeColEl.appendChild(this.viewStripEl);
        this.cascadeColEl.appendChild(this.viewConfigStripEl);
        this.cascadeColEl.appendChild(this.leaderStripEl);
        this.cascadeColEl.appendChild(this.inputEl);
        this.cascadeColEl.appendChild(this.resultsEl);
        this.cascadeColEl.appendChild(this.detailEl);
        this.cascadeColEl.appendChild(this.hintEl);
        this.cascadeColEl.appendChild(this.perfFooterEl);
        popup.appendChild(this.cascadeColEl);

        // Side preview pane — right column of the popup, hidden until an
        // entry/action on the stack registers a preview via
        // `ca-preview-template`. Title row above a scrollable body that
        // hosts the rendered wikitext template. Toggle the
        // `rcp-showing-preview` class on the popup to reveal.
        this.sidePreviewEl = this.document.createElement("div");
        this.sidePreviewEl.className = "rcp-preview-pane";
        this.sidePreviewEl.setAttribute("tabindex", "-1");
        // Pill row — hidden when ≤1 candidate applies (the :empty CSS
        // selector elides the row). When ≥2 candidates apply, each pill
        // becomes a clickable tab; ←/→ on the preview pane cycles them.
        this.sidePreviewPillsEl = this.document.createElement("div");
        this.sidePreviewPillsEl.className = "rcp-preview-pane-pills";
        this.sidePreviewTitleEl = this.document.createElement("div");
        this.sidePreviewTitleEl.className = "rcp-preview-pane-title";
        this.sidePreviewBodyEl = this.document.createElement("div");
        this.sidePreviewBodyEl.className = "rcp-preview-pane-body";
        this.sidePreviewEl.appendChild(this.sidePreviewPillsEl);
        this.sidePreviewEl.appendChild(this.sidePreviewTitleEl);
        this.sidePreviewEl.appendChild(this.sidePreviewBodyEl);
        popup.appendChild(this.sidePreviewEl);

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
            // Side preview is fully interactive — a keystroke inside a
            // form input / button / link there must reach the widget
            // natively (otherwise Enter fires the cascade row instead
            // of committing the form input, Space triggers toggles
            // instead of inserting a space, etc.). Escape still routes
            // to the cascade so the user can return focus to input.
            if (self._keydownTargetIsInsidePreviewWidget(e)) return;
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
        this.detailEl.addEventListener("mousedown", function () {
            self.setFocus("details");
        });
        this.detailEl.addEventListener("focus", function () {
            if (self.focus !== "details") {
                self.focus = "details";
                self._applyFocusAttr();
            }
        });

        // Side preview pane — clicking inside the pane (background OR a
        // descendant widget) gives it focus so keyboard scroll / Esc back
        // work. mousedown captures before the inner widgets' own focus
        // handling so we win the focus race.
        this.sidePreviewEl.addEventListener("mousedown", function (e) {
            // Don't steal focus from interactive descendants — if the user
            // clicked on an input/button inside the rendered template, let
            // it handle the focus itself.
            var tgt = e.target;
            if (tgt && tgt !== self.sidePreviewEl &&
                tgt !== self.sidePreviewBodyEl &&
                tgt !== self.sidePreviewTitleEl) {
                var tag = (tgt.tagName || "").toLowerCase();
                if (tag === "input" || tag === "textarea" ||
                    tag === "select" || tag === "button" || tag === "a") {
                    return;
                }
            }
            self.setFocus("preview");
        });
        this.sidePreviewEl.addEventListener("focus", function () {
            if (self.focus !== "preview") {
                self.focus = "preview";
                self._applyFocusAttr();
            }
        });

        // Pill strips share identical focus-wiring: background-only
        // mousedown to take focus (per-pill clicks are wired in each
        // strip's _render*Strip method) + focus listener that mirrors
        // the DOM focus into this.focus.
        function wireStripFocus(stripEl, name) {
            stripEl.addEventListener("mousedown", function (e) {
                if (e.target === stripEl) self.setFocus(name);
            });
            stripEl.addEventListener("focus", function () {
                if (self.focus !== name) {
                    self.focus = name;
                    self._applyFocusAttr();
                }
            });
        }
        wireStripFocus(this.filterStripEl, "filter");
        wireStripFocus(this.visibilityStripEl, "visibility");
        wireStripFocus(this.reachStripEl, "reach");
        wireStripFocus(this.fieldStripEl, "field");
        wireStripFocus(this.viewStripEl, "view");
        wireStripFocus(this.presetStripEl, "preset");
        wireStripFocus(this.viewConfigStripEl, "viewconfig");
        wireStripFocus(this.leaderStripEl, "leader");

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
                // Same for the side-preview cache: invalidate if either
                // the rendered template tiddler OR the bound context
                // tiddler changed. The render then re-runs on the
                // forced recompute below. For ALL OTHER changes (e.g.
                // the user typed into a form input inside the preview
                // that writes to a state tiddler), keep the cache but
                // refresh the widget tree so reactive nodes update —
                // makeWidget'd trees aren't part of the rootWidget's
                // auto-refresh cycle, so we dispatch the change set
                // into the tree by hand.
                if (self._sidePreviewCache) {
                    var spc = self._sidePreviewCache;
                    if ((spc.template && changes[spc.template]) ||
                        (spc.context && changes[spc.context])) {
                        self._invalidateSidePreviewCache();
                    } else {
                        self._refreshSidePreviewOnChange(changes);
                    }
                }
                // Shared dirty-probe for tag-keyed caches. A cache is
                // dirty if any of: (a) one of its tracked config keys
                // changed, (b) one of its cached titles changed (covers
                // edit + delete), (c) any newly-changed tiddler carries
                // the cache's tag (covers create + retag).
                function isTaggedChange(opts) {
                    var configKeys = opts.configKeys || [];
                    for (var i = 0; i < configKeys.length; i++) {
                        if (changes[configKeys[i]]) return true;
                    }
                    var titles = opts.cachedTitles || [];
                    for (var j = 0; j < titles.length; j++) {
                        if (changes[titles[j]]) return true;
                    }
                    if (opts.tag) {
                        var keys = Object.keys(changes);
                        for (var k = 0; k < keys.length; k++) {
                            var t = self.wiki.getTiddler(keys[k]);
                            var tags = (t && t.fields && t.fields.tags) || [];
                            if (tags.indexOf(opts.tag) >= 0) return true;
                        }
                    }
                    return false;
                }
                // Tagged side-preview candidates — drop the cache so the
                // next render re-scans.
                if (self._taggedPreviewsCache) {
                    var taggedTitles = (self._taggedPreviewsCache.entries || [])
                        .map(function (e) { return e.source; });
                    if (isTaggedChange({ tag: C.SIDE_PREVIEW_TAG, cachedTitles: taggedTitles })) {
                        self._taggedPreviewsCache = null;
                        self._invalidateSidePreviewCache();
                    }
                }
                // Row-icon tiddlers + the URL-fields config. The cache is
                // rebuilt lazily on first touch — we just drop it here.
                if (self._rowIconsCache || changes[C.URL_FIELDS_CONFIG]) {
                    var iconTitles = ((self._rowIconsCache && self._rowIconsCache.entries) || [])
                        .map(function (e) { return e.title; });
                    if (isTaggedChange({
                        tag:         C.ROW_ICON_TAG,
                        cachedTitles: iconTitles,
                        configKeys:  [C.URL_FIELDS_CONFIG]
                    })) {
                        self._invalidateRowIconsCache();
                    }
                }
                // Preset pills — also clears active-preset marker if the
                // active preset was deleted.
                var presetTitles = (self._presetPills || [])
                    .map(function (p) { return p.title; });
                if (isTaggedChange({ tag: C.PRESET_TAG, cachedTitles: presetTitles })) {
                    self._invalidatePresetPills();
                    if (self.activePresetTitle &&
                        !self.wiki.tiddlerExists(self.activePresetTitle)) {
                        self.activePresetTitle = null;
                        self.activePresetBaseline = null;
                    }
                    if (self.open) self._renderPresetStrip();
                }
                // Leader pills.
                var leaderTitles = (self._leadersCache || [])
                    .map(function (l) { return l.title; });
                if (isTaggedChange({ tag: C.LEADER_TAG, cachedTitles: leaderTitles })) {
                    self._invalidateLeadersCache();
                    if (self.open) self._renderLeaderStrip();
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
        // subsystem entry point. registerRootMessage keeps the wire/unwire
        // pair refresh-safe by tracking prior handlers in self._rootHandlers.
        if ($tw.rootWidget) {
            self._rootHandlers = self._rootHandlers || {};
            function registerRootMessage(message, fn) {
                var prev = self._rootHandlers[message];
                if (prev) $tw.rootWidget.removeEventListener(message, prev);
                self._rootHandlers[message] = fn;
                $tw.rootWidget.addEventListener(message, fn);
            }
            registerRootMessage(C.OPEN_MESSAGE, function () {
                self.openPalette();
                return false;
            });
            // Open-at-entry: opens cp (if closed) and drills directly into a
            // named entry tiddler — must be visible at root (entry-tagged,
            // declared at-root position for the active view).
            registerRootMessage(C.OPEN_ENTRY_MESSAGE, function (event) {
                var entry = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.entry) || "";
                if (entry) self.openPaletteAtEntry(entry);
                return false;
            });
            // Reset-constraints wipes both strips; bound to Ctrl-DEL
            // globally and to the `Reset constraints` leader.
            registerRootMessage(C.RESET_CONSTRAINTS_MESSAGE, function () {
                self._clearAllFilters();
                self._clearAllVisibility();
                return false;
            });
            registerRootMessage(C.RESET_FILTERS_MESSAGE, function () {
                self._clearAllFilters();
                return false;
            });
            registerRootMessage(C.RESET_VISIBILITY_MESSAGE, function () {
                self._clearAllVisibility();
                return false;
            });
            // Add-filter / add-visibility / add-reach / add-field —
            // takes a constraint-tiddler title in `param`. Pre-fills
            // the input with the constraint's prefix so the user can
            // type the arg and hit Enter to commit.
            registerRootMessage(C.ADD_FILTER_MESSAGE, function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.filter) || "";
                if (title) self._addFilterByTitle(title);
                return false;
            });
            registerRootMessage(C.ADD_VISIBILITY_MESSAGE, function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.visibility) || "";
                if (title) self._addVisibilityByTitle(title);
                return false;
            });
            registerRootMessage(C.ADD_REACH_MESSAGE, function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.reach) || "";
                if (title) self._addReachByTitle(title);
                return false;
            });
            registerRootMessage(C.ADD_FIELD_MESSAGE, function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.field) || "";
                if (title) self._addFieldByTitle(title);
                return false;
            });
            registerRootMessage(C.RESET_REACH_MESSAGE, function () {
                self._clearAllReach();
                return false;
            });
            registerRootMessage(C.RESET_FIELDS_MESSAGE, function () {
                self._clearAllFields();
                return false;
            });
            // set-filter / set-visibility: leader-driven explicit-arg push.
            // Skips the interactive prefill — the leader supplies the arg.
            registerRootMessage(C.SET_FILTER_MESSAGE, function (event) {
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
            });
            registerRootMessage(C.SET_VISIBILITY_MESSAGE, function (event) {
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
            });
            registerRootMessage(C.SET_VIEW_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var viewTitle = p.view || (event && event.param) || "";
                if (viewTitle) self._setActiveView(viewTitle);
                return false;
            });
            registerRootMessage(C.APPLY_PRESET_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var presetTitle = p.preset || (event && event.param) || "";
                if (presetTitle) self._applyPreset(presetTitle);
                return false;
            });
            registerRootMessage(C.SAVE_PRESET_MESSAGE, function () {
                self.enterSaveMode();
                return false;
            });
            // Recall focuses the preset pill strip — the user can then ← →
            // to a pill and Enter to apply. Falls back to input focus when
            // no presets exist.
            registerRootMessage(C.RECALL_PRESET_MESSAGE, function () {
                if (self._presetPillCount && self._presetPillCount() > 0) {
                    self.setFocus("preset");
                } else {
                    self.setFocus("input");
                }
                return false;
            });
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

    // opts.fresh = true skips the saved-stack restore and forces a clean
    // root. Used by openPaletteAtEntry / OPEN_ENTRY_MESSAGE — the caller
    // is explicitly pointing the palette at a known entry and doesn't
    // want a stale resumed stack overwriting that intent.
    CascadePaletteWidget.prototype.openPalette = function (opts) {
        opts = opts || {};
        this._loadViews();
        this.open = true;
        var restored = false;
        if (!opts.fresh) {
            restored = this.restoreSavedStack();
        }
        if (!restored) {
            this.stack = [this.buildRootStage()];
        }
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
        this._renderReachStrip();
        this._renderFieldStrip();
        this._renderFilterStrip();
        this._renderLeaderStrip();
        this.renderStage();
        this._applyFocusAttr();
        if (this.detailsOpen) this.renderDetails();
        var self = this;
        setTimeout(function () {
            self.inputEl.focus();
        }, 0);
    };

    // Open cp (resets to root if already open) and immediately drill into
    // the named entry — reuses drillSelected so any drill kind (filter
    // stage, items-from, tree-container) works the same as a Tab press.
    // Silent no-op if the entry isn't present in the root stage's results
    // (e.g. hidden by the active view / visibility filters).
    CascadePaletteWidget.prototype.openPaletteAtEntry = function (entryTitle) {
        // Always fresh — the caller pointed us at a specific entry, so
        // any saved stack would silently override that intent.
        this.openPalette({ fresh: true });
        if (!entryTitle) return;
        var stage = this.topStage();
        if (!stage || !stage.results) return;
        for (var i = 0; i < stage.results.length; i++) {
            if (stage.results[i].title === entryTitle) {
                stage.selectedIndex = i;
                this.drillSelected();
                return;
            }
        }
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
            this.hideDetail();
        }
    };

    // reason = "preserve" → serialize the current stack to $:/temp so
    // the next openPalette() resumes there. Used by Shift-Esc and
    // action-fire close paths. Any other reason (default) → clear any
    // saved stack so the next open starts fresh.
    CascadePaletteWidget.prototype.close = function (reason) {
        if (reason === "preserve") {
            this.persistStack();
        } else {
            this.clearSavedStack();
        }
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
        this.hideDetail();
        this._hideSidePreview();
        this.backdropEl.style.display = "none";
    };

    // Move focus between the palette sections. Browser-level focus moves
    // to the section's DOM node (so keyboard events flow there); this.focus
    // is the canonical state; the popup's data-focus attribute is the
    // visual cue.
    CascadePaletteWidget.prototype.setFocus = function (section) {
        if (section !== "input" && section !== "menu" &&
            section !== "details" && section !== "preview" &&
            section !== "filter" &&
            section !== "visibility" && section !== "view" &&
            section !== "preset" && section !== "viewconfig" &&
            section !== "leader" &&
            section !== "reach" && section !== "field") return;
        // Don't allow focusing a strip with no pills — it would be a dead
        // end visually and a confusing Tab destination.
        if (section === "filter" && (!this.filters || this.filters.length === 0)) {
            section = "input";
        }
        if (section === "visibility" && (!this.visibilities || this.visibilities.length === 0)) {
            section = "input";
        }
        if (section === "reach" && (!this.reachPills || this.reachPills.length === 0)) {
            section = "input";
        }
        if (section === "field" && (!this.fieldPills || this.fieldPills.length === 0)) {
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
        // Don't focus the structure strip when the active view has no
        // structure to show (no layers, or layers but no pills) — focus
        // would land on a strip the user can't interact with.
        if (section === "viewconfig" && !this._hasViewConfigToShow()) {
            section = "input";
        }
        // Same for the leader strip when no leader is visible for the
        // active view.
        if (section === "leader" && this._leaderPillCount() === 0) {
            section = "input";
        }
        // Don't focus the details pane when the drawer isn't actually
        // visible — `detailsOpen` can be true while the drawer is hidden
        // (e.g. always-on with empty menu). The visual state is the truth.
        if (section === "details" && !this._isDetailsVisible()) {
            section = "input";
        }
        // Side preview pane only joins the cycle when an entry/action on
        // the stack registered a preview (the `rcp-showing-preview` class
        // toggles visibility).
        if (section === "preview" && !this._isSidePreviewVisible()) {
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
        else if (section === "details") this.detailEl.focus();
        else if (section === "preview") this.sidePreviewEl.focus();
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
        } else if (section === "reach") {
            if (this.reachFocusIdx >= this.reachPills.length) {
                this.reachFocusIdx = Math.max(0, this.reachPills.length - 1);
            }
            this.reachStripEl.focus();
            this._renderReachStrip();
            this._maybeRenderReachHelp();
        } else if (section === "field") {
            if (this.fieldFocusIdx >= this.fieldPills.length) {
                this.fieldFocusIdx = Math.max(0, this.fieldPills.length - 1);
            }
            this.fieldStripEl.focus();
            this._renderFieldStrip();
            this._maybeRenderFieldHelp();
        } else if (section === "viewconfig") {
            // Always enter compact mode on (re-)focus, per the documented
            // behaviour. Expansion is explicit via Enter / Space / Right
            // and survives only until Esc collapses it (or until focus
            // leaves the strip).
            this.viewConfigExpanded = false;
            this.viewConfigFocusIdx = 0;
            this.viewConfigStripEl.focus();
            this._renderViewConfigStrip();
            this._maybeRenderViewConfigHelp();
        } else if (section === "leader") {
            var leaderCount = this._leaderPillCount();
            if (this.leaderFocusIdx >= leaderCount) {
                this.leaderFocusIdx = Math.max(0, leaderCount - 1);
            }
            this.leaderStripEl.focus();
            this._renderLeaderStrip();
            this._maybeRenderLeaderHelp();
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
        if (prevFocus === "reach" || section === "reach") {
            this._renderReachStrip();
        }
        if (prevFocus === "field" || section === "field") {
            this._renderFieldStrip();
        }
        if (prevFocus === "view" || section === "view") {
            this._renderViewStrip();
        }
        if (prevFocus === "preset" || section === "preset") {
            this._renderPresetStrip();
        }
        if (prevFocus === "viewconfig" || section === "viewconfig") {
            this._renderViewConfigStrip();
        }
        if (prevFocus === "leader" || section === "leader") {
            this._renderLeaderStrip();
        }
        // Leaving a strip-focus while details is open: the pane was showing
        // strip help — refresh it to show the current menu selection so
        // the user gets per-row preview again.
        var stripFoci = { filter: 1, visibility: 1, view: 1, preset: 1, viewconfig: 1, leader: 1 };
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
        if (this.focus === "menu") {
            // Swap in the row-icon hint variant when the selected row has
            // at least one icon resolved, so the Alt-↵ gesture is
            // discoverable. If the primary icon also declares an alt
            // gesture (e.g. the shipped url icon's Ctrl-Alt-↵ copy),
            // surface that one too.
            var stageMenu = this.topStage();
            var pickedMenu = stageMenu && stageMenu.results &&
                stageMenu.results[stageMenu.selectedIndex];
            var iconsMenu = pickedMenu && pickedMenu._rowIcons;
            if (iconsMenu && iconsMenu.length) {
                var primary = (typeof this.primaryRowIcon === "function")
                    ? this.primaryRowIcon(pickedMenu) : null;
                var hasAlt = primary && (primary.altMessage || primary.altAction);
                this.hintEl.textContent = hasAlt
                    ? C.HINT_MENU_ROW_ICON_ALT
                    : C.HINT_MENU_ROW_ICON;
            } else {
                this.hintEl.textContent = C.HINT_MENU;
            }
        }
        else if (this.focus === "details")    this.hintEl.textContent = C.HINT_DETAILS;
        else if (this.focus === "preview")    this.hintEl.textContent =
            this._previewHasMultipleCandidates() ? C.HINT_PREVIEW_PILLS : C.HINT_PREVIEW;
        else if (this.focus === "filter")     this.hintEl.textContent = C.HINT_FILTER;
        else if (this.focus === "visibility") this.hintEl.textContent = C.HINT_VISIBILITY;
        else if (this.focus === "reach")      this.hintEl.textContent = C.HINT_REACH;
        else if (this.focus === "field")      this.hintEl.textContent = C.HINT_FIELD;
        else if (this.focus === "view")       this.hintEl.textContent = C.HINT_VIEW;
        else if (this.focus === "viewconfig") {
            this.hintEl.textContent = this.viewConfigExpanded
                ? C.HINT_VIEWCONFIG_EXPANDED
                : C.HINT_VIEWCONFIG_COMPACT;
        }
        else if (this.focus === "leader")     this.hintEl.textContent = C.HINT_LEADER;
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
