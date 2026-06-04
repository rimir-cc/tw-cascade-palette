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
  this.filters[] / visibilities[] / reachPills[] / metaPills[] / fieldPills[]
                             cp-{filters,visibility,reach-pills,search-meta-pills,
                                  search-field-pills}
                             OWN (each its own array)
  this._leaderFiring         cp-leaders OWNS — but READ by:
                             cp-filters._pushFilter, cp-visibility._pushVisibility,
                             cp-search-meta-pills._pushMeta,
                             cp-search-field-pills._pushField,
                             cp-views._setActiveView
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
                                          cp-reach-pills, cp-search-meta-pills,
                                          cp-search-field-pills, cp-leaders
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
        // Last focus held within each Tab group (pills vs main), tracked by
        // setFocus. Shift-Tab (_jumpFocusGroup) restores these so the user
        // returns to where they were rather than always snapping to input /
        // the bottom-most pill. Undefined until each group is first entered.
        this._lastPillFocus = undefined;
        this._lastMainFocus = "input";
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
        // Active search-meta pills (cascade-item author meta keys — name,
        // hint, or author-defined). Same lifecycle / push-remove grammar;
        // consumed by _activeMetaKeys() (cp-search-meta-pills.js). None
        // active = each row's ca-search-fields / global default
        // (meta-keys only) kicks in.
        this.metaPills = [];
        this.metaFocusIdx = 0;
        // Active search-field pills (literal tiddler fields on the row's
        // backing tiddler — text, caption, tags, author-defined fields).
        // Same lifecycle / push-remove grammar; consumed by
        // _activeTiddlerFields() (cp-search-field-pills.js). None active
        // = the matcher skips the tiddler-field layer entirely.
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
        // View-history back-stack — frames pushed by action/leader-initiated
        // view jumps (SET_VIEW_MESSAGE with recordBack:true). Bare Esc at
        // root depth pops a frame before falling through to close. Cleared
        // on every user-initiated view switch (view-pill, preset apply)
        // and on close.
        this._viewBackStack = [];
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
    require("$:/plugins/rimir/cascade-palette/widgets/cp-context-pills")(CascadePaletteWidget.prototype);
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
    require("$:/plugins/rimir/cascade-palette/widgets/cp-search-meta-pills")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-search-field-pills")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-lens-editor")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-row-decorations")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(CascadePaletteWidget.prototype);
    require("$:/plugins/rimir/cascade-palette/widgets/cp-axis-editor")(CascadePaletteWidget.prototype);
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
        this._updatePinPillRows();

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

        // Sticky-context strip — pills naming the tiddlers the user has
        // pinned for the current workday flow (call, meeting, focus).
        // Sits between preset and visibility in the visual stack so it
        // reads as the most session-meaningful constraint. Revealed via
        // `rcp-has-context` on the popup. State source of truth is
        // STICKY_CONTEXT_TITLE — pin/unpin/clear messages write that
        // tiddler; the change-event hook re-renders this strip live.
        this.contextStripEl = this.document.createElement("div");
        this.contextStripEl.className = "rcp-context-strip";
        this.contextStripEl.setAttribute("tabindex", "-1");
        this.contextFocusIdx = 0;

        // View strip — thin row of pills naming each registered view,
        // sitting between the constraint strips and the input. Hidden via
        // the `rcp-has-views` class on the popup when fewer than two
        // views are declared (a single-view setup is the default and
        // showing one pill would just add visual noise).
        this.viewStripEl = this.document.createElement("div");
        this.viewStripEl.className = "rcp-view-strip";
        this.viewStripEl.setAttribute("tabindex", "-1");

        // Lens slot strips (H4) — one single-select chooser per row-
        // decoration slot (name / icon / annotation). Each sits in the
        // visual stack just below the view strip; hidden via
        // `rcp-has-lens-<slot>` on the popup when no lens projects that
        // slot. Created in LENS_SLOTS order so the DOM matches the cycle.
        this._lensStripEls = {};
        this._lensFocusIdx = {};
        var self0 = this;
        C.LENS_SLOTS.forEach(function (slot) {
            var el = self0.document.createElement("div");
            el.className = "rcp-lens-strip rcp-lens-strip-" + slot;
            el.setAttribute("tabindex", "-1");
            self0._lensStripEls[slot] = el;
            self0._lensFocusIdx[slot] = 0;
        });

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

        // Search-meta strip — pills that decide WHICH cascade-item
        // author-meta keys the matcher reads (name / hint /
        // author-defined). Revealed via `rcp-has-meta`. Sits between
        // the reach strip and the field strip — both configure the
        // search axis on different dimensions.
        this.metaStripEl = this.document.createElement("div");
        this.metaStripEl.className = "rcp-meta-strip";
        this.metaStripEl.setAttribute("tabindex", "-1");

        // Search-field strip — pills that decide WHICH literal tiddler
        // fields the matcher reads on the row's backing tiddler
        // (text / caption / tags / author-defined). Revealed via
        // `rcp-has-field`. Sister of the meta strip.
        this.fieldStripEl = this.document.createElement("div");
        this.fieldStripEl.className = "rcp-field-strip";
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
        this.cascadeColEl.appendChild(this.contextStripEl);
        this.cascadeColEl.appendChild(this.visibilityStripEl);
        this.cascadeColEl.appendChild(this.reachStripEl);
        this.cascadeColEl.appendChild(this.metaStripEl);
        this.cascadeColEl.appendChild(this.fieldStripEl);
        this.cascadeColEl.appendChild(this.filterStripEl);
        this.cascadeColEl.appendChild(this.viewStripEl);
        var self1 = this;
        C.LENS_SLOTS.forEach(function (slot) {
            self1.cascadeColEl.appendChild(self1._lensStripEls[slot]);
        });
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
            self._onInputChanged();
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
            // Esc inside the filter lab returns focus to the palette
            // input WITHOUT cancelling the facet edit — the lab is a
            // decoupled sandbox, so leaving it shouldn't discard the edit
            // in progress. (A second Esc, now in the palette input, cancels
            // the edit normally.) Must come before both the preview-widget
            // passthrough — which excludes Escape so it'd otherwise fall to
            // handleKeydown's edit-mode Esc=cancel — and handleKeydown.
            if (e.key === "Escape" && self._filterLabActive &&
                self._filterLabActive() && self.sidePreviewEl &&
                self.sidePreviewEl.contains(e.target)) {
                e.preventDefault();
                self.inputEl.focus();
                return;
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
            var tgt = e.target;
            // Preview header (title row or pills-row background) acts as
            // a focus-restore handle — pulls focus back into whichever
            // section last held it, rather than re-anchoring to the
            // preview pane. Pill buttons themselves stop propagation in
            // their own click handler so they keep switching templates.
            if (tgt === self.sidePreviewTitleEl ||
                tgt === self.sidePreviewPillsEl) {
                e.preventDefault();
                self.restoreFocus();
                return;
            }
            // Don't steal focus from interactive descendants — if the user
            // clicked on an input/button inside the rendered template, let
            // it handle the focus itself.
            if (tgt && tgt !== self.sidePreviewEl &&
                tgt !== self.sidePreviewBodyEl) {
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
        wireStripFocus(this.contextStripEl, "context");
        wireStripFocus(this.visibilityStripEl, "visibility");
        wireStripFocus(this.reachStripEl, "reach");
        wireStripFocus(this.metaStripEl, "meta");
        wireStripFocus(this.fieldStripEl, "field");
        wireStripFocus(this.viewStripEl, "view");
        C.LENS_SLOTS.forEach(function (slot) {
            wireStripFocus(self._lensStripEls[slot], "lens-" + slot);
        });
        wireStripFocus(this.presetStripEl, "preset");
        wireStripFocus(this.viewConfigStripEl, "viewconfig");
        wireStripFocus(this.leaderStripEl, "leader");

        // Breadcrumb header — clicking the background (or a non-clickable
        // segment / separator) restores focus to the section that last
        // held it. Useful when a preview-body widget or off-popup target
        // grabbed native focus and the user wants to pull it back without
        // re-anchoring to a default. Clickable segments have their own
        // mousedown handler in renderBreadcrumb (pop to depth + input
        // focus) — skip those so both don't compete.
        this.breadcrumbEl.addEventListener("mousedown", function (e) {
            var tgt = e.target;
            if (tgt && tgt.classList &&
                tgt.classList.contains("rcp-breadcrumb-clickable")) return;
            e.preventDefault();
            self.restoreFocus();
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
                if (changes[C.PIN_PILL_ROWS_CONFIG]) {
                    self._updatePinPillRows();
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
                // Lenses (H4) — invalidate when a tagged lens tiddler
                // changes, or when any per-slot active-lens state moves
                // (state titles share LENS_STATE_PREFIX). Re-render every
                // slot strip so chooser highlight + decorations track live.
                var lensTitles = (self._lensesCache || [])
                    .map(function (l) { return l.title; });
                var lensStateChanged = Object.keys(changes).some(function (k) {
                    return k.indexOf(C.LENS_STATE_PREFIX) === 0;
                });
                if (lensStateChanged ||
                    isTaggedChange({ tag: C.LENS_TAG, cachedTitles: lensTitles })) {
                    self._invalidateLenses();
                    if (self.open) self._renderAllLensStrips();
                }
                // View / structure-layer / axis definition tiddlers (and
                // scratchpad / layer-axes state) — invalidate the view
                // descriptor cache so structural edits (ours via the editor
                // OR external) rebuild the descriptors and the live preview.
                // _loadViews resets the active view, so reload via the
                // active-preserving helper. Without this, the deferred
                // change event after a facet commit would re-render with the
                // STALE cached view and silently undo the edit.
                if (isTaggedChange({ tag: C.VIEW_TAG }) ||
                    isTaggedChange({ tag: C.STRUCTURE_LAYER_TAG }) ||
                    isTaggedChange({ tag: C.AXIS_TAG }) ||
                    Object.keys(changes).some(function (k) {
                        return k.indexOf(C.SCRATCHPAD_PREFIX) === 0 ||
                            k.indexOf(C.LAYER_AXES_STATE_PREFIX) === 0;
                    })) {
                    if (self._reloadViewsPreservingActive) {
                        self._reloadViewsPreservingActive();
                    } else {
                        self._viewsLoaded = false;
                    }
                    if (self.open && self._renderViewStrip) self._renderViewStrip();
                    if (self.open && self._renderViewConfigStrip) {
                        self._renderViewConfigStrip();
                    }
                }
                // Sticky context — refresh the strip when the state
                // tiddler changes (own writes via pin/unpin, external
                // writes via row actions sending the messages). The
                // view strip is also re-rendered because the per-view
                // context-aware badge derives from contextPills.length.
                if (changes[C.STICKY_CONTEXT_TITLE]) {
                    self._refreshContextPills();
                    if (self.open) {
                        self._renderContextStrip();
                        self._renderViewStrip();
                    }
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
            // Sticky context — three universal verbs callable from any
            // row action / leader / external trigger. Payload is the
            // tiddler title (in `param` for ad-hoc senders, in
            // `paramObject.title` for structured callers).
            registerRootMessage(C.PIN_CONTEXT_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var title = p.title || (event && event.param) || "";
                if (title) self._pinStickyContext(title);
                return false;
            });
            registerRootMessage(C.UNPIN_CONTEXT_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var title = p.title || (event && event.param) || "";
                if (title) self._unpinStickyContext(title);
                return false;
            });
            registerRootMessage(C.CLEAR_CONTEXT_MESSAGE, function () {
                self._clearStickyContext();
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
            registerRootMessage(C.ADD_META_MESSAGE, function (event) {
                var title = (event && event.param) ||
                    (event && event.paramObject && event.paramObject.meta) || "";
                if (title) self._addMetaByTitle(title);
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
            registerRootMessage(C.RESET_META_MESSAGE, function () {
                self._clearAllMeta();
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
                if (viewTitle) self._setActiveView(viewTitle, { recordBack: true });
                return false;
            });
            // View lifecycle (Manage views menu). Each handler self-navigates
            // (resets the stack to root, re-renders, focuses) so the fired
            // leaf can carry `ca-after-fire: keep` and the palette lands the
            // user on the right surface. `view`/`param` = target title; the
            // editor methods default to the active view when omitted.
            registerRootMessage(C.NEW_VIEW_MESSAGE, function () {
                if (self._newViewScratchpad) self._newViewScratchpad();
                return false;
            });
            registerRootMessage(C.EDIT_VIEW_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.view || (event && event.param) || "";
                if (t && t !== self.activeView) self._setActiveView(t);
                if (self._editActiveView) self._editActiveView();
                return false;
            });
            registerRootMessage(C.FORK_VIEW_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.view || (event && event.param) || self.activeView;
                if (self._forkView) self._forkView(t);
                return false;
            });
            registerRootMessage(C.DELETE_VIEW_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.view || (event && event.param) || self.activeView;
                if (self._deleteView) self._deleteView(t);
                return false;
            });
            registerRootMessage(C.NEW_LENS_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var slot = p.slot || (event && event.param) || "name";
                if (self._newLensScratchpad) self._newLensScratchpad(slot);
                return false;
            });
            registerRootMessage(C.CLONE_LENS_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.lens || (event && event.param) || "";
                if (t && self._cloneLensToUser) self._cloneLensToUser(t);
                return false;
            });
            registerRootMessage(C.DELETE_LENS_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.lens || (event && event.param) || "";
                if (t && self._deleteLens) self._deleteLens(t);
                return false;
            });
            registerRootMessage(C.NEW_AXIS_MESSAGE, function () {
                if (self._newAxisScratchpad) self._newAxisScratchpad();
                return false;
            });
            registerRootMessage(C.CLONE_AXIS_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.axis || (event && event.param) || "";
                if (t && self._cloneAxisToUser) self._cloneAxisToUser(t);
                return false;
            });
            registerRootMessage(C.DELETE_AXIS_MESSAGE, function (event) {
                var p = (event && event.paramObject) || {};
                var t = p.axis || (event && event.param) || "";
                if (t && self._deleteAxis) self._deleteAxis(t);
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
        this._refreshContextPills();
        this._renderContextStrip();
        this._renderViewStrip();
        this._renderAllLensStrips();
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

    CascadePaletteWidget.prototype.isPinPillRows = function () {
        var raw = this.wiki.getTiddlerText(C.PIN_PILL_ROWS_CONFIG, C.DEFAULT_FALSE_VALUE);
        var s = String(raw || "").toLowerCase().trim();
        return s === "yes" || s === "true" || s === "on" || s === "1";
    };

    // Toggle the `rcp-pin-pill-rows` class on the popup. When set, CSS
    // forces every pill strip (visibility / reach / fields / filter)
    // to render even with zero pushed pills. Idempotent; safe to call
    // any time popupEl exists.
    CascadePaletteWidget.prototype._updatePinPillRows = function () {
        if (!this.popupEl) return;
        this.popupEl.classList.toggle("rcp-pin-pill-rows", this.isPinPillRows());
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
        // Cancel any pending debounced side-preview render so it doesn't
        // fire against the torn-down stack / DOM after close.
        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
            this._previewDebounceTimer = null;
        }
        this._leaderPending = null;
        if (this.inputEl) {
            this.inputEl.classList.remove("rcp-input-leader-match");
        }
        this._pickModeReturnTo = null;
        this._viewBackStack = [];
        this.saveMode = null;
        this.hideDetail();
        this._hideSidePreview();
        this.backdropEl.style.display = "none";
    };

    // Move focus between the palette sections. Browser-level focus moves
    // to the section's DOM node (so keyboard events flow there); this.focus
    // is the canonical state; the popup's data-focus attribute is the
    // visual cue.
    // Recompute + re-render the active stage from the current input
    // value, refreshing all the typing-driven cues. Shared by the
    // inputEl "input" listener and the type-ahead redirect
    // (_typeAheadToInput), which mutates inputEl.value programmatically
    // — a programmatic value set does NOT dispatch an "input" event, so
    // the redirect path calls this directly.
    CascadePaletteWidget.prototype._onInputChanged = function () {
        // While editing a bound value or naming a save, the input IS the
        // value editor — typing must not re-filter the results.
        if (this.editMode || this.saveMode) return;
        var stage = this.topStage();
        if (!stage) return;
        stage.query = this.inputEl.value;
        stage.selectedIndex = 0;
        this.recomputeStage(stage);
        this.renderStage();
        // Leader detection runs first — leader-pending state takes
        // precedence over every other cue. Then the sticky-context "+"
        // cue (separate semantics: pins a literal title rather than
        // commits a filter/visibility constraint). Finally the generic
        // filter/visibility prefix cue.
        var leaderPending = this._updateLeaderCue();
        if (!leaderPending) {
            var contextPrefix = this._updateContextPrefixCue();
            if (!contextPrefix) {
                // Visual cue when the input matches a filter/visibility
                // prefix: input picks up a coloured underline and the
                // hint footer changes to "↵ commit".
                this._updateConstraintPrefixCue();
            }
        }
    };

    // Type-ahead redirect: a printable character pressed while focus is
    // anywhere but the input jumps to the input and appends the char
    // (command-palette convention — start typing from any section to
    // filter). Called from handleKeydown's Tier 4 after the active
    // section handler declined the key. Appends at the end and moves the
    // caret there (focus wasn't in the input, so there's no meaningful
    // selection to preserve), then recomputes via the shared path.
    CascadePaletteWidget.prototype._typeAheadToInput = function (ch) {
        this.setFocus("input");
        if (!this.inputEl) return;
        this.inputEl.value = this.inputEl.value + ch;
        var end = this.inputEl.value.length;
        try { this.inputEl.setSelectionRange(end, end); } catch (e) { /* no-op */ }
        this._onInputChanged();
    };

    CascadePaletteWidget.prototype.setFocus = function (section) {
        var isLensSection = typeof section === "string" && section.indexOf("lens-") === 0;
        if (section !== "input" && section !== "menu" &&
            section !== "details" && section !== "preview" &&
            section !== "filter" && section !== "context" &&
            section !== "visibility" && section !== "view" &&
            !isLensSection &&
            section !== "preset" && section !== "viewconfig" &&
            section !== "leader" &&
            section !== "reach" && section !== "meta" &&
            section !== "field") return;
        // Same guard for context as for other strips — don't focus an
        // empty pill row (dead-end UX).
        if (section === "context" && (!this.contextPills || this.contextPills.length === 0)) {
            section = "input";
        }
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
        if (section === "meta" && (!this.metaPills || this.metaPills.length === 0)) {
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
        // Lens slot strip joins the cycle only when a lens projects its
        // slot. Don't focus an empty chooser (dead-end UX).
        if (isLensSection) {
            var guardSlot = section.slice("lens-".length);
            if (this._lensPillCount(guardSlot) === 0) section = "input";
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
        // Remember the last focus within each of the two Tab groups (pills
        // vs main) so Shift-Tab can return to exactly where the user was,
        // rather than always snapping to input / the bottom-most pill. The
        // resolved `section` is used (post-normalization), so a downgraded
        // dead-end strip records as "input" — consistent with where focus
        // actually lands. Context isn't in either Tab cycle, so it's
        // deliberately recorded in neither group.
        if (this._isPillFocus(section)) {
            this._lastPillFocus = section;
        } else if (section === "input" || section === "menu" ||
                   section === "details" || section === "preview") {
            this._lastMainFocus = section;
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
        } else if (section === "context") {
            if (!this.contextPills) this._refreshContextPills();
            if (this.contextFocusIdx >= this.contextPills.length) {
                this.contextFocusIdx = Math.max(0, this.contextPills.length - 1);
            }
            this.contextStripEl.focus();
            this._renderContextStrip();
            this._maybeRenderContextHelp();
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
        } else if (section === "meta") {
            if (this.metaFocusIdx >= this.metaPills.length) {
                this.metaFocusIdx = Math.max(0, this.metaPills.length - 1);
            }
            this.metaStripEl.focus();
            this._renderMetaStrip();
            this._maybeRenderMetaHelp();
        } else if (section === "field") {
            if (this.fieldFocusIdx >= this.fieldPills.length) {
                this.fieldFocusIdx = Math.max(0, this.fieldPills.length - 1);
            }
            this.fieldStripEl.focus();
            this._renderFieldStrip();
            this._maybeRenderFieldHelp();
        } else if (section === "viewconfig") {
            // Normally enter compact mode on (re-)focus: expansion is
            // explicit via Enter / Space / Right and survives only until
            // Esc collapses it (or until focus leaves the strip). In
            // scratchpad mode the strip is pinned-open, so don't reset it.
            if (!(this._structurePinned && this._structurePinned())) {
                this.viewConfigExpanded = false;
            }
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
        } else if (typeof section === "string" && section.indexOf("lens-") === 0) {
            // Anchor focus on the active lens (or the synthetic "off" head
            // at index 0) so ←/→ starts adjacent to the current pick and
            // Enter re-applies it as a no-op. Mirrors the row-label branch.
            var lensSlot = section.slice("lens-".length);
            var lensEntries = this._lensStripEntries(lensSlot);
            var lensActive = this._readActiveLensTitle(lensSlot);
            var lensIdx = 0;
            if (lensActive) {
                for (var lei = 0; lei < lensEntries.length; lei++) {
                    if (lensEntries[lei].title === lensActive) { lensIdx = lei; break; }
                }
            }
            this._lensFocusIdxSet(lensSlot,
                Math.min(lensIdx, Math.max(0, lensEntries.length - 1)));
            this._lensStripEls[lensSlot].focus();
            this._renderLensStrip(lensSlot);
            this._maybeRenderLensHelp(lensSlot);
        }
        // Re-render the strip when focus changes so pill-focused styling
        // updates (focused class only on pills of the focused strip).
        if (prevFocus === "filter" || section === "filter") {
            this._renderFilterStrip();
        }
        if (prevFocus === "context" || section === "context") {
            this._renderContextStrip();
        }
        if (prevFocus === "visibility" || section === "visibility") {
            this._renderVisibilityStrip();
        }
        if (prevFocus === "reach" || section === "reach") {
            this._renderReachStrip();
        }
        if (prevFocus === "meta" || section === "meta") {
            this._renderMetaStrip();
        }
        if (prevFocus === "field" || section === "field") {
            this._renderFieldStrip();
        }
        if (prevFocus === "view" || section === "view") {
            this._renderViewStrip();
        }
        // Re-render whichever lens strip lost or gained focus so the
        // focused-pill highlight only sits on the active chooser.
        if (typeof prevFocus === "string" && prevFocus.indexOf("lens-") === 0) {
            this._renderLensStrip(prevFocus.slice("lens-".length));
        }
        if (typeof section === "string" && section.indexOf("lens-") === 0) {
            this._renderLensStrip(section.slice("lens-".length));
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
        var stripFoci = {
            filter: 1, context: 1, visibility: 1, view: 1,
            "lens-name": 1, "lens-icon": 1, "lens-annotation": 1,
            preset: 1, viewconfig: 1, leader: 1
        };
        if (stripFoci[prevFocus] && !stripFoci[section] && this.detailsOpen) {
            this.renderDetails();
        }
    };

    // Re-apply browser-level focus to whichever section this.focus already
    // names. Used when the popup lost native focus (e.g., a widget inside
    // the preview body grabbed it and was then removed) and the user clicks
    // a header element to pull focus back into the popup — without changing
    // the logical focus section.
    CascadePaletteWidget.prototype.restoreFocus = function () {
        if (!this.open) return;
        var section = this.focus || "input";
        if (section === "input") this.inputEl.focus();
        else if (section === "menu") this.resultsEl.focus();
        else if (section === "details") this.detailEl.focus();
        else if (section === "preview") this.sidePreviewEl.focus();
        else if (section === "preset") this.presetStripEl.focus();
        else if (section === "filter") this.filterStripEl.focus();
        else if (section === "context") this.contextStripEl.focus();
        else if (section === "visibility") this.visibilityStripEl.focus();
        else if (section === "reach") this.reachStripEl.focus();
        else if (section === "meta") this.metaStripEl.focus();
        else if (section === "field") this.fieldStripEl.focus();
        else if (section === "view") this.viewStripEl.focus();
        else if (section.indexOf && section.indexOf("lens-") === 0 &&
                 this._lensStripEls[section.slice("lens-".length)]) {
            this._lensStripEls[section.slice("lens-".length)].focus();
        }
        else if (section === "viewconfig") this.viewConfigStripEl.focus();
        else if (section === "leader") this.leaderStripEl.focus();
        else this.inputEl.focus();
    };

    CascadePaletteWidget.prototype._applyFocusAttr = function () {
        if (this.popupEl) this.popupEl.dataset.focus = this.focus;
        this._renderHint();
    };

    // Compose the menu-section hint from the selected row's capabilities.
    // Each token in C.HINT_TOKENS is gated on something the row actually
    // supports — `Space actions` only when applicable actions exist,
    // `+/- adjust` only on number rows, `Alt-↵ open` only when a row-icon
    // is present, etc. Joined with " · " in stable display order. Cheap:
    // every read is either a field on `picked` or a single filter call
    // (loadActionsForType) which dominates the overall cost at <1 ms.
    CascadePaletteWidget.prototype._composeMenuHint = function () {
        var T = C.HINT_TOKENS;
        var stage = this.topStage();
        var picked = stage && stage.results &&
            stage.results[stage.selectedIndex];
        var tokens = [];

        tokens.push(T["tab-section"]);

        // `↑↓ select` only makes sense when there's more than one row to
        // move between. Hidden on empty stages and single-result stages.
        if (stage && stage.results && stage.results.length > 1) {
            tokens.push(T["select"]);
        }

        // Drill capability — mirrors the dispatch order in drillSelected
        // (cp-firing.js). Each of these row shapes opens a follow-up
        // stage on Right-arrow.
        var drillable = false;
        if (picked) {
            if (picked._path !== undefined) drillable = true;
            else if (picked._treeContainer && picked._treeParent) drillable = true;
            else if (picked.entityType && picked.kind === "leaf") drillable = true;
            else if (picked.kind === "drill" && (picked.nextScope || picked.itemsFrom)) drillable = true;
            else if (picked.isItem && stage && stage.entityType) drillable = true;
        }
        if (drillable) tokens.push(T["drill"]);

        // `← back` only when there's a stage to pop to. At root the
        // gesture is a no-op (see ArrowLeft in _handleKeydownMenu).
        if (this.stack && this.stack.length > 1) tokens.push(T["back"]);

        // Space binds to exactly one gesture per row — mirror the
        // dispatch order in cp-keyboard.js's Space handler so the hint
        // matches what the key will actually do.
        if (picked) {
            if (picked._path !== undefined) {
                tokens.push(T["pin"]);
            } else if (picked.kind === "toggle") {
                tokens.push(T["toggle"]);
            } else if (picked.kind === "text" || picked.kind === "number" ||
                       picked.kind === "date") {
                tokens.push(T["edit"]);
            } else if (picked.title && !picked.isSynthetic) {
                var entityType = picked.entityType ||
                    (picked.isItem && stage ? stage.entityType : null) ||
                    null;
                // Reuse `_actionPreviewCountCache` populated by
                // `_maybeAppendActionPreview` during result render —
                // most visible rows are already in it. Fall back to a
                // direct filter call when the view disables previews
                // (cache is empty in that case).
                var key = (entityType || "") + " " + picked.title;
                var cache = this._actionPreviewCountCache;
                var count;
                if (cache && Object.prototype.hasOwnProperty.call(cache, key)) {
                    count = cache[key];
                } else {
                    var applicable = this.loadActionsForType(entityType, picked.title);
                    count = applicable ? applicable.length : 0;
                    if (cache) cache[key] = count;
                }
                if (count > 0) tokens.push(T["actions"]);
            }
        }

        // +/- on number rows steps the bound value (cp-keyboard.js
        // isPlusKey / isMinusKey path).
        if (picked && picked.kind === "number") tokens.push(T["adjust"]);

        // ↵ fire is the universal commit gesture in the menu — every
        // result type has a fireSelected branch.
        if (picked) tokens.push(T["fire"]);

        // Row-icon gestures — Alt-↵ opens the primary icon's payload
        // (URL etc.). Ctrl-Alt-↵ fires the icon's secondary action when
        // declared (e.g. the shipped url icon's copy-to-clipboard).
        if (picked && picked._rowIcons && picked._rowIcons.length) {
            tokens.push(T["open-icon"]);
            var primary = (typeof this.primaryRowIcon === "function")
                ? this.primaryRowIcon(picked) : null;
            if (primary && (primary.altMessage || primary.altAction)) {
                tokens.push(T["copy-icon"]);
            }
        }

        // Esc in menu pops one stage at depth > 1 (returning to the
        // previous context), and falls back to focusing input at root.
        // Action-menu stages reach the popped state via their parent
        // tiddler, so label it "Esc tiddler" for clarity. Other non-root
        // stages keep the existing "Esc input" wording.
        if (stage && stage.kind === "actions") {
            tokens.push(T["esc-tiddler"]);
        } else {
            tokens.push(T["esc-input"]);
        }
        tokens.push(T["hold-ctrl-detail"]);

        return tokens.join(" · ");
    };

    CascadePaletteWidget.prototype._renderHint = function () {
        if (!this.hintEl) return;
        if (this.editMode) {
            this.hintEl.textContent = C.HINT_EDIT;
            return;
        }
        if (this.focus === "menu") {
            this.hintEl.textContent = this._composeMenuHint();
        }
        else if (this.focus === "details")    this.hintEl.textContent = C.HINT_DETAILS;
        else if (this.focus === "preview")    this.hintEl.textContent =
            this._previewHasMultipleCandidates() ? C.HINT_PREVIEW_PILLS : C.HINT_PREVIEW;
        else if (this.focus === "filter")     this.hintEl.textContent = C.HINT_FILTER;
        else if (this.focus === "visibility") this.hintEl.textContent = C.HINT_VISIBILITY;
        else if (this.focus === "reach")      this.hintEl.textContent = C.HINT_REACH;
        else if (this.focus === "meta")       this.hintEl.textContent = C.HINT_META;
        else if (this.focus === "field")      this.hintEl.textContent = C.HINT_FIELD;
        else if (this.focus === "view")       this.hintEl.textContent = C.HINT_VIEW;
        else if (typeof this.focus === "string" && this.focus.indexOf("lens-") === 0) {
            this.hintEl.textContent = C.HINT_LENS;
        }
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
