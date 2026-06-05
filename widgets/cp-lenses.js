/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-lenses
type: application/javascript
module-type: library

Lens subsystem (H4) — the unified, type-driven row decorator that
replaces the former row-label (name) + structure-toggle (icon)
subsystems with one model.

A lens is a tiddler tagged LENS_TAG. It projects zero or more
row-decoration SLOTS (see LENS_SLOTS — name / icon / annotation) and may
contribute actions. Each slot projection is either:

  ca-lens-<slot>-filter    cheap — a filter evaluated per data row with
                           <currentTiddler> bound to the row's backing
                           tiddler title; the first non-empty result fills
                           the slot. Covers the common case (a glyph, a
                           caption, a relational/temporal lookup).
  ca-lens-<slot>-template  rich — wikitext rendered per visible row (H4
                           slice 4). Not yet resolved here.

The same primitive backs every slot: icon and label are the same
operation — a per-row projection → string → into a visual slot. So:
  - name  REPLACES the row's display name (former row-label pills)
  - icon  AUGMENTS-LEAD a glyph        (former structure-toggle row icon)
  - annotation AUGMENTS-TRAIL a badge  (new — H4 slice 4)

CONTROL — per-slot single-select. Each slot is its own chooser; the
active lens per slot persists in LENS_STATE_PREFIX + <slot>. A lens that
projects several slots (e.g. a Kind lens projecting icon + name) appears
as an option in EACH slot it fills; the user enables it per slot (no
hidden precedence). `ca-lens-default` (space-separated slot list) seeds a
slot's chooser on first load when no state is stored.

APPLICABILITY — `ca-lens-when` is a global existence test (evaluated with
no row context). An empty result hides the lens from every chooser (e.g.
"are there any kind types?"). Missing / empty filter = always applicable.

PERFORMANCE — projecting-lens sets and applicability are cached per wiki
change-count generation, so signature/chooser computation is O(1) within
a render. Per-row slot resolution itself is cached one level up by
cp-row-decorations (keyed by (signature, change-count)), so typing never
re-runs a projection filter.

