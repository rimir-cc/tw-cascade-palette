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
        if (e.key === "Tab") {
            e.preventDefault();
            this._cycleFocus(e.shiftKey ? -1 : 1);
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
            hasAnyConstraint) {
            // Backspace in input has its native "delete char" semantic when
            // not paired with Ctrl — Ctrl-Backspace is "delete word", which
            // we deliberately repurpose as "wipe constraints" since the
            // user is unlikely to need word-delete mid-palette.
            e.preventDefault();
            this._clearAllFilters();
            this._clearAllVisibility();
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

    proto._handleKeydownMenu = function (e, stage) {
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

    proto._handleKeydownFilter = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (this.filterFocusIdx < this.filters.length - 1) {
                this.filterFocusIdx += 1;
                this._renderFilterStrip();
                this._maybeRenderFilterHelp();
            }
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (this.filterFocusIdx > 0) {
                this.filterFocusIdx -= 1;
                this._renderFilterStrip();
                this._maybeRenderFilterHelp();
            }
            return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            this._removeFilterAt(this.filterFocusIdx);
            return;
        }
        if (e.key === "Enter") {
            // Enter moves focus into the details pane so the user can
            // read / scroll the longer-form help. If details isn't
            // visible, open it for the duration of the help readout.
            e.preventDefault();
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderFilterHelp();
            }
            this.setFocus("details");
            return;
        }
    };

    proto._handleKeydownVisibility = function (e, stage) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (this.visibilityFocusIdx < this.visibilities.length - 1) {
                this.visibilityFocusIdx += 1;
                this._renderVisibilityStrip();
                this._maybeRenderVisibilityHelp();
            }
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (this.visibilityFocusIdx > 0) {
                this.visibilityFocusIdx -= 1;
                this._renderVisibilityStrip();
                this._maybeRenderVisibilityHelp();
            }
            return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            this._removeVisibilityAt(this.visibilityFocusIdx);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (!this.detailsOpen) {
                this.detailsOpen = true;
                this._maybeRenderVisibilityHelp();
            }
            this.setFocus("details");
            return;
        }
    };

    proto._handleKeydownView = function (e, stage) {
        var visible = this._visibleViews();
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (this.viewFocusIdx < visible.length - 1) {
                this.viewFocusIdx += 1;
                this._renderViewStrip();
                this._maybeRenderViewHelp();
            }
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (this.viewFocusIdx > 0) {
                this.viewFocusIdx -= 1;
                this._renderViewStrip();
                this._maybeRenderViewHelp();
            }
            return;
        }
        if (e.key === "Enter" || e.key === " " || e.code === "Space") {
            e.preventDefault();
            var view = visible[this.viewFocusIdx];
            if (view) this._setActiveView(view.title);
            return;
        }
        // Other keys ignored at this section.
    };

    proto._handleKeydownPreset = function (e, stage) {
        var count = this._presetPillCount();
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            if (this.presetFocusIdx < count - 1) {
                this.presetFocusIdx += 1;
                this._renderPresetStrip();
                this._maybeRenderPresetHelp();
            }
            return;
        }
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (this.presetFocusIdx > 0) {
                this.presetFocusIdx -= 1;
                this._renderPresetStrip();
                this._maybeRenderPresetHelp();
            }
            return;
        }
        if (e.key === "Home") {
            e.preventDefault();
            if (count > 0) {
                this.presetFocusIdx = 0;
                this._renderPresetStrip();
                this._maybeRenderPresetHelp();
            }
            return;
        }
        if (e.key === "End") {
            e.preventDefault();
            if (count > 0) {
                this.presetFocusIdx = count - 1;
                this._renderPresetStrip();
                this._maybeRenderPresetHelp();
            }
            return;
        }
        if (e.key === "Enter" || e.key === " " || e.code === "Space") {
            e.preventDefault();
            var pills = this._loadPresetPills();
            var preset = pills[this.presetFocusIdx];
            if (preset) this._applyPreset(preset.title);
            return;
        }
        // Other keys ignored at this section.
    };

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

    // Cycle focus across the active sections. Each strip joins the cycle
    // only when it has something to navigate: preset ≥ 1 preset; view ≥ 2
    // visible views; visibility ≥ 1 rule; filter ≥ 1 rule; details when
    // the drawer is open. Full cycle:
    //   input → preset → visibility → filter → view → menu → details → input
    proto._cycleFocus = function (delta) {
        var order = ["input"];
        if (this._presetPillCount() >= 1) order.push("preset");
        if (this.visibilities && this.visibilities.length) order.push("visibility");
        if (this.filters && this.filters.length) order.push("filter");
        if (this._visibleViews().length >= 2) order.push("view");
        order.push("menu");
        if (this.detailsOpen) order.push("details");
        var idx = order.indexOf(this.focus);
        if (idx < 0) idx = 0;
        idx = (idx + delta + order.length) % order.length;
        this.setFocus(order[idx]);
    };

};
