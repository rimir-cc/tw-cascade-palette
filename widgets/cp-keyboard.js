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
        // Tier 2a' — Esc cancels pick-mode globally (input / menu / etc.)
        // before the section-specific Esc handlers run, so the user can
        // bail out of a sub-pick from any focus.
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
            this.focus !== "preset") {
            if (this.focus === "input" && !e.ctrlKey && !e.shiftKey) {
                if (this._commitConstraintFromInput()) {
                    e.preventDefault();
                    return;
                }
            }
            e.preventDefault();
            // Ctrl-Enter keeps palette open after firing. Shift-Enter kept
            // as a silent alias for back-compat (deprecated; remove in
            // v0.3).
            this.fireSelected(e.ctrlKey || e.shiftKey);
            return;
        }

        // Tier 3 — section-specific.
        switch (this.focus) {
            case "input":       this._handleKeydownInput(e, stage); return;
            case "menu":        this._handleKeydownMenu(e, stage); return;
            case "filter":      this._handleKeydownFilter(e, stage); return;
            case "visibility":  this._handleKeydownVisibility(e, stage); return;
            case "view":        this._handleKeydownView(e, stage); return;
            case "preset":      this._handleKeydownPreset(e, stage); return;
            case "details":     this._handleKeydownDetails(e, stage); return;
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
            // In an action subtree (action menu or a confirm pushed from
            // one), Esc pops one stage directly and keeps focus on the
            // menu — so backing out of a wrong action drill is one
            // keystroke that lands the user on the prior menu, ready to
            // pick again. Other stage kinds (tree / filter / root) keep
            // the legacy "Esc refocuses input" behaviour so typing to
            // filter the current level is a single keystroke away.
            if (stage && (stage.kind === "actions" || stage.kind === "confirm")
                && this.stack.length > 1) {
                this.popStage();
                return;
            }
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
            // ArrowLeft pops one stage (back). At root depth it would
            // close the palette, but closing is reserved for Esc — at
            // root, ArrowLeft is a no-op.
            if (this.stack.length > 1) this.popStage();
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
                // Entity-type action menu — Space mirrors Right-arrow's
                // entity-type drill on leaves AND additionally enables it
                // on containers (where Right descends instead). Lets the
                // user reach the action menu on a tag-tree / namespace
                // folder etc. without first having to navigate into it.
                if (picked.entityType) {
                    e.preventDefault();
                    this.pushStage(this.buildActionMenuStage(
                        picked.title, picked.entityType, picked.name
                    ));
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

    proto._handleKeydownFilter     = function (e) { this._handleKeydownPillStrip(e, FILTER_KEY_DESC); };
    proto._handleKeydownVisibility = function (e) { this._handleKeydownPillStrip(e, VISIBILITY_KEY_DESC); };
    proto._handleKeydownView       = function (e) { this._handleKeydownPillStrip(e, VIEW_KEY_DESC); };
    proto._handleKeydownPreset     = function (e) { this._handleKeydownPillStrip(e, PRESET_KEY_DESC); };

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
               f === "filter" || f === "view";
    };

    proto._pillsCycle = function () {
        var order = [];
        if (this._presetPillCount() >= 1) order.push("preset");
        if (this.visibilities && this.visibilities.length) order.push("visibility");
        if (this.filters && this.filters.length) order.push("filter");
        if (this._visibleViews().length >= 2) order.push("view");
        return order;
    };

    // True iff the preview drawer is currently visible. `detailsOpen` can
    // be stale (e.g. always-on with an empty menu — renderDetails calls
    // hidePreview without resetting the flag); the rcp-previewing class
    // is the visual source of truth.
    proto._isDetailsVisible = function () {
        return !!(this.popupEl && this.popupEl.classList &&
                  this.popupEl.classList.contains("rcp-previewing"));
    };

    proto._mainCycle = function () {
        var order = ["input", "menu"];
        if (this._isDetailsVisible()) order.push("details");
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
