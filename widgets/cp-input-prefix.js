/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-input-prefix
type: application/javascript
module-type: library

Input-prefix dispatcher — single typed grammar across two constraint
kinds.

Both filters and visibility rules expose a `ca-*-prefix` field. When the
user types in the input, this module scans BOTH tag families, greedy by
prefix length, and reports which constraint (if any) the current text
matches. On Enter, the matched kind decides where the resulting pill
lands (filters strip or visibility strip).

The visual cue is also kind-aware: blue underline for filter matches,
red/orange underline for visibility matches.

\*/
"use strict";

var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");

module.exports = function (proto) {

    // Detect whether the current input text begins with a known constraint
    // prefix. Thin wrapper around cp-utils.detectInputPrefix that supplies
    // the loaded filter + visibility metas (both cached, so this call is
    // O(1) after first warm).
    //
    // Returns `{kind, meta, argText}` on match, null otherwise.
    proto._detectInputPrefix = function (text) {
        return utils.detectInputPrefix(
            text,
            this._loadFilterTiddlers(),
            this._loadVisibilityTiddlers()
        );
    };

    // Commit the detected prefix match. Pushes to the right strip, clears
    // the input, recomputes the stage. Returns true if commit happened.
    proto._commitConstraintFromInput = function () {
        var stage = this.topStage();
        if (!stage) return false;
        var detected = this._detectInputPrefix(this.inputEl.value);
        if (!detected) return false;
        var arg = detected.argText.trim();
        if (!arg && detected.meta.argType === "text") return false;
        if (detected.kind === "filter") {
            var inst = this._buildFilterInstance(detected.meta, arg);
            this._pushFilter(inst);
        } else {
            var instV = this._buildVisibilityInstance(detected.meta, arg);
            this._pushVisibility(instV);
        }
        this.inputEl.value = "";
        stage.query = "";
        stage.selectedIndex = 0;
        this.recomputeStage(stage);
        this.renderStage();
        this.inputEl.classList.remove("rcp-input-filter-match");
        this.inputEl.classList.remove("rcp-input-visibility-match");
        return true;
    };

    // Visual cue toggle — when input matches a prefix, give the input a
    // coloured underline (blue for filter, red for visibility) and the
    // hint footer shows "↵ commit". Called from the input event listener
    // so every keystroke updates the cue immediately.
    proto._updateConstraintPrefixCue = function () {
        if (!this.inputEl) return;
        var detected = this._detectInputPrefix(this.inputEl.value);
        this.inputEl.classList.remove("rcp-input-filter-match");
        this.inputEl.classList.remove("rcp-input-visibility-match");
        if (detected) {
            this.inputEl.classList.add(
                detected.kind === "filter"
                    ? "rcp-input-filter-match"
                    : "rcp-input-visibility-match"
            );
            var label = detected.kind === "filter" ? "filter" : "visibility";
            this.hintEl.textContent = "↵ commit " + label + ": " + detected.meta.name +
                (detected.argText.trim()
                    ? "  ·  arg = " + detected.argText.trim()
                    : "  ·  type an argument");
        } else {
            this._renderHint();
        }
    };

};
