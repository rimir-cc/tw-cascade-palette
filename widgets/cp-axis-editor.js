/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-axis-editor.js
type: application/javascript
module-type: library

In-palette axis create / clone / delete (Phase 3), mirroring cp-lens-editor.

An axis is a tiddler tagged AXIS_TAG carrying a grouping spec: `ca-axis-key`
(per-row filter → bucket key, `<currentTiddler>` = the row, with optional
`<axis-param-X>` placeholders), plus `ca-axis-label` / `-sort` /
`-sort-keys` / `-empty-label` / `-icon` / `-name` / `-hint`. Axes are the
reusable group-by parts composed into a layer's chain in the Structure
strip; this module owns their lifecycle:

  • New     "+ New axis…" (NEW_AXIS_MESSAGE) seeds a scratch axis with a
            starter `ca-axis-key`, opens the raw-filter editor (editKind
            "filter" → live "✓ N matches"), then prompts a name and saves
            it under AXES_NS — the transparent, filter-first creation flow.
  • Edit    per-facet field editing happens IN PLACE via the declarative
            `cp-axis-edit-rows` bind rows (the "Manage axes" drill); a
            SHIPPED (shadow-only) axis is clone-protected — `_cloneAxisToUser`
            copies it to AXES_NS first.
  • Delete  DEL / ca-on-delete on a user axis → confirm → `_deleteAxis`.
            Shipped axes refuse deletion (clone & edit instead).

Reuses from cp-view-editor: `_titleTaken`, `_slugTitle`. Reuses from
cp-firing: `enterEditMode` (editKind "filter" gives the live count;
`onCommitFn` / `onCancelFn` drive the flow). Reopens the "Manage axes" list
via `openPaletteAtEntry` after a create/clone so the result is visible.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var AXIS_TAG = C.AXIS_TAG;
var AXES_NS = C.AXES_NS;
var SCRATCHPAD_PREFIX = C.SCRATCHPAD_PREFIX;
var SCRATCH_KIND_FIELD = C.SCRATCH_KIND_FIELD;
var SCRATCH_SOURCE_FIELD = C.SCRATCH_SOURCE_FIELD;
var SCRATCH_NAME_SUFFIX = " ✎";
var MANAGE_AXES_ENTRY = "$:/plugins/rimir/cascade-palette/entries/manage-axes";

// Starter grouping seeded into a brand-new axis so it buckets immediately
// (an empty key wouldn't group anything) and the user edits from a sensible
// template rather than a blank line.
var AXIS_STARTER_KEY = "[<currentTiddler>get[modified]format:date[YYYY]]";

