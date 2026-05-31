/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-context-pills
type: application/javascript
module-type: library

Sticky-context pill strip — the third lifecycle tier of "context"
variables in cp:

  * `<<context-tiddler>>`       single-shot, captured at openPalette
                                from the page's data-tiddler-title.
                                Stable for the open-close cycle.
  * `<<stage-preview-context>>` per-stage, set by `ca-preview-context`
                                on the entry/action that drilled in.
                                Topmost non-empty wins.
  * Sticky context              session-persistent list of pinned
                                tiddler titles, survives reload, mutable
                                mid-session through pin/unpin/clear
                                messages. Exposed as
                                `<<sticky-context-list>>` (raw title-
                                list string) and `<<sticky-context-count>>`
                                in every filter / action scope (see
                                cp-actions.js `buildStageVariables`).

The strip mirrors cp-filters.js / cp-visibility.js — owns a per-widget
`this.contextPills[]` array refreshed from the state tiddler. Pills
render via the shared `renderPillStripSection` helper; stale-pin styling
is post-applied here because the shared helper has no per-pill class hook
and we don't want to grow a parallel abstraction over it.

State source of truth is the state tiddler (`STICKY_CONTEXT_TITLE`,
field `list`, TW parseStringArray format). All mutations write the
tiddler and rely on the wiki-change hook in cascade-palette-widget.js
to bounce back into `_refreshContextPills` + `_renderContextStrip` —
so external row actions (the Pin / Unpin verbs) update the strip live
without going through the strip module.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var STICKY_CONTEXT_TITLE = C.STICKY_CONTEXT_TITLE;

