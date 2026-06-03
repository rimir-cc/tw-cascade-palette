/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-structure-toggles
type: application/javascript
module-type: library

Structure-toggle subsystem — boolean on/off switches that live in the
Structure (viewconfig) strip's view-header row.

A structure toggle is a tiddler tagged STRUCTURE_TOGGLE_TAG declaring:
  ca-struct-name            pill label (e.g. "Kind icons")
  ca-struct-hint            short tooltip
  ca-struct-help            long help text (shown in the strip help line)
  ca-struct-default         "yes"/"no" — initial state when no state stored
  ca-struct-when            applicability filter — empty result hides the
                            toggle entirely (evaluated with no row context).
                            Empty / missing = always applicable.
  ca-struct-row-icon-filter optional per-data-row filter; while the toggle
                            is ON its first non-empty result becomes the
                            row's leading icon glyph (only for data rows
                            that don't already carry an explicit icon).
  ca-order                  sort order among toggles (default 100).

State persists in STRUCTURE_TOGGLE_STATE_PREFIX + <slug> (body "yes"/"no").
Flipping re-renders the strip and the result list so row icons appear /
vanish immediately.

This is a GENERIC mechanism. The `rimir/kind` plugin ships the "Kind
icons" toggle (palette/structure/kind-icons.tid) that resolves each
instance's type `kind.icon`; cascade-palette knows nothing about kind.

Sister module: cp-row-label-pills.js (single-select per-row NAME override,
own strip + state). This subsystem is the ICON analogue but surfaces as a
boolean pill inside the existing Structure strip rather than its own strip.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var STRUCTURE_TOGGLE_TAG = C.STRUCTURE_TOGGLE_TAG;
var STRUCTURE_TOGGLE_STATE_PREFIX = C.STRUCTURE_TOGGLE_STATE_PREFIX;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Discover + parse registered toggles, sorted by ca-order then name.
    // Cached per widget instance; invalidated by the wiki change hook when
    // a tagged tiddler is created / edited / deleted.
    proto._loadStructureToggles = function () {
        if (this._structureTogglesCache) return this._structureTogglesCache;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + STRUCTURE_TOGGLE_TAG + "]]"
        );
        var toggles = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-struct-name"] || title.split("/").pop(),
                hint: f["ca-struct-hint"] || "",
                help: f["ca-struct-help"] || "",
                isDefaultOn: (f["ca-struct-default"] || "").toLowerCase() === "yes",
                when: f["ca-struct-when"] || "",
                rowIconFilter: f["ca-struct-row-icon-filter"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER),
                stateTitle: STRUCTURE_TOGGLE_STATE_PREFIX + title.split("/").pop()
            };
        });
        toggles.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this._structureTogglesCache = toggles;
        return toggles;
    };

    proto._invalidateStructureToggles = function () {
        this._structureTogglesCache = null;
        this._rowIconResultCache = null;
    };

    // True when the toggle's `ca-struct-when` filter is non-empty (or
    // absent). Evaluated with no row binding — the filter is expected to
    // be a global existence test (e.g. "are there any kind types?").
    proto._structureToggleApplies = function (toggle) {
        if (!toggle.when) return true;
        try {
            var res = this._filterInScope(toggle.when, {});
            return !!(res && res.length);
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-struct-when filter error on",
                    toggle.title, "—", err && err.message
                );
            }
            return false;
        }
    };

    // Toggles that should currently be shown (applicability passes).
    proto._applicableStructureToggles = function () {
        var self = this;
        return this._loadStructureToggles().filter(function (t) {
            return self._structureToggleApplies(t);
        });
    };

    // Read on/off state — stored body "yes"/"no"; absent → ca-struct-default.
    proto._isStructureToggleOn = function (toggle) {
        var raw = this.wiki.getTiddlerText(toggle.stateTitle, "");
        var stored = (raw || "").trim().toLowerCase();
        if (stored === "yes") return true;
        if (stored === "no") return false;
        return toggle.isDefaultOn;
    };

    // Persist a new on/off state and refresh. Writes an explicit "yes"/"no"
    // (not empty-clears) so the user's choice is unambiguous and survives a
    // later change to the toggle's default.
    proto._setStructureToggle = function (toggle, on) {
        this.wiki.addTiddler(new $tw.Tiddler({
            title: toggle.stateTitle,
            text: on ? "yes" : "no"
        }));
        this._rowIconResultCache = null;
        // Re-render the strip (pill on/off display) and the result list
        // (row icons appear / vanish). Recompute so any icon-dependent
        // layout settles; mirrors _setRowLabel.
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._maybeRenderViewConfigHelp) this._maybeRenderViewConfigHelp();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
    };

    proto._flipStructureToggle = function (toggleTitle) {
        var toggles = this._loadStructureToggles();
        for (var i = 0; i < toggles.length; i++) {
            if (toggles[i].title === toggleTitle) {
                this._setStructureToggle(toggles[i], !this._isStructureToggleOn(toggles[i]));
                return;
            }
        }
    };

    // Currently-ON toggles that declare a row-icon filter (and apply).
    // Computed once per render pass and stashed on _rowIconResultCache.
    proto._enabledRowIconToggles = function () {
        var self = this;
        return this._applicableStructureToggles().filter(function (t) {
            return t.rowIconFilter && self._isStructureToggleOn(t);
        });
    };

    // Resolve a leading-icon glyph for a data row from the enabled
    // row-icon toggles. Returns null when nothing applies. Guarded like
    // row-label: data rows only, and never overrides an explicit icon
    // (caller checks item.icon first). Per-render cache keyed by title so
    // a long result list doesn't re-evaluate the same filters per keystroke.
    proto._resolveRowIconOverride = function (item) {
        if (!item || !item.dataRow || !item.title) return null;
        var cache = this._rowIconResultCache;
        if (!cache) {
            cache = this._rowIconResultCache = {
                toggles: this._enabledRowIconToggles(),
                byTitle: {}
            };
        }
        if (!cache.toggles.length) return null;
        if (Object.prototype.hasOwnProperty.call(cache.byTitle, item.title)) {
            return cache.byTitle[item.title];
        }
        var resolved = null;
        for (var i = 0; i < cache.toggles.length && !resolved; i++) {
            var toggle = cache.toggles[i];
            try {
                var results = this._filterInScope(
                    toggle.rowIconFilter, { currentTiddler: item.title }
                );
                if (results && results.length) {
                    var first = String(results[0] || "").trim();
                    if (first) resolved = first;
                }
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-struct-row-icon-filter error on",
                        toggle.title, "for", item.title, "—", err && err.message
                    );
                }
            }
        }
        cache.byTitle[item.title] = resolved;
        return resolved;
    };

    // Pill specs for the Structure strip's view-header row — one per
    // applicable toggle. Consumed by _viewScopedPills (cp-views.js).
    proto._structureTogglePills = function () {
        var self = this;
        return this._applicableStructureToggles().map(function (t) {
            var on = self._isStructureToggleOn(t);
            return {
                kind: "struct-toggle",
                label: t.name,
                value: on ? "☑" : "☐",
                toggleTitle: t.title,
                on: on,
                help: t.help || t.hint ||
                    "Toggle " + t.name + " on / off (Space or Enter)."
            };
        });
    };

};
