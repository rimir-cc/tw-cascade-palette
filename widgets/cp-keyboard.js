/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-keyboard
type: application/javascript
module-type: library

Keyboard dispatch — 3-tier model.

  1. Edit-mode / save-mode short-circuit — Enter/Esc only.
  2. Global keys — Tab cycle, Esc-cancel-pick-mode, Ctrl-DEL clear all
     constraints, Enter fire.
  3. Section-specific keys — routed by `this.focus`.

Within section-specific routing, Esc has consistent "exit current
context" semantics:
  - in input:   close the palette entirely
  - in menu:    return focus to input
  - in any strip / details: return focus to input

\*/
"use strict";

// Section-level dispatch table — `(focus) → handler-method-name`. Maps
// every value `this.focus` can hold (set by setFocus across modules)
// to the per-section keydown handler. Hoisted out of the switch
// statement so it's pure data: testable in isolation, and a new
// section ships by adding one row + writing the handler.
//
// The handler signature is uniform: `(e, stage)` — the dispatcher
// passes both. Sections that ignore `stage` (none today) would
// still receive it.
var SECTION_HANDLERS = {
    "input":      "_handleKeydownInput",
    "menu":       "_handleKeydownMenu",
    "filter":     "_handleKeydownFilter",
    "visibility": "_handleKeydownVisibility",
    "reach":      "_handleKeydownReach",
    "meta":       "_handleKeydownMeta",
    "field":      "_handleKeydownField",
    "view":       "_handleKeydownView",
    "viewconfig": "_handleKeydownViewConfig",
    "leader":     "_handleKeydownLeader",
    "preset":     "_handleKeydownPreset",
    "details":    "_handleKeydownDetails"
    // "preview" focus has no per-section keydown handler — the side-
    // preview pane is a natively focusable DOM element, so the browser
    // handles cursor / scroll directly. The pre-Phase-E switch had a
    // stray `case "preview": this._handleKeydownPreview(e, stage)` that
    // would have thrown TypeError (the handler was never defined); the
    // table-driven dispatch fixes the latent bug by simply not routing
    // preview focus to anything (the typeof guard in handleKeydown
    // silently no-ops unknown focus values).
};

// Resolve the section handler for a focus value. Returns the handler
// METHOD NAME (string) or `null` when the focus is unknown. The
// caller invokes `proto[name]` themselves — keeps this pure for
// testing without needing a widget instance.
function resolveSectionHandler(focus) {
    if (!focus || typeof focus !== "string") return null;
    return Object.prototype.hasOwnProperty.call(SECTION_HANDLERS, focus)
        ? SECTION_HANDLERS[focus]
        : null;
}

// Snapshot the dispatch table (read-only export for diagnostics /
// specs). Returns a fresh copy each call so callers can safely
// inspect / iterate without race-on-mutate.
function dispatchTableSnapshot() {
    var out = {};
    for (var k in SECTION_HANDLERS) {
        if (Object.prototype.hasOwnProperty.call(SECTION_HANDLERS, k)) {
            out[k] = SECTION_HANDLERS[k];
        }
    }
    return out;
}

