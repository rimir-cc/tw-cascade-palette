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
var FILTER_TAG = C.FILTER_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadFilterTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + FILTER_TAG + "]]"
        );
        return titles.map(function (title) {
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
    };

    proto._buildFilterInstance = function (meta, arg) {
        var safeArg = String(arg || "")
            .replace(/[\r\n\t]/g, " ")
            .replace(/[\]\[]/g, "")
            .trim()
            .slice(0, 200);
        function resolveFilter(template) {
            if (!template) return "";
            return String(template).replace(/<arg>/g, "[" + safeArg + "]");
        }
        function resolveText(template) {
            if (!template) return "";
            return String(template).replace(/<<arg>>/g, safeArg);
        }
        return {
            constraintTiddler: meta.title,
            name: meta.name,
            argType: meta.argType,
            arg: safeArg,
            expr: resolveFilter(meta.expr),
            chip: resolveText(meta.chip) || meta.name,
            hint: resolveText(meta.hint),
            help: resolveText(meta.help)
        };
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
        if (!this.filterStripEl) return;
        while (this.filterStripEl.firstChild) {
            this.filterStripEl.removeChild(this.filterStripEl.firstChild);
        }
        var has = this.filters && this.filters.length > 0;
        if (this.popupEl) this.popupEl.classList.toggle("rcp-has-filters", has);
        if (!has) return;
        var self = this;
        this.filters.forEach(function (item, i) {
            var pillEl = self.document.createElement("span");
            pillEl.className = "rcp-pill" +
                (self.focus === "filter" && i === self.filterFocusIdx
                    ? " rcp-pill-focused" : "");
            pillEl.textContent = item.chip;
            if (item.hint) pillEl.title = item.hint;
            pillEl.dataset.filterIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.filterFocusIdx = i;
                self.setFocus("filter");
            });
            var xEl = self.document.createElement("span");
            xEl.className = "rcp-pill-remove";
            xEl.textContent = "×";
            xEl.title = "Remove this filter";
            xEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                e.stopPropagation();
                self._removeFilterAt(i);
            });
            pillEl.appendChild(xEl);
            self.filterStripEl.appendChild(pillEl);
        });
    };

    proto._maybeRenderFilterHelp = function () {
        if (this.focus !== "filter") return;
        if (!this.filters.length) return;
        var item = this.filters[this.filterFocusIdx];
        if (!item) return;
        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-detail-title";
        titleEl.textContent = item.name + (item.arg ? " — " + item.arg : "");
        this.detailEl.appendChild(titleEl);

        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = item.help || item.hint || item.name;
        this.detailEl.appendChild(helpEl);

        var rows = [];
        if (item.arg) rows.push(["Argument", item.arg]);
        if (item.expr) rows.push(["Filter", item.expr]);
        rows.push(["Filter tiddler", item.constraintTiddler]);
        var dl = this.document.createElement("dl");
        dl.className = "rcp-detail-fields";
        rows.forEach(function (row) {
            var dt = this.document.createElement("dt");
            dt.textContent = row[0];
            var dd = this.document.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        }, this);
        this.detailEl.appendChild(dl);
        this.popupEl.classList.add("rcp-showing-detail");
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
