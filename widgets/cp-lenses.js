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

    // Resolve the active lens object for a slot. Returns null when no lens
    // is active, or the stored title no longer projects this slot / no
    // longer applies (stale state → treated as off, the slot falls back).
    proto._activeLensForSlot = function (slot) {
        var title = this._readActiveLensTitle(slot);
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
        var lens = this._activeLensForSlot(slot);
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

    // Persist a new active lens for a slot and refresh. Empty / null /
    // unmatched title clears the slot (single-select "off"). Re-renders the
    // slot's chooser strip + the result list so decorations appear / vanish
    // immediately.
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
        if (this._renderLensStrip) this._renderLensStrip(slot);
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
    };

    proto._clearSlotLens = function (slot) {
        this._setSlotLens(slot, "");
    };

    /* ---------- per-slot selector strips (UI) ---------- */

    // Human label shown at the head of each slot's chooser strip.
    var SLOT_LABELS = { name: "Name", icon: "Icon", annotation: "Note" };
    // Sentinel title for the trailing "+ New…" authoring pill (never a real
    // lens; handlers branch on `entry.isNew`).
    var LENS_NEW_SENTINEL = "$:/cp-lens-new-sentinel";
    // Chip for the synthetic "off" entry at index 0 of each strip. For the
    // name slot "off" means "use the row's intrinsic name" (a default), for
    // the augment slots it means "no glyph / no badge".
    var SLOT_OFF_CHIP = { name: "(default)", icon: "(off)", annotation: "(off)" };

    proto._lensSlotLabel = function (slot) { return SLOT_LABELS[slot] || slot; };

    // The strip DOM element for a slot, created lazily by the widget setup
    // into `this._lensStripEls`. Returns null before the popup is built.
    proto._lensStripEl = function (slot) {
        return this._lensStripEls ? this._lensStripEls[slot] : null;
    };

    proto._lensFocusIdxGet = function (slot) {
        if (!this._lensFocusIdx) this._lensFocusIdx = {};
        return this._lensFocusIdx[slot] || 0;
    };
    proto._lensFocusIdxSet = function (slot, i) {
        if (!this._lensFocusIdx) this._lensFocusIdx = {};
        this._lensFocusIdx[slot] = i;
    };

    // Entries rendered in a slot's strip: a synthetic "off" head at index 0,
    // the projecting lenses, then a trailing "+ New…" authoring sentinel.
    // Index 0 → clear; middle → lens; last (isNew) → create a new lens.
    proto._lensStripEntries = function (slot) {
        var lenses = this._projectingLenses(slot);
        if (!lenses.length) return [];
        var off = {
            title: "",
            chip: SLOT_OFF_CHIP[slot] || "(off)",
            hint: slot === "name"
                ? "Use each row's default name (no override)."
                : "No " + (slot === "icon" ? "leading icon" : "annotation") + " (slot off)."
        };
        var add = {
            title: LENS_NEW_SENTINEL,
            isNew: true,
            chip: "➕ New…",
            hint: "Create a new " + this._lensSlotLabel(slot).toLowerCase() +
                " lens (type its projection filter; live preview)."
        };
        return [off].concat(lenses).concat([add]);
    };

    // Count drives strip visibility + cycle membership. 0 = no projecting
    // lenses → strip hidden + excluded from the Tab cycle (like row-label).
    proto._lensPillCount = function (slot) {
        return this._lensStripEntries(slot).length;
    };

    proto._renderLensStrip = function (slot) {
        var stripEl = this._lensStripEl(slot);
        if (!stripEl) return;
        while (stripEl.firstChild) stripEl.removeChild(stripEl.firstChild);
        var entries = this._lensStripEntries(slot);
        var hasAny = entries.length > 0;
        if (this.popupEl) {
            this.popupEl.classList.toggle("rcp-has-lens-" + slot, hasAny);
        }
        if (!hasAny) return;
        var self = this;
        var active = this._readActiveLensTitle(slot);
        // Non-interactive slot label at the head so the user always knows
        // which decoration this chooser controls.
        var labelEl = this.document.createElement("span");
        labelEl.className = "rcp-lens-strip-label";
        labelEl.textContent = this._lensSlotLabel(slot);
        stripEl.appendChild(labelEl);
        // Clamp focus into the rebuilt list; on first render anchor on the
        // active entry so ↵/Space re-applies rather than overriding silently.
        var fi = this._lensFocusIdxGet(slot);
        if (fi === undefined || fi < 0 || fi >= entries.length) {
            var startIdx = 0;
            if (active) {
                for (var k = 0; k < entries.length; k++) {
                    if (entries[k].title === active) { startIdx = k; break; }
                }
            }
            this._lensFocusIdxSet(slot, startIdx);
        }
        var focusIdx = this._lensFocusIdxGet(slot);
        var section = "lens-" + slot;
        entries.forEach(function (entry, i) {
            var pillEl = self.document.createElement("span");
            var cls = "rcp-lens-pill";
            if (entry.isNew) cls += " rcp-lens-pill-new";
            if (!entry.isNew && entry.title === active) cls += " rcp-lens-pill-active";
            if (self.focus === section && i === focusIdx) {
                cls += " rcp-lens-pill-focused";
            }
            pillEl.className = cls;
            pillEl.textContent = entry.chip;
            if (entry.hint) pillEl.title = entry.hint;
            pillEl.dataset.lensIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self._lensFocusIdxSet(slot, i);
                if (entry.isNew) {
                    if (self._newLensScratchpad) self._newLensScratchpad(slot);
                } else {
                    self._setSlotLens(slot, entry.title);
                    self.setFocus(section);
                }
            });
            stripEl.appendChild(pillEl);
        });
    };

    // Re-render every slot strip — used by the open lifecycle + change hook.
    proto._renderAllLensStrips = function () {
        var self = this;
        LENS_SLOTS.forEach(function (slot) { self._renderLensStrip(slot); });
    };

    // Help line under the strip for the focused entry (mirrors the former
    // row-label help). Index 0 is the synthetic "off" entry.
    proto._maybeRenderLensHelp = function (slot) {
        if (this.focus !== "lens-" + slot) return;
        var lenses = this._projectingLenses(slot);
        if (!lenses.length) return;
        var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
        var entries = this._lensStripEntries(slot);
        var idx = this._lensFocusIdxGet(slot);
        if (idx === 0) {
            pillstrip.renderConstraintHelp(this, {
                title: SLOT_OFF_CHIP[slot] || "(off)",
                help: slot === "name"
                    ? "Clear the active name lens. Rows fall back to whatever name the view / next-scope path assigned (typically the tiddler caption or title)."
                    : "Turn the " + this._lensSlotLabel(slot) + " slot off — rows show no lens-supplied " + (slot === "icon" ? "leading glyph" : "annotation") + ".",
                rows: []
            });
            return;
        }
        if (entries[idx] && entries[idx].isNew) {
            pillstrip.renderConstraintHelp(this, {
                title: "➕ New " + this._lensSlotLabel(slot).toLowerCase() + " lens",
                help: "Create a new lens projecting the " + this._lensSlotLabel(slot) +
                    " slot. ↵ / Space opens a raw-filter editor (live '✓ N matches'); " +
                    "the rows decorate as you type. Commit names it and saves it as a new lens.",
                rows: [
                    ["Gesture", "↵ / Space  create · e edit focused lens · Shift-DEL delete"]
                ]
            });
            return;
        }
        var lens = lenses[idx - 1];
        if (!lens) return;
        var proj = lens.slots[slot] || {};
        pillstrip.renderConstraintHelp(this, {
            title: lens.chip || lens.name,
            help: lens.help || lens.hint ||
                ("Project the " + this._lensSlotLabel(slot) + " slot using this lens."),
            rows: [
                ["Slot", this._lensSlotLabel(slot)],
                [proj.template ? "Template" : "Filter",
                 proj.template || proj.filter || "—"],
                ["Lens", lens.title]
            ]
        });
    };

};