Sister module: cp-row-decorations.js — the orchestrator + cross-render
cache that calls `_resolveSlot` for each slot and merges the result.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LENS_TAG = C.LENS_TAG;
var LENS_SLOTS = C.LENS_SLOTS;
var LENS_STATE_PREFIX = C.LENS_STATE_PREFIX;
var LENS_ACTIONS_VIA_ENTITY_TYPE = C.LENS_ACTIONS_VIA_ENTITY_TYPE;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Discover + parse registered lenses, sorted by ca-order then name.
    // Cached per widget instance; invalidated by the wiki change hook when
    // a tagged tiddler is created / edited / deleted.
    proto._loadLenses = function () {
        if (this._lensesCache) return this._lensesCache;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + LENS_TAG + "]]"
        );
        var lenses = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var slots = {};
            LENS_SLOTS.forEach(function (slot) {
                var filter = f["ca-lens-" + slot + "-filter"] || "";
                var template = f["ca-lens-" + slot + "-template"] || "";
                if (filter || template) {
                    slots[slot] = { filter: filter, template: template };
                }
            });
            var defaultSlots = (f["ca-lens-default"] || "")
                .split(/\s+/).filter(Boolean);
            var stem = title.split("/").pop();
            return {
                title: title,
                name: f["ca-lens-name"] || stem,
                chip: f["ca-lens-chip"] || f["ca-lens-name"] || stem,
                hint: f["ca-lens-hint"] || "",
                help: f["ca-lens-help"] || "",
                when: f["ca-lens-when"] || "",
                actions: f["ca-lens-actions"] || "",
                slots: slots,
                defaultSlots: defaultSlots,
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
        lenses.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this._lensesCache = lenses;
        return lenses;
    };

    proto._invalidateLenses = function () {
        this._lensesCache = null;
        this._projectingLensCache = null;
        if (this._invalidateRowDecorations) this._invalidateRowDecorations();
    };

    // True when the lens's `ca-lens-when` filter is non-empty (or absent).
    // Evaluated with no row binding — a global existence test.
    proto._lensApplies = function (lens) {
        if (!lens.when) return true;
        try {
            var res = this._filterInScope(lens.when, {});
            return !!(res && res.length);
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-lens-when filter error on",
                    lens.title, "—", err && err.message
                );
            }
            return false;
        }
    };

    // Lenses that project `slot` AND currently apply. Cached per wiki
    // change-count so repeated calls within a render are O(1) — every row
    // resolution computes the decoration signature, which walks the slots.
    proto._projectingLenses = function (slot) {
        var cc = (this.wiki.getChangeCount && this.wiki.getChangeCount()) || 0;
        var cache = this._projectingLensCache;
        if (!cache || cache.cc !== cc) {
            cache = this._projectingLensCache = { cc: cc, bySlot: {} };
        }
        if (Object.prototype.hasOwnProperty.call(cache.bySlot, slot)) {
            return cache.bySlot[slot];
        }
        var self = this;
        var res = this._loadLenses().filter(function (l) {
            return l.slots[slot] && self._lensApplies(l);
        });
        cache.bySlot[slot] = res;
        return res;
    };

    proto._lensStateTitle = function (slot) {
        return LENS_STATE_PREFIX + slot;
    };

    // Active lens title for a slot — persisted via state tiddler so reload
    // preserves the pick. First read with no state seeds the slot's default
    // (a projecting lens whose `ca-lens-default` list includes this slot).
    // Returns "" when nothing is active / defaulted (slot stays off).
    proto._readActiveLensTitle = function (slot) {
        var raw = this.wiki.getTiddlerText(this._lensStateTitle(slot), "");
        var stored = (raw || "").trim();
        if (stored) return stored;
        var lenses = this._projectingLenses(slot);
        for (var i = 0; i < lenses.length; i++) {
            if (lenses[i].defaultSlots.indexOf(slot) >= 0) return lenses[i].title;
        }
        return "";
    };

    // The effective lens TITLE for a slot on a given row — channel-aware.
    // Resolution order:
    //   1. the row's channel's baked effective lens (locked → view default;
    //      else channel override; else view default), via item._layerIdx →
    //      activeView.layers[idx].effectiveLens[slot];
    //   2. for a CHANNEL-LESS row (filter / action-menu / synthetic items with
    //      no _layerIdx) the active view's default lens (view.lens[slot]);
    //   3. legacy / transitional fallback — the global per-slot lens state
    //      strip ($:/state/…/lens/<slot>), so the pre-relocation global chooser
    //      keeps working and un-configured views still decorate (this is also
    //      what seeds `ca-lens-default`). Retired once the strips relocate onto
    //      the view (Phase C), after which views carry their own lens fields.
    // Returns "" when nothing projects the slot for this row.
    proto._effectiveLensTitle = function (slot, item) {
        var view = this._getViewByTitle
            ? this._getViewByTitle(this.activeView) : null;
        if (view) {
            var baked = "";
            var ch = (item && item._layerIdx != null && view.layers)
                ? view.layers[item._layerIdx] : null;
            if (ch && ch.effectiveLens &&
                Object.prototype.hasOwnProperty.call(ch.effectiveLens, slot)) {
                baked = ch.effectiveLens[slot] || "";
            } else {
                baked = (view.lens && view.lens[slot]) || "";
            }
            if (baked) return baked;
        }
        return this._readActiveLensTitle(slot);
    };

    // Resolve the active lens object for a slot on a row. Returns null when no
    // lens projects the slot for this row, or the resolved title no longer
    // projects this slot / no longer applies (stale → treated as off, the slot
    // falls back). `item` selects the channel (channel-aware); omit it for the
    // view/global default (used by the decoration signature).
    proto._activeLensForSlot = function (slot, item) {
        var title = this._effectiveLensTitle(slot, item);
        if (!title) return null;
        var lenses = this._projectingLenses(slot);
        for (var i = 0; i < lenses.length; i++) {
            if (lenses[i].title === title) return lenses[i];
        }
        return null;
    };

    // Resolve one slot's projection for a data row. Returns the projected
    // string when the active lens produces a non-empty result; null
    // otherwise (no active lens, non-data row, empty result). Caller
    // (cp-row-decorations) caches by title so a long list doesn't
    // re-evaluate per keystroke. Template projections (rich) are deferred
    // to H4 slice 4 — a slot with only a template resolves to null here.
    proto._resolveSlot = function (slot, item) {
        if (!item || !item.dataRow || !item.title) return null;
        var lens = this._activeLensForSlot(slot, item);
        if (!lens) return null;
        var proj = lens.slots[slot];
        if (!proj || !proj.filter) return null;
        try {
            var results = this._filterInScope(proj.filter, { currentTiddler: item.title });
            if (results && results.length) {
                var first = String(results[0] || "").trim();
                if (first) return first;
            }
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-lens-" + slot + "-filter error on",
                    lens.title, "for", item.title, "—", err && err.message
                );
            }
        }
        return null;
    };

    // The active lens's TEMPLATE projection wikitext for a slot, or null
    // (H4 slice 4). Rich markup case — rendered per visible row by
    // cp-rendering (which owns the document + makeWidget); the cheap string
    // case is `_resolveSlot`. Returns null for non-data rows, no active
    // lens, a filter-based projection, or when the active lens ALSO has a
    // filter for this slot (filter takes precedence — the cheap path wins,
    // so a slot never renders both). The template string is identical for
    // every row (only <currentTiddler> differs at render), so there is
    // nothing to cache here.
    proto._activeSlotTemplate = function (slot, item) {
        if (!item || !item.dataRow || !item.title) return null;
        var lens = this._activeLensForSlot(slot, item);
        if (!lens) return null;
        var proj = lens.slots[slot];
        if (!proj || proj.filter || !proj.template) return null;
        return proj.template;
    };

    /* ---------- actions via lens (H4 slice 3) ---------- */

    // Action TITLES contributed by actions-active lenses for one row, to be
    // unioned into loadActionsForType. A lens is ACTIONS-ACTIVE when
    // `ca-lens-actions` is non-empty AND it applies (`ca-lens-when`) —
    // INDEPENDENT of whether the lens is selected in any decoration slot.
    // This is deliberate: the Kind lens contributes both an icon and the
    // entity-type actions, and those actions must survive turning the Icon
    // slot off (otherwise hiding kind icons would also hide Open / Edit /
    // Delete — a regression vs the pre-lens always-on bridge).
    //
    //   ca-lens-actions: via-entity-type  → declarative marker; the lens
    //       owns the always-on entity-type bridge (catalogue + configured-
    //       field paths in loadActionsForType). Contributes nothing here.
    //   ca-lens-actions: <filter>         → a filter returning ACTION tiddler
    //       titles, run with <currentTiddler> = the row. Lets a lens surface
    //       its own actions on matching rows.
    //
    // Returns a de-duplicated list of titles; the caller still validates each
    // is an action tiddler and applies the `ca-action-when` narrowing.
    proto._lensContributedActionTitles = function (contextTitle) {
        var self = this;
        var titles = [];
        var seen = Object.create(null);
        this._loadLenses().forEach(function (lens) {
            if (!lens.actions) return;
            if (lens.actions === LENS_ACTIONS_VIA_ENTITY_TYPE) return;
            if (!self._lensApplies(lens)) return;
            var res;
            try {
                res = self._filterInScope(lens.actions, {
                    currentTiddler: contextTitle || ""
                });
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-lens-actions filter error on",
                        lens.title, "—", err && err.message
                    );
                }
                return;
            }
            (res || []).forEach(function (title) {
                if (title && !seen[title]) { seen[title] = true; titles.push(title); }
            });
        });
        return titles;
    };

    // Persist the active lens for a slot in the legacy global state tiddler
    // and refresh the result list so decorations appear / vanish immediately.
    // Empty / null / unmatched title clears the slot. Still used by the lens
    // editor (create / clone / delete) — the view/channel lens fields are the
    // primary control now, but this global pick remains the resolution
    // fallback (cp-lenses#_effectiveLensTitle).
    proto._setSlotLens = function (slot, title) {
        var lenses = this._projectingLenses(slot);
        var matched = "";
        for (var i = 0; i < lenses.length; i++) {
            if (lenses[i].title === title) { matched = title; break; }
        }
        this.wiki.addTiddler(new $tw.Tiddler({
            title: this._lensStateTitle(slot),
            text: matched
        }));
        if (this._invalidateRowDecorations) this._invalidateRowDecorations();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
    };

    proto._clearSlotLens = function (slot) {
        this._setSlotLens(slot, "");
    };

    /* ---------- decoration-slot helpers ---------- */
    // Shared by the view→channel tree lens choosers (cp-views#_lensChooserPills):
    // a human label + a friendly chip per slot. The former standalone chooser
    // strips were removed in 0.0.118 when the choosers moved into the tree.

    // Human label per slot.
    var SLOT_LABELS = { name: "Name", icon: "Icon", annotation: "Note" };
    // Chip for the "off" / inherit state. For the name slot "off" means "use
    // the row's intrinsic name"; for the augment slots "no glyph / no badge".
    var SLOT_OFF_CHIP = { name: "(default)", icon: "(off)", annotation: "(off)" };

    proto._lensSlotLabel = function (slot) { return SLOT_LABELS[slot] || slot; };

    // Friendly chip for a lens title (""/unknown → the slot-off chip). Used by
    // the view→channel tree choosers to label the current pick.
    proto._lensChipForTitle = function (title, slot) {
        if (!title) return SLOT_OFF_CHIP[slot] || "(off)";
        var lenses = this._loadLenses();
        for (var i = 0; i < lenses.length; i++) {
            if (lenses[i].title === title) return lenses[i].chip || lenses[i].name;
        }
        return title.split("/").pop();
    };

};
