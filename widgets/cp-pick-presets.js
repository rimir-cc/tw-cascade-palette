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
        if (picked && picked._treeContainer && picked._treePath) {
            // Container: join the full tree path. For path-segments
            // strategy this gives a usable title-prefix (e.g. "work/customers/A").
            arg = picked._treePath.join("/");
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
            filters: (this.filters || []).map(function (s) {
                return { title: s.constraintTiddler, arg: s.arg || "" };
            }),
            visibility: (this.visibilities || []).map(function (s) {
                return { title: s.constraintTiddler, arg: s.arg || "" };
            })
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
            var meta = null;
            for (var i = 0; i < vmetas.length; i++) {
                if (vmetas[i].title === s.title) { meta = vmetas[i]; break; }
            }
            if (!meta) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] preset references missing visibility:",
                        s.title
                    );
                }
                return;
            }
            self.visibilities.push(self._buildVisibilityInstance(meta, s.arg || ""));
        });

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
            this._renderFilterStrip();
            this._renderVisibilityStrip();
            this.renderStage();
        }
    };

};
