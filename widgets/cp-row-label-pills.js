/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-row-label-pills
type: application/javascript
module-type: library

Row-label subsystem — pills that override how each data row's display
name is rendered.

A row-label pill is a tiddler tagged ROW_LABEL_TAG that declares a
`ca-row-label-filter` — a filter evaluated per data row with
`<currentTiddler>` bound to the row's backing tiddler title. The first
non-empty result replaces `item.name` at render time. Multiple pills
are registered; exactly one (or none) is active at a time, mirroring
the view-pill single-select model rather than the additive filter-pill
model.

Activation is persisted in ROW_LABEL_STATE_TITLE (text body = active
pill title) so the user's display preference survives reload. The
shipped default (ca-row-label-default: yes) activates on first load
when no state is stored.

Override scope — guarded inside `_resolveRowLabel`:
  - item.dataRow must be true. View-built rows
    (cp-views.js#_buildRowsForView) and ca-next-scope synthetic rows
    (cp-actions.js#evaluateFilterStage) set this flag. Static
    cascade-palette entries / actions / settings stay on their
    explicit `ca-name` regardless of the active pill.
  - item.title must be non-empty (synthetic ca-items-from rows skip).
  - The pill's filter must return at least one non-empty title; on
    empty result the row falls back to `item.name` so the row never
    becomes blank.

Sister modules:
  - cp-search-meta-pills / cp-search-field-pills — push/pop multi-active
    pills. Different model: every pushed pill contributes, no
    persistence across reloads.
  - cp-views (_renderViewStrip) — single-active view pill, closest
    structural analogue. Row-label borrows its render + activate logic
    but lives in its own strip + state.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var ROW_LABEL_TAG = C.ROW_LABEL_TAG;
var ROW_LABEL_STATE_TITLE = C.ROW_LABEL_STATE_TITLE;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Discover registered row-label pills. Sorted by ca-order then
    // name. Cached per widget instance — invalidated by the wiki
    // change hook when a tagged tiddler is created / edited / deleted.
    proto._loadRowLabelPills = function () {
        if (this._rowLabelPillsCache) return this._rowLabelPillsCache;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ROW_LABEL_TAG + "]]"
        );
        var pills = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-row-label-name"] || title.split("/").pop(),
                chip: f["ca-row-label-chip"] || f["ca-row-label-name"] || title.split("/").pop(),
                hint: f["ca-row-label-hint"] || "",
                help: f["ca-row-label-help"] || "",
                filter: f["ca-row-label-filter"] || "",
                isDefault: (f["ca-row-label-default"] || "").toLowerCase() === "yes",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
        pills.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this._rowLabelPillsCache = pills;
        return pills;
    };

    proto._invalidateRowLabelPills = function () {
        this._rowLabelPillsCache = null;
        this._activeRowLabelMeta = null;
        this._rowLabelResultCache = null;
    };

    // Active pill title — persisted via state tiddler so reload preserves
    // the user's pick. First read also seeds the default pill (one tagged
    // `ca-row-label-default: yes`) so a fresh install shows captions
    // without the user having to click a pill first.
    proto._readActiveRowLabelTitle = function () {
        var raw = this.wiki.getTiddlerText(ROW_LABEL_STATE_TITLE, "");
        var stored = (raw || "").trim();
        if (stored) return stored;
        // No state yet — seed default. Returns "" when no pill carries
        // ca-row-label-default; that's fine, override stays inert.
        var pills = this._loadRowLabelPills();
        for (var i = 0; i < pills.length; i++) {
            if (pills[i].isDefault) return pills[i].title;
        }
        return "";
    };

    proto._activeRowLabelPill = function () {
        // Cache invalidation lives in `_invalidateRowLabelPills` and
        // `_setRowLabel` — both clear `_activeRowLabelMeta`, so a non-null
        // cache value is always current. State-tiddler changes also route
        // through the wiki change-hook which calls invalidate.
        if (this._activeRowLabelMeta) return this._activeRowLabelMeta;
        var activeTitle = this._readActiveRowLabelTitle();
        if (!activeTitle) return null;
        var pills = this._loadRowLabelPills();
        for (var i = 0; i < pills.length; i++) {
            if (pills[i].title === activeTitle) {
                this._activeRowLabelMeta = pills[i];
                return this._activeRowLabelMeta;
            }
        }
        // Stored title refers to a missing pill (deleted by author /
        // plugin uninstalled). Treat as no override so the user still
        // sees something. The stale state tiddler stays in place — a
        // next install of the same-titled pill silently picks it back up.
        return null;
    };

    // Resolve display label for a data row. Returns the override text
    // when an active pill produces a non-empty result; null when no
    // override should apply (no active pill, non-data row, filter
    // returned nothing, etc.) — caller falls back to `item.name`.
    proto._resolveRowLabel = function (item) {
        if (!item || !item.dataRow || !item.title) return null;
        var pill = this._activeRowLabelPill();
        if (!pill || !pill.filter) return null;
        // Per-render cache so 60 rows × keystroke doesn't re-evaluate
        // the same (pill, title) pairs. Reset on every renderResults.
        var cache = this._rowLabelResultCache;
        if (!cache || cache.pill !== pill.title) {
            cache = this._rowLabelResultCache = { pill: pill.title, byTitle: {} };
        }
        if (Object.prototype.hasOwnProperty.call(cache.byTitle, item.title)) {
            return cache.byTitle[item.title];
        }
        var resolved = null;
        try {
            var results = this._filterInScope(pill.filter, { currentTiddler: item.title });
            if (results && results.length) {
                var first = String(results[0] || "").trim();
                if (first) resolved = first;
            }
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] row-label filter error on", pill.title,
                    "for", item.title, "—", err && err.message
                );
            }
        }
        cache.byTitle[item.title] = resolved;
        return resolved;
    };

    // Persist a new active pill and re-render. Empty / null clears.
    proto._setRowLabel = function (title) {
        var pills = this._loadRowLabelPills();
        var matched = "";
        for (var i = 0; i < pills.length; i++) {
            if (pills[i].title === title) { matched = title; break; }
        }
        // Write a real (non-shadow) tiddler so the state survives. Using
        // an empty text intentionally clears.
        this.wiki.addTiddler(new $tw.Tiddler({
            title: ROW_LABEL_STATE_TITLE,
            text: matched
        }));
        this._activeRowLabelMeta = null;
        this._rowLabelResultCache = null;
        this._renderRowLabelStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
    };

    proto._clearRowLabel = function () {
        this._setRowLabel("");
    };

    proto._renderRowLabelStrip = function () {
        if (!this.rowLabelStripEl) return;
        while (this.rowLabelStripEl.firstChild) {
            this.rowLabelStripEl.removeChild(this.rowLabelStripEl.firstChild);
        }
        var pills = this._loadRowLabelPills();
        // Hidden via `rcp-has-row-label` class when no pills are
        // registered. The shipped pills (Title / Caption / Caption →
        // Title) make `hasAny` always true on a default install — but
        // a custom build that strips them keeps the strip hidden until
        // someone re-installs a pill, so empty-installs look untouched.
        // pin-pill-rows intentionally does NOT surface this strip when
        // empty: there's no "empty state" semantics for a single-select
        // override the way there is for a constraint-stack.
        var hasAny = pills.length > 0;
        if (this.popupEl) {
            this.popupEl.classList.toggle("rcp-has-row-label", hasAny);
        }
        if (!hasAny) return;
        var self = this;
        var active = this._readActiveRowLabelTitle();
        // Synthetic "(none)" pill at the head so the user can clear the
        // override without leaving the strip — DEL would also work but
        // a visible pill makes the "off" state navigable like any other.
        var entries = [{
            title: "",
            chip: "(none)",
            hint: "Use each row's default name (no override)."
        }].concat(pills);
        // Clamp focus into the rebuilt list.
        if (this.rowLabelFocusIdx === undefined || this.rowLabelFocusIdx < 0 ||
            this.rowLabelFocusIdx >= entries.length) {
            // On first render, place focus on the active pill so ↵/Space
            // reactivates rather than overriding silently. Falls back to
            // 0 ((none)) when no pill is active.
            var startIdx = 0;
            if (active) {
                for (var i = 0; i < entries.length; i++) {
                    if (entries[i].title === active) { startIdx = i; break; }
                }
            }
            this.rowLabelFocusIdx = startIdx;
        }
        entries.forEach(function (entry, i) {
            var pillEl = self.document.createElement("span");
            var cls = "rcp-row-label-pill";
            if (entry.title === active) cls += " rcp-row-label-pill-active";
            if (self.focus === "rowlabel" && i === self.rowLabelFocusIdx) {
                cls += " rcp-row-label-pill-focused";
            }
            pillEl.className = cls;
            pillEl.textContent = entry.chip;
            if (entry.hint) pillEl.title = entry.hint;
            pillEl.dataset.rowLabelIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.rowLabelFocusIdx = i;
                self._setRowLabel(entry.title);
                self.setFocus("rowlabel");
            });
            self.rowLabelStripEl.appendChild(pillEl);
        });
    };

    // Help line under the strip — surfaces the focused pill's chip,
    // help text, and underlying filter so the user can audit the rule.
    proto._maybeRenderRowLabelHelp = function () {
        if (this.focus !== "rowlabel") return;
        var pills = this._loadRowLabelPills();
        if (!pills.length) return;
        var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
        var idx = this.rowLabelFocusIdx || 0;
        // Index 0 is the synthetic "(none)" — surface a static help line
        // explaining what clearing does instead of dereferencing a real pill.
        if (idx === 0) {
            pillstrip.renderConstraintHelp(this, {
                title: "(none)",
                help: "Clear the active row-label pill. Rows fall back to whatever name the view / next-scope path assigned (typically the tiddler caption or title).",
                rows: []
            });
            return;
        }
        var pill = pills[idx - 1];
        if (!pill) return;
        pillstrip.renderConstraintHelp(this, {
            title: pill.chip || pill.name,
            help: pill.help || pill.hint ||
                "Override every data row's display name using this filter.",
            rows: [
                ["Filter", pill.filter || "—"],
                ["Tiddler", pill.title]
            ]
        });
    };

    proto._rowLabelPillCount = function () {
        var pills = this._loadRowLabelPills();
        // +1 for the synthetic "(none)" entry rendered at the head.
        return pills.length ? pills.length + 1 : 0;
    };

    proto._addRowLabelByTitle = function (title) {
        // Symmetric with _addFilterByTitle / _addReachByTitle —
        // leader / external triggers use this to activate a named pill.
        // Empty title clears.
        this._setRowLabel(title || "");
    };

};
