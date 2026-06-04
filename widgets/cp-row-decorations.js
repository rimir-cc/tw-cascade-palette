/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-row-decorations
type: application/javascript
module-type: library

Row-decoration resolution (H4) — the single per-row pass that fills a
row's decoration slots from the active lenses (cp-lenses.js):

  name       (replace)       ← active name-slot lens
  icon       (augment-lead)  ← active icon-slot lens
  annotation (augment-trail) ← active annotation-slot lens (templates: slice 4)

Replaces the two former render-time lookups (row-label + structure-toggle
row icon) with ONE merged, cross-render cache. The cache is keyed by
(selection signature, wiki.getChangeCount()) so it PERSISTS across input
keystrokes — typing changes neither the active per-slot lens picks nor the
wiki change-count — and rebuilds only when the user changes a slot's lens
or any tiddler is written. Each slot is resolved only for VISIBLE /
rendered data rows (≤ max-results).

This is the performance foundation for the lens model: a slot projection
(even a relational / template one) is evaluated ~once per row per
data-change, not once per row per keystroke (the previous per-renderResults
reset re-ran it on every keystroke). The actual per-slot filter evaluation
lives in cp-lenses.js#_resolveSlot; this module is the orchestrator + cache.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LENS_SLOTS = C.LENS_SLOTS;

// Shared sentinel for rows that carry no decorations — never cached, so
// callers must treat it as read-only.
var EMPTY = { name: null, icon: null, annotation: null };

module.exports = function (proto) {

    // Signature of the active per-slot lens selections. Changing which
    // lens is active in any slot flips this — forcing a rebuild even when
    // the wiki change-count hasn't advanced (e.g. a default seeded without
    // a tiddler write).
    proto._decorationSignature = function () {
        var parts = [];
        for (var i = 0; i < LENS_SLOTS.length; i++) {
            var slot = LENS_SLOTS[i];
            var lens = this._activeLensForSlot ? this._activeLensForSlot(slot) : null;
            parts.push(slot + ":" + (lens ? lens.title : ""));
        }
        return parts.join("|");
    };

    proto._invalidateRowDecorations = function () {
        this._rowDecorationCache = null;
    };

    // Resolve all decoration slots for a row. Returns the shared EMPTY for
    // non-data / title-less rows (not cached). Otherwise cached by title
    // under the current (signature, change-count) generation.
    proto._resolveRowDecorations = function (item) {
        if (!item || !item.dataRow || !item.title) return EMPTY;
        var sig = this._decorationSignature();
        var cc = (this.wiki.getChangeCount && this.wiki.getChangeCount()) || 0;
        var cache = this._rowDecorationCache;
        if (!cache || cache.sig !== sig || cache.cc !== cc) {
            cache = this._rowDecorationCache = { sig: sig, cc: cc, byTitle: {} };
        }
        if (Object.prototype.hasOwnProperty.call(cache.byTitle, item.title)) {
            return cache.byTitle[item.title];
        }
        // Resolve each slot via its active lens (cp-lenses#_resolveSlot).
        // Slots without an active lens return null → the renderer falls
        // back to the row's intrinsic name / icon.
        var deco = {
            name: this._resolveSlot ? this._resolveSlot("name", item) : null,
            icon: this._resolveSlot ? this._resolveSlot("icon", item) : null,
            annotation: this._resolveSlot ? this._resolveSlot("annotation", item) : null
        };
        cache.byTitle[item.title] = deco;
        return deco;
    };

};