module.exports = function (proto) {

    proto.handleKeydown = function (e) {
        var stage = this.topStage();
        if (!stage) return;

        // Tier 1 — edit mode / save mode short-circuit.
        if (this.editMode) {
            this._handleKeydownEdit(e);
            return;
        }
        if (this.saveMode) {
            if (e.key === "Enter") {
                e.preventDefault();
                this.exitSaveMode(true);
                return;
            }
            if (e.key === "Escape") {
                e.preventDefault();
                this.exitSaveMode(false);
                return;
            }
            // Other keys fall through to native input behaviour.
            return;
        }

        // Tier 2a — global section-cycling.
        //   Tab        cycles within the current focus group (pills xor main).
        //   Shift-Tab  jumps between the two groups.
        if (e.key === "Tab") {
            e.preventDefault();
            if (e.shiftKey) {
                this._jumpFocusGroup();
            } else {
                this._cycleFocus(1);
            }
            return;
        }
        // Tier 2a' — Shift-Esc closes the palette directly from any
        // focus and any depth. Comes FIRST so it bypasses pick-mode
        // cleanup (the user explicitly chose "I'm done", not "back out
        // of pick-mode"). Bare Esc walks the breadcrumb back one stage
        // at a time.
        if (e.key === "Escape" && e.shiftKey) {
            e.preventDefault();
            // Shift-Esc explicitly freezes the current stack — the user
            // is parking the palette mid-flow and wants to resume next
            // open. See cp-stack.js comment block on session persistence.
            this.close("preserve");
            return;
        }
        // Tier 2a'' — bare Esc cancels pick-mode globally (input / menu
        // / etc.) before the section-specific Esc handlers run, so the
        // user can bail out of a sub-pick from any focus.
        if (e.key === "Escape" && this._pickModeReturnTo) {
            e.preventDefault();
            this._cancelPickMode();
            return;
        }
        // Tier 2b — global Ctrl-DEL clears both constraint strips
        // (filters + visibility) regardless of focus. Cheap escape hatch
        // from a "now what?" pile-up of pills.
        var hasAnyConstraint =
            (this.filters && this.filters.length > 0) ||
            (this.visibilities && this.visibilities.length > 0);
        if ((e.key === "Delete" || e.key === "Backspace") && e.ctrlKey &&
            (hasAnyConstraint || this.activePresetTitle)) {
            // Backspace in input has its native "delete char" semantic when
            // not paired with Ctrl — Ctrl-Backspace is "delete word", which
            // we deliberately repurpose as "wipe constraints" since the
            // user is unlikely to need word-delete mid-palette. Also wipes
            // the active-preset marker so the user returns to a clean,
            // no-preset baseline.
            e.preventDefault();
            this._clearAllFilters();
            this._clearAllVisibility();
            this.activePresetTitle = null;
            this.activePresetBaseline = null;
            this._renderPresetStrip();
            return;
        }
        // Tier 2c — Enter fires selection when focus is on input/menu/
        // details. In any strip focus, Enter is delegated to the section
        // handler (no fire — Enter activates the strip's pill instead).
        // Exception: in input focus, if the current text matches a known
        // constraint prefix with a non-empty argument, Enter commits the
        // pill (pushes a filter or visibility, clears the input) instead
        // of firing the menu selection.
        if (e.key === "Enter" && this.focus !== "filter" &&
            this.focus !== "visibility" && this.focus !== "view" &&
            this.focus !== "preset" &&
            this.focus !== "reach" && this.focus !== "meta" &&
            this.focus !== "field") {
            // Alt-Enter — fire the selected row's primary row-icon
            // (e.g. open external URL in a new tab). Ctrl-Alt-Enter
            // fires the same icon's ''secondary'' action (`alt`
            // mode): the shipped URL icon copies the URL to the
            // clipboard. Both gestures fall through to the regular
            // fire path when the row has no icons, so users who
            // reflex-press them on a regular row still get the
            // default behaviour rather than a silent no-op.
            if (e.altKey && !e.shiftKey &&
                (this.focus === "input" || this.focus === "menu" ||
                 this.focus === "details")) {
                var stageAlt = this.topStage();
                var pickedAlt = stageAlt &&
                    stageAlt.results &&
                    stageAlt.results[stageAlt.selectedIndex];
                var iconAlt = pickedAlt && this.primaryRowIcon(pickedAlt);
                if (iconAlt) {
                    var mode = e.ctrlKey ? "alt" : "primary";
                    // Silent no-op if the icon has no action for the
                    // requested mode (e.g. Ctrl-Alt-↵ on an icon that
                    // only declares a primary action) — better than
                    // closing the palette unexpectedly.
                    var hasGesture = mode === "alt"
                        ? (iconAlt.altMessage || iconAlt.altAction)
                        : (iconAlt.message || iconAlt.action);
                    if (hasGesture) {
                        e.preventDefault();
                        this.fireRowIcon(pickedAlt, iconAlt, e, mode);
                        return;
                    }
                }
            }
            if (this.focus === "input" && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                if (this._commitConstraintFromInput()) {
                    e.preventDefault();
                    return;
                }
            }
            e.preventDefault();
            // Ctrl-Enter keeps palette open after firing.
            this.fireSelected(e.ctrlKey);
            return;
        }

        // Tier 3 — section-specific. Dispatch via the hoisted
        // SECTION_HANDLERS table (top of file): focus value → method
        // name → invoke. Unknown focus is a silent no-op (defensive —
        // setFocus is the gate that should reject bad values).
        var handlerName = resolveSectionHandler(this.focus);
        if (handlerName && typeof this[handlerName] === "function") {
            this[handlerName](e, stage);
        }
    };

    proto._handleKeydownEdit = function (e) {
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

    proto._handleKeydownInput = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            // Esc backs out one stage at any depth > 1 — symmetric with
            // ArrowLeft-in-menu — and only closes at root. So a deep
            // action-subtree (entity drill → action menu → confirm) backs
            // out keystroke-by-keystroke instead of jumping all the way
            // out, and the user can revisit a wrong drill without
            // restarting the whole flow.
            if (this.stack.length > 1) {
                this.popStage();
            } else {
                this.close();
            }
            return;
        }
        if (e.key === "ArrowDown") {
            // Step into the menu only if there's something to select.
            if (stage.results.length > 0) {
                e.preventDefault();
                this.setFocus("menu");
            }
            return;
        }
        if (e.key === "ArrowUp") {
            // Step into the pill section (bottom-most active row) if any.
            var pills = this._pillsCycle();
            if (pills.length > 0) {
                e.preventDefault();
                this.setFocus(pills[pills.length - 1]);
            }
            return;
        }
        // Typing is handled by the input event listener.
    };

    proto._handleKeydownMenu = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            // At any depth > 1, Esc-in-menu pops one stage and keeps
            // focus on the menu — symmetric with ArrowLeft and with
            // Esc-in-input. The user walks the breadcrumb right-to-left
            // keystroke-by-keystroke from anywhere, instead of bouncing
            // through input on the way. At root depth (no stage to pop),
            // Esc refocuses input so the user can type to filter root
            // results.
            if (this.stack.length > 1) {
                this.popStage();
                return;
            }
            this.setFocus("input");
            return;
        }
        // Ctrl-↑ / Ctrl-↓ on a row declaring `ca-on-move-up` / `ca-on-
        // move-down` fires the move action. Selection is pre-bumped so it
        // follows the row through the cp change-hook's stage recompute.
        // No action declared on the focused row → fall through to the
        // bare ArrowUp/ArrowDown selection-nudge below.
        if (e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            var pickedMv = stage.results[stage.selectedIndex];
            var goingUp = e.key === "ArrowUp";
            var mvAction = pickedMv && (goingUp ? pickedMv.onMoveUp : pickedMv.onMoveDown);
            if (mvAction) {
                e.preventDefault();
                var canMove = goingUp
                    ? stage.selectedIndex > 0
                    : stage.selectedIndex < stage.results.length - 1;
                if (canMove) {
                    stage.selectedIndex += goingUp ? -1 : 1;
                }
                var mvVars = this.buildStageVariables(stage, pickedMv.title);
                this.invokeViaNavigator(mvAction, mvVars);
                return;
            }
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (stage.selectedIndex > 0) {
                stage.selectedIndex -= 1;
                this.renderResults();
                if (stage._previewPerRow) this._renderSidePreview();
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
                if (stage._previewPerRow) this._renderSidePreview();
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
            // ArrowLeft pops one stage (back). At root depth it would
            // close the palette, but closing is reserved for Esc — at
            // root, ArrowLeft is a no-op.
            if (this.stack.length > 1) this.popStage();
            return;
        }
        if (e.key === " " || e.code === "Space") {
            var picked = stage.results[stage.selectedIndex];
            if (picked) {
                // Deep-search result — Space pins the row: replay the
                // drill chain to the row's natural parent stage,
                // select the row there, but do NOT fire its action /
                // enter edit mode / open the action menu. The user can
                // then use any normal cascade gesture from the natural
                // stage (Enter to fire, Space to edit, Right to drill).
                // This is the safe "go look at it in context" gesture
                // that avoids accidentally executing destructive
                // actions that happened to surface in the search list.
                if (picked._path !== undefined) {
                    e.preventDefault();
                    var pinMode = this._activeReachMode
                        ? this._activeReachMode()
                        : "local";
                    this.replayDeepPath(picked, pinMode, "select");
                    return;
                }
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
                // Action menu — surfaces in three modes:
                //   1. Catalogue (row-bound): the row carries an
                //      entityType (set by `ca-layer-row-entity-type`
                //      on its emitting layer); action discovery
                //      matches on `ca-entity-type`.
                //   2. Catalogue (stage-bound): a filter-stage's
                //      dynamic items inherit the stage's entityType
                //      (e.g. drill into "Persons" → person rows
                //      whose item.entityType is unset but
                //      stage.entityType = "person").
                //   3. Filter-based: real tiddler row with no bound
                //      entityType anywhere (e.g. tree-view leaves in
                //      By namespace / By parent / All tiddlers).
                //      Discovery scans actions whose `ca-applies`
                //      filter matches the row title, plus globals
                //      tagged `ca-entity-type: *`.
                // Pre-flight the action list so we silently no-op
                // when no applicable actions exist — avoids opening
                // an empty stage on rows that have no actions wired.
                if (picked.title && !picked.isSynthetic) {
                    var spaceEntityType = picked.entityType ||
                        (picked.isItem ? stage.entityType : null) ||
                        null;
                    var spaceApplicable = this.loadActionsForType(
                        spaceEntityType, picked.title
                    );
                    if (spaceApplicable && spaceApplicable.length > 0) {
                        e.preventDefault();
                        var spaceActStage = this.buildActionMenuStage(
                            picked.title, spaceEntityType, picked.name
                        );
                        this._attachPreviewToStage(spaceActStage, picked, stage);
                        this.pushStage(spaceActStage);
                        return;
                    }
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
        // dynamic user-created tiddler in a diagnostic list. Shift-DEL
        // takes a different path: add a hide-entry visibility so the
        // selected entry disappears from the root menu (no destructive
        // action). Shadow-only items in the unmodified DEL case are silent
        // no-ops (cannot delete a shadow).
        if (e.key === "Delete" || e.key === "Backspace") {
            var pickedDel = stage.results[stage.selectedIndex];
            if (!pickedDel) return;
            // Shift-DEL on a root entry row → hide it via visibility rule.
            // Other stages don't support hide (only root menu is affected
            // by hide-entry visibility).
            if (e.shiftKey && stage.kind === "root" && pickedDel.title) {
                e.preventDefault();
                this._addHideEntryVisibility(pickedDel.title);
                return;
            }
            // ca-on-delete: row-specific delete action. Used by synthetic
            // JSON-item rows whose "deletion" is a parent-tiddler mutation
            // rather than a tiddler delete. Takes priority over the
            // built-in restore-default / delete-tiddler paths.
            if (pickedDel.onDelete) {
                e.preventDefault();
                var delVars = this.buildStageVariables(stage, pickedDel.title);
                if (pickedDel.onDeleteConsequence) {
                    this.pushStage(this.buildConfirmStage({
                        title: "Delete " + (pickedDel.name || pickedDel.title || "row"),
                        consequence: this._substituteVars(
                            pickedDel.onDeleteConsequence, delVars
                        ),
                        actions: pickedDel.onDelete,
                        vars: delVars
                    }));
                } else {
                    this.invokeViaNavigator(pickedDel.onDelete, delVars);
                }
                return;
            }
            if (this.isOverridden(pickedDel)) {
                e.preventDefault();
                this._pushRestoreDefaultConfirm(pickedDel);
                return;
            }
            // Bound field row with no shadow source (typical create/edit
            // flow, e.g. kind's "+ New <kind>" field rows) — DEL clears
            // the field's value. Cleared = field absent (whole-field
            // bindings) or "" (sub-path bindings). No confirm — Esc-to-
            // undo would be nice but TW has no field-level history.
            if (pickedDel.bindTiddler && pickedDel.bindField && !pickedDel.isItem) {
                e.preventDefault();
                this.clearBoundField(pickedDel);
                this.recomputeStage(stage);
                this.renderStage();
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

    proto._pushRestoreDefaultConfirm = function (item) {
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

    proto._pushDeleteTiddlerConfirm = function (item) {
        // Cheap backlink count — informative without rendering the list.
        var backlinkCount = 0;
        try {
            backlinkCount = this._filterInScope(
                "[all[tiddlers]backlinks[]]",
                { currentTiddler: item.title }
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
    proto._escapeAttr = function (s) {
        if (!s) return "";
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    };

    //
    // Pill-strip keyboard model
    // -----------------------------------------------------------------
    // The four strips (preset, visibility, filter, view) share an
    // identical navigation skeleton — Esc returns to input, Arrow
    // Left/Right walks the focused index. Enter / Delete / Home / End
    // dispatch to zone-specific behaviour declared in a descriptor.
    //
    // Descriptor fields:
    //   getCount, getFocusIdx, setFocusIdx, render — index plumbing
    //   maybeHelp           (optional) re-render help pane after move
    //   onEnter(idx)        Enter (and Space, if enterAcceptsSpace)
    //   onCtrlEnter(idx)    (optional) Ctrl-Enter — distinct gesture
    //   onDelete(idx)       (optional) Delete / Backspace
    //   enterAcceptsSpace   (optional) true on view / preset
    //   homeEnd             (optional) true on preset
    //
    var FILTER_KEY_DESC = {
        getCount:    function () { return this.filters.length; },
        getFocusIdx: function () { return this.filterFocusIdx; },
        setFocusIdx: function (i) { this.filterFocusIdx = i; },
        render:      function () { this._renderFilterStrip(); },
        maybeHelp:   function () { this._maybeRenderFilterHelp(); },
        onDelete:    function (i) { this._removeFilterAt(i); },
        onEnter:     function () {
            // Enter opens the details pane (if closed) and parks focus
            // there so the user can read / scroll the longer help.
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderFilterHelp();
            }
            this.setFocus("details");
        }
    };

    var VISIBILITY_KEY_DESC = {
        getCount:    function () { return this.visibilities.length; },
        getFocusIdx: function () { return this.visibilityFocusIdx; },
        setFocusIdx: function (i) { this.visibilityFocusIdx = i; },
        render:      function () { this._renderVisibilityStrip(); },
        maybeHelp:   function () { this._maybeRenderVisibilityHelp(); },
        onDelete:    function (i) { this._removeVisibilityAt(i); },
        onEnter:     function () {
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderVisibilityHelp();
            }
            this.setFocus("details");
        }
    };

    var REACH_KEY_DESC = {
        getCount:    function () { return this.reachPills.length; },
        getFocusIdx: function () { return this.reachFocusIdx; },
        setFocusIdx: function (i) { this.reachFocusIdx = i; },
        render:      function () { this._renderReachStrip(); },
        maybeHelp:   function () { this._maybeRenderReachHelp(); },
        onDelete:    function (i) { this._removeReachAt(i); },
        onEnter:     function () {
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderReachHelp();
            }
            this.setFocus("details");
        }
    };

    var META_KEY_DESC = {
        getCount:    function () { return this.metaPills.length; },
        getFocusIdx: function () { return this.metaFocusIdx; },
        setFocusIdx: function (i) { this.metaFocusIdx = i; },
        render:      function () { this._renderMetaStrip(); },
        maybeHelp:   function () { this._maybeRenderMetaHelp(); },
        onDelete:    function (i) { this._removeMetaAt(i); },
        onEnter:     function () {
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderMetaHelp();
            }
            this.setFocus("details");
        }
    };

    var FIELD_KEY_DESC = {
        getCount:    function () { return this.fieldPills.length; },
        getFocusIdx: function () { return this.fieldFocusIdx; },
        setFocusIdx: function (i) { this.fieldFocusIdx = i; },
        render:      function () { this._renderFieldStrip(); },
        maybeHelp:   function () { this._maybeRenderFieldHelp(); },
        onDelete:    function (i) { this._removeFieldAt(i); },
        onEnter:     function () {
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderFieldHelp();
            }
            this.setFocus("details");
        }
    };

    var VIEW_KEY_DESC = {
        getCount:    function () { return this._visibleViews().length; },
        getFocusIdx: function () { return this.viewFocusIdx; },
        setFocusIdx: function (i) { this.viewFocusIdx = i; },
        render:      function () { this._renderViewStrip(); },
        maybeHelp:   function () { this._maybeRenderViewHelp(); },
        enterAcceptsSpace: true,
        onEnter:     function (i) {
            var view = this._visibleViews()[i];
            if (!view) return;
            this._setActiveView(view.title);
            // _setActiveView jumps focus to input; restore to the view
            // strip so keyboard activation feels "sticky".
            this.setFocus("view");
        }
    };

    var PRESET_KEY_DESC = {
        getCount:    function () { return this._presetPillCount(); },
        getFocusIdx: function () { return this.presetFocusIdx; },
        setFocusIdx: function (i) { this.presetFocusIdx = i; },
        render:      function () { this._renderPresetStrip(); },
        maybeHelp:   function () { this._maybeRenderPresetHelp(); },
        enterAcceptsSpace: true,
        homeEnd:     true,
        onEnter:     function (i) {
            var presets = this._loadPresetPills();
            // The trailing "+" pill (last navigable index) triggers the
            // save-as flow rather than applying a preset.
            if (i === presets.length) {
                this.enterSaveMode();
                return;
            }
            var preset = presets[i];
            if (!preset) return;
            this._applyPreset(preset.title);
            // _applyPreset → _setActiveView jumps focus to input; restore
            // to the preset strip so keyboard activation feels "sticky".
            this.setFocus("preset");
        },
        onCtrlEnter: function (i) {
            // Overwrite the focused preset with current state — only
            // meaningful when this IS the active preset AND it's dirty.
            // Silently no-ops otherwise (the cue/hint tell the user why).
            var presets = this._loadPresetPills();
            if (i === presets.length) return; // plus pill — no overwrite
            var preset = presets[i];
            if (!preset) return;
            if (preset.title !== this.activePresetTitle) return;
            if (!this._isActivePresetDirty()) return;
            this._overwriteActivePreset();
            this.setFocus("preset");
        },
        onDelete: function (i) {
            var presets = this._loadPresetPills();
            if (i === presets.length) return; // plus pill — not deletable
            var preset = presets[i];
            if (!preset) return;
            this._pushDeletePresetConfirm(preset);
        }
    };

    proto._handleKeydownPillStrip = function (e, d) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        var self = this;
        var count = d.getCount.call(this);
        var idx = d.getFocusIdx.call(this);
        function moveTo(target) {
            d.setFocusIdx.call(self, target);
            d.render.call(self);
            if (d.maybeHelp) d.maybeHelp.call(self);
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (idx < count - 1) moveTo(idx + 1);
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (idx > 0) moveTo(idx - 1);
            return;
        }
        // Up/Down walk vertically between pill rows. At the bottom-most
        // active row, Down drops into the input below (continuous flow).
        if (e.key === "ArrowUp") {
            e.preventDefault();
            var pillsU = this._pillsCycle();
            var posU = pillsU.indexOf(this.focus);
            if (posU > 0) this.setFocus(pillsU[posU - 1]);
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            var pillsD = this._pillsCycle();
            var posD = pillsD.indexOf(this.focus);
            if (posD >= 0 && posD < pillsD.length - 1) {
                this.setFocus(pillsD[posD + 1]);
            } else {
                this.setFocus("input");
            }
            return;
        }
        if (d.homeEnd && e.key === "Home") {
            e.preventDefault();
            if (count > 0) moveTo(0);
            return;
        }
        if (d.homeEnd && e.key === "End") {
            e.preventDefault();
            if (count > 0) moveTo(count - 1);
            return;
        }
        if (d.onDelete && (e.key === "Delete" || e.key === "Backspace")) {
            e.preventDefault();
            d.onDelete.call(this, idx);
            return;
        }
        if (e.key === "Enter" && e.ctrlKey && d.onCtrlEnter) {
            e.preventDefault();
            d.onCtrlEnter.call(this, idx);
            return;
        }
        if (e.key === "Enter" || (d.enterAcceptsSpace && (e.key === " " || e.code === "Space"))) {
            e.preventDefault();
            d.onEnter.call(this, idx);
            return;
        }
    };

    var LEADER_KEY_DESC = {
        getCount:    function () { return this._leaderPillCount(); },
        getFocusIdx: function () { return this.leaderFocusIdx; },
        setFocusIdx: function (i) { this.leaderFocusIdx = i; },
        render:      function () { this._renderLeaderStrip(); },
        maybeHelp:   function () { this._maybeRenderLeaderHelp(); },
        enterAcceptsSpace: true,
        onEnter:     function (i) {
            var leaders = this._visibleLeaders();
            var leader = leaders[i];
            if (!leader) return;
            this._fireLeader(leader);
            // _fireLeader's actions may switch view / focus input. If
            // the leader strip is still populated for the new view,
            // restore focus so keyboard activation feels sticky.
            if (this._leaderPillCount() > 0) this.setFocus("leader");
        }
    };

    proto._handleKeydownFilter     = function (e) { this._handleKeydownPillStrip(e, FILTER_KEY_DESC); };
    proto._handleKeydownVisibility = function (e) { this._handleKeydownPillStrip(e, VISIBILITY_KEY_DESC); };
    proto._handleKeydownView       = function (e) { this._handleKeydownPillStrip(e, VIEW_KEY_DESC); };
    proto._handleKeydownPreset     = function (e) { this._handleKeydownPillStrip(e, PRESET_KEY_DESC); };
    proto._handleKeydownLeader     = function (e) { this._handleKeydownPillStrip(e, LEADER_KEY_DESC); };
    proto._handleKeydownReach      = function (e) { this._handleKeydownPillStrip(e, REACH_KEY_DESC); };
    proto._handleKeydownMeta       = function (e) { this._handleKeydownPillStrip(e, META_KEY_DESC); };
    proto._handleKeydownField      = function (e) { this._handleKeydownPillStrip(e, FIELD_KEY_DESC); };

    proto._handleKeydownDetails = function (e, stage) {
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

    // ----------------------------------------------------------------
    // Focus groups
    // ----------------------------------------------------------------
    // Focus is partitioned into two groups:
    //   pills group:  preset → visibility → filter → view (top-to-bottom)
    //   main group:   input → menu → details
    // Tab cycles within the current group; Shift-Tab jumps to the other
    // group (lands on the bottom-most pill when entering pills, on input
    // when returning to main). A row joins its group's cycle only when
    // it has something to navigate.
    proto._isPillFocus = function (f) {
        f = f || this.focus;
        return f === "preset" || f === "visibility" ||
               f === "reach" || f === "meta" || f === "field" ||
               f === "filter" || f === "view" || f === "viewconfig" ||
               f === "leader";
    };

    // Step out of viewconfig vertically into an adjacent pill section
    // (or input below). Always collapses the strip first — leaving with
    // the strip still expanded would surprise the user when they Tab
    // back later. Returns true if focus moved.
    proto._viewConfigStepOut = function (direction) {
        this.viewConfigExpanded = false;
        var cycle = this._pillsCycle();
        var pos = cycle.indexOf("viewconfig");
        if (direction === "up") {
            if (pos > 0) {
                this.setFocus(cycle[pos - 1]);
                return true;
            }
            // No pill above — refocus input.
            this.setFocus("input");
            return true;
        }
        // direction === "down"
        if (pos >= 0 && pos < cycle.length - 1) {
            this.setFocus(cycle[pos + 1]);
            return true;
        }
        // No pill below — drop into input.
        this.setFocus("input");
        return true;
    };

    proto._handleKeydownViewConfig = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            if (this.viewConfigExpanded) {
                // Collapse to compact; stay focused on the strip.
                this.viewConfigExpanded = false;
                this.viewConfigFocusIdx = 0;
                this._renderViewConfigStrip();
                this._maybeRenderViewConfigHelp();
                this._renderHint();
            } else {
                // Already compact — leave the strip back to input.
                this.setFocus("input");
            }
            return;
        }
        if (!this.viewConfigExpanded) {
            // Compact mode: Enter, Space, or Right expands to the full
            // per-layer layout.
            if (e.key === "Enter" || e.key === " " || e.code === "Space" ||
                e.key === "ArrowRight") {
                e.preventDefault();
                this.viewConfigExpanded = true;
                this.viewConfigFocusIdx = 0;
                this._renderViewConfigStrip();
                this._maybeRenderViewConfigHelp();
                this._renderHint();
                return;
            }
            // Up/Down navigate to the adjacent pill section (same vertical
            // walk as other pill strips). preventDefault prevents the
            // wiki-stream behind the popup from scrolling.
            if (e.key === "ArrowUp") {
                e.preventDefault();
                this._viewConfigStepOut("up");
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                this._viewConfigStepOut("down");
                return;
            }
            return;
        }
        // Expanded mode: axis-pill operations come first so they short-
        // circuit before generic grid navigation.
        var focusedPill = this._currentViewConfigPill && this._currentViewConfigPill();
        if (focusedPill && focusedPill.kind === "axis") {
            if (e.key === "Backspace" || e.key === "Delete") {
                e.preventDefault();
                this._removeAxisAt(focusedPill.layerTitle, focusedPill.axisIdx);
                return;
            }
            if (e.shiftKey && e.key === "ArrowLeft") {
                e.preventDefault();
                this._moveAxisAt(focusedPill.layerTitle, focusedPill.axisIdx, -1);
                return;
            }
            if (e.shiftKey && e.key === "ArrowRight") {
                e.preventDefault();
                this._moveAxisAt(focusedPill.layerTitle, focusedPill.axisIdx, +1);
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                this._openAxisPicker(
                    focusedPill.layerTitle, "replace", focusedPill.axisIdx
                );
                return;
            }
        }
        if (focusedPill && focusedPill.kind === "axis-add") {
            if (e.key === "Enter" || e.key === " " || e.code === "Space") {
                e.preventDefault();
                this._openAxisPicker(focusedPill.layerTitle, "add");
                return;
            }
        }
        // Expanded mode: 4-arrow grid navigation. Up at the top-most row
        // and Down at the bottom-most row cross the strip boundary —
        // collapse and step into the adjacent pill section (or input).
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            this._viewConfigMove("left");
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            this._viewConfigMove("right");
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (this._viewConfigAtTopRow()) {
                this._viewConfigStepOut("up");
            } else {
                this._viewConfigMove("up");
            }
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (this._viewConfigAtBottomRow()) {
                this._viewConfigStepOut("down");
            } else {
                this._viewConfigMove("down");
            }
            return;
        }
    };

    proto._pillsCycle = function () {
        var order = [];
        if (this._presetPillCount() >= 1) order.push("preset");
        if (this.visibilities && this.visibilities.length) order.push("visibility");
        // Reach + Meta + Field strips sit just above the filter strip
        // in the visual stack; same order in the Tab cycle so navigation
        // walks top-to-bottom.
        if (this.reachPills && this.reachPills.length) order.push("reach");
        if (this.metaPills && this.metaPills.length) order.push("meta");
        if (this.fieldPills && this.fieldPills.length) order.push("field");
        if (this.filters && this.filters.length) order.push("filter");
        if (this._visibleViews().length >= 2) order.push("view");
        // Structure (viewconfig) sits below view in the visual stack and
        // is conceptually "more detail about the active view" — place it
        // last in the pill cycle so Tab walks through configuration top-
        // to-bottom in the same order the strips are rendered.
        if (this._hasViewConfigToShow && this._hasViewConfigToShow()) {
            order.push("viewconfig");
        }
        // Leader strip sits just above the input — included only when
        // at least one leader is visible for the active view.
        if (this._leaderPillCount && this._leaderPillCount() > 0) {
            order.push("leader");
        }
        return order;
    };

    // True iff the detail drawer is currently visible. `detailsOpen` can
    // be stale (e.g. always-on with an empty menu — renderDetails calls
    // hideDetail without resetting the flag); the rcp-showing-detail class
    // is the visual source of truth.
    proto._isDetailsVisible = function () {
        return !!(this.popupEl && this.popupEl.classList &&
                  this.popupEl.classList.contains("rcp-showing-detail"));
    };

    proto._mainCycle = function () {
        var order = ["input", "menu"];
        if (this._isDetailsVisible()) order.push("details");
        // The side preview pane joins the main cycle only when an entry/
        // action on the stack registered a preview (visible). Sits AFTER
        // details so the Tab order walks the cascade-internal slots
        // first, then the right-side pane.
        if (this._isSidePreviewVisible && this._isSidePreviewVisible()) {
            order.push("preview");
        }
        return order;
    };

    proto._cycleFocus = function (delta) {
        var cycle = this._isPillFocus() ? this._pillsCycle() : this._mainCycle();
        if (!cycle.length) return;
        var idx = cycle.indexOf(this.focus);
        if (idx < 0) idx = 0;
        idx = (idx + delta + cycle.length) % cycle.length;
        this.setFocus(cycle[idx]);
    };

    proto._jumpFocusGroup = function () {
        if (this._isPillFocus()) {
            this.setFocus("input");
            return;
        }
        var pills = this._pillsCycle();
        if (pills.length === 0) return;
        // Enter pills at the bottom-most active row (visually closest to
        // the input the user is jumping from).
        this.setFocus(pills[pills.length - 1]);
    };

};

// Re-export the pure helpers as properties on the patcher function so
// specs can reach them without monkey-patching: the loader uses the
// function call signature (`require(...)(proto)`), but `.X` properties
// survive that idiom.
module.exports.resolveSectionHandler = resolveSectionHandler;
module.exports.dispatchTableSnapshot = dispatchTableSnapshot;
module.exports.SECTION_HANDLERS = SECTION_HANDLERS;
