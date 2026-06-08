/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-view-editor
type: application/javascript
module-type: library

In-palette definition editor (Phase 1 — views).

The editor lets a power-user create / modify custom VIEWS and define their
structure transparently, expressed through raw TW filters, with the result
visible live in the result list.

SCRATCHPAD MODEL (isolation guarantee)
--------------------------------------
Persisted definition tiddlers are read-only. Editing happens ONLY on a
session-only scratchpad copy under SCRATCHPAD_PREFIX. Nothing in a
scratchpad touches the originating definition — or any view — until the
user explicitly commits. Editing a pill on a non-scratchpad view clones
the view into a scratchpad first, then edits the clone; the scratchpad
becomes the active view so the result list IS the live preview.

Commit choices (user controls the blast radius):
  - save-as-new : write a brand-new view; nothing else affected.
  - overwrite   : write back over the source; all consumers reflect it.
  - discard     : delete the scratchpad; nothing changed anywhere.

Phase 1 scope: implicit-layer views (every structural facet is a
`ca-view-*` field on the view tiddler itself — covers All tiddlers,
Entries, By date / namespace / parent).

Phase 2 — shared (explicit) layers as reusable parts. Editing a shared
layer pill (e.g. Tag tree / Path tree on Hybrid) clones the LAYER into
its own scratchpad AND a previewing-view scratchpad whose ca-view-layers
references the clone, so the edit previews live without touching either
original. Each edited layer gets its OWN commit pills at the end of its row
(save-as-new / overwrite — with a "used by N views" consumer count —
/ discard); several layers can be edited and committed independently. The
preview carrier is torn down once its last layer edit resolves. See
_beginLayerEdit / _commitLayer / _layerCommitPillsFor. The built-in entries
layer carries no editable structure.

Reuses the settings-row binding substrate (writeBoundValue / readBoundValue
/ clearBoundField in cp-items.js) and the edit-mode input (enterEditMode /
exitEditMode in cp-firing.js, extended with a `filter` editKind that shows
a live match-count). Structural facets map onto `ca-view-*` fields via
`_pillEditDescriptor`.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");
var parseChainSpec =
    require("$:/plugins/rimir/cascade-palette/widgets/cp-axes").parseChainSpec;
var VIEW_TAG = C.VIEW_TAG;
var STRUCTURE_LAYER_TAG = C.STRUCTURE_LAYER_TAG;
var CHANNEL_TAG = C.CHANNEL_TAG;
var AXIS_TAG = C.AXIS_TAG;
var SCRATCHPAD_PREFIX = C.SCRATCHPAD_PREFIX;
var SCRATCH_KIND_FIELD = C.SCRATCH_KIND_FIELD;
var SCRATCH_SOURCE_FIELD = C.SCRATCH_SOURCE_FIELD;
var SCRATCH_PREVIEW_ONLY_FIELD = C.SCRATCH_PREVIEW_ONLY_FIELD;
var VIEWS_NS = C.VIEWS_NS;
var CHANNELS_NS = C.CHANNELS_NS;
var AXES_NS = C.AXES_NS;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

// Suffix appended to a scratchpad view's display name so the active-view
// pill makes the editing state obvious.
var SCRATCH_NAME_SUFFIX = " ✎"; // ✎

// The built-in synthetic entries channel's descriptor title — excluded from
// the channel picker (it's auto-appended, not composed by reference).
var BUILTIN_ENTRIES_LAYER_TITLE =
    "$:/plugins/rimir/cascade-palette/channels/entries";

// Dual-read helpers shared with the parser + drills (cp-utils): prefer the
// ca-channel-* / ca-view-channels namespace, fall back to the legacy fields.
// WRITES here always use the new namespace.
var channelField = utils.channelField;
var viewChannelsRaw = utils.viewChannelsRaw;

// Map a structural pill kind → the ca-view-* field it edits, for implicit
// layers (where structure lives on the view tiddler). Filter-valued kinds
// edit as raw filter text with a live match-count; the rest as plain text.
var VIEW_FILTER_FIELD = {
    "roots":       "ca-view-roots",
    "children":    "ca-view-children",
    "leaf":        "ca-view-leaf",
    "label":       "ca-view-label",
    "entity-type": "ca-view-row-entity-type",
    "row-name":    "ca-view-row-name",
    "row-group":   "ca-view-row-group",
    "row-kind":    "ca-view-row-kind"
};
var VIEW_TEXT_FIELD = {
    "actions": "ca-view-row-actions"
};

// H2: ca-view-* structural suffixes that move onto a migrated layer
// (ca-view-<suffix> → ca-layer-<suffix>) when an implicit view is converted
// to explicit layers. View-level policy fields (sort, grouping, pick, order,
// include-entries, name/hint, …) stay on the view and are NOT listed here.
var MIGRATE_STRUCT_SUFFIXES = [
    "roots", "children", "leaf", "label", "axes",
    "row-name", "row-hint", "row-icon", "row-kind", "row-group",
    "row-order", "row-actions", "row-entity-type", "row-next-scope",
    "row-items-from"
];