module.exports = function (proto) {

    // Read the current list of pinned titles from the state tiddler.
    // Returns a plain string array (possibly empty). Idempotent — no
    // side effects. Centralised so tests can swap the source without
    // monkey-patching every read site.
    proto._readStickyContextList = function () {
        var tid = this.wiki.getTiddler(STICKY_CONTEXT_TITLE);
        if (!tid || !tid.fields || !tid.fields.list) return [];
        var raw = tid.fields.list;
        if (Array.isArray(raw)) return raw.slice();
        return $tw.utils.parseStringArray(String(raw)) || [];
    };

    proto._writeStickyContextList = function (titles) {
        var clean = (titles || []).filter(function (t) {
            return typeof t === "string" && t.length > 0;
        });
        // De-duplicate, preserving order.
        var seen = Object.create(null);
        var unique = [];
        for (var i = 0; i < clean.length; i++) {
            if (!seen[clean[i]]) {
                seen[clean[i]] = true;
                unique.push(clean[i]);
            }
        }
        var existing = this.wiki.getTiddler(STICKY_CONTEXT_TITLE);
        var existingFields = (existing && existing.fields) || {};
        this.wiki.addTiddler(new $tw.Tiddler(
            { title: STICKY_CONTEXT_TITLE },
            existingFields,
            { title: STICKY_CONTEXT_TITLE, list: $tw.utils.stringifyList(unique) }
        ));
    };

    // Append a title to the sticky context. No-ops if already present.
    proto._pinStickyContext = function (title) {
        if (!title) return;
        var titles = this._readStickyContextList();
        if (titles.indexOf(title) !== -1) return;
        titles.push(title);
        this._writeStickyContextList(titles);
    };

    proto._unpinStickyContext = function (title) {
        if (!title) return;
        var titles = this._readStickyContextList();
        var idx = titles.indexOf(title);
        if (idx === -1) return;
        titles.splice(idx, 1);
        this._writeStickyContextList(titles);
    };

    proto._clearStickyContext = function () {
        var titles = this._readStickyContextList();
        if (!titles.length) return;
        this._writeStickyContextList([]);
    };

    // Rebuild `this.contextPills` from the state tiddler. Each pill:
    //   title  the pinned tiddler title (source of truth)
    //   chip   display label — caption / ca-name / title fallback
    //   hint   tooltip — the raw title (helps disambiguate captions)
    //   stale  true when the target tiddler no longer exists
    //
    // Cheap: O(N) wiki.getTiddler calls per refresh, capped by the
    // pin count (single-digit in practice). Called from the wiki
    // change-event hook and from openPalette / setFocus.
    proto._refreshContextPills = function () {
        var titles = this._readStickyContextList();
        var self = this;
        this.contextPills = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var label = f.caption || f["ca-name"] || title;
            return {
                title: title,
                chip: label,
                hint: title,
                stale: !self.wiki.tiddlerExists(title)
            };
        });
        if (this.contextFocusIdx === undefined ||
            this.contextFocusIdx < 0 ||
            this.contextFocusIdx >= this.contextPills.length) {
            this.contextFocusIdx = Math.max(0, this.contextPills.length - 1);
        }
    };

    proto._removeContextPillAt = function (idx) {
        if (!this.contextPills || idx < 0 || idx >= this.contextPills.length) return;
        var pill = this.contextPills[idx];
        if (!pill) return;
        this._unpinStickyContext(pill.title);
        // The wiki change-event hook will re-render the strip — no need
        // to call _renderContextStrip here. But fix focus first so the
        // re-render lands on a valid index.
        if (this.contextFocusIdx >= idx && this.contextFocusIdx > 0) {
            this.contextFocusIdx--;
        }
        if (!this.contextPills.length && this.focus === "context") {
            this.setFocus("input");
        }
    };

    proto._renderContextStrip = function () {
        if (!this.contextStripEl) return;
        if (!this.contextPills) this._refreshContextPills();
        var self = this;
        pillstrip.renderPillStripSection({
            widget:        self,
            stripEl:       self.contextStripEl,
            pills:         self.contextPills,
            focusIdx:      self.contextFocusIdx || 0,
            focusSection:  "context",
            popupHasClass: "rcp-has-context",
            pillModifier:  "rcp-pill-context",
            datasetKey:    "contextIdx",
            removeTitle:   "Unpin from sticky context",
            onSelectAt:    function (i) {
                self.contextFocusIdx = i;
                self.setFocus("context");
            },
            onRemoveAt:    function (i) { self._removeContextPillAt(i); }
        });
        // Post-process: mark stale pills. The shared helper renders
        // identical pills; "stale" is a context-strip-only concept.
        var pillEls = self.contextStripEl.querySelectorAll(".rcp-pill");
        for (var i = 0; i < pillEls.length && i < self.contextPills.length; i++) {
            if (self.contextPills[i].stale) {
                pillEls[i].classList.add("rcp-pill-stale");
            }
        }
    };

    proto._maybeRenderContextHelp = function () {
        if (this.focus !== "context") return;
        if (!this.contextPills || !this.contextPills.length) return;
        var item = this.contextPills[this.contextFocusIdx || 0];
        if (!item) return;
        var rows = [["Tiddler title", item.title]];
        if (item.stale) rows.push(["Status", "Stale — target tiddler not found"]);
        pillstrip.renderConstraintHelp(this, {
            title: item.chip,
            help:  item.stale
                ? "The pinned tiddler no longer exists. Use × or Backspace to remove it from sticky context."
                : "Pinned tiddler — appears in <<sticky-context-list>> for every context-aware view, layer, and filter.",
            rows:  rows
        });
    };

    // ---- "+" input prefix — type +<title>, Enter pins the literal title ----
    //
    // Mirrors the visual-cue + commit-on-Enter contract of the filter and
    // visibility prefix dispatchers (cp-input-prefix.js), but lives here
    // because sticky context isn't a "constraint" in the cp-utils sense
    // (no prefix-tagged tiddler family, no arg-type plumbing). The prefix
    // is hardcoded to "+" and the arg is treated as a tiddler title
    // verbatim — no fuzzy matching against existing tiddlers. The user
    // gets autocomplete in the cascade by using Space → "Pin to context"
    // on a row instead; this path is the keyboard-only / one-handed pin.

    proto._detectContextPrefix = function (text) {
        if (!text || text.charAt(0) !== "+") return null;
        return text.slice(1);
    };

    // Returns true when a + prefix was detected and the cue was applied.
    // Caller uses the boolean to decide whether to fall through to the
    // generic constraint-prefix cue (same shape as _updateLeaderCue).
    proto._updateContextPrefixCue = function () {
        if (!this.inputEl) return false;
        var arg = this._detectContextPrefix(this.inputEl.value);
        if (arg === null) {
            if (this.inputEl.classList &&
                this.inputEl.classList.contains("rcp-input-context-match")) {
                this.inputEl.classList.remove("rcp-input-context-match");
            }
            return false;
        }
        this.inputEl.classList.add("rcp-input-context-match");
        var trimmed = arg.trim();
        if (this.hintEl) {
            this.hintEl.textContent = "↵ pin to context: " +
                (trimmed || "type a tiddler title");
        }
        return true;
    };

    // Called on Enter in input focus, BEFORE _commitConstraintFromInput.
    // Returns true when the input matched a + prefix AND the title was
    // pinned; the caller then preventDefaults so the standard fire path
    // doesn't also run.
    proto._commitContextFromInput = function () {
        if (!this.inputEl) return false;
        var arg = this._detectContextPrefix(this.inputEl.value);
        if (arg === null) return false;
        var title = arg.trim();
        if (!title) return false; // bare "+" with no title — silent no-op
        this._pinStickyContext(title);
        this.inputEl.value = "";
        if (this.inputEl.classList) {
            this.inputEl.classList.remove("rcp-input-context-match");
        }
        var stage = this.topStage && this.topStage();
        if (stage) {
            stage.query = "";
            stage.selectedIndex = 0;
            this.recomputeStage(stage);
            this.renderStage();
        }
        // Wiki change-event hook re-renders the strip; we don't need to
        // call _renderContextStrip() ourselves.
        return true;
    };

};
