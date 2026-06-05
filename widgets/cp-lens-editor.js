/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-lens-editor
type: application/javascript
module-type: library

In-palette lens authoring (H4) — create / edit / delete lenses without
hand-authoring tiddlers, reusing the scratchpad + edit-mode model that
backs the view/layer editor (cp-view-editor.js).

A lens scratchpad is a tiddler tagged LENS_TAG under SCRATCHPAD_PREFIX,
carrying the bookkeeping fields `cp-scratch-kind: lens`, `cp-scratch-source`
(origin lens title; "" = brand-new), and `cp-scratch-slot` (the slot the
session is editing). Because it IS tagged LENS_TAG it is discovered by
`_loadLenses`, so making it the active lens for its slot lets the result
list decorate LIVE while the user edits its projection filter — strict
isolation: the original lens (and everything else) stays byte-identical
until commit.

Authoring here edits a slot's `ca-lens-<slot>-filter` (the cheap projection).
Template projections (`-template`) and actions (`ca-lens-actions`) are
authored by hand for now; the live editor covers the common filter case.

Flows (all reached from the ''Manage lenses'' entry — the standalone lens
strips were removed in 0.0.118 when the choosers moved into the Structure
strip's view→channel tree):
  • New      "Manage lenses → + New lens" (NEW_LENS_MESSAGE with a slot) →
             seed a scratch lens projecting the slot with a starter filter →
             edit the filter (live match-count) → name it → save-as-new under
             LENS_NS.
  • Edit     the ''Manage lenses'' list drills each lens into a per-facet
             field editor (`widgets/cp-lens-rows.js` / `cp-lens-edit-rows.js`)
             which bind-edits a USER lens in place; `_cloneLensToUser` clones a
             SHIPPED (shadow-only) lens first so the original survives.
  • Delete   DEL on a user-lens row / the 🗑 Delete row fires
             DELETE_LENS_MESSAGE → `_deleteLens`. Shipped lenses refuse
             deletion (clone & edit instead).

Reuses from cp-view-editor: `_titleTaken`, `_slugTitle`, `_isScratchpadTitle`.
Reuses from cp-firing: `enterEditMode` (editKind "filter" gives the live
"✓ N matches" feedback; `onCommitFn` / `onCancelFn` hooks drive the flow).
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LENS_TAG = C.LENS_TAG;
var LENS_NS = C.LENS_NS;
var LENS_SLOTS = C.LENS_SLOTS;
var SCRATCHPAD_PREFIX = C.SCRATCHPAD_PREFIX;
var SCRATCH_KIND_FIELD = C.SCRATCH_KIND_FIELD;
var SCRATCH_SOURCE_FIELD = C.SCRATCH_SOURCE_FIELD;
var SCRATCH_SLOT_FIELD = "cp-scratch-slot";
var SCRATCH_NAME_SUFFIX = " ✎"; // ✎

// Starter projection filters seeded into a brand-new lens so it projects
// its slot immediately (an empty filter wouldn't register as a projection)
// and the user edits from a sensible template rather than a blank line.
var SLOT_STARTER_FILTER = {
    name: "[<currentTiddler>get[caption]else<currentTiddler>]",
    icon: "[<currentTiddler>get[icon]]",
    annotation: "[<currentTiddler>get[caption]]"
};

module.exports = function (proto) {

    function stripPencil(s) {
        return String(s || "").replace(/\s*✎\s*$/, "").trim();
    }

    // Copy a lens's authoring fields (ca-lens-* + ca-order) from `src` into
    // a fresh field set. Bookkeeping (cp-scratch-*) and tags/type are NOT
    // copied — the caller sets those.
    function copyLensFields(src) {
        var out = {};
        Object.keys(src || {}).forEach(function (k) {
            if (k.indexOf("ca-lens-") === 0 || k === "ca-order") out[k] = src[k];
        });
        return out;
    }

    // ---- scratch identity -------------------------------------------------

    proto._lensScratchTitleFor = function (sourceTitle) {
        var slug = (sourceTitle ? String(sourceTitle).split("/").pop() : "new");
        var base = SCRATCHPAD_PREFIX + slug;
        var title = base + "/lens";
        var n = 2;
        while (this.wiki.tiddlerExists(title)) {
            title = base + "-" + n + "/lens";
            n++;
        }
        return title;
    };

    // Make `lensTitle` the active lens for `slot` for live preview, after
    // remembering the prior pick so discard can restore it.
    proto._selectLensForPreview = function (slot, lensTitle) {
        if (!this._lensPrevSelection) this._lensPrevSelection = {};
        this._lensPrevSelection[slot] = this._readActiveLensTitle(slot);
        this._setSlotLens(slot, lensTitle);
    };

    // ---- New --------------------------------------------------------------

    // Create a scratch lens projecting `slot`, preview it live, and open the
    // projection-filter editor. Returns the scratch title.
    proto._newLensScratchpad = function (slot) {
        slot = (LENS_SLOTS.indexOf(slot) >= 0) ? slot : "name";
        var scratch = this._lensScratchTitleFor("");
        var fields = {
            title: scratch,
            tags: [LENS_TAG],
            type: "text/vnd.tiddlywiki",
            "ca-lens-name": "New lens" + SCRATCH_NAME_SUFFIX
        };
        fields["ca-lens-" + slot + "-filter"] =
            SLOT_STARTER_FILTER[slot] || "[<currentTiddler>]";
        fields[SCRATCH_KIND_FIELD] = "lens";
        fields[SCRATCH_SOURCE_FIELD] = "";
        fields[SCRATCH_SLOT_FIELD] = slot;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        this._lensScratchTitle = scratch;
        if (this._invalidateLenses) this._invalidateLenses();
        this._selectLensForPreview(slot, scratch);
        this._editLensFilter(slot, scratch);
        return scratch;
    };

    // ---- Edit -------------------------------------------------------------
    // (In-place editing of an existing lens is done from "Manage lenses" — the
    // per-lens field drill in cp-lens-rows / cp-lens-edit-rows binds each
    // ca-lens-* facet directly; a shipped lens is cloned first via
    // _cloneLensToUser. The former strip-driven `e`-to-edit clone-and-commit
    // flow — _beginLensEdit / _commitLensEdit / _overwriteLens — was removed in
    // 0.0.118 with the standalone lens strips.)

    // Open the raw-filter editor on the new scratch lens's
    // `ca-lens-<slot>-filter` (editKind "filter" → live match count). On commit,
    // re-decorate and prompt for a name → save-as-new; on cancel, discard.
    proto._editLensFilter = function (slot, scratchTitle) {
        var self = this;
        var t = this.wiki.getTiddler(scratchTitle);
        var f = (t && t.fields) || {};
        var label = this._lensSlotLabel ? this._lensSlotLabel(slot) : slot;
        this.enterEditMode({
            bindTiddler: scratchTitle,
            bindField: "ca-lens-" + slot + "-filter",
            kind: "text",
            editKind: "filter",
            name: label + " projection filter",
            initialValue: f["ca-lens-" + slot + "-filter"] || "",
            returnFocus: "input",
            onCommitFn: function () {
                if (self._invalidateLenses) self._invalidateLenses();
                var top = self.topStage && self.topStage();
                if (top) { self.recomputeStage(top); self.renderStage(); }
                self._promptLensName(slot, scratchTitle);
            },
            onCancelFn: function () {
                self._discardLensScratch(slot, scratchTitle);
            }
        });
    };

    // Prompt for a display name (new lenses only), then save-as-new.
    proto._promptLensName = function (slot, scratchTitle) {
        var self = this;
        var t = this.wiki.getTiddler(scratchTitle);
        var f = (t && t.fields) || {};
        this.enterEditMode({
            bindTiddler: scratchTitle,
            bindField: "ca-lens-name",
            kind: "text",
            editKind: "text",
            name: "New lens name",
            initialValue: stripPencil(f["ca-lens-name"]),
            returnFocus: "input",
            onCommitFn: function (name) {
                self._finalizeLensSaveAsNew(slot, scratchTitle, name);
            },
            onCancelFn: function () {
                self._discardLensScratch(slot, scratchTitle);
            }
        });
    };

    // ---- Commit -----------------------------------------------------------

    proto._finalizeLensSaveAsNew = function (slot, scratchTitle, rawName) {
        var name = stripPencil(rawName) || "Custom lens";
        var st = this.wiki.getTiddler(scratchTitle);
        var sf = (st && st.fields) || {};
        var newTitle = this._slugTitle(name, LENS_NS);
        this._writeNewLens(newTitle, sf, name);
        this.wiki.deleteTiddler(scratchTitle);
        this._lensScratchTitle = null;
        if (this._invalidateLenses) this._invalidateLenses();
        this._setSlotLens(slot, newTitle);
        this._afterLensCommit(slot);
    };

    proto._writeNewLens = function (newTitle, scratchFields, name) {
        var fields = copyLensFields(scratchFields);
        fields.title = newTitle;
        fields.tags = [LENS_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-lens-name"] = stripPencil(name) || stripPencil(scratchFields["ca-lens-name"]) || "Custom lens";
        delete fields["ca-lens-default"]; // a fresh user lens isn't a default
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        return newTitle;
    };

    // Clone a SHIPPED (shadow-only) lens to an editable USER lens under
    // LENS_NS, so the per-lens field drill can edit its facets in place
    // without mutating the shadow. Returns the new title. The "Manage
    // lenses" reopen is fired declaratively after this message.
    proto._cloneLensToUser = function (lensTitle) {
        var src = this.wiki.getTiddler(lensTitle);
        if (!src) return null;
        var sf = src.fields || {};
        var baseName = (sf["ca-lens-name"] || lensTitle.split("/").pop()) + " (copy)";
        var newTitle = this._slugTitle(baseName, LENS_NS);
        var fields = copyLensFields(sf);
        fields.title = newTitle;
        fields.tags = [LENS_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-lens-name"] = baseName;
        delete fields["ca-lens-default"]; // a fresh user copy isn't a default
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        if (this._invalidateLenses) this._invalidateLenses();
        return newTitle;
    };

    // ---- Discard / Delete -------------------------------------------------

    proto._discardLensScratch = function (slot, scratchTitle) {
        scratchTitle = scratchTitle || this._lensScratchTitle;
        if (!scratchTitle) return;
        this.wiki.deleteTiddler(scratchTitle);
        this._lensScratchTitle = null;
        if (this._invalidateLenses) this._invalidateLenses();
        // Restore the slot's prior pick (or off) so discard changes nothing.
        var prev = (this._lensPrevSelection && this._lensPrevSelection[slot]) || "";
        this._setSlotLens(slot, prev);
        this._afterLensCommit(slot);
    };

    // Delete a user lens. Shipped (shadow-only) lenses can't be deleted —
    // they'd reappear from the plugin — so refuse with a hint (clone instead).
    proto._deleteLens = function (lensTitle) {
        if (!lensTitle) return false;
        if (this.wiki.isShadowTiddler(lensTitle) && !this.wiki.tiddlerExists(lensTitle)) {
            if (this.hintEl) {
                this.hintEl.textContent =
                    "Shipped lenses can't be deleted — press e to clone & edit instead.";
            }
            return false;
        }
        var self = this;
        // Clear any slot whose active pick is this lens (→ falls back to default/off).
        LENS_SLOTS.forEach(function (slot) {
            if (self._readActiveLensTitle(slot) === lensTitle) self._setSlotLens(slot, "");
        });
        this.wiki.deleteTiddler(lensTitle);
        if (this._invalidateLenses) this._invalidateLenses();
        // The change hook re-renders the Structure strip choosers + rows.
        return true;
    };

    // ---- shared tail ------------------------------------------------------

    // After an authoring commit / discard: refresh the view→channel tree
    // choosers + the decorated rows, and return focus to the input. (`slot`
    // is retained for signature stability with the call sites.)
    proto._afterLensCommit = function (slot) {
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        var top = this.topStage && this.topStage();
        if (top) { this.recomputeStage(top); this.renderStage(); }
        if (this.setFocus) this.setFocus("input");
    };

};
