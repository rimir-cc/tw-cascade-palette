/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-rendering
type: application/javascript
module-type: library

DOM rendering — breadcrumb, input, result list, per-row dispatch,
details drawer with template tabs / fields fallback.

Row rendering is split into three phases per row:
  - icon slot (left)     — _renderRowIcon
  - name (centre, flex)  — always rendered inline
  - value slot (right)   — _renderRowValue, dispatches by kind
The dispatcher (_appendResultRow) also handles the row container,
selection state, click handler, and chevron for drill rows.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var TEMPLATE_TAG = C.TEMPLATE_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    /* ---------- stage rendering ---------- */

    proto.renderStage = function () {
        var perfNow = (typeof performance !== "undefined" && performance.now)
            ? performance : Date;
        var t0 = perfNow.now();
        this.renderBreadcrumb();
        this.renderInput();
        this.renderResults();
        // Side preview pane — visible iff a stage on the stack registered
        // a `ca-preview-template`. Render after results so the cascade
        // column's selection state settles first.
        this._renderSidePreview();
        this._lastPerf = this._lastPerf || {};
        this._lastPerf.renderMs = perfNow.now() - t0;
        this._lastPerf.actionPreviewMs = this._actionPreviewMs || 0;
        this._lastPerf.actionPreviewRows = this._actionPreviewRows || 0;
        this._renderPerfFooter();
    };

    proto._renderPerfFooter = function () {
        if (!this.perfFooterEl) return;
        var enabled = (this.wiki.getTiddlerText(C.PERF_FOOTER_CONFIG, "no") || "")
            .trim().toLowerCase() === "yes";
        if (!enabled) {
            this.perfFooterEl.style.display = "none";
            this.perfFooterEl.textContent = "";
            return;
        }
        var p = this._lastPerf || {};
        var stage = this.topStage();
        var kind = (p.stageKind || (stage && stage.kind) || "—");
        var items = (p.itemCount != null) ? p.itemCount : "—";
        var results = (p.resultCount != null) ? p.resultCount : "—";
        var rcm = (typeof p.recomputeMs === "number") ? p.recomputeMs.toFixed(1) + "ms" : "—";
        var rnd = (typeof p.renderMs === "number") ? p.renderMs.toFixed(1) + "ms" : "—";
        var extra = "";
        if (typeof p.actionPreviewMs === "number") {
            extra = " · actions " + p.actionPreviewMs.toFixed(1) + "ms"
                + (typeof p.actionPreviewRows === "number" ? " (" + p.actionPreviewRows + " rows)" : "");
        }
        this.perfFooterEl.style.display = "";
        this.perfFooterEl.textContent =
            "perf · " + kind +
            " · recompute " + rcm +
            " · render " + rnd +
            " · items " + items + "/" + results +
            extra;
    };

    proto.renderBreadcrumb = function () {
        while (this.breadcrumbEl.firstChild) {
            this.breadcrumbEl.removeChild(this.breadcrumbEl.firstChild);
        }
        var self = this;
        this.stack.forEach(function (stage, i) {
            if (i > 0) {
                var sep = self.document.createElement("span");
                sep.className = "rcp-breadcrumb-sep";
                sep.textContent = " › ";
                self.breadcrumbEl.appendChild(sep);
            }
            var seg = self.document.createElement("span");
            seg.className = "rcp-breadcrumb-seg";
            if (i < self.stack.length - 1) {
                seg.classList.add("rcp-breadcrumb-clickable");
                seg.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    self.popToDepth(i);
                    self.inputEl.focus();
                });
            }
            seg.textContent = stage.title;
            self.breadcrumbEl.appendChild(seg);
        });
    };

    proto.renderInput = function () {
        var stage = this.topStage();
        if (!stage) return;
        this.inputEl.value = stage.query || "";
    };

    proto.renderResults = function () {
        while (this.resultsEl.firstChild) {
            this.resultsEl.removeChild(this.resultsEl.firstChild);
        }
        // Reset per-renderResults caches. Action-preview counts are keyed
        // by (entityType, title) and only valid within this render pass —
        // any wiki change or stage push invalidates them.
        this._actionPreviewCountCache = {};
        this._actionPreviewMs = 0;
        this._actionPreviewRows = 0;
        var stage = this.topStage();
        if (!stage) return;
        if (stage.results.length === 0) {
            var emptyEl = this.document.createElement("li");
            emptyEl.className = "rcp-empty";
            emptyEl.textContent = "No results — ? for help";
            this.resultsEl.appendChild(emptyEl);
            return;
        }
        var self = this;
        this._selectedRowEl = null;

        // Headers suppressed when all results belong to a single group
        // (matches breadcrumb-hide-on-root behaviour) AND for tree views
        // entirely (the tree structure already organises items; group
        // headers from plugin source would be redundant noise).
        // `stage.results` is already reordered into visual-group sequence
        // by `applyQueryToStage`, so a single pass with prev-group
        // tracking is enough.
        var groupingOn = this._isGroupingEnabledForStage(stage);
        var distinct = {};
        var distinctCount = 0;
        stage.results.forEach(function (item) {
            var g = item.group || "";
            if (!(g in distinct)) { distinct[g] = true; distinctCount++; }
        });
        var showHeaders = groupingOn && distinctCount > 1;
        var prevGroup = null;

        stage.results.forEach(function (item, i) {
            var g = item.group || "";
            if (showHeaders && g !== prevGroup) {
                var headerEl = self.document.createElement("li");
                headerEl.className = "rcp-group-header";
                headerEl.textContent = g || "Other";
                self.resultsEl.appendChild(headerEl);
                prevGroup = g;
            }
            self._appendResultRow(item, i, stage);
        });

        if (self._selectedRowEl && self._selectedRowEl.scrollIntoView) {
            self._selectedRowEl.scrollIntoView({ block: "nearest" });
        }
        // Preview drawer mirrors the selected row — refresh content whenever
        // the result list re-renders (arrow nav, stage push/pop, etc.).
        if (this.detailsOpen) this.renderDetails();
    };

    proto._appendResultRow = function (item, i, stage) {
        var self = this;
        var rowEl = this.document.createElement("li");
        rowEl.className =
            "rcp-row" + (i === stage.selectedIndex ? " rcp-row-selected" : "");
        if (item.kind === "drill") rowEl.classList.add("rcp-row-drill");
        if (item.kind === "toggle") rowEl.classList.add("rcp-row-toggle");
        // Deep-search hint: truncation sentinel uses its own styled row so
        // the user reads it as informational, not actionable.
        if (item._deepTruncated) rowEl.classList.add("rcp-row-deep-truncated");
        // Hover help — ca-hint is shown as a subtitle in some rows but is
        // ALSO surfaced as the native HTML tooltip on every row, so even
        // settings rows (which use the right slot for the bound value) get
        // discoverable help text.
        if (item.hint) rowEl.title = item.hint;

        this._renderRowIcon(rowEl, item);

        // Deep-search breadcrumb prefix — stamped on results by
        // cp-deep-search.js's deepWalk. Renders as a muted "Kinds → Task
        // → fields" pre-label so the user can place each match without
        // drilling. Empty path = match lives at the search anchor itself;
        // no breadcrumb needed.
        if (item._path && item._path.length) {
            var crumbEl = this.document.createElement("span");
            crumbEl.className = "rcp-row-breadcrumb";
            for (var bi = 0; bi < item._path.length; bi++) {
                if (bi > 0) {
                    var sepEl = this.document.createElement("span");
                    sepEl.className = "rcp-row-breadcrumb-sep";
                    sepEl.textContent = " › ";
                    crumbEl.appendChild(sepEl);
                }
                var segEl = this.document.createElement("span");
                segEl.className = "rcp-row-breadcrumb-seg";
                segEl.textContent = item._path[bi].name || "";
                crumbEl.appendChild(segEl);
            }
            rowEl.appendChild(crumbEl);
        }

        var nameEl = this.document.createElement("span");
        nameEl.className = "rcp-row-name";
        this._renderRowNameContent(nameEl, item);
        rowEl.appendChild(nameEl);

        // Tree container count badge — opt-in via `ca-view-show-count`.
        // Sits in the value slot before the regular renderRowValue chain
        // so it doesn't fight with hint/title text on plain rows.
        if (item._treeContainer && item._childCount !== undefined) {
            var view = this._getViewByTitle(stage.viewTitle || this.activeView);
            if (view && view.showCount) {
                var fmt = view.countFormat || " (<<count>>)";
                var badgeEl = this.document.createElement("span");
                badgeEl.className = "rcp-row-count";
                badgeEl.textContent = String(fmt)
                    .replace(/<<count>>/g, String(item._childCount));
                rowEl.appendChild(badgeEl);
            }
        }

        this._renderRowValue(rowEl, item);

        // Action preview badge — for typed leaf rows, show how many
        // actions would appear on Right-arrow drill into this tiddler.
        // Per-view opt-out via `ca-view-show-action-preview: no`.
        this._maybeAppendActionPreview(rowEl, item, stage);

        // Overridden-default marker — small dot after the value, before any
        // chevron. Only meaningful for bindable kinds.
        if (this.isOverridden(item)) {
            var dotEl = this.document.createElement("span");
            dotEl.className = "rcp-row-overridden";
            dotEl.textContent = "●";
            dotEl.title = "Overridden — DEL to restore default";
            rowEl.appendChild(dotEl);
        }

        if (item.kind === "drill") {
            var chevronEl = this.document.createElement("span");
            chevronEl.className = "rcp-row-chevron";
            chevronEl.textContent = "›";
            rowEl.appendChild(chevronEl);
        }

        // Match snippets — one line per matched field that isn't
        // rendered inline. Name / hint matches show inline (handled
        // above) so we skip them in the snippet pass; description,
        // aliases, searchText (and any author-declared fields) get a
        // muted snippet beneath the row. Multiple matches across
        // multiple fields each render their own line so the user
        // can see WHY this row is in the result list.
        if (item._matches && item._matches.length) {
            var hiddenMatches = [];
            for (var mi = 0; mi < item._matches.length; mi++) {
                if (this._isHiddenMatchField(item._matches[mi].field)) {
                    hiddenMatches.push(item._matches[mi]);
                }
            }
            if (hiddenMatches.length) {
                for (var hi = 0; hi < hiddenMatches.length; hi++) {
                    this._appendMatchSnippet(rowEl, hiddenMatches[hi]);
                }
                rowEl.classList.add("rcp-row-has-snippet");
            }
        }

        // Row-icon footer strip — small glyphs surfacing affordances on
        // the row's backing tiddler (URLs etc.). Appended last so it
        // sits below match snippets when both are present. The helper
        // is a no-op when no icons resolve, and stamps `item._rowIcons`
        // either way so the Alt-↵ keyboard branch can read the resolved
        // list without recomputing.
        this._renderRowIcons(rowEl, item);

        rowEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            stage.selectedIndex = i;
            self.setFocus("menu");
            self.fireSelected(e.shiftKey);
        });

        if (i === stage.selectedIndex) {
            this._selectedRowEl = rowEl;
        }
        this.resultsEl.appendChild(rowEl);
    };

    // Match-highlight helpers. `_match` is stamped by filterByQuery /
    // deepWalk: `{field, value, start, len}`. The renderer picks the
    // right slot for the matched field and wraps the matched substring
    // in `<span class="rcp-match">`. Fields not rendered inline get a
    // snippet line below the row instead.

    proto._isHiddenMatchField = function (field) {
        return field !== "name" && field !== "hint";
    };

    // Render text into `el` with an optional highlight on substring
    // [start, start+len). When no highlight applies, falls back to plain
    // textContent. Splits with textNodes + a wrapping span so the
    // highlight applies natively to existing CSS (no innerHTML, no
    // XSS surface).
    proto._renderHighlighted = function (el, text, highlightStart, highlightLen) {
        if (highlightStart === undefined || highlightStart < 0 ||
            highlightLen === undefined || highlightLen <= 0 ||
            highlightStart + highlightLen > text.length) {
            el.textContent = text;
            return;
        }
        el.appendChild(this.document.createTextNode(text.slice(0, highlightStart)));
        var hl = this.document.createElement("span");
        hl.className = "rcp-match";
        hl.textContent = text.slice(highlightStart, highlightStart + highlightLen);
        el.appendChild(hl);
        el.appendChild(this.document.createTextNode(text.slice(highlightStart + highlightLen)));
    };

    proto._renderRowNameContent = function (nameEl, item) {
        if (item._match && item._match.field === "name") {
            this._renderHighlighted(nameEl, item.name || "",
                item._match.start, item._match.len);
        } else {
            nameEl.textContent = item.name || "";
        }
    };

    // Snippet line under the row when the match lives in a non-displayed
    // field (description / aliases / searchText / etc.). Windows the
    // match: 24 chars before, 40 after, plus ellipses if truncated.
    // Match itself is wrapped in `.rcp-match` so the highlight style
    // applies. Field name is shown as a small prefix so the user knows
    // which field surfaced the row.
    proto._appendMatchSnippet = function (rowEl, match) {
        var WINDOW_BEFORE = 24;
        var WINDOW_AFTER = 40;
        var value = String(match.value || "");
        var start = match.start;
        var end = start + match.len;
        var windowStart = Math.max(0, start - WINDOW_BEFORE);
        var windowEnd = Math.min(value.length, end + WINDOW_AFTER);
        var before = (windowStart > 0 ? "… " : "") + value.slice(windowStart, start);
        var matched = value.slice(start, end);
        var after = value.slice(end, windowEnd) + (windowEnd < value.length ? " …" : "");

        var snippetEl = this.document.createElement("div");
        snippetEl.className = "rcp-row-snippet";

        var fieldEl = this.document.createElement("span");
        fieldEl.className = "rcp-row-snippet-field";
        fieldEl.textContent = match.field + ":";
        snippetEl.appendChild(fieldEl);

        snippetEl.appendChild(this.document.createTextNode(" " + before));
        var hl = this.document.createElement("span");
        hl.className = "rcp-match";
        hl.textContent = matched;
        snippetEl.appendChild(hl);
        snippetEl.appendChild(this.document.createTextNode(after));

        rowEl.appendChild(snippetEl);
    };

    // For toggles, a checkbox glyph occupies the icon slot. For other kinds,
    // ca-icon takes the slot. Slot is shared so the visual column lines up.
    proto._renderRowIcon = function (rowEl, item) {
        if (item.kind === "toggle") {
            var on = this.isToggleOn(item);
            var cbEl = this.document.createElement("span");
            cbEl.className = "rcp-row-checkbox" + (on ? " rcp-row-checkbox-on" : "");
            cbEl.textContent = on ? "☑" : "☐";
            rowEl.appendChild(cbEl);
            return;
        }
        if (item.icon) {
            var iconEl = this.document.createElement("span");
            iconEl.className = "rcp-row-icon";
            iconEl.textContent = item.icon;
            rowEl.appendChild(iconEl);
        }
    };

    // Right-aligned slot — dispatches by kind. Kept as a sequence of small
    // helpers so adding a new kind (Phase D's slider/enum etc.) doesn't
    // require touching the dispatcher.
    proto._renderRowValue = function (rowEl, item) {
        switch (item.kind) {
            case "toggle": this._renderToggleValue(rowEl, item); return;
            case "text":   this._renderTextValue(rowEl, item); return;
            case "number": this._renderNumberValue(rowEl, item); return;
            case "date":   this._renderDateValue(rowEl, item); return;
        }
        // Drill carrying a binding (e.g. ref/enum picker sub-drill in a
        // field-edit flow): surface the currently-bound value on the right
        // so the user can see their pick without having to drill in again.
        if (item.kind === "drill" && item.bindTiddler && item.bindField) {
            this._renderBoundDrillValue(rowEl, item);
            return;
        }
        // Non-edit kinds.
        if (item.isItem && item.rawTitle && item.rawTitle !== item.name) {
            var titleEl = this.document.createElement("span");
            titleEl.className = "rcp-row-title";
            titleEl.textContent = item.rawTitle;
            titleEl.title = item.rawTitle;
            rowEl.appendChild(titleEl);
            return;
        }
        if (item.hint) {
            var hintEl = this.document.createElement("span");
            hintEl.className = "rcp-row-hint";
            if (item._match && item._match.field === "hint") {
                this._renderHighlighted(hintEl, item.hint,
                    item._match.start, item._match.len);
            } else {
                hintEl.textContent = item.hint;
            }
            rowEl.appendChild(hintEl);
        }
    };

    proto._renderToggleValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var displayed = raw === undefined || raw === null || raw === ""
            ? "(unset)"
            : (this.isToggleOn(item) ? item.trueValue : item.falseValue);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value";
        valueEl.textContent = displayed;
        rowEl.appendChild(valueEl);
    };

    // Resolve a tiddler reference to a human caption — prefer the target
    // tiddler's `caption` field; fall back to the raw title.
    proto._displayRef = function (val) {
        if (!val) return "";
        var t = this.wiki.getTiddler(String(val));
        var caption = t && t.fields && t.fields.caption;
        return caption ? String(caption) : String(val);
    };

    proto._renderBoundDrillValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var text;
        var self = this;
        if (raw === undefined || raw === null || raw === "") {
            text = "(unset)";
        } else if (Array.isArray(raw)) {
            // string-array multi-select: comma-join captions for compactness.
            text = raw.length
                ? raw.map(function (v) { return self._displayRef(v); }).join(", ")
                : "(unset)";
        } else if (item.bindType === C.STRING_ARRAY_TYPE) {
            // After scribetype.fromField the value is TW-list-format text
            // (entries with spaces wrapped in [[...]]); parse and comma-join
            // captions so the row shows "brown fox, Bar" not "[[brown fox]] Bar".
            var list = $tw.utils.parseStringArray(String(raw)) || [];
            text = list.length
                ? list.map(function (v) { return self._displayRef(v); }).join(", ")
                : "(unset)";
        } else {
            text = this._displayRef(String(raw)) || "(unset)";
        }
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-text";
        valueEl.textContent = text;
        valueEl.title = text;
        rowEl.appendChild(valueEl);
    };

    proto._renderTextValue = function (rowEl, item) {
        var raw = this.readBoundValue(item);
        var text = raw === undefined || raw === null ? "(unset)" : String(raw);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-text";
        valueEl.textContent = text;
        valueEl.title = text;  // full value on hover when truncated
        rowEl.appendChild(valueEl);
    };

    proto._renderDateValue = function (rowEl, item) {
        var raw = this._readBoundRaw(item);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-row-value rcp-row-value-date";
        if (raw === undefined || raw === null || raw === "") {
            valueEl.textContent = "(unset)";
            rowEl.appendChild(valueEl);
            return;
        }
        // Format the stored TW date string via the item's ca-date-format.
        // Falls back to whatever fromField produces if formatting fails.
        var formatted = "";
        try {
            var d = $tw.utils.parseDate(String(raw));
            if (d && !isNaN(d.getTime())) {
                formatted = $tw.utils.formatDateString(d, item.dateFormat || "DD.MM.YYYY");
            }
        } catch (err) { /* fall through */ }
        if (!formatted) {
            formatted = this.readBoundValue(item) || String(raw);
        }
        valueEl.textContent = formatted;
        valueEl.title = formatted;
        rowEl.appendChild(valueEl);
    };

    proto._renderNumberValue = function (rowEl, item) {
        var nVal = this.readNumberValue(item);
        var hasRange = item.minValue !== null && item.maxValue !== null
            && item.maxValue > item.minValue;
        if (hasRange) {
            var barWrap = this.document.createElement("span");
            barWrap.className = "rcp-row-slider";
            var fillEl = this.document.createElement("span");
            fillEl.className = "rcp-row-slider-fill";
            var frac = (nVal - item.minValue) / (item.maxValue - item.minValue);
            if (frac < 0) frac = 0;
            if (frac > 1) frac = 1;
            fillEl.style.width = (frac * 100) + "%";
            barWrap.appendChild(fillEl);
            rowEl.appendChild(barWrap);
        }
        var numEl = this.document.createElement("span");
        numEl.className = "rcp-row-value";
        numEl.textContent = String(nVal) + (item.unit || "");
        rowEl.appendChild(numEl);
    };

    /* ---------- details drawer ---------- */

    proto.renderDetails = function () {
        var stage = this.topStage();
        if (!stage || !stage.results.length) {
            this.hideDetail();
            return;
        }
        var picked = stage.results[stage.selectedIndex];
        if (!picked) {
            this.hideDetail();
            return;
        }
        // Confirm-stage synthetic items (Confirm / Cancel) carry empty
        // titles by design — but we still want the drawer to render so
        // the consequence banner below shows. Only the empty-title +
        // non-confirm combination has nothing useful to display.
        if (!picked.title && stage.kind !== "confirm") {
            this.hideDetail();
            return;
        }

        // Reset template-tab index when the selected row changes.
        if (this._detailsCache && this._detailsCache.title !== picked.title) {
            this.detailsTemplateIdx = 0;
        }

        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }

        if (picked.title) {
            var headerEl = this.document.createElement("div");
            headerEl.className = "rcp-detail-title";
            headerEl.textContent = picked.title;
            this.detailEl.appendChild(headerEl);
        }

        // Confirm-stage consequence banner — surfaces what DEL or Enter
        // will do. Pre-empts both help text and templates so the user
        // sees the destructive consequence first.
        if (stage.kind === "confirm" && stage.consequenceText) {
            var consEl = this.document.createElement("div");
            consEl.className = "rcp-details-consequence";
            consEl.textContent = stage.consequenceText;
            this.detailEl.appendChild(consEl);
        }

        var helpText = this._resolveHelpText(picked);
        if (helpText) {
            var helpEl = this.document.createElement("div");
            helpEl.className = "rcp-details-help";
            helpEl.textContent = helpText;
            this.detailEl.appendChild(helpEl);
        }

        // Overridden-default banner — surfaces the shadow value so the user
        // knows what DEL would restore. Bindable kinds only.
        if (this.isOverridden(picked)) {
            var defaultValue = this.getDefaultValue(picked);
            var defEl = this.document.createElement("div");
            defEl.className = "rcp-details-default";
            defEl.textContent = "Default: " + (defaultValue === undefined || defaultValue === ""
                ? "(empty)" : String(defaultValue));
            this.detailEl.appendChild(defEl);
        }

        var templates = this.findTemplatesFor(picked.title);
        var renderedTemplate = false;

        if (templates.length > 0) {
            // Clamp template index to current set.
            if (this.detailsTemplateIdx >= templates.length) {
                this.detailsTemplateIdx = 0;
            }
            if (templates.length > 1) {
                this.detailEl.appendChild(this._buildTemplateTabStrip(templates));
            }
            var bodyEl = this._renderTemplateBody(picked.title, templates[this.detailsTemplateIdx]);
            if (bodyEl) {
                this.detailEl.appendChild(bodyEl);
                renderedTemplate = true;
            }
        }

        // Fields-table fallback only when nothing else applies.
        if (!renderedTemplate && !helpText) {
            this._appendFieldsTable(picked.title);
        }

        this.popupEl.classList.add("rcp-showing-detail");
    };

    proto.hideDetail = function () {
        this.popupEl.classList.remove("rcp-showing-detail");
    };

    proto._resolveHelpText = function (item) {
        if (!item) return "";
        // Synthetic items (ca-items-from) have no backing tiddler; the
        // help text lives on the item itself rather than as ca-help on
        // a real tiddler.
        if (!item.title) return item.hint || "";
        var t = this.wiki.getTiddler(item.title);
        var f = (t && t.fields) || {};
        // ca-help (multiline, long-form) wins over ca-hint (subtitle/tooltip).
        return f["ca-help"] || f["ca-hint"] || item.hint || "";
    };

    // Discover applicable templates for a given tiddler title. A template
    // tiddler is tagged TEMPLATE_TAG; `ca-template-applies` is a filter
    // evaluated with `currentTiddler` bound to the picked title — if the
    // filter returns the picked title, the template applies. Missing
    // filter → universal template (applies to everything). Sorted by
    // `ca-order` ascending.
    proto.findTemplatesFor = function (title) {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + TEMPLATE_TAG + "]]"
        );
        var matches = [];
        titles.forEach(function (tplTitle) {
            var t = self.wiki.getTiddler(tplTitle);
            var f = (t && t.fields) || {};
            var applies = f["ca-template-applies"];
            if (applies) {
                try {
                    var results = self._filterInScope(applies, { currentTiddler: title });
                    if (results.indexOf(title) === -1) return;
                } catch (err) {
                    if (console && console.warn) {
                        console.warn(
                            "[cascade-palette] ca-template-applies error on",
                            tplTitle, "—", err && err.message
                        );
                    }
                    return;
                }
            }
            var orderRaw = f["ca-order"];
            var order = orderRaw !== undefined && orderRaw !== ""
                ? parseFloat(orderRaw) : DEFAULT_ORDER;
            if (isNaN(order)) order = DEFAULT_ORDER;
            matches.push({
                title: tplTitle,
                name: f["ca-template-name"] || tplTitle.split("/").pop(),
                order: order
            });
        });
        matches.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        return matches;
    };

    proto._buildTemplateTabStrip = function (templates) {
        var self = this;
        var stripEl = this.document.createElement("div");
        stripEl.className = "rcp-details-tabs";
        templates.forEach(function (tpl, idx) {
            var tabEl = self.document.createElement("span");
            tabEl.className = "rcp-details-tab" +
                (idx === self.detailsTemplateIdx ? " rcp-details-tab-active" : "");
            tabEl.textContent = tpl.name;
            tabEl.title = tpl.title;
            tabEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.detailsTemplateIdx = idx;
                self._detailsCache = null;  // template changed → invalidate
                self.setFocus("details");
                self.renderDetails();
            });
            stripEl.appendChild(tabEl);
        });
        return stripEl;
    };

    // Render a template tiddler's wikitext with `currentTiddler` bound to
    // the picked title. Uses the standard TW transclude-style: parse the
    // template, make a widget tree, render to a real DOM container, return
    // the container. Cached by (title, templateIdx).
    proto._renderTemplateBody = function (pickedTitle, template) {
        var cache = this._detailsCache;
        if (cache && cache.title === pickedTitle &&
            cache.templateIdx === this.detailsTemplateIdx &&
            cache.dom) {
            return cache.dom;
        }
        var container = this.document.createElement("div");
        container.className = "rcp-details-template";
        try {
            var parser = this.wiki.parseTiddler(template.title);
            var widgetNode = this.wiki.makeWidget(parser, {
                parentWidget: this.findActionParent() || $tw.rootWidget,
                document: this.document,
                variables: { currentTiddler: pickedTitle }
            });
            widgetNode.render(container, null);
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] template render error",
                    template.title, "—", err && err.message
                );
            }
            container.textContent = "(template render error: " +
                (err && err.message) + ")";
        }
        this._detailsCache = {
            title: pickedTitle,
            templateIdx: this.detailsTemplateIdx,
            dom: container
        };
        return container;
    };

    proto._appendFieldsTable = function (title) {
        var t = this.wiki.getTiddler(title);
        if (!t) {
            var noEl = this.document.createElement("div");
            noEl.className = "rcp-detail-empty";
            noEl.textContent = "(no tiddler — likely a transient filter result)";
            this.detailEl.appendChild(noEl);
            return;
        }
        var fields = t.fields || {};
        var keys = Object.keys(fields)
            .filter(function (k) { return k !== "title"; })
            .sort(function (a, b) {
                if (a === "text") return 1;
                if (b === "text") return -1;
                return a.localeCompare(b);
            });
        if (keys.length === 0) {
            var nf = this.document.createElement("div");
            nf.className = "rcp-detail-empty";
            nf.textContent = "(no fields besides title)";
            this.detailEl.appendChild(nf);
            return;
        }
        var dl = this.document.createElement("dl");
        dl.className = "rcp-detail-fields";
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var v = fields[k];
            var str = v === null || v === undefined ? "" : String(v);
            var dt = this.document.createElement("dt");
            dt.textContent = k;
            var dd = this.document.createElement("dd");
            dd.textContent = str;
            if (k === "text") dd.classList.add("rcp-detail-body");
            dl.appendChild(dt);
            dl.appendChild(dd);
        }
        this.detailEl.appendChild(dl);
    };

    // Add a small badge to typed leaf rows showing how many actions
    // would be applicable when the user drills into the row. Counts are
    // memoized by (entityType, title) within a renderResults pass so a
    // keystroke that just narrows the visible list doesn't reevaluate
    // already-computed rows.
    proto._maybeAppendActionPreview = function (rowEl, item, stage) {
        if (!item || !item.title || item.isSynthetic) return;
        var view = this._getViewByTitle(stage.viewTitle || this.activeView);
        if (view && view.showActionPreview === false) return;
        var entityType = item.entityType ||
            (item.isItem ? stage.entityType : null) || null;
        var key = (entityType || "") + " " + item.title;
        var cache = this._actionPreviewCountCache || (this._actionPreviewCountCache = {});
        var count;
        if (Object.prototype.hasOwnProperty.call(cache, key)) {
            count = cache[key];
        } else {
            var perfNow = (typeof performance !== "undefined" && performance.now)
                ? performance : Date;
            var t0 = perfNow.now();
            try {
                var actions = this.loadActionsForType(entityType, item.title);
                count = actions.length;
            } catch (err) {
                count = 0;
            }
            this._actionPreviewMs = (this._actionPreviewMs || 0) + (perfNow.now() - t0);
            this._actionPreviewRows = (this._actionPreviewRows || 0) + 1;
            cache[key] = count;
        }
        if (count <= 0) return;
        rowEl.classList.add("rcp-row-actionable");
        var badge = this.document.createElement("span");
        badge.className = "rcp-row-action-preview";
        badge.textContent = "→" + count;
        var triggerHint = item.kind === "drill"
            ? "Space" : "Space or Right-arrow";
        badge.title = count + " action" + (count === 1 ? "" : "s") +
            " available (" + triggerHint + ")";
        rowEl.appendChild(badge);
    };

};