module.exports = function (proto) {

    // ===================================================================
    // Scratchpad identity
    // ===================================================================

    // The active view, IF it is a scratchpad (its tiddler carries the
    // bookkeeping kind field). Otherwise null.
    proto._scratchpadView = function () {
        var v = this._getViewByTitle && this._getViewByTitle(this.activeView);
        if (!v) return null;
        var t = this.wiki.getTiddler(v.title);
        if (t && t.fields && t.fields[SCRATCH_KIND_FIELD]) return v;
        return null;
    };

    // While a scratchpad is the active definition the Structure strip is
    // "pinned" expanded: it stays open even when focus leaves the strip,
    // so the user can edit a facet, jump to the result list / side preview
    // to inspect the effect, and come back without re-expanding. In normal
    // (non-scratchpad) mode the strip still auto-collapses on blur.
    proto._structurePinned = function () {
        return !!this._scratchpadView();
    };

    // Collision-safe title under `prefix` derived from `name`. Mirrors
    // cp-pick-presets `_capturePreset` slugging. The collision check MUST
    // include shadows: shipped views/layers/axes live in this same
    // namespace as plugin shadows, and `tiddlerExists` is false for a pure
    // shadow — so a "save as new" named after a shipped view would
    // otherwise slug onto the shadow's title and silently write an OVERRIDE
    // instead of a fresh definition (the symptom: the original view
    // "disappears", replaced by the override).
    proto._titleTaken = function (title) {
        return this.wiki.tiddlerExists(title) || this.wiki.isShadowTiddler(title);
    };
    proto._slugTitle = function (name, prefix) {
        var slug = String(name || "")
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "");
        if (!slug) slug = "view";
        var base = prefix + slug;
        var title = base;
        var n = 2;
        while (this._titleTaken(title) && n < 1000) {
            title = base + "-" + n;
            n++;
        }
        return title;
    };

    // Reload the view descriptors after a definition tiddler changed,
    // WITHOUT letting _loadViews reset the active view to the default.
    proto._reloadViewsPreservingActive = function () {
        var keep = this.activeView;
        this._viewsLoaded = false;
        this._loadViews();
        if (keep && this._getViewByTitle(keep)) {
            this.activeView = keep;
        }
    };

    // ===================================================================
    // Clone → scratchpad
    // ===================================================================

    // Clone a persisted view into a fresh scratchpad and make it active.
    // Returns the scratchpad view title, or null on failure.
    proto._cloneViewToScratchpad = function (sourceTitle) {
        var srcView = this._getViewByTitle(sourceTitle);
        if (!srcView) return null;
        var srcTid = this.wiki.getTiddler(sourceTitle);
        var srcFields = (srcTid && srcTid.fields) || {};

        // Unique scratchpad title: <prefix><source-slug>[-n]/view
        var slug = String(sourceTitle).split("/").pop() || "view";
        var base = SCRATCHPAD_PREFIX + slug;
        var stem = base;
        var n = 2;
        while (this.wiki.tiddlerExists(stem + "/view")) {
            stem = base + "-" + n;
            n++;
        }
        var scratchTitle = stem + "/view";

        var fields = { title: scratchTitle };
        Object.keys(srcFields).forEach(function (k) {
            if (k.indexOf("ca-view-") === 0 || k === "ca-order" || k === "ca-icon") {
                fields[k] = srcFields[k];
            }
        });
        // Normalize a legacy composed-channels list onto the new field so the
        // scratchpad (and everything the editor reads off it) uses new vocab.
        if (fields["ca-view-layers"] !== undefined) {
            if (fields["ca-view-channels"] === undefined) {
                fields["ca-view-channels"] = fields["ca-view-layers"];
            }
            delete fields["ca-view-layers"];
        }
        // Never inherit "default view" status onto a transient copy.
        delete fields["ca-view-default"];
        fields.tags = [VIEW_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-view-name"] =
            (srcFields["ca-view-name"] || srcView.name || slug) + SCRATCH_NAME_SUFFIX;
        fields[SCRATCH_KIND_FIELD] = "view";
        fields[SCRATCH_SOURCE_FIELD] = sourceTitle;
        this.wiki.addTiddler(new $tw.Tiddler(fields));

        this._reloadViewsPreservingActive();
        this._setActiveView(scratchTitle);
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
        return scratchTitle;
    };

    // Unique scratchpad title under SCRATCHPAD_PREFIX for a source title,
    // suffixed with `/<kind>` (view|layer). Collision-safe.
    proto._scratchTitleFor = function (sourceTitle, kind) {
        var slug = String(sourceTitle).split("/").pop() || kind;
        var base = SCRATCHPAD_PREFIX + slug;
        var title = base + "/" + kind;
        var n = 2;
        while (this.wiki.tiddlerExists(title)) {
            title = base + "-" + n + "/" + kind;
            n++;
        }
        return title;
    };

    proto._isScratchpadTitle = function (title) {
        return !!title && String(title).indexOf(SCRATCHPAD_PREFIX) === 0;
    };

    // Begin editing a shared (explicit) layer. Clones the layer into its own
    // scratchpad, ensures the active view is a scratchpad, and rewires that
    // view's ca-view-layers so the original layer reference points at the
    // clone — so the result list reflects the edit live while BOTH the
    // original layer and original view stay byte-identical until commit. The
    // previewing-view scratchpad is marked (SCRATCH_LAYER_*) so commit targets
    // the layer. Returns the layer-scratchpad title (the edit target), or null.
    //
    // Phase-2 scope: one shared layer per session. Editing a second distinct
    // shared layer retargets the markers to it; the first clone's edits stay
    // visible in the preview but only the marked layer is committed.
    proto._beginLayerEdit = function (layerTitle) {
        var lt = this.wiki.getTiddler(layerTitle);
        if (!lt) return null;
        var lf = lt.fields || {};

        // Ensure we have a VIEW scratchpad to rewire (clone the active
        // persisted view if we're not already on a scratchpad). A freshly
        // cloned carrier is flagged preview-only: it offers no view-level
        // commit and is torn down once its layer edits are resolved.
        var scratchView;
        var freshCarrier = false;
        if (this._scratchpadView()) {
            scratchView = this.activeView;
        } else {
            scratchView = this._cloneViewToScratchpad(this.activeView);
            if (!scratchView) return null;
            freshCarrier = true;
        }

        // Clone the channel.
        var scratchLayer = this._scratchTitleFor(layerTitle, "layer");
        var lFields = this._copyChannelFields(lf);
        lFields.title = scratchLayer;
        lFields.tags = [CHANNEL_TAG];
        lFields.type = "text/vnd.tiddlywiki";
        lFields["ca-channel-name"] =
            (channelField(lf, "name") || layerTitle.split("/").pop()) + SCRATCH_NAME_SUFFIX;
        lFields[SCRATCH_KIND_FIELD] = "layer";
        lFields[SCRATCH_SOURCE_FIELD] = layerTitle;
        this.wiki.addTiddler(new $tw.Tiddler(lFields));

        // Rewire the scratch view's ca-view-channels (original → clone) and
        // stamp the channel-edit markers.
        var vt = this.wiki.getTiddler(scratchView);
        var vf = (vt && vt.fields) || {};
        var raw = viewChannelsRaw(vf).trim();
        var titles = raw ? raw.split(/\s+/) : [];
        var rewired = titles.map(function (t) {
            return t === layerTitle ? scratchLayer : t;
        }).join(" ");
        var mods = { "ca-view-channels": rewired, "ca-view-layers": undefined };
        if (freshCarrier) mods[SCRATCH_PREVIEW_ONLY_FIELD] = "yes";
        this.wiki.addTiddler(new $tw.Tiddler(vf, mods));

        this._reloadViewsPreservingActive();
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
        return scratchLayer;
    };

    // ===================================================================
    // Pill → editable-field descriptor
    // ===================================================================

    // Resolve a Structure-strip pill to a bind descriptor, or null when
    // the pill isn't editable in Phase 1. `layer` is the owning layer for
    // layer-scoped pills, null for view-scoped (header) pills.
    proto._pillEditDescriptor = function (pill, layer) {
        if (!pill) return null;
        var k = pill.kind;
        // Lens-slot chooser (Phase C): an enum cycling the projecting lenses
        // for the slot (+ "" = off / inherit), bound to the view default or
        // the channel override. A locked CHANNEL slot is NOT editable (the
        // view forces its lens); the VIEW slot stays editable even when locked.
        if (k === "lens-slot") {
            var slot = pill._slot;
            var titles = [""];
            if (this._projectingLenses) {
                this._projectingLenses(slot).forEach(function (l) {
                    titles.push(l.title);
                });
            }
            if (pill._scope === "view") {
                return {
                    bindTiddler: this.activeView,
                    bindField: "ca-view-lens-" + slot,
                    editKind: "enum", enumValues: titles,
                    name: pill.label + " lens (view default)"
                };
            }
            // channel scope
            if (!layer || layer.isBuiltIn || pill._locked) return null;
            return {
                bindTiddler: layer.title,
                bindField: "ca-channel-lens-" + slot,
                editKind: "enum", enumValues: titles,
                name: pill.label + " lens (channel override)",
                scope: "layer"
            };
        }
        // View-scoped enum / toggle facets (bind to the view tiddler).
        if (k === "sort") {
            return {
                bindTiddler: this.activeView, bindField: "ca-view-sort",
                editKind: "enum",
                enumValues: ["alphabetical", "natural", "by-field", "custom"],
                name: "Sort"
            };
        }
        if (k === "entries-mode") {
            return {
                bindTiddler: this.activeView, bindField: "ca-view-include-entries",
                editKind: "enum", enumValues: ["auto", "yes", "no"],
                name: "Include entries"
            };
        }
        if (k === "grouping") {
            return {
                bindTiddler: this.activeView, bindField: "ca-view-grouping",
                editKind: "toggle", trueValue: "yes", falseValue: "no",
                name: "Grouping"
            };
        }
        // Channel/view "summary" — the Overview-row template title. View-scoped
        // (layer null) binds `ca-view-preview` on the view; an implicit channel
        // IS the view (same field); an explicit channel binds `ca-channel-preview`
        // and edits via a layer scratchpad. The entries channel has none.
        if (k === "summary") {
            if (!layer || layer.isImplicit) {
                return {
                    bindTiddler: (layer && layer.title) || this.activeView,
                    bindField: "ca-view-preview",
                    editKind: "text", name: "Summary (view overview)"
                };
            }
            if (layer.isBuiltIn) return null;
            return {
                bindTiddler: layer.title, bindField: "ca-channel-preview",
                editKind: "text", name: "Summary (channel overview)", scope: "layer"
            };
        }
        // Layer-scoped structural facets. Two cases:
        //  - implicit layer: structure lives on the view tiddler, so the
        //    field is `ca-view-*` and binds to the view (Phase 1).
        //  - explicit (shared) layer: structure lives on the layer tiddler;
        //    the field is the same suffix under `ca-layer-*`, and editing
        //    routes through a layer-edit scratchpad (Phase 2). The built-in
        //    entries layer carries no editable structure.
        var filterField = VIEW_FILTER_FIELD[k];
        var textField = VIEW_TEXT_FIELD[k];
        if (filterField || textField) {
            if (!layer) return null;
            var vfield = filterField || textField;
            var editKind = filterField ? "filter" : "text";
            if (layer.isImplicit) {
                return {
                    bindTiddler: layer.title,
                    bindField: vfield,
                    editKind: editKind,
                    name: pill.label || k
                };
            }
            if (layer.isBuiltIn) return null; // entries channel — not editable
            // Explicit shared channel: same suffix, ca-channel-* prefix.
            return {
                bindTiddler: layer.title,
                bindField: vfield.replace("ca-view-", "ca-channel-"),
                editKind: editKind,
                name: pill.label || k,
                scope: "layer"
            };
        }
        return null;
    };

    // ===================================================================
    // Edit gestures (routed from cp-keyboard _handleKeydownViewConfig)
    // ===================================================================

    // Resolve the effective edit descriptor for a gesture: capture the
    // target field BEFORE any clone (cloning rebuilds the strip and shifts
    // pill indices, so we must NOT re-resolve by focus position), then —
    // if we had to clone — repoint bindTiddler at the scratchpad (the new
    // active view). For both implicit-layer and view-scoped facets the
    // correct bind target after a clone is simply the active view title.
    proto._resolveEditTarget = function (pill) {
        if (!pill || !pill._edit) return null;
        var ed = pill._edit;
        // Shared-layer facet. Editing must ALWAYS land on a layer clone, even
        // when the active view is already a (view-scoped) scratchpad whose
        // ca-view-layers still references the ORIGINAL shared layer — binding
        // straight to that would mutate the shipped part. So: if the bind
        // target is already a scratchpad layer, edit it; otherwise clone the
        // layer and rewire the active (cloning the view first if needed).
        if (ed.scope === "layer") {
            if (this._isScratchpadTitle(ed.bindTiddler)) return ed;
            var scratchLayer = this._beginLayerEdit(ed.bindTiddler);
            if (!scratchLayer) return null;
            return {
                bindTiddler: scratchLayer,
                bindField: ed.bindField,
                editKind: ed.editKind,
                enumValues: ed.enumValues,
                name: ed.name,
                scope: "layer"
            };
        }
        // View-scoped / implicit facet: edit the active scratchpad directly,
        // else clone the view first.
        if (this._scratchpadView()) {
            this._promoteFromPreviewOnly(); // editing a view facet → genuine view edit
            return ed;
        }
        if (!this._cloneViewToScratchpad(this.activeView)) return null;
        return {
            bindTiddler: this.activeView,
            bindField: ed.bindField,
            editKind: ed.editKind,
            enumValues: ed.enumValues,
            trueValue: ed.trueValue,
            falseValue: ed.falseValue,
            name: ed.name
        };
    };

    // Enter / Space on an editable pill. Clones to a scratchpad first when
    // editing a persisted view, then dispatches by editKind.
    proto._editPill = function (pill) {
        var ed = this._resolveEditTarget(pill);
        if (!ed) return;
        if (ed.editKind === "toggle") { this._toggleViewField(ed); return; }
        if (ed.editKind === "enum") { this._cycleViewEnum(ed); return; }
        this._enterFieldEditMode(ed);
    };

    // DEL / Backspace on an editable pill — clear the field (after cloning
    // to a scratchpad when needed).
    proto._clearPillField = function (pill) {
        var ed = this._resolveEditTarget(pill);
        if (!ed) return;
        this.clearBoundField({ bindTiddler: ed.bindTiddler, bindField: ed.bindField });
        this._afterViewConfigEdit();
    };

    proto._enterFieldEditMode = function (ed) {
        this.enterEditMode({
            bindTiddler: ed.bindTiddler,
            bindField: ed.bindField,
            kind: "text",
            editKind: ed.editKind,
            returnFocus: "viewconfig",
            name: ed.name
        });
    };

    proto._cycleViewEnum = function (ed) {
        var item = { bindTiddler: ed.bindTiddler, bindField: ed.bindField };
        var cur = (this.readBoundValue(item) || "").toLowerCase();
        var vals = ed.enumValues;
        var i = vals.indexOf(cur);
        if (i < 0) i = 0; // absent ≈ the implicit default at index 0
        this.writeBoundValue(item, vals[(i + 1) % vals.length]);
        this._afterViewConfigEdit();
    };

    // Toggle a slot's membership in the view's `ca-view-locked` list. A
    // locked slot forces the view's default lens onto every channel for that
    // slot (channel overrides ignored). Routes through the view scratchpad
    // (clones a persisted view first) so the change is committed via the
    // view's save/overwrite pills like any other view-scoped edit, then
    // re-bakes inheritance via _afterViewConfigEdit (reload → _loadView →
    // _applyLensInheritance).
    proto._toggleSlotLock = function (slot) {
        var sv = this._ensureViewScratchForCompose();
        if (!sv) return;
        var t = this.wiki.getTiddler(sv);
        if (!t) return;
        var locked = $tw.utils.parseStringArray(t.fields["ca-view-locked"] || "") || [];
        var i = locked.indexOf(slot);
        if (i >= 0) locked.splice(i, 1); else locked.push(slot);
        this.wiki.addTiddler(new $tw.Tiddler(t.fields, {
            "ca-view-locked": $tw.utils.stringifyList(locked)
        }));
        this._afterViewConfigEdit();
    };

    proto._toggleViewField = function (ed) {
        var item = { bindTiddler: ed.bindTiddler, bindField: ed.bindField };
        var cur = (this.readBoundValue(item) || "").toLowerCase();
        var on = ed.trueValue || "yes";
        var off = ed.falseValue || "no";
        this.writeBoundValue(item, cur === on.toLowerCase() ? off : on);
        this._afterViewConfigEdit();
    };

    // After any structural field edit: rebuild the (now-stale) view
    // descriptors, drop the stack to root, re-render the live preview and
    // Structure strip, keep focus on the strip. Same shape as
    // _resetStackAfterChainEdit but reloads the view cache first (the
    // change hook does not invalidate _viewsLoaded on view-tag edits).
    proto._afterViewConfigEdit = function () {
        // Keep focus on the pill the user just edited. setFocus("viewconfig")
        // resets viewConfigFocusIdx to 0 (the first commit pill), so capture
        // the index up front and restore it after the strip is rebuilt. The
        // pill list is stable across the edit (the scratchpad commit pills
        // were already present), so the same index still names the same pill.
        var keepIdx = this.viewConfigFocusIdx || 0;
        this._reloadViewsPreservingActive();
        this.stack = [this.buildRootStage()];
        this.recomputeStage(this.topStage());
        this.renderStage();
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
        // setFocus re-rendered the strip and populated _viewConfigPillList;
        // restore the focused pill (clamped) and re-render so the highlight
        // lands on it rather than the first pill.
        var n = (this._viewConfigPillList && this._viewConfigPillList.length) || 0;
        if (n > 0) {
            this.viewConfigFocusIdx = Math.max(0, Math.min(keepIdx, n - 1));
            if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        }
    };

    // ===================================================================
    // Commit
    // ===================================================================

    // VIEW-level commit pills shown in the Structure header row. Suppressed
    // for preview-only carriers (pure shared-layer sessions): there the
    // commit affordances live per-layer (_layerCommitPillsFor) on each layer
    // row, and the carrier view is never persisted.
    proto._scratchCommitPills = function () {
        var sp = this._scratchpadView();
        if (!sp) return [];
        var t = this.wiki.getTiddler(sp.title);
        var f = (t && t.fields) || {};
        if (f[SCRATCH_PREVIEW_ONLY_FIELD] === "yes") return [];
        var source = f[SCRATCH_SOURCE_FIELD] || "";
        var pills = [];
        pills.push({
            kind: "scratch-commit", commitMode: "save-new",
            label: "save", value: "as new",
            help: "Save this scratchpad as a brand-new view. Nothing else is affected."
        });
        if (source) {
            var srcName = this._sourceDisplayName(source);
            pills.push({
                kind: "scratch-commit", commitMode: "overwrite",
                label: "overwrite", value: srcName,
                help: "Write these edits back over '" + srcName +
                    "'. Every view referencing it reflects the change."
            });
        }
        pills.push({
            kind: "scratch-commit", commitMode: "discard",
            label: "discard", value: "",
            help: "Delete this scratchpad. Nothing is changed anywhere."
        });
        return pills;
    };

    // Per-layer commit pills, appended to a layer's OWN row when that layer
    // is a scratchpad clone (being edited). Each pill carries `commitLayer`
    // (the clone title) so the keyboard routes to the layer-scoped commit,
    // and overwrite shows a "used by N views" consumer count. Returns [] for
    // any layer that isn't a clone. Lets several layers be edited and
    // committed independently in one session.
    proto._layerCommitPillsFor = function (layerCloneTitle) {
        if (!this._isScratchpadTitle(layerCloneTitle)) return [];
        var lt = this.wiki.getTiddler(layerCloneTitle);
        var lf = (lt && lt.fields) || {};
        if (lf[SCRATCH_KIND_FIELD] !== "layer") return [];
        var source = lf[SCRATCH_SOURCE_FIELD] || "";
        // A migrated/new layer (no source) is this view's own structure — it
        // is committed WITH the view (save-as-new / overwrite the view), not
        // via per-layer pills. Only edit-clones of shared layers get them.
        if (!source) return [];
        var pills = [];
        pills.push({
            kind: "scratch-commit", commitMode: "save-new", commitLayer: layerCloneTitle,
            label: "save", value: "as new layer",
            help: "Save these layer edits as a brand-new shared layer. " +
                "No existing view changes."
        });
        if (source) {
            var st = this.wiki.getTiddler(source);
            var sname = (st && channelField(st.fields, "name")) ||
                source.split("/").pop();
            var n = this._layerConsumerCount(source);
            pills.push({
                kind: "scratch-commit", commitMode: "overwrite", commitLayer: layerCloneTitle,
                label: "overwrite", value: sname +
                    " (" + n + " view" + (n === 1 ? "" : "s") + ")",
                help: "Write these edits back over the shared layer '" + sname +
                    "'. All " + n + " view" + (n === 1 ? "" : "s") +
                    " using it reflect the change."
            });
        }
        pills.push({
            kind: "scratch-commit", commitMode: "discard", commitLayer: layerCloneTitle,
            label: "discard", value: "",
            help: "Revert this layer to the original. Nothing else is changed."
        });
        return pills;
    };

    // Clear the preview-only flag on the active view scratchpad, promoting a
    // pure layer-preview carrier into a genuine view edit (so view-level
    // commit pills appear). No-op when not applicable.
    proto._promoteFromPreviewOnly = function () {
        var sp = this._scratchpadView();
        if (!sp) return;
        var t = this.wiki.getTiddler(sp.title);
        if (t && t.fields && t.fields[SCRATCH_PREVIEW_ONLY_FIELD] === "yes") {
            this.wiki.addTiddler(new $tw.Tiddler(t.fields,
                { "cp-scratch-preview-only": undefined }));
        }
    };

    // Layer-clone titles currently referenced by a view scratchpad's
    // ca-view-layers (the layers still under edit).
    proto._scratchLayerRefs = function (viewScratchTitle) {
        var self = this;
        var t = this.wiki.getTiddler(viewScratchTitle);
        var raw = viewChannelsRaw(t && t.fields);
        return raw.split(/\s+/).filter(function (x) {
            return self._isScratchpadTitle(x);
        });
    };

    // Count persisted views whose ca-view-layers references `layerTitle`.
    // Scratchpad views are excluded (they reference layer clones, not the
    // original, and aren't real consumers).
    proto._layerConsumerCount = function (layerTitle) {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + VIEW_TAG + "]]"
        );
        var n = 0;
        titles.forEach(function (vt) {
            if (vt.indexOf(SCRATCHPAD_PREFIX) === 0) return;
            var t = self.wiki.getTiddler(vt);
            var raw = viewChannelsRaw(t && t.fields);
            if (raw.split(/\s+/).indexOf(layerTitle) >= 0) n++;
        });
        return n;
    };

    proto._sourceDisplayName = function (title) {
        var t = this.wiki.getTiddler(title);
        return (t && t.fields && t.fields["ca-view-name"]) ||
            (title ? title.split("/").pop() : "");
    };

    // Execute a commit. `mode` ∈ save-new | overwrite | discard.
    proto._commitScratchpad = function (mode) {
        var sp = this._scratchpadView();
        if (!sp) return;
        var scratchTitle = sp.title;
        var st = this.wiki.getTiddler(scratchTitle);
        var sf = (st && st.fields) || {};
        var source = sf[SCRATCH_SOURCE_FIELD] || "";

        if (mode === "discard") {
            this._deleteScratchpad(scratchTitle, source || null);
            return;
        }
        if (mode === "overwrite") {
            if (!source) { mode = "save-new"; }
            else {
                var materialized = this._materializeMigratedLayers(sf);
                this._overwriteView(source, sf, materialized);
                this._deleteScratchpad(scratchTitle, source);
                return;
            }
        }
        if (mode === "save-new") {
            // Prompt for a name (pre-filled with the source name, ✎
            // stripped). Commit creates a brand-new view under a fresh,
            // collision-safe slug; the source and all other views are left
            // exactly as they are. Esc cancels and returns to the editor
            // with the scratchpad intact.
            this._promptSaveAsNew(scratchTitle, sf);
        }
    };

    // Capture a name for "save as new" via the edit-mode input, then
    // finalize. Reuses enterEditMode's onCommitFn JS hook so the typed name
    // flows straight into _finalizeSaveAsNew.
    proto._promptSaveAsNew = function (scratchTitle, sf) {
        var self = this;
        var suggested = (sf["ca-view-name"] || "").replace(/\s*✎\s*$/, "").trim();
        this.enterEditMode({
            bindTiddler: scratchTitle,
            bindField: "ca-view-name",
            kind: "text",
            editKind: "text",
            name: "New view name",
            initialValue: suggested,
            returnFocus: "viewconfig",
            onCommitFn: function (name) {
                self._finalizeSaveAsNew(scratchTitle, name);
            }
        });
    };

    proto._finalizeSaveAsNew = function (scratchTitle, rawName) {
        var name = String(rawName || "").replace(/\s*✎\s*$/, "").trim() || "Custom view";
        var st = this.wiki.getTiddler(scratchTitle);
        var sf = (st && st.fields) || {};
        // Persist any migrated/new layers first, then write the view
        // referencing their persisted titles.
        var materialized = this._materializeMigratedLayers(sf);
        var newTitle = this._slugTitle(name, VIEWS_NS);
        this._writeNewView(newTitle, sf, name, materialized);
        this.wiki.deleteTiddler(scratchTitle);
        this._reloadViewsPreservingActive();
        this._setActiveView(newTitle);
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
    };

    // Structural ca-view-* keys the editor manages — collected from either
    // tiddler so a field the user CLEARED in the scratchpad (now absent) is
    // also removed from the target on overwrite. `ca-view-default` is
    // EXCLUDED: it's view metadata the clone deliberately strips, so syncing
    // it would wrongly clear the source's default flag on overwrite.
    var OVERWRITE_EXCLUDE = { "ca-view-default": true };
    function viewFieldKeys(a, b) {
        var keys = {};
        [a, b].forEach(function (f) {
            Object.keys(f || {}).forEach(function (k) {
                if (k.indexOf("ca-view-") === 0 && !OVERWRITE_EXCLUDE[k]) {
                    keys[k] = true;
                }
            });
        });
        return Object.keys(keys);
    }

    // Overwrite a persisted view: preserve its non-structural fields
    // (tags, ca-view-default, ca-order, ca-icon) and apply the scratchpad's
    // ca-view-* set (clearing fields the user removed). The "✎" suffix is
    // stripped from the name.
    proto._overwriteView = function (targetTitle, scratchFields, materializedLayers) {
        var existing = this.wiki.getTiddler(targetTitle);
        var existingFields = (existing && existing.fields) || {};
        var apply = {};
        var hasOwn = Object.prototype.hasOwnProperty;
        viewFieldKeys(existingFields, scratchFields).forEach(function (k) {
            apply[k] = hasOwn.call(scratchFields, k) ? scratchFields[k] : undefined;
        });
        if (apply["ca-view-name"]) {
            apply["ca-view-name"] = apply["ca-view-name"]
                .replace(/\s*✎\s*$/, "").trim();
        }
        // Migrated channels were persisted under fresh titles — point the
        // overwritten view at those (an implicit→explicit overwrite drops the
        // now-migrated ca-view-* structural fields, handled above by the
        // scratch lacking them). Also clear any legacy ca-view-layers on the
        // target so the new ca-view-channels is the single source of truth.
        if (materializedLayers !== undefined) {
            apply["ca-view-channels"] = materializedLayers || undefined;
            apply["ca-view-layers"] = undefined;
        }
        this.wiki.addTiddler(new $tw.Tiddler(existingFields, apply));
    };

    // Write a brand-new persisted view from a scratchpad's fields.
    proto._writeNewView = function (newTitle, scratchFields, name) {
        var fields = { title: newTitle, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki" };
        Object.keys(scratchFields).forEach(function (k) {
            if (k.indexOf("ca-view-") === 0 || k === "ca-icon") {
                fields[k] = scratchFields[k];
            }
        });
        fields["ca-view-name"] = name;
        delete fields["ca-view-default"];
        // Sort to the end of the view strip.
        var maxOrder = DEFAULT_ORDER;
        (this.views || []).forEach(function (v) {
            if (v.order > maxOrder) maxOrder = v.order;
        });
        fields["ca-order"] = String(maxOrder + 100);
        // The clone loop above may have copied a legacy ca-view-layers — drop
        // it; ca-view-channels is the single source of truth on a new view.
        delete fields["ca-view-layers"];
        if (arguments.length > 3 && arguments[3] !== undefined) {
            fields["ca-view-channels"] = arguments[3]; // materialized channel refs
        }
        this.wiki.addTiddler(new $tw.Tiddler(fields));
    };

    // On VIEW commit, persist any migrated/new layer scratchpads referenced
    // by the view's ca-view-layers and rewire the refs to the persisted
    // titles. Migrated layers (kind=layer, NO source) become brand-new shared
    // layers in the library. Edit-clone refs (source set) are NOT persisted
    // here — they belong to the per-layer commit flow, so they're restored to
    // their original reference. Non-scratch refs pass through unchanged.
    // Returns the rewritten ca-view-layers string (or "" when none).
    proto._materializeMigratedLayers = function (scratchFields) {
        var self = this;
        var raw = viewChannelsRaw(scratchFields).trim();
        if (!raw) return raw;
        return raw.split(/\s+/).map(function (ref) {
            if (!self._isScratchpadTitle(ref)) return ref;
            var lt = self.wiki.getTiddler(ref);
            var lf = (lt && lt.fields) || {};
            if (lf[SCRATCH_KIND_FIELD] !== "layer") return ref; // unknown — leave
            var src = lf[SCRATCH_SOURCE_FIELD] || "";
            if (src) return src; // edit-clone — view commit restores the original
            var name = (channelField(lf, "name") || "Structure")
                .replace(/\s*✎\s*$/, "").trim() || "Structure";
            var newTitle = self._slugTitle(name, CHANNELS_NS);
            self._writeNewLayer(newTitle, lf, name);
            self.wiki.deleteTiddler(ref);
            return newTitle;
        }).join(" ");
    };

    // ===================================================================
    // Layer-edit commit (per-layer — routed from a layer row's own commit
    // pill, `commitLayer` = the layer clone). The target is the shared LAYER;
    // the previewing view's reference is rewired back to the original, and a
    // preview-only carrier is torn down once its last layer edit resolves.
    // ===================================================================

    proto._commitLayer = function (mode, layerCloneTitle) {
        var lst = this.wiki.getTiddler(layerCloneTitle);
        if (!lst) return;
        var lf = lst.fields || {};
        var layerSource = lf[SCRATCH_SOURCE_FIELD] || "";

        if (mode === "discard") {
            this._finishLayerCommit(layerCloneTitle, layerSource);
            return;
        }
        if (mode === "overwrite") {
            if (!layerSource) { mode = "save-new"; }
            else {
                this._overwriteLayer(layerSource, lf);
                this._finishLayerCommit(layerCloneTitle, layerSource);
                return;
            }
        }
        if (mode === "save-new") {
            this._promptSaveAsNewLayer(layerCloneTitle, layerSource);
        }
    };

    // Finish a layer commit: rewire the active previewing view's
    // ca-view-layers reference from the clone back to `restoreTitle` (the
    // original layer for discard/overwrite, or the original for save-as-new
    // too — the new layer is added to the library, not auto-wired in), delete
    // the layer clone, and — if the carrier is preview-only with no more
    // layer edits — tear it down and return to the source view.
    proto._finishLayerCommit = function (layerCloneTitle, restoreTitle) {
        var viewScratch = this.activeView;
        var vt = this.wiki.getTiddler(viewScratch);
        if (vt && vt.fields && vt.fields[SCRATCH_KIND_FIELD] === "view") {
            var raw = viewChannelsRaw(vt.fields).trim();
            var titles = raw ? raw.split(/\s+/) : [];
            var rewired = titles.map(function (t) {
                return t === layerCloneTitle ? restoreTitle : t;
            }).filter(function (t) { return t; }).join(" ");
            this.wiki.addTiddler(new $tw.Tiddler(vt.fields,
                { "ca-view-channels": rewired, "ca-view-layers": undefined }));
        }
        this.wiki.deleteTiddler(layerCloneTitle);
        this._reloadViewsPreservingActive();

        // Auto-tear-down a spent preview-only carrier.
        var vt2 = this.wiki.getTiddler(viewScratch);
        var previewOnly = vt2 && vt2.fields &&
            vt2.fields[SCRATCH_PREVIEW_ONLY_FIELD] === "yes";
        if (previewOnly && this._scratchLayerRefs(viewScratch).length === 0) {
            var src = vt2.fields[SCRATCH_SOURCE_FIELD] || "";
            this.wiki.deleteTiddler(viewScratch);
            this._reloadViewsPreservingActive();
            var back = (src && this._getViewByTitle(src)) ? src
                : (this.views && this.views.length ? this.views[0].title : null);
            if (back) this._setActiveView(back);
        }
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
    };

    // ca-channel-* / legacy ca-layer-* keys present on either tiddler, so a
    // field cleared in the scratchpad is also removed from the target on
    // overwrite. Both prefixes are collected so overwriting an un-migrated
    // (ca-layer-*) target with a new-vocab (ca-channel-*) scratch clears the
    // stale legacy keys (the scratch never carries them).
    function layerFieldKeys(a, b) {
        var keys = {};
        [a, b].forEach(function (f) {
            Object.keys(f || {}).forEach(function (k) {
                if (k.indexOf("ca-channel-") === 0 ||
                    k.indexOf("ca-layer-") === 0) keys[k] = true;
            });
        });
        return Object.keys(keys);
    }

    proto._overwriteLayer = function (targetTitle, scratchFields) {
        var existing = this.wiki.getTiddler(targetTitle);
        var existingFields = (existing && existing.fields) || {};
        var apply = {};
        var hasOwn = Object.prototype.hasOwnProperty;
        layerFieldKeys(existingFields, scratchFields).forEach(function (k) {
            apply[k] = hasOwn.call(scratchFields, k) ? scratchFields[k] : undefined;
        });
        if (apply["ca-channel-name"]) {
            apply["ca-channel-name"] = apply["ca-channel-name"]
                .replace(/\s*✎\s*$/, "").trim();
        }
        this.wiki.addTiddler(new $tw.Tiddler(existingFields, apply));
    };

    proto._writeNewLayer = function (newTitle, scratchFields, name) {
        var fields = {
            title: newTitle, tags: [CHANNEL_TAG], type: "text/vnd.tiddlywiki"
        };
        // Copy the channel's authoring fields, normalizing any legacy
        // ca-layer-* the scratch might still carry into the channel namespace.
        var copied = this._copyChannelFields(scratchFields);
        Object.keys(copied).forEach(function (k) { fields[k] = copied[k]; });
        fields["ca-channel-name"] = name;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
    };

    proto._promptSaveAsNewLayer = function (layerCloneTitle, layerSource) {
        var self = this;
        var lt = this.wiki.getTiddler(layerCloneTitle);
        var suggested = ((lt && channelField(lt.fields, "name")) || "")
            .replace(/\s*✎\s*$/, "").trim();
        this.enterEditMode({
            bindTiddler: layerCloneTitle,
            bindField: "ca-channel-name",
            kind: "text",
            editKind: "text",
            name: "New channel name",
            initialValue: suggested,
            returnFocus: "viewconfig",
            onCommitFn: function (name) {
                self._finalizeLayerSaveAsNew(layerCloneTitle, layerSource, name);
            }
        });
    };

    proto._finalizeLayerSaveAsNew = function (layerCloneTitle, layerSource, rawName) {
        var name = String(rawName || "").replace(/\s*✎\s*$/, "").trim() || "Custom channel";
        var lst = this.wiki.getTiddler(layerCloneTitle);
        var newTitle = this._slugTitle(name, CHANNELS_NS);
        this._writeNewLayer(newTitle, (lst && lst.fields) || {}, name);
        // Save-as-new is the "don't touch anyone" path: the view goes back to
        // referencing the original layer; the new layer joins the library.
        this._finishLayerCommit(layerCloneTitle, layerSource);
    };

    // ===================================================================
    // Layer composition — assign / remove / reorder shared layers on a
    // view's ca-view-layers (by reference). This is a VIEW edit, so it
    // routes through the view scratchpad and commits via the view-level
    // commit pills (save-as-new / overwrite the view).
    // ===================================================================

    // The active view's ca-view-layers as an array (reads the live tiddler,
    // scratchpad or persisted).
    proto._viewLayerRefs = function (viewTitle) {
        var t = this.wiki.getTiddler(viewTitle || this.activeView);
        var raw = viewChannelsRaw(t && t.fields).trim();
        return raw ? raw.split(/\s+/) : [];
    };

    // Ensure there's a view scratchpad to mutate. Composing layers is a
    // genuine view edit, so a preview-only carrier is promoted.
    proto._ensureViewScratchForCompose = function () {
        if (this._scratchpadView()) {
            this._promoteFromPreviewOnly();
            return this.activeView;
        }
        return this._cloneViewToScratchpad(this.activeView);
    };

    proto._writeViewLayers = function (scratchView, titles) {
        var t = this.wiki.getTiddler(scratchView);
        if (!t) return;
        this.wiki.addTiddler(new $tw.Tiddler(t.fields,
            { "ca-view-channels": titles.join(" "), "ca-view-layers": undefined }));
        this._afterViewConfigEdit();
    };

    // ===================================================================
    // H2 — implicit → explicit migration. An implicit view carries its
    // structure as ca-view-* fields on the view tiddler (one synthetic
    // layer). To compose more layers onto it, that structure must first be
    // lifted into a real, referenceable layer. Migration runs inside the
    // view scratchpad: it creates a migrated-layer scratchpad (kind=layer,
    // NO source — it commits *with* the view, not via per-layer pills),
    // points ca-view-layers at it, and strips the migrated ca-view-* fields.
    // Behaviour-preserving: the explicit form renders identical rows.
    // ===================================================================

    // Collision-safe scratch title for a migrated layer, grouped under the
    // same scratch stem as its view (…/<stem>/layer).
    proto._migratedLayerScratchTitle = function (viewScratchTitle) {
        var stem = String(viewScratchTitle).replace(/\/view$/, "");
        var title = stem + "/layer";
        var n = 2;
        while (this.wiki.tiddlerExists(title)) {
            title = stem + "-" + n + "/layer";
            n++;
        }
        return title;
    };

    // Convert the given view scratchpad from implicit to explicit. No-op
    // (returns null) when the view already has ca-view-layers. Returns the
    // migrated-layer scratch title otherwise.
    proto._migrateImplicitToExplicit = function (viewScratchTitle) {
        var t = this.wiki.getTiddler(viewScratchTitle);
        if (!t) return null;
        var vf = t.fields;
        if (viewChannelsRaw(vf).trim()) return null; // already explicit

        var layerScratch = this._migratedLayerScratchTitle(viewScratchTitle);
        var lFields = {
            title: layerScratch,
            tags: [CHANNEL_TAG],
            type: "text/vnd.tiddlywiki"
        };
        MIGRATE_STRUCT_SUFFIXES.forEach(function (suf) {
            var vk = "ca-view-" + suf;
            if (vf[vk] !== undefined && vf[vk] !== "") {
                lFields["ca-channel-" + suf] = vf[vk];
            }
        });
        lFields["ca-channel-name"] = (vf["ca-view-channel-name"] !== undefined
            ? vf["ca-view-channel-name"] : vf["ca-view-layer-name"]) ||
            (vf["ca-view-name"] || "").replace(/\s*✎\s*$/, "").trim() || "Structure";
        lFields[SCRATCH_KIND_FIELD] = "layer";
        lFields[SCRATCH_SOURCE_FIELD] = ""; // migrated/new — commits with the view
        this.wiki.addTiddler(new $tw.Tiddler(lFields));

        var mods = { "ca-view-channels": layerScratch, "ca-view-layers": undefined };
        MIGRATE_STRUCT_SUFFIXES.forEach(function (suf) {
            mods["ca-view-" + suf] = undefined;
        });
        mods["ca-view-channel-name"] = undefined;
        mods["ca-view-layer-name"] = undefined;
        this.wiki.addTiddler(new $tw.Tiddler(vf, mods));
        this._reloadViewsPreservingActive();
        return layerScratch;
    };

    proto._addLayerToView = function (layerTitle) {
        var sv = this._ensureViewScratchForCompose();
        if (!sv) return;
        this._migrateImplicitToExplicit(sv); // no-op when already explicit
        var titles = this._viewLayerRefs(sv);
        if (titles.indexOf(layerTitle) < 0) titles.push(layerTitle);
        this._writeViewLayers(sv, titles);
    };

    proto._removeLayerFromView = function (layerTitle) {
        var sv = this._ensureViewScratchForCompose();
        if (!sv) return;
        var titles = this._viewLayerRefs(sv).filter(function (t) {
            return t !== layerTitle;
        });
        this._writeViewLayers(sv, titles);
    };

    proto._moveLayerInView = function (layerTitle, direction) {
        var sv = this._ensureViewScratchForCompose();
        if (!sv) return;
        var titles = this._viewLayerRefs(sv);
        var i = titles.indexOf(layerTitle);
        var j = i + direction;
        if (i < 0 || j < 0 || j >= titles.length) return;
        var tmp = titles[i]; titles[i] = titles[j]; titles[j] = tmp;
        this._writeViewLayers(sv, titles);
    };

    // Open a picker listing shared layers not already in the active view
    // (excludes scratchpad clones + the built-in entries descriptor). Enter
    // on a row routes to _applyLayerPick → _addLayerToView.
    proto._openLayerPicker = function () {
        var self = this;
        var present = {};
        this._viewLayerRefs(this.activeView).forEach(function (t) { present[t] = true; });
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + CHANNEL_TAG + "]] " +
            "[all[shadows+tiddlers]tag[" + STRUCTURE_LAYER_TAG + "]]"
        ).filter(function (title) {
            return !self._isScratchpadTitle(title) &&
                title !== BUILTIN_ENTRIES_LAYER_TITLE &&
                !present[title];
        });
        if (!titles.length) {
            if (this.hintEl) {
                this.hintEl.textContent =
                    "No other shared channels to add — create one via 'save as new channel'.";
            }
            return;
        }
        var items = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var item = self._buildCascadeItem({
                "ca-name": channelField(f, "name") || title.split("/").pop(),
                "ca-hint": (channelField(f, "roots") || "") +
                    (channelField(f, "children") ? " → " + channelField(f, "children") : ""),
                "ca-kind": "leaf"
            }, title);
            item.isItem = true;
            return item;
        });
        var stage = {
            kind: "filter", title: "Add channel to view", query: "", selectedIndex: 0,
            filter: "", itemsFromFilter: "", stageDefaultAction: "",
            entityDefaultActions: [], asLink: false,
            items: items, results: items.slice(),
            parentPicked: null, entityType: null,
            _freezeItems: true, _isLayerPicker: true
        };
        this.pushStage(stage);
        if (this.setFocus) this.setFocus("input");
    };

    proto._applyLayerPick = function (stage, picked) {
        if (!picked || !picked.title) { this.popStage(); return; }
        this._addLayerToView(picked.title);
    };

    // Delete any layer scratchpads referenced by a view scratchpad's
    // ca-view-layers (migrated/new layers and edit clones) — they're orphaned
    // once the view scratch is discarded, so clean them up to honour "discard
    // changes nothing anywhere".
    proto._deleteScratchLayersOf = function (viewScratchTitle) {
        var self = this;
        var t = this.wiki.getTiddler(viewScratchTitle);
        var raw = viewChannelsRaw(t && t.fields);
        raw.split(/\s+/).forEach(function (ref) {
            if (!self._isScratchpadTitle(ref)) return;
            var lt = self.wiki.getTiddler(ref);
            if (lt && lt.fields && lt.fields[SCRATCH_KIND_FIELD] === "layer") {
                self.wiki.deleteTiddler(ref);
            }
        });
    };

    // Delete a scratchpad and return to a sensible active view.
    proto._deleteScratchpad = function (scratchTitle, source) {
        this._deleteScratchLayersOf(scratchTitle);
        this.wiki.deleteTiddler(scratchTitle);
        this._reloadViewsPreservingActive();
        var back = (source && this._getViewByTitle(source)) ? source
            : (this.views && this.views.length ? this.views[0].title : null);
        if (back) this._setActiveView(back);
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
    };

    // ===================================================================
    // Lifecycle entry points (routed from the Manage views menu via
    // root messages — see cascade-palette-widget registerRootMessage)
    // ===================================================================

    // Land the Structure strip expanded + focused on whatever is now the
    // active view. Shared tail for new / edit; _setActiveView already reset
    // the stack to root and moved focus to the input, so we re-grab it.
    proto._focusStructureForActive = function () {
        this.viewConfigExpanded = true;
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this._renderHint) this._renderHint();
        if (this.setFocus) this.setFocus("viewconfig");
    };

    // Create a fresh scratchpad seeded with sane defaults and start editing
    // it. Commit (save-as-new) later persists it as a real view.
    proto._newViewScratchpad = function () {
        var scratchTitle = SCRATCHPAD_PREFIX + "new/view";
        var n = 2;
        while (this.wiki.tiddlerExists(scratchTitle)) {
            scratchTitle = SCRATCHPAD_PREFIX + "new-" + n + "/view";
            n++;
        }
        var fields = {
            title: scratchTitle,
            tags: [VIEW_TAG],
            type: "text/vnd.tiddlywiki",
            "ca-view-name": "New view" + SCRATCH_NAME_SUFFIX,
            "ca-view-roots": "[all[tiddlers]!is[system]]",
            "ca-view-sort": "alphabetical"
        };
        fields[SCRATCH_KIND_FIELD] = "view";
        fields[SCRATCH_SOURCE_FIELD] = ""; // no source — pure new
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        this._reloadViewsPreservingActive();
        this._setActiveView(scratchTitle);
        this._focusStructureForActive();
        return scratchTitle;
    };

    // Clone the active view into a scratchpad and start editing (no-op if it
    // already is a scratchpad — just re-focus the strip).
    proto._editActiveView = function () {
        if (this._scratchpadView()) {
            this._focusStructureForActive();
            return this.activeView;
        }
        return this._cloneViewToScratchpad(this.activeView);
    };

    // Copy a channel's authoring fields (ca-channel-*) from `src` into a fresh
    // field set, normalizing any legacy ca-layer-* into the channel namespace
    // so a clone/fork of an un-migrated channel carries new-vocab fields.
    // Bookkeeping (cp-scratch-*) and tags/type/title are NOT copied — the
    // caller sets those. Shared by _beginLayerEdit (clone for editing) and
    // _forkChannel (deep view-fork) so the channel field set lives in one
    // place — sibling of cp-axis-editor's _copyAxisFields.
    proto._copyChannelFields = function (src) {
        var out = {};
        Object.keys(src || {}).forEach(function (k) {
            if (k.indexOf("ca-channel-") === 0) {
                out[k] = src[k];
            } else if (k.indexOf("ca-layer-") === 0) {
                var nk = "ca-channel-" + k.slice("ca-layer-".length);
                if (out[nk] === undefined) out[nk] = src[k];
            }
        });
        return out;
    };

    // Fork a view into an independent PERSISTED copy (not a scratchpad) and
    // make it active. A fork is a DEEP clone: the view's ca-view-* fields are
    // copied, and every explicit structure-layer and grouping axis it
    // references is copied into a private part (title rewritten in the new
    // view's ca-view-layers / ca-view-axes, and in each forked layer's
    // ca-layer-axes). Nothing the fork references is shared with the source,
    // so editing the fork's structure never touches the original. The
    // synthetic built-in entries layer is referenced, not copied (it carries
    // no editable structure); an unresolvable reference is kept verbatim.
    proto._forkView = function (sourceTitle) {
        var self = this;
        var srcView = this._getViewByTitle(sourceTitle);
        if (!srcView) return null;
        var srcTid = this.wiki.getTiddler(sourceTitle);
        var srcFields = (srcTid && srcTid.fields) || {};
        var baseName = (srcFields["ca-view-name"] || srcView.name || "view")
            .replace(/\s*✎\s*$/, "").trim();
        var name = baseName + " (copy)";
        var newTitle = this._slugTitle(name, VIEWS_NS);
        var fields = { title: newTitle, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki" };
        Object.keys(srcFields).forEach(function (k) {
            if (k.indexOf("ca-view-") === 0 || k === "ca-icon" || k === "ca-order") {
                fields[k] = srcFields[k];
            }
        });
        delete fields["ca-view-default"]; // a fork is never the default
        delete fields["ca-view-layers"]; // legacy — normalized to ca-view-channels
        fields["ca-view-name"] = name;

        // Deep-copy referenced explicit channels (private copies, refs rewritten).
        var layerRefs = this._viewLayerRefs(sourceTitle);
        if (layerRefs.length) {
            fields["ca-view-channels"] = layerRefs.map(function (t) {
                return self._forkChannel(t);
            }).join(" ");
        }
        // Deep-copy the view-level axis chain (implicit-layer views).
        if ((srcFields["ca-view-axes"] || "").trim()) {
            fields["ca-view-axes"] = this._forkAxisChain(srcFields["ca-view-axes"]);
        }

        this.wiki.addTiddler(new $tw.Tiddler(fields));
        this._reloadViewsPreservingActive();
        this._setActiveView(newTitle);
        return newTitle;
    };

    // Copy a referenced channel into a private persisted channel and return
    // its new title. The channel's own axis chain (ca-channel-axes) is
    // deep-copied too. The built-in entries channel (no editable structure)
    // and any unresolvable reference are returned verbatim — never copied.
    proto._forkChannel = function (layerTitle) {
        if (layerTitle === BUILTIN_ENTRIES_LAYER_TITLE) return layerTitle;
        var lt = this.wiki.getTiddler(layerTitle);
        if (!lt) return layerTitle;
        var lf = lt.fields || {};
        var baseName = (channelField(lf, "name") || layerTitle.split("/").pop())
            .replace(/\s*✎\s*$/, "").trim();
        var name = baseName + " (copy)";
        var newTitle = this._slugTitle(name, CHANNELS_NS);
        var fields = this._copyChannelFields(lf);
        fields.title = newTitle;
        fields.tags = [CHANNEL_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-channel-name"] = name;
        if ((channelField(lf, "axes") || "").trim()) {
            fields["ca-channel-axes"] = this._forkAxisChain(channelField(lf, "axes"));
        }
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        return newTitle;
    };

    // Deep-copy every axis named in a chain spec (space-separated titles OR a
    // JSON `[{title,params}]` array — parseChainSpec normalises both) into
    // private axes, returning a rewritten chain spec. Per-axis params are
    // preserved; the result is re-serialised as JSON only when some entry
    // carries params, else as a plain title list (keeps simple chains compact).
    proto._forkAxisChain = function (raw) {
        var self = this;
        var entries = parseChainSpec(raw);
        if (!entries.length) return raw || "";
        var hasParams = false;
        var rewired = entries.map(function (e) {
            if (e.params) hasParams = true;
            return { title: self._forkAxis(e.title), params: e.params || null };
        });
        if (hasParams) return JSON.stringify(rewired);
        return rewired.map(function (e) { return e.title; }).join(" ");
    };

    // Copy a single axis tiddler into a private persisted axis and return its
    // new title. Reuses cp-axis-editor's _copyAxisFields (ca-axis-* + ca-order)
    // so the axis field set lives in one place. An unresolvable reference is
    // returned verbatim.
    proto._forkAxis = function (axisTitle) {
        var at = this.wiki.getTiddler(axisTitle);
        if (!at) return axisTitle;
        var af = at.fields || {};
        var baseName = (af["ca-axis-name"] || axisTitle.split("/").pop())
            .replace(/\s*✎\s*$/, "").trim();
        var name = baseName + " (copy)";
        var newTitle = this._slugTitle(name, AXES_NS);
        var fields = this._copyAxisFields(af);
        fields.title = newTitle;
        fields.tags = [AXIS_TAG];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-axis-name"] = name;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        return newTitle;
    };

    // Push the standard delete-confirmation for a focused VIEW pill (DEL on
    // the view strip routes here). Shipped (shadow-only) views can't be
    // deleted — surface the fork hint instead of a confirm. On confirm, a
    // sendmessage fires DELETE_VIEW_MESSAGE → _deleteView.
    proto._confirmDeleteView = function (view) {
        if (!view || !view.title) return;
        var title = view.title;
        if (this.wiki.isShadowTiddler(title) && !this.wiki.tiddlerExists(title)) {
            if (this.hintEl) {
                this.hintEl.textContent =
                    "Shipped views can't be deleted — fork it (Manage views) instead.";
            }
            return;
        }
        var name = view.name || title.split("/").pop();
        this.pushStage(this.buildConfirmStage({
            title: "Delete view " + name,
            consequence: "Permanently delete the view “" + name +
                "”. This cannot be undone.",
            actions: '<$action-sendmessage $message="' + C.DELETE_VIEW_MESSAGE +
                '" view="' + this._escapeAttr(title) + '"/>'
        }));
        if (this.setFocus) this.setFocus("menu");
    };

    // Delete a persisted, user-created view. Shipped (shadow) views can't be
    // deleted — they'd just reappear from the plugin — so refuse with a hint.
    // Scratchpads route through _deleteScratchpad (discard) instead. After a
    // successful delete, _loadViews reselects the default view.
    proto._deleteView = function (title) {
        if (!title) return false;
        if (this._scratchpadView() && this.activeView === title) {
            var src = (this.wiki.getTiddler(title) || { fields: {} })
                .fields[SCRATCH_SOURCE_FIELD] || "";
            this._deleteScratchpad(title, src);
            return true;
        }
        if (this.wiki.isShadowTiddler(title) && !this.wiki.tiddlerExists(title)) {
            if (this._renderHint) {
                this.hintEl && (this.hintEl.textContent =
                    "Shipped views can't be deleted — fork it instead.");
            }
            return false;
        }
        this.wiki.deleteTiddler(title);
        this._viewsLoaded = false;
        this._loadViews(); // reselects default into this.activeView
        this.stack = [this.buildRootStage()];
        this.recomputeStage(this.topStage());
        if (this._renderViewStrip) this._renderViewStrip();
        this.renderStage();
        if (this.setFocus) this.setFocus("input");
        return true;
    };

};
