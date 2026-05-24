/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-pick-presets
type: application/javascript
module-type: library

Pick-mode + presets — modal-input and view-bundle subsystems.

Pick-mode: a view (`ca-view-pick-mode: yes`) treats Enter on any row
as "commit this path as a filter arg", then returns to the view that
was active before pick-mode was entered. Right-arrow still drills
(narrow before committing). Esc cancels.

Presets: a saved `(activeView, filters, visibility)` bundle, tagged
PRESET_TAG. Applying replays that state: switches view + replaces both
the filter and visibility lists. Saving uses a mini-prompt that
repurposes the input (similar to edit-mode).

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var PRESET_TAG = C.PRESET_TAG;

module.exports = function (proto) {

    /* ---------- pick mode ---------- */

    // Commit the selected row's effective path as a filter arg, push the
    // configured filter, return to the prior view.
    proto._commitPickModeSelection = function (stage, picked) {
        var view = this._getViewByTitle(stage.viewTitle || this.activeView);
        if (!view || !view.pickEmitsFilter) {
            this._cancelPickMode();
            return;
        }
        var arg;
        if (picked && picked._treeContainer && picked._treeParent) {
            // Container: the tiddler title at this node IS the path arg
            // — for the by-namespace view (roots: titles without `/`,
            // children: cp-child-of<currentTiddler>) that's exactly the
            // prefix the user picked. For other tree shapes, it's still
            // the most meaningful path-like identifier we have.
            arg = picked._treeParent;
        } else if (picked && picked.title) {
            arg = picked.title;
        } else if (picked && picked.name) {
            arg = picked.name;
        } else {
            arg = "";
        }
        if (!arg) {
            this._cancelPickMode();
            return;
        }
        var metas = this._loadFilterTiddlers();
        var meta = null;
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === view.pickEmitsFilter) {
                meta = metas[i];
                break;
            }
        }
        if (!meta) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] pick-mode filter not installed:",
                    view.pickEmitsFilter
                );
            }
            this._cancelPickMode();
            return;
        }
        // Push the filter first; then switch back to the prior view. The
        // filter strip flashes on push when this was leader-fired earlier;
        // for the post-pick switch, it's a regular UI transition.
        var instance = this._buildFilterInstance(meta, arg);
        this._pushFilter(instance);
        this._returnFromPickMode();
    };

    // Restore the view that was active before pick-mode was entered.
    // Cleared regardless of whether a filter was pushed (cancel path uses
    // this too).
    proto._returnFromPickMode = function () {
        var prev = this._pickModeReturnTo;
        this._pickModeReturnTo = null;
        if (prev) {
            // _setActiveView clears _pickModeReturnTo too (since the
            // target is non-pick), but we cleared first so the call is
            // a no-op on that field.
            this._setActiveView(prev);
        }
    };

    // Cancel pick-mode without committing — returns to prior view.
    proto._cancelPickMode = function () {
        this._returnFromPickMode();
    };

    /* ---------- presets ---------- */

    // Enter the save mini-prompt. Input is cleared and repurposed for
    // typing the preset's display name; Enter commits, Esc cancels.
    proto.enterSaveMode = function () {
        var stage = this.topStage();
        if (!stage) return;
        if (this.detailsOpen) {
            this.detailsOpen = false;
            this.hidePreview();
        }
        this.saveMode = {
            savedQuery: stage.query || "",
            savedSelectedIndex: stage.selectedIndex
        };
        this.inputEl.value = "";
        this.inputEl.placeholder = "Save preset as…";
        this.popupEl.classList.add("rcp-saving");
        this.hintEl.textContent = "↵ save · Esc cancel";
        var self = this;
        setTimeout(function () { self.inputEl.focus(); }, 0);
    };

    proto.exitSaveMode = function (commit) {
        if (!this.saveMode) return;
        var sm = this.saveMode;
        var name = (this.inputEl.value || "").trim();
        if (commit && name) {
            this._capturePreset(name);
        }
        this.saveMode = null;
        this.inputEl.placeholder = "Type to filter…";
        this.popupEl.classList.remove("rcp-saving");
        var stage = this.topStage();
        if (stage) {
            stage.query = sm.savedQuery;
            stage.selectedIndex = sm.savedSelectedIndex;
        }
        this.inputEl.value = sm.savedQuery;
        this._renderHint();
        this.renderStage();
    };

    // Build a preset tiddler capturing the current activeView, filters,
    // and visibility rules. Sanitises the name into a path-safe slug;
    // appends `-2`, `-3`, … on title collision so saving "Test" twice
    // creates two distinct presets.
    //
    // Persisted shape (in `ca-preset-constraints`):
    //   {
    //     "filters":    [{title, arg}, …],
    //     "visibility": [{title, arg}, …]
    //   }
    proto._capturePreset = function (name) {
        var sanitised = String(name)
            .replace(/[\r\n\t]/g, " ")
            .trim()
            .slice(0, 80);
        if (!sanitised) return;
        var slug = sanitised.toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (!slug) slug = "preset";
        var baseTitle = "$:/plugins/rimir/cascade-palette/presets/" + slug;
        var finalTitle = baseTitle;
        var n = 2;
        while (this.wiki.tiddlerExists(finalTitle) && n < 100) {
            finalTitle = baseTitle + "-" + n;
            n++;
        }
        var bundle = {
            filters: this._currentFiltersSnapshot(),
            visibility: this._currentVisibilitySnapshot()
        };
        this.wiki.addTiddler(new $tw.Tiddler({
            title: finalTitle,
            tags: PRESET_TAG,
            "ca-preset-name": sanitised,
            "ca-preset-view": this.activeView || "",
            "ca-preset-constraints": JSON.stringify(bundle),
            // Picking a preset from the strip keeps the palette open so
            // the user sees the resulting state.
            "ca-after-fire": "keep"
        }));
        // The just-saved preset becomes the active one; baseline = the
        // state we just persisted.
        this.activePresetTitle = finalTitle;
        this.activePresetBaseline = {
            view: this.activeView || "",
            filters: bundle.filters,
            visibility: bundle.visibility
        };
    };

    // Snapshot helpers — used by capture, apply baseline, and dirty check.
    // Filters store the meta tiddler directly. Visibility strips the per-
    // instance "::arg" suffix (hide-entry uses it for dedup uniqueness).
    proto._currentFiltersSnapshot = function () {
        return (this.filters || []).map(function (s) {
            return { title: s.constraintTiddler, arg: s.arg || "" };
        });
    };

    proto._currentVisibilitySnapshot = function () {
        return (this.visibilities || []).map(function (s) {
            var ct = String(s.constraintTiddler || "");
            var sep = ct.indexOf("::");
            return {
                title: sep >= 0 ? ct.slice(0, sep) : ct,
                arg: s.arg || ""
            };
        });
    };

    proto._constraintListsEqual = function (a, b) {
        a = a || []; b = b || [];
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
            if ((a[i].title || "") !== (b[i].title || "")) return false;
            if ((a[i].arg || "") !== (b[i].arg || "")) return false;
        }
        return true;
    };

    // Cheap repaint of the preset strip — used by state-mutating
    // operations (filter/visibility push/remove/clear, view switch) so
    // the active-pill dirty cue stays in sync. Also re-renders the hint
    // line so the "preset modified" message updates the moment dirty
    // status flips. Skips work when no preset is active or the strip
    // isn't mounted yet.
    proto._refreshPresetActiveCue = function () {
        if (!this.activePresetTitle) return;
        if (!this.presetStripEl) return;
        this._renderPresetStrip();
        if (this.focus === "preset" && this._renderHint) this._renderHint();
    };

    // True iff there's an active preset AND current state diverges from
    // its captured baseline (view, filters, or visibility list).
    proto._isActivePresetDirty = function () {
        if (!this.activePresetTitle || !this.activePresetBaseline) return false;
        var base = this.activePresetBaseline;
        if ((base.view || "") !== (this.activeView || "")) return true;
        if (!this._constraintListsEqual(base.filters, this._currentFiltersSnapshot())) {
            return true;
        }
        if (!this._constraintListsEqual(base.visibility, this._currentVisibilitySnapshot())) {
            return true;
        }
        return false;
    };

    // Overwrite the active preset tiddler with the current state. Returns
    // true on success, false if no active preset / tiddler missing.
    proto._overwriteActivePreset = function () {
        if (!this.activePresetTitle) return false;
        var t = this.wiki.getTiddler(this.activePresetTitle);
        if (!t || !t.fields) return false;
        var bundle = {
            filters: this._currentFiltersSnapshot(),
            visibility: this._currentVisibilitySnapshot()
        };
        // Preserve preset metadata (name, hint, order); only the state-
        // bearing fields change.
        var newFields = $tw.utils.extend({}, t.fields, {
            "ca-preset-view": this.activeView || "",
            "ca-preset-constraints": JSON.stringify(bundle)
        });
        this.wiki.addTiddler(new $tw.Tiddler(newFields));
        this.activePresetBaseline = {
            view: this.activeView || "",
            filters: bundle.filters,
            visibility: bundle.visibility
        };
        this._invalidatePresetPills();
        this._renderPresetStrip();
        return true;
    };

    // Push a confirm-drill stage to delete a preset. On confirm, the
    // action runs `<$action-deletetiddler>`; the wiki change hook clears
    // the active marker if the deleted preset was active. Focus moves
    // to the menu so the user can fire the confirm/cancel option without
    // first having to leave the preset strip.
    proto._pushDeletePresetConfirm = function (preset) {
        if (!preset || !preset.title) return;
        this.pushStage(this.buildConfirmStage({
            title: "Delete preset " + preset.name,
            consequence: "This will permanently delete the preset “" +
                preset.name + "” (`" + preset.title + "`).",
            actions: '<$action-deletetiddler $tiddler="' +
                this._escapeAttr(preset.title) + '"/>'
        }));
        this.setFocus("menu");
    };

    // Apply a saved preset — replace both constraint lists with the
    // preset's snapshot and switch to the preset's view. Missing view →
    // refresh with the new constraint state (warn). Missing constraint
    // tiddlers → skip them (warn).
    proto._applyPreset = function (presetTitle) {
        var t = this.wiki.getTiddler(presetTitle);
        if (!t || !t.fields) return;
        var f = t.fields;
        var viewTitle = f["ca-preset-view"] || "";
        var bundleJson = f["ca-preset-constraints"] || "{}";
        var bundle;
        try { bundle = JSON.parse(bundleJson); }
        catch (err) { bundle = {}; }
        if (!bundle || typeof bundle !== "object") bundle = {};
        var filtersList = Array.isArray(bundle.filters) ? bundle.filters : [];
        var visList = Array.isArray(bundle.visibility) ? bundle.visibility : [];

        var self = this;
        var fmetas = this._loadFilterTiddlers();
        var vmetas = this._loadVisibilityTiddlers();

        this.filters = [];
        filtersList.forEach(function (s) {
            if (!s || !s.title) return;
            var meta = null;
            for (var i = 0; i < fmetas.length; i++) {
                if (fmetas[i].title === s.title) { meta = fmetas[i]; break; }
            }
            if (!meta) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] preset references missing filter:",
                        s.title
                    );
                }
                return;
            }
            self.filters.push(self._buildFilterInstance(meta, s.arg || ""));
        });

        this.visibilities = [];
        visList.forEach(function (s) {
            if (!s || !s.title) return;
            // Tolerate the legacy capture shape that stored the per-
            // instance pseudo-title ("...hide-entry::SomeEntry") — strip
            // the suffix and fall back to the suffix-as-arg if `s.arg`
            // wasn't recorded. Re-saving the preset cleans this up.
            var lookupTitle = String(s.title);
            var sep = lookupTitle.indexOf("::");
            var argFromTitle = "";
            if (sep >= 0) {
                argFromTitle = lookupTitle.slice(sep + 2);
                lookupTitle = lookupTitle.slice(0, sep);
            }
            var meta = null;
            for (var i = 0; i < vmetas.length; i++) {
                if (vmetas[i].title === lookupTitle) { meta = vmetas[i]; break; }
            }
            if (!meta) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] preset references missing visibility:",
                        lookupTitle
                    );
                }
                return;
            }
            self.visibilities.push(self._visibilityInstanceFor(meta, s.arg || argFromTitle));
        });

        // Re-render the constraint strips after replacing both lists —
        // _setActiveView only refreshes the view strip and results, not
        // these. Do it before the view branch so it's done either way.
        this._renderFilterStrip();
        this._renderVisibilityStrip();

        // Mark this preset as active. The baseline is captured after the
        // view-switch below so it reflects the effective state (in case
        // the preset's view doesn't exist).
        this.activePresetTitle = presetTitle;

        if (viewTitle && this._getViewByTitle(viewTitle)) {
            this._setActiveView(viewTitle);
        } else {
            if (viewTitle && console && console.warn) {
                console.warn(
                    "[cascade-palette] preset references missing view:",
                    viewTitle
                );
            }
            this.recomputeStage(this.topStage());
            this.renderStage();
        }

        // Capture baseline AFTER the view-switch so it matches the now-
        // effective state. Dirty detection compares against this.
        this.activePresetBaseline = {
            view: this.activeView || "",
            filters: this._currentFiltersSnapshot(),
            visibility: this._currentVisibilitySnapshot()
        };
    };

};