module.exports = function (proto) {

    function stripPencil(s) {
        return String(s || "").replace(/\s*✎\s*$/, "").trim();
    }

    // Copy an axis's authoring fields (ca-axis-* + ca-order) from `src` into
    // a fresh field set. Bookkeeping (cp-scratch-*) and tags/type are NOT
    // copied — the caller sets those.
    function copyAxisFields(src) {
        var out = {};
        Object.keys(src || {}).forEach(function (k) {
            if (k.indexOf("ca-axis-") === 0 || k === "ca-order") out[k] = src[k];
        });
        return out;
    }

    // ---- scratch identity -------------------------------------------------

    proto._axisScratchTitleFor = function (sourceTitle) {
        var slug = (sourceTitle ? String(sourceTitle).split("/").pop() : "new");
        var base = SCRATCHPAD_PREFIX + slug;
        var title = base + "/axis";
        var n = 2;
        while (this.wiki.tiddlerExists(title)) {
            title = base + "-" + n + "/axis";
            n++;
        }
        return title;
    };

    // ---- New --------------------------------------------------------------

    // Create a scratch axis with a starter key and open the raw-filter editor
    // (live match count). On commit → prompt a name → save-as-new under
    // AXES_NS; on cancel → discard. Returns the scratch title.
    proto._newAxisScratchpad = function () {
        var scratch = this._axisScratchTitleFor("");
        this.wiki.addTiddler(new $tw.Tiddler({
            title: scratch,
            tags: [AXIS_TAG],
            type: "text/vnd.tiddlywiki",
            "ca-axis-name": "New axis" + SCRATCH_NAME_SUFFIX,
            "ca-axis-key": AXIS_STARTER_KEY,
            "ca-axis-sort": "asc",
            "ca-axis-empty-label": "(no value)"
        }));
        this._axisScratchTitle = scratch;
        this._editAxisKey(scratch, true);
        return scratch;
    };

    // ---- Edit-key (the live-count filter editor) --------------------------

    // Open the raw-filter editor on the scratch's `ca-axis-key` (editKind
    // "filter" → live "✓ N matches"). On commit prompt a name (new); on
    // cancel discard the scratch.
    proto._editAxisKey = function (scratchTitle, isNew) {
        var self = this;
        var t = this.wiki.getTiddler(scratchTitle);
        var f = (t && t.fields) || {};
        this.enterEditMode({
            bindTiddler: scratchTitle,
            bindField: "ca-axis-key",
            kind: "text",
            editKind: "filter",
            name: "Axis grouping key (per-row filter → bucket key)",
            initialValue: f["ca-axis-key"] || "",
            returnFocus: "menu",
            onCommitFn: function () {
                if (isNew) self._promptAxisName(scratchTitle);
            },
            onCancelFn: function () {
                self._discardAxisScratch(scratchTitle);
            }
        });
    };

    // Prompt for a display name, then save-as-new.
    proto._promptAxisName = function (scratchTitle) {
        var self = this;
        var t = this.wiki.getTiddler(scratchTitle);
        var f = (t && t.fields) || {};
        this.enterEditMode({
            bindTiddler: scratchTitle,
            bindField: "ca-axis-name",
            kind: "text",
            editKind: "text",
            name: "New axis name",
            initialValue: stripPencil(f["ca-axis-name"]),
            returnFocus: "menu",
            onCommitFn: function (name) {
                self._finalizeAxisSaveAsNew(scratchTitle, name);
            },
            onCancelFn: function () {
                self._discardAxisScratch(scratchTitle);
            }
        });
    };

    proto._finalizeAxisSaveAsNew = function (scratchTitle, rawName) {
        var name = stripPencil(rawName) || "Custom axis";
        var st = this.wiki.getTiddler(scratchTitle);
        var sf = (st && st.fields) || {};
        var newTitle = this._slugTitle(name, AXES_NS);
        var fields = copyAxisFields(sf);
        fields.title = newTitle;
        fields.tags = [AXIS_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-axis-name"] = name;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        this.wiki.deleteTiddler(scratchTitle);
        this._axisScratchTitle = null;
        this._reopenManageAxes();
        return newTitle;
    };

    // ---- Clone (shipped → editable user copy) -----------------------------

    // Clone a SHIPPED (shadow-only) axis to an editable USER axis under
    // AXES_NS so the per-axis field drill can edit its facets in place
    // without mutating the shadow. Returns the new title.
    proto._cloneAxisToUser = function (axisTitle) {
        var src = this.wiki.getTiddler(axisTitle);
        if (!src) return null;
        var sf = src.fields || {};
        var baseName = (sf["ca-axis-name"] || axisTitle.split("/").pop()) + " (copy)";
        var newTitle = this._slugTitle(baseName, AXES_NS);
        var fields = copyAxisFields(sf);
        fields.title = newTitle;
        fields.tags = [AXIS_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-axis-name"] = baseName;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        return newTitle;
    };

    // ---- Discard / Delete -------------------------------------------------

    proto._discardAxisScratch = function (scratchTitle) {
        scratchTitle = scratchTitle || this._axisScratchTitle;
        if (!scratchTitle) return;
        this.wiki.deleteTiddler(scratchTitle);
        this._axisScratchTitle = null;
    };

    // Delete a user axis. Shipped (shadow-only) axes can't be deleted — they
    // would reappear from the plugin — so refuse with a hint (clone instead).
    // A deleted axis still referenced in a layer's chain resolves to a
    // fallback label (the loader is defensive), so no chain rewrite is needed.
    proto._deleteAxis = function (axisTitle) {
        if (!axisTitle) return false;
        if (this.wiki.isShadowTiddler(axisTitle) && !this.wiki.tiddlerExists(axisTitle)) {
            if (this.hintEl) {
                this.hintEl.textContent =
                    "Shipped axes can't be deleted — clone & edit instead.";
            }
            return false;
        }
        this.wiki.deleteTiddler(axisTitle);
        return true;
    };

    // ---- shared tail ------------------------------------------------------

    proto._reopenManageAxes = function () {
        if (this.openPaletteAtEntry) this.openPaletteAtEntry(MANAGE_AXES_ENTRY);
    };

};
