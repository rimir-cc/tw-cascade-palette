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
            // No-item call → the view/global default lens for the slot.
            var lens = this._activeLensForSlot ? this._activeLensForSlot(slot) : null;
            parts.push(slot + ":" + (lens ? lens.title : ""));
        }
        // Fold in the active view's per-channel EFFECTIVE lenses so the same
        // tiddler decorated under two channels caches separately, and a view
        // switch / reload (which re-bakes effectiveLens) invalidates the cache.
        // Effective lenses change only on view load → wiki change-count bump,
        // so this is stable across keystrokes.
        var view = this._getViewByTitle
            ? this._getViewByTitle(this.activeView) : null;
        if (view && view.layers) {
            parts.push("view:" + view.title);
            for (var j = 0; j < view.layers.length; j++) {
                var ch = view.layers[j];
                if (!ch || !ch.effectiveLens) continue;
                var slots = [];
                for (var k = 0; k < LENS_SLOTS.length; k++) {
                    slots.push(LENS_SLOTS[k] + "=" +
                        (ch.effectiveLens[LENS_SLOTS[k]] || ""));
                }
                parts.push(j + "{" + slots.join(",") + "}");
            }
        }
        return parts.join("|");
    };

    proto._invalidateRowDecorations = function () {
        this._rowDecorationCache = null;
        // Rendered template-projection HTML (cp-rendering) shares this
        // generation; drop it together so a lens change clears both.
        this._slotTemplateHtmlCache = null;
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
            cache = this._rowDecorationCache = { sig: sig, cc: cc, byKey: {} };
        }
        // Key by CHANNEL + title: the same tiddler in two channels can resolve
        // to different lenses (channel-aware resolution), so title alone is not
        // a safe cache key. Channel-less rows share the "_" bucket.
        var key = (item._layerIdx != null ? item._layerIdx : "_") + "::" + item.title;
        if (Object.prototype.hasOwnProperty.call(cache.byKey, key)) {
            return cache.byKey[key];
        }
        // Resolve each slot via its active lens (cp-lenses#_resolveSlot).
        // Slots without an active lens return null → the renderer falls
        // back to the row's intrinsic name / icon.
        var deco = {
            name: this._resolveSlot ? this._resolveSlot("name", item) : null,
            icon: this._resolveSlot ? this._resolveSlot("icon", item) : null,
            annotation: this._resolveSlot ? this._resolveSlot("annotation", item) : null
        };
        cache.byKey[key] = deco;
        return deco;
    };

};
