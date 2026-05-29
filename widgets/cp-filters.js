/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-filters
type: application/javascript
module-type: library

Filter subsystem — pills that intersect every stage's data filter.

Filters are declarative tiddlers tagged FILTER_TAG. Each one declares a
TW filter snippet (`ca-filter-expr`) with `<arg>` as the operand
placeholder; we pre-substitute the user's arg at push time so the
resolved filter can be appended to any stage filter without per-instance
variable plumbing. The text templates (chip, hint, help) use `<<arg>>`.

This is the data-narrowing half of what was previously called "scope".
Visibility (hide-predicate) is the sibling subsystem in cp-visibility.js.

Replace-by-kind: one slot per filter tiddler. Pushing a filter of the
same tiddler title evicts the previous instance.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var FILTER_TAG = C.FILTER_TAG;
var ENTRY_TAG = C.ENTRY_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Cached by wiki.getChangeCount(): rebuilds when the wiki has any
    // change since last read; otherwise returns the same array reference.
    // Called from _detectInputPrefix on every keystroke — uncached this
    // would be 2x wiki.filterTiddlers + N×getTiddler per keystroke.
    proto._loadFilterTiddlers = function () {
        var cc = (this.wiki.getChangeCount && this.wiki.getChangeCount()) || 0;
        if (this._filterTiddlersCache && this._filterTiddlersCache.changeCount === cc) {
            return this._filterTiddlersCache.entries;
        }
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + FILTER_TAG + "]]"
        );
        var entries = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-filter-name"] || title.split("/").pop(),
                prefix: f["ca-filter-prefix"] || "",
                argType: (f["ca-filter-arg"] || "text").toLowerCase(),
                expr: f["ca-filter-expr"] || "",
                chip: f["ca-filter-chip"] || "",
                hint: f["ca-filter-hint"] || "",
                help: f["ca-filter-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
        this._filterTiddlersCache = { changeCount: cc, entries: entries };
        return entries;
    };

    // Build the in-memory instance from a loader meta + user arg.
    // Delegates to cp-utils.buildConstraintInstance (shared with the
    // visibility subsystem, which has the same shape).
    proto._buildFilterInstance = function (meta, arg) {
        return utils.buildConstraintInstance(meta, arg);
    };

    proto._pushFilter = function (instance) {
        if (!instance) return;
        this.filters = this.filters.filter(function (s) {
            return s.constraintTiddler !== instance.constraintTiddler;
        });
        this.filters.push(instance);
        this._renderFilterStrip();
        this._refreshPresetActiveCue();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this._leaderFiring && this.filterStripEl) {
            var pills = this.filterStripEl.querySelectorAll(".rcp-pill");
            if (pills.length) {
                this._flashElement(pills[pills.length - 1]);
            }
        }
    };

    proto._removeFilterAt = function (idx) {
        if (idx < 0 || idx >= this.filters.length) return;
        this.filters.splice(idx, 1);
        if (this.filterFocusIdx >= this.filters.length) {
            this.filterFocusIdx = Math.max(0, this.filters.length - 1);
        }
        this._renderFilterStrip();
        this._refreshPresetActiveCue();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.filters.length === 0 && this.focus === "filter") {
            this.setFocus("input");
        } else if (this.focus === "filter") {
            this._maybeRenderFilterHelp();
        }
    };

    proto._clearAllFilters = function () {
        if (!this.filters.length) return;
        this.filters = [];
        this.filterFocusIdx = 0;
        this._renderFilterStrip();
        this._refreshPresetActiveCue();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.focus === "filter") this.setFocus("input");
    };

    proto._renderFilterStrip = function () {
        var self = this;
        pillstrip.renderPillStripSection({
            widget:        self,
            stripEl:       self.filterStripEl,
            pills:         self.filters,
            focusIdx:      self.filterFocusIdx,
            focusSection:  "filter",
            popupHasClass: "rcp-has-filters",
            datasetKey:    "filterIdx",
            removeTitle:   "Remove this filter",
            onSelectAt:    function (i) { self.filterFocusIdx = i; self.setFocus("filter"); },
            onRemoveAt:    function (i) { self._removeFilterAt(i); }
        });
    };

    proto._maybeRenderFilterHelp = function () {
        if (this.focus !== "filter") return;
        if (!this.filters.length) return;
        var item = this.filters[this.filterFocusIdx];
        if (!item) return;
        var rows = [];
        if (item.arg) rows.push(["Argument", item.arg]);
        if (item.expr) rows.push(["Filter", item.expr]);
        rows.push(["Filter tiddler", item.constraintTiddler]);
        pillstrip.renderConstraintHelp(this, {
            title: item.name + (item.arg ? " — " + item.arg : ""),
            help:  item.help || item.hint || item.name,
            rows:  rows
        });
    };

    // Compose the suffix appended to every stage filter when filters are
    // active. Each filter's resolved expression is wrapped in its own
    // filter run (TW: subsequent `+[...]` runs intersect with the prior
    // result).
    proto._composeFilterSuffix = function () {
        if (!this.filters || !this.filters.length) return "";
        return this.filters
            .map(function (s) { return s.expr || ""; })
            .filter(function (f) { return f; })
            .join("");
    };

    // Apply the active filter-pill suffix to a base filter expression,
    // exempting virtual menu entries from the narrowing. Centralises the
    // "filters are global like Visibility, but virtual entries pass
    // unconditionally" contract: callers no longer concat the suffix
    // themselves.
    //
    // When no filter pills are active this is identical to a single
    // `_filterInScope(baseFilter)` call — zero overhead.
    //
    // With filters active we compute two passes over the base:
    //   - narrowed: base + filter suffix (real tiddlers that survive)
    //   - entries:  base ∩ [tag[ENTRY_TAG]] (virtual entries in base)
    // and return their union (narrowed-order first, entries-only suffix
    // appended in order). Entries that already match the suffix appear
    // once via the first pass. The cost is +1 filterTiddlers call per
    // producer evaluation — matches the cost class of the per-row
    // visibility check.
    //
    // Authors who want a filter pill to AFFECT entries can write the
    // expression as a positive predicate that includes the entry tag —
    // but the convention is: pill = narrow real tiddlers, input query =
    // narrow whatever's currently rendered (including virtual entries).
    proto._applyFilterSuffix = function (baseFilter, vars, source) {
        var suffix = this._composeFilterSuffix();
        if (!suffix) {
            return this._filterInScope(baseFilter, vars, source);
        }
        var narrowed = this._filterInScope(baseFilter + suffix, vars, source);
        var entriesInBase = this._filterInScope(
            baseFilter + " +[tag[" + ENTRY_TAG + "]]",
            vars,
            source
        );
        if (!entriesInBase.length) return narrowed;
        var seen = Object.create(null);
        var out = [];
        for (var i = 0; i < narrowed.length; i++) {
            var t = narrowed[i];
            if (!seen[t]) { seen[t] = true; out.push(t); }
        }
        for (var j = 0; j < entriesInBase.length; j++) {
            var e = entriesInBase[j];
            if (!seen[e]) { seen[e] = true; out.push(e); }
        }
        return out;
    };

    // Push a filter by tiddler title. For "none" arg-type, push directly.
    // For "text"/"tag"/"tiddler", pre-populate the input with the filter's
    // prefix so the user can complete the arg without re-typing.
    //
    // Called from the add-filter message handler. The triggering leaf has
    // `ca-after-fire: pop` so the engine pops the Add-filter stage one
    // tick after the message fires; we schedule the prefill ALSO on
    // setTimeout(0) — FIFO order guarantees the pop runs first, then our
    // prefill, so the prefilled input survives the popped stage's
    // renderInput pass.
    proto._addFilterByTitle = function (title) {
        var metas = this._loadFilterTiddlers();
        var meta = null;
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === title) { meta = metas[i]; break; }
        }
        if (!meta) return;
        if (meta.argType === "none") {
            this._pushFilter(this._buildFilterInstance(meta, ""));
            return;
        }
        if (!meta.prefix) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] filter", title,
                    "has arg-type", meta.argType, "but no prefix — cannot be added interactively"
                );
            }
            return;
        }
        var self = this;
        setTimeout(function () {
            if (!self.open) return;
            var top = self.topStage();
            if (top) {
                top.query = meta.prefix;
                self.recomputeStage(top);
            }
            self.inputEl.value = meta.prefix;
            self.setFocus("input");
            self.renderStage();
            self._updateConstraintPrefixCue();
            var len = self.inputEl.value.length;
            try { self.inputEl.setSelectionRange(len, len); } catch (e) { /* ignore */ }
        }, 0);
    };

};
