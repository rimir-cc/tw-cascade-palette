/*\
title: $:/plugins/rimir/cascade-palette/test/test-view-editor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for cp-view-editor (Phase 1): the scratchpad model and pill-edit
descriptor mapping.

The editor's UI gestures are DOM/keyboard-driven and not unit-testable
here, but its core invariants ARE: (a) cloning a view to a scratchpad
leaves the source byte-identical (isolation guarantee), (b) commit modes
write the right persisted tiddler and clean up the scratchpad, (c) the
pill→field descriptor maps facets to the correct ca-view-* fields.

We build a stub widget over a fresh $tw.Wiki(), apply the real
cp-view-editor methods, and no-op the render/stack/focus collaborators
(cp-view-editor only needs the wiki + a handful of view-lookup helpers).
\*/
"use strict";

describe("cascade-palette: cp-view-editor", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var VIEW_TAG = C.VIEW_TAG;

    // Build a stub widget: real cp-view-editor methods over a fresh wiki,
    // with lightweight stand-ins for the cp-views / rendering collaborators
    // that the editor calls (it never inspects their effects here).
    function makeWidget(viewTiddlers) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(proto);
        var self = Object.create(proto);
        self.wiki = new $tw.Wiki();
        (viewTiddlers || []).forEach(function (fields) {
            self.wiki.addTiddler(new $tw.Tiddler(fields));
        });
        self.views = [];
        self.activeView = null;
        // --- collaborators the editor leans on ---
        self._getViewByTitle = function (title) {
            if (!title) return null;
            var t = this.wiki.getTiddler(title);
            if (!t) return null;
            var tags = (t.fields && t.fields.tags) || [];
            return tags.indexOf(VIEW_TAG) >= 0 ? { title: title } : null;
        };
        self._loadViews = function () {
            var titles = this.wiki.filterTiddlers(
                "[all[tiddlers]tag[" + VIEW_TAG + "]]"
            );
            var w = this;
            var defaultTitle = null;
            this.views = titles.map(function (title) {
                var f = (w.wiki.getTiddler(title).fields) || {};
                var order = parseFloat(f["ca-order"]);
                if (!defaultTitle &&
                    (f["ca-view-default"] || "").toLowerCase() === "yes") {
                    defaultTitle = title;
                }
                return {
                    title: title,
                    name: f["ca-view-name"] || title.split("/").pop(),
                    order: isNaN(order) ? 100 : order
                };
            });
            // Mirror the real _loadViews: (re)select the default (or first)
            // view. _reloadViewsPreservingActive restores the kept one on top.
            this.activeView = defaultTitle ||
                (this.views.length ? this.views[0].title : null);
        };
        // No-op render / stack / focus.
        self._setActiveView = function (title) { this.activeView = title; };
        self.buildRootStage = function () { return { kind: "root" }; };
        self.topStage = function () { return this.stack[this.stack.length - 1] || null; };
        self.recomputeStage = function () {};
        self.renderStage = function () {};
        self._renderViewConfigStrip = function () {};
        self._renderViewStrip = function () {};
        self._renderHint = function () {};
        self.setFocus = function () {};
        self._currentViewConfigPill = function () { return null; };
        // Stage stack stand-ins for the layer picker.
        self.pushStage = function (s) { this.stack.push(s); };
        self.popStage = function () { return this.stack.pop(); };
        self._buildCascadeItem = function (f, title) {
            return { title: title, name: f["ca-name"], hint: f["ca-hint"] || "" };
        };
        self.stack = [];
        return self;
    }

    var SRC = "$:/plugins/rimir/cascade-palette/views/all-tiddlers";

    function srcFields(extra) {
        return $tw.utils.extend({
            title: SRC,
            tags: [VIEW_TAG],
            type: "text/vnd.tiddlywiki",
            "ca-view-name": "All tiddlers",
            "ca-view-default": "yes",
            "ca-view-roots": "[all[tiddlers]!is[system]]",
            "ca-view-sort": "alphabetical",
            "ca-order": "200"
        }, extra || {});
    }

    describe("clone isolation", function () {

        it("clones into the scratchpad namespace without touching the source", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);

            var scratch = w._cloneViewToScratchpad(SRC);

            // Source byte-identical.
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
            // Scratchpad lives under the scratchpad prefix.
            expect(scratch.indexOf(C.SCRATCHPAD_PREFIX)).toBe(0);
            // Active view switched to the scratchpad.
            expect(w.activeView).toBe(scratch);

            var sf = w.wiki.getTiddler(scratch).fields;
            // Bookkeeping + copied structure.
            expect(sf[C.SCRATCH_KIND_FIELD]).toBe("view");
            expect(sf[C.SCRATCH_SOURCE_FIELD]).toBe(SRC);
            expect(sf["ca-view-roots"]).toBe("[all[tiddlers]!is[system]]");
            // Default status is never inherited onto a transient copy.
            expect(sf["ca-view-default"]).toBeUndefined();
            // Name carries the editing marker.
            expect(sf["ca-view-name"].indexOf("All tiddlers")).toBe(0);
            expect(sf["ca-view-name"]).not.toBe("All tiddlers");
        });

        it("_scratchpadView detects the active scratchpad, null otherwise", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            expect(w._scratchpadView()).toBeNull();
            var scratch = w._cloneViewToScratchpad(SRC);
            expect(w._scratchpadView()).not.toBeNull();
            expect(w._scratchpadView().title).toBe(scratch);
        });

        it("gives distinct scratchpads for repeated clones", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var a = w._cloneViewToScratchpad(SRC);
            w.activeView = SRC; // pretend the user went back and cloned again
            var b = w._cloneViewToScratchpad(SRC);
            expect(a).not.toBe(b);
            expect(w.wiki.tiddlerExists(a)).toBe(true);
            expect(w.wiki.tiddlerExists(b)).toBe(true);
        });
    });

    describe("commit", function () {

        it("save-as-new prompts for a name (pre-filled, ✎ stripped) wired to finalize", function () {
            var w = makeWidget([srcFields()]);
            // Capture the edit-mode prompt instead of opening DOM input.
            w.enterEditMode = function (item) { this._lastEdit = item; };
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);

            w._commitScratchpad("save-new");

            var item = w._lastEdit;
            expect(item).toBeDefined();
            expect(item.bindField).toBe("ca-view-name");
            // Pre-filled with the source name, editing marker stripped.
            expect(item.initialValue).toBe("All tiddlers");
            expect(typeof item.onCommitFn).toBe("function");
            // The scratchpad still exists until the user commits a name.
            expect(w.wiki.tiddlerExists(scratch)).toBe(true);
        });

        it("_finalizeSaveAsNew writes a fresh view under the typed name, leaving the source intact", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            // User edited roots in the scratchpad.
            var sf = w.wiki.getTiddler(scratch);
            w.wiki.addTiddler(new $tw.Tiddler(sf, { "ca-view-roots": "[tag[Done]]" }));
            var srcBefore = JSON.stringify(w.wiki.getTiddler(SRC).fields);

            w._finalizeSaveAsNew(scratch, "Done items");

            // Scratchpad gone; source byte-identical (the original stays put).
            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(srcBefore);
            // A new persisted view exists with the edited roots, typed name,
            // its own slug, and no default flag / scratch bookkeeping.
            var created = w.wiki.filterTiddlers(
                "[all[tiddlers]tag[" + VIEW_TAG + "]] -[[" + SRC + "]]"
            );
            expect(created.length).toBe(1);
            expect(created[0]).toBe("$:/plugins/rimir/cascade-palette/views/done-items");
            var nf = w.wiki.getTiddler(created[0]).fields;
            expect(nf["ca-view-roots"]).toBe("[tag[Done]]");
            expect(nf["ca-view-name"]).toBe("Done items");
            expect(nf["ca-view-default"]).toBeUndefined();
            expect(nf[C.SCRATCH_KIND_FIELD]).toBeUndefined();
        });

        it("_finalizeSaveAsNew avoids colliding with an existing title", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            // A real tiddler already occupies the slug the name would map to.
            w.wiki.addTiddler(new $tw.Tiddler({
                title: "$:/plugins/rimir/cascade-palette/views/by-parent"
            }));

            w._finalizeSaveAsNew(scratch, "By parent");

            // The pre-existing tiddler is untouched; the new view took -2.
            expect(w.wiki.getTiddler(
                "$:/plugins/rimir/cascade-palette/views/by-parent"
            ).fields["ca-view-name"]).toBeUndefined();
            expect(w.activeView).toBe(
                "$:/plugins/rimir/cascade-palette/views/by-parent-2"
            );
        });

        it("overwrite applies edits to the source, preserving its default flag", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            var sf = w.wiki.getTiddler(scratch);
            w.wiki.addTiddler(new $tw.Tiddler(sf, {
                "ca-view-roots": "[tag[Inbox]]"
            }));

            w._commitScratchpad("overwrite");

            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
            var src = w.wiki.getTiddler(SRC).fields;
            // Edited field applied.
            expect(src["ca-view-roots"]).toBe("[tag[Inbox]]");
            // Non-structural fields preserved (default flag survives).
            expect(src["ca-view-default"]).toBe("yes");
            // Name suffix stripped.
            expect(src["ca-view-name"]).toBe("All tiddlers");
        });

        it("overwrite removes a field the user cleared in the scratchpad", function () {
            var w = makeWidget([srcFields({ "ca-view-children": "[tag<currentTiddler>]" })]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            // Clear children on the scratchpad (drop the field entirely).
            var sf = w.wiki.getTiddler(scratch);
            var cleared = {};
            cleared["ca-view-children"] = undefined;
            w.wiki.addTiddler(new $tw.Tiddler(sf, cleared));
            expect(w.wiki.getTiddler(scratch).fields["ca-view-children"]).toBeUndefined();

            w._commitScratchpad("overwrite");

            expect(w.wiki.getTiddler(SRC).fields["ca-view-children"]).toBeUndefined();
        });

        it("discard deletes the scratchpad and leaves the source untouched", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);
            var scratch = w._cloneViewToScratchpad(SRC);
            w._commitScratchpad("discard");
            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
            expect(w.activeView).toBe(SRC);
        });
    });

    describe("_resolveEditTarget", function () {

        it("clones to a scratchpad and repoints bindTiddler at the active scratchpad", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var pill = { _edit: { bindTiddler: SRC, bindField: "ca-view-roots", editKind: "filter", name: "roots" } };
            var ed = w._resolveEditTarget(pill);
            // A scratchpad was created and is now active.
            expect(w._scratchpadView()).not.toBeNull();
            expect(w.activeView.indexOf(C.SCRATCHPAD_PREFIX)).toBe(0);
            // The resolved target binds to the scratchpad, same field.
            expect(ed.bindTiddler).toBe(w.activeView);
            expect(ed.bindField).toBe("ca-view-roots");
            expect(ed.editKind).toBe("filter");
        });

        it("returns the descriptor as-is when already editing a scratchpad", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            var pill = { _edit: { bindTiddler: scratch, bindField: "ca-view-roots", editKind: "filter" } };
            var ed = w._resolveEditTarget(pill);
            expect(ed.bindTiddler).toBe(scratch);
            // No second scratchpad created.
            var scratchpads = w.wiki.filterTiddlers(
                "[all[tiddlers]prefix[" + C.SCRATCHPAD_PREFIX + "]]"
            );
            expect(scratchpads.length).toBe(1);
        });
    });

    describe("_pillEditDescriptor", function () {

        var w;
        beforeEach(function () {
            w = makeWidget([srcFields()]);
            w.activeView = "V";
        });

        it("maps implicit-layer filter facets to ca-view-* filter fields", function () {
            var layer = { isImplicit: true, title: "V" };
            var d = w._pillEditDescriptor({ kind: "roots" }, layer);
            expect(d).toEqual(jasmine.objectContaining({
                bindTiddler: "V", bindField: "ca-view-roots", editKind: "filter"
            }));
            expect(w._pillEditDescriptor({ kind: "children" }, layer).bindField)
                .toBe("ca-view-children");
            expect(w._pillEditDescriptor({ kind: "entity-type" }, layer).bindField)
                .toBe("ca-view-row-entity-type");
        });

        it("maps the Enter-actions facet as a plain-text field", function () {
            var layer = { isImplicit: true, title: "V" };
            var d = w._pillEditDescriptor({ kind: "actions" }, layer);
            expect(d.bindField).toBe("ca-view-row-actions");
            expect(d.editKind).toBe("text");
        });

        it("maps explicit (shared) channel pills to ca-channel-* with scope:layer", function () {
            var layer = { isImplicit: false, isBuiltIn: false, title: "$:/some/layer" };
            var d = w._pillEditDescriptor({ kind: "roots" }, layer);
            expect(d).toEqual(jasmine.objectContaining({
                bindTiddler: "$:/some/layer",
                bindField: "ca-channel-roots",
                editKind: "filter",
                scope: "layer"
            }));
            // row-entity-type keeps the row- segment under the channel prefix.
            expect(w._pillEditDescriptor({ kind: "entity-type" }, layer).bindField)
                .toBe("ca-channel-row-entity-type");
            // The Enter-actions facet maps to ca-channel-row-actions (text).
            var act = w._pillEditDescriptor({ kind: "actions" }, layer);
            expect(act.bindField).toBe("ca-channel-row-actions");
            expect(act.editKind).toBe("text");
        });

        it("refuses the built-in entries layer (no editable structure)", function () {
            var layer = { isImplicit: false, isBuiltIn: true, title: "$:/.../entries" };
            expect(w._pillEditDescriptor({ kind: "roots" }, layer)).toBeNull();
        });

        it("maps view-scoped enum/toggle facets to the view tiddler", function () {
            var sort = w._pillEditDescriptor({ kind: "sort" }, null);
            expect(sort).toEqual(jasmine.objectContaining({
                bindTiddler: "V", bindField: "ca-view-sort", editKind: "enum"
            }));
            expect(sort.enumValues).toContain("by-field");
            var grouping = w._pillEditDescriptor({ kind: "grouping" }, null);
            expect(grouping.editKind).toBe("toggle");
            expect(w._pillEditDescriptor({ kind: "axis" }, null)).toBeNull();
        });
    });

    describe("_slugTitle", function () {

        it("slugifies and prefixes the name", function () {
            var w = makeWidget([]);
            expect(w._slugTitle("My View!", "$:/x/")).toBe("$:/x/my-view");
            expect(w._slugTitle("  Spaces  &  Stuff ", "$:/x/")).toBe("$:/x/spaces-stuff");
        });

        it("avoids collisions by appending -n", function () {
            var w = makeWidget([]);
            w.wiki.addTiddler(new $tw.Tiddler({ title: "$:/x/dup" }));
            expect(w._slugTitle("dup", "$:/x/")).toBe("$:/x/dup-2");
            w.wiki.addTiddler(new $tw.Tiddler({ title: "$:/x/dup-2" }));
            expect(w._slugTitle("dup", "$:/x/")).toBe("$:/x/dup-3");
        });

        it("falls back to 'view' for an empty slug", function () {
            var w = makeWidget([]);
            expect(w._slugTitle("!!!", "$:/x/")).toBe("$:/x/view");
        });
    });

    describe("lifecycle (new / fork / delete)", function () {

        it("_newViewScratchpad seeds a fresh scratchpad and activates it", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);

            var scratch = w._newViewScratchpad();

            // It's a scratchpad with the bookkeeping fields and sane seeds.
            expect(scratch.indexOf(C.SCRATCHPAD_PREFIX)).toBe(0);
            var sf = w.wiki.getTiddler(scratch).fields;
            expect(sf[C.SCRATCH_KIND_FIELD]).toBe("view");
            expect(sf[C.SCRATCH_SOURCE_FIELD]).toBe(""); // pure-new, no source
            expect(sf["ca-view-roots"]).toBe("[all[tiddlers]!is[system]]");
            expect(sf.tags.indexOf(VIEW_TAG)).toBeGreaterThan(-1);
            expect(w.activeView).toBe(scratch);
            expect(w._scratchpadView()).not.toBeNull();
            // The existing view is untouched.
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
        });

        it("_forkView writes an independent persisted copy, source untouched", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);

            var fork = w._forkView(SRC);

            // Persisted (not a scratchpad) in the views namespace.
            expect(fork.indexOf(C.VIEWS_NS)).toBe(0);
            var ff = w.wiki.getTiddler(fork).fields;
            expect(ff[C.SCRATCH_KIND_FIELD]).toBeUndefined();
            expect(ff["ca-view-roots"]).toBe("[all[tiddlers]!is[system]]");
            // Fork is never the default and is named "<name> (copy)".
            expect(ff["ca-view-default"]).toBeUndefined();
            expect(ff["ca-view-name"]).toBe("All tiddlers (copy)");
            expect(w.activeView).toBe(fork);
            // Source byte-identical.
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
        });

        it("_forkView avoids slug collisions on repeated forks", function () {
            var w = makeWidget([srcFields()]);
            var f1 = w._forkView(SRC);
            var f2 = w._forkView(SRC);
            expect(f1).not.toBe(f2);
        });

        it("_deleteView removes a user view and reselects the default", function () {
            var extra = {
                title: C.VIEWS_NS + "extra",
                tags: [VIEW_TAG],
                "ca-view-name": "Extra",
                "ca-view-roots": "[tag[x]]",
                "ca-order": "300"
            };
            var w = makeWidget([srcFields(), extra]);
            w.activeView = extra.title;

            var ok = w._deleteView(extra.title);

            expect(ok).toBe(true);
            expect(w.wiki.tiddlerExists(extra.title)).toBe(false);
            // Active fell back to the default (All tiddlers).
            expect(w.activeView).toBe(SRC);
        });

        it("_deleteView on the active scratchpad discards it back to source", function () {
            var w = makeWidget([srcFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            expect(w.activeView).toBe(scratch);

            var ok = w._deleteView(scratch);

            expect(ok).toBe(true);
            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
            expect(w.activeView).toBe(SRC); // returned to the source view
        });
    });

    describe("shared-layer editing (Phase 2)", function () {

        var LAYER = "$:/plugins/rimir/cascade-palette/structure-layers/tag-tree";
        var HYBRID = "$:/plugins/rimir/cascade-palette/views/hybrid";

        function layerFields(extra) {
            return $tw.utils.extend({
                title: LAYER,
                tags: [C.STRUCTURE_LAYER_TAG],
                type: "text/vnd.tiddlywiki",
                "ca-layer-name": "Tag tree",
                "ca-layer-roots": "[tag[TableOfContents]]",
                "ca-layer-children": "[tag<currentTiddler>]"
            }, extra || {});
        }
        function hybridFields(extra) {
            return $tw.utils.extend({
                title: HYBRID,
                tags: [VIEW_TAG],
                type: "text/vnd.tiddlywiki",
                "ca-view-name": "Hybrid",
                "ca-view-layers": LAYER,
                "ca-order": "500"
            }, extra || {});
        }

        // Second shared layer, so we can edit two independently.
        var LAYER2 = "$:/plugins/rimir/cascade-palette/structure-layers/path-tree";
        function layer2Fields(extra) {
            return $tw.utils.extend({
                title: LAYER2,
                tags: [C.STRUCTURE_LAYER_TAG],
                type: "text/vnd.tiddlywiki",
                "ca-layer-name": "Path tree",
                "ca-layer-roots": "[all[tiddlers]]"
            }, extra || {});
        }

        it("_beginLayerEdit clones the layer + a preview-only carrier, originals untouched", function () {
            var w = makeWidget([hybridFields(), layerFields()]);
            w.activeView = HYBRID;
            var hybridBefore = JSON.stringify(w.wiki.getTiddler(HYBRID).fields);
            var layerBefore = JSON.stringify(w.wiki.getTiddler(LAYER).fields);

            var scratchLayer = w._beginLayerEdit(LAYER);

            // A layer clone under the scratchpad prefix carrying its source.
            expect(scratchLayer.indexOf(C.SCRATCHPAD_PREFIX)).toBe(0);
            var lf = w.wiki.getTiddler(scratchLayer).fields;
            expect(lf[C.SCRATCH_KIND_FIELD]).toBe("layer");
            expect(lf[C.SCRATCH_SOURCE_FIELD]).toBe(LAYER);
            // The clone normalizes the legacy ca-layer-* source onto ca-channel-*.
            expect(lf["ca-channel-roots"]).toBe("[tag[TableOfContents]]");
            // The active view is a preview-only carrier rewired to the clone.
            var vf = w.wiki.getTiddler(w.activeView).fields;
            expect(vf[C.SCRATCH_KIND_FIELD]).toBe("view");
            expect(vf[C.SCRATCH_PREVIEW_ONLY_FIELD]).toBe("yes");
            expect(vf["ca-view-channels"]).toBe(scratchLayer); // original ref replaced
            // BOTH originals byte-identical (isolation guarantee).
            expect(JSON.stringify(w.wiki.getTiddler(HYBRID).fields)).toBe(hybridBefore);
            expect(JSON.stringify(w.wiki.getTiddler(LAYER).fields)).toBe(layerBefore);
        });

        it("a preview-only carrier shows NO view-level commit pills", function () {
            var w = makeWidget([hybridFields(), layerFields()]);
            w.activeView = HYBRID;
            w._beginLayerEdit(LAYER);
            expect(w._scratchCommitPills()).toEqual([]);
        });

        it("per-layer commit pills target the layer with a consumer count", function () {
            var other = hybridFields({
                title: HYBRID + "-2", "ca-view-name": "Hybrid 2"
            });
            var w = makeWidget([hybridFields(), other, layerFields()]);
            w.activeView = HYBRID;
            var scratchLayer = w._beginLayerEdit(LAYER);

            var pills = w._layerCommitPillsFor(scratchLayer);
            var modes = pills.map(function (p) { return p.commitMode; });
            expect(modes).toEqual(["save-new", "overwrite", "discard"]);
            // Every pill is scoped to THIS layer clone.
            pills.forEach(function (p) { expect(p.commitLayer).toBe(scratchLayer); });
            expect(pills[0].value).toBe("as new layer");
            expect(pills[1].value).toContain("2 views"); // both Hybrids consume it
            expect(w._layerConsumerCount(LAYER)).toBe(2);
            // A non-clone layer title yields no commit pills.
            expect(w._layerCommitPillsFor(LAYER)).toEqual([]);
        });

        it("overwrite writes the layer back over its source and tears down the carrier", function () {
            var w = makeWidget([hybridFields(), layerFields()]);
            w.activeView = HYBRID;
            var scratchLayer = w._beginLayerEdit(LAYER);
            var scratchView = w.activeView;
            w.wiki.setText(scratchLayer, "ca-channel-roots", null, "[tag[Done]]");

            w._commitLayer("overwrite", scratchLayer);

            expect(w.wiki.getTiddler(LAYER).fields["ca-channel-roots"]).toBe("[tag[Done]]");
            expect(w.wiki.tiddlerExists(scratchLayer)).toBe(false);
            expect(w.wiki.tiddlerExists(scratchView)).toBe(false); // preview-only carrier gone
            expect(w.activeView).toBe(HYBRID);
        });

        it("save-as-new writes a fresh layer; source untouched, carrier torn down", function () {
            var w = makeWidget([hybridFields(), layerFields()]);
            w.activeView = HYBRID;
            var scratchLayer = w._beginLayerEdit(LAYER);
            var scratchView = w.activeView;
            w.wiki.setText(scratchLayer, "ca-channel-roots", null, "[tag[Done]]");
            var layerBefore = JSON.stringify(w.wiki.getTiddler(LAYER).fields);

            w._finalizeLayerSaveAsNew(scratchLayer, LAYER, "My tags");

            var created = w.wiki.filterTiddlers(
                "[all[tiddlers]prefix[" + C.CHANNELS_NS + "]] -[[" + LAYER + "]]"
            );
            expect(created.length).toBe(1);
            var nf = w.wiki.getTiddler(created[0]).fields;
            expect(nf["ca-channel-name"]).toBe("My tags");
            expect(nf["ca-channel-roots"]).toBe("[tag[Done]]");
            expect(JSON.stringify(w.wiki.getTiddler(LAYER).fields)).toBe(layerBefore);
            expect(w.wiki.tiddlerExists(scratchLayer)).toBe(false);
            expect(w.wiki.tiddlerExists(scratchView)).toBe(false);
            expect(w.activeView).toBe(HYBRID);
        });

        it("discard reverts the layer ref and changes nothing", function () {
            var w = makeWidget([hybridFields(), layerFields()]);
            w.activeView = HYBRID;
            var hybridBefore = JSON.stringify(w.wiki.getTiddler(HYBRID).fields);
            var layerBefore = JSON.stringify(w.wiki.getTiddler(LAYER).fields);
            var scratchLayer = w._beginLayerEdit(LAYER);
            var scratchView = w.activeView;

            w._commitLayer("discard", scratchLayer);

            expect(w.wiki.tiddlerExists(scratchLayer)).toBe(false);
            expect(w.wiki.tiddlerExists(scratchView)).toBe(false);
            expect(w.activeView).toBe(HYBRID);
            expect(JSON.stringify(w.wiki.getTiddler(HYBRID).fields)).toBe(hybridBefore);
            expect(JSON.stringify(w.wiki.getTiddler(LAYER).fields)).toBe(layerBefore);
        });

        it("edits two layers independently — committing one keeps the other in edit", function () {
            var w = makeWidget([
                hybridFields({ "ca-view-layers": LAYER + " " + LAYER2 }),
                layerFields(), layer2Fields()
            ]);
            w.activeView = HYBRID;

            var clone1 = w._beginLayerEdit(LAYER);
            var carrier = w.activeView;
            var clone2 = w._beginLayerEdit(LAYER2);
            // Same carrier reused; both layer refs are clones now.
            expect(w.activeView).toBe(carrier);
            expect(w._scratchLayerRefs(carrier).sort())
                .toEqual([clone1, clone2].sort());

            // Commit (discard) only the first; the carrier survives because
            // the second layer is still being edited.
            w._commitLayer("discard", clone1);
            expect(w.wiki.tiddlerExists(clone1)).toBe(false);
            expect(w.wiki.tiddlerExists(clone2)).toBe(true);
            expect(w.wiki.tiddlerExists(carrier)).toBe(true);
            expect(w.activeView).toBe(carrier);
            // The carrier now references the original LAYER + the 2nd clone.
            expect(w._scratchLayerRefs(carrier)).toEqual([clone2]);

            // Commit the second; now the carrier is spent → torn down.
            w._commitLayer("discard", clone2);
            expect(w.wiki.tiddlerExists(clone2)).toBe(false);
            expect(w.wiki.tiddlerExists(carrier)).toBe(false);
            expect(w.activeView).toBe(HYBRID);
        });
    });

    describe("layer composition (ca-view-layers add / remove / reorder)", function () {

        var L1 = "$:/plugins/rimir/cascade-palette/structure-layers/tag-tree";
        var L2 = "$:/plugins/rimir/cascade-palette/structure-layers/path-tree";
        var HYBRID = "$:/plugins/rimir/cascade-palette/views/hybrid";

        function layerFields(title, name) {
            return {
                title: title, tags: [C.STRUCTURE_LAYER_TAG], type: "text/vnd.tiddlywiki",
                "ca-layer-name": name, "ca-layer-roots": "[tag[x]]"
            };
        }
        function hybridFields(layers) {
            return {
                title: HYBRID, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
                "ca-view-name": "Hybrid", "ca-view-layers": layers, "ca-order": "500"
            };
        }
        function setup(layers) {
            var w = makeWidget([
                hybridFields(layers), layerFields(L1, "Tag tree"), layerFields(L2, "Path tree")
            ]);
            w.activeView = HYBRID;
            return w;
        }

        it("_addLayerToView clones the view and appends the layer ref", function () {
            var w = setup(L1);
            var before = JSON.stringify(w.wiki.getTiddler(HYBRID).fields);

            w._addLayerToView(L2);

            // Active is now a view scratchpad with both layers referenced.
            expect(w._isScratchpadTitle(w.activeView)).toBe(true);
            expect(w._viewLayerRefs(w.activeView)).toEqual([L1, L2]);
            // Source view untouched until commit.
            expect(JSON.stringify(w.wiki.getTiddler(HYBRID).fields)).toBe(before);
        });

        it("_addLayerToView is idempotent (no duplicate ref)", function () {
            var w = setup(L1 + " " + L2);
            w._addLayerToView(L2);
            expect(w._viewLayerRefs(w.activeView)).toEqual([L1, L2]);
        });

        it("_removeLayerFromView drops the ref", function () {
            var w = setup(L1 + " " + L2);
            w._removeLayerFromView(L1);
            expect(w._viewLayerRefs(w.activeView)).toEqual([L2]);
        });

        it("_moveLayerInView reorders the refs", function () {
            var w = setup(L1 + " " + L2);
            w._moveLayerInView(L2, -1);
            expect(w._viewLayerRefs(w.activeView)).toEqual([L2, L1]);
            // Clamped at the ends (no-op past the edge).
            w._moveLayerInView(L2, -1);
            expect(w._viewLayerRefs(w.activeView)).toEqual([L2, L1]);
        });

        it("_openLayerPicker offers only layers not already in the view", function () {
            var w = setup(L1);
            w._openLayerPicker();
            var stage = w.stack[w.stack.length - 1];
            expect(stage._isLayerPicker).toBe(true);
            var titles = stage.items.map(function (it) { return it.title; });
            expect(titles).toContain(L2);   // available
            expect(titles).not.toContain(L1); // already present
        });

        it("_applyLayerPick adds the picked layer to the view", function () {
            var w = setup(L1);
            w._applyLayerPick({ _isLayerPicker: true }, { title: L2 });
            expect(w._viewLayerRefs(w.activeView)).toEqual([L1, L2]);
        });
    });

    describe("implicit→explicit migration (H2)", function () {

        var L2 = "$:/plugins/rimir/cascade-palette/structure-layers/path-tree";

        // An implicit view: structure lives in ca-view-* fields, no layers.
        function implicitFields(extra) {
            return $tw.utils.extend({
                title: SRC, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
                "ca-view-name": "All tiddlers",
                "ca-view-roots": "[all[tiddlers]!is[system]]",
                "ca-view-children": "[tag<currentTiddler>]",
                "ca-view-row-actions": "<$action-navigate/>",
                "ca-view-sort": "alphabetical",
                "ca-order": "200"
            }, extra || {});
        }
        function sharedLayer() {
            return {
                title: L2, tags: [C.STRUCTURE_LAYER_TAG], type: "text/vnd.tiddlywiki",
                "ca-layer-name": "Path tree", "ca-layer-roots": "[tag[x]]"
            };
        }

        it("lifts ca-view-* structure onto a migrated layer and strips it from the view", function () {
            var w = makeWidget([implicitFields()]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);

            var layerScratch = w._migrateImplicitToExplicit(scratch);

            expect(layerScratch).not.toBeNull();
            expect(w._isScratchpadTitle(layerScratch)).toBe(true);
            var lf = w.wiki.getTiddler(layerScratch).fields;
            // ca-view-* → ca-channel-*.
            expect(lf["ca-channel-roots"]).toBe("[all[tiddlers]!is[system]]");
            expect(lf["ca-channel-children"]).toBe("[tag<currentTiddler>]");
            expect(lf["ca-channel-row-actions"]).toBe("<$action-navigate/>");
            // Migrated/new channel: kind=layer, NO source (commits with view).
            expect(lf[C.SCRATCH_KIND_FIELD]).toBe("layer");
            expect(lf[C.SCRATCH_SOURCE_FIELD]).toBe("");

            var vf = w.wiki.getTiddler(scratch).fields;
            expect(vf["ca-view-channels"]).toBe(layerScratch);
            // Structural fields stripped; view-level policy preserved.
            expect(vf["ca-view-roots"]).toBeUndefined();
            expect(vf["ca-view-children"]).toBeUndefined();
            expect(vf["ca-view-row-actions"]).toBeUndefined();
            expect(vf["ca-view-sort"]).toBe("alphabetical");
        });

        it("is a no-op on an already-explicit view", function () {
            var w = makeWidget([implicitFields({ "ca-view-layers": L2 })]);
            w.activeView = SRC;
            var scratch = w._cloneViewToScratchpad(SRC);
            expect(w._migrateImplicitToExplicit(scratch)).toBeNull();
        });

        it("_addLayerToView migrates an implicit view, then appends the layer", function () {
            var w = makeWidget([implicitFields(), sharedLayer()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);

            w._addLayerToView(L2);

            var refs = w._viewLayerRefs(w.activeView);
            expect(refs.length).toBe(2);
            expect(w._isScratchpadTitle(refs[0])).toBe(true); // migrated layer
            expect(refs[1]).toBe(L2);                          // appended shared layer
            // Source view byte-identical until commit.
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
        });

        it("save-as-new persists the migrated layer and a view referencing it", function () {
            var w = makeWidget([implicitFields(), sharedLayer()]);
            w.activeView = SRC;
            w._addLayerToView(L2);
            var scratch = w.activeView;
            var migratedScratch = w._viewLayerRefs(scratch)[0];

            w._finalizeSaveAsNew(scratch, "My View");

            var newView = w.activeView;
            expect(w._isScratchpadTitle(newView)).toBe(false);
            var nvf = w.wiki.getTiddler(newView).fields;
            var layers = nvf["ca-view-channels"].split(" ");
            expect(layers.length).toBe(2);
            // Migrated channel persisted under the channels namespace; shared one passes through.
            expect(layers[0].indexOf(C.CHANNELS_NS)).toBe(0);
            expect(layers[1]).toBe(L2);
            expect(w.wiki.getTiddler(layers[0]).fields["ca-channel-roots"])
                .toBe("[all[tiddlers]!is[system]]");
            // The new view carries no structural ca-view-* fields.
            expect(nvf["ca-view-roots"]).toBeUndefined();
            // Scratchpads cleaned up.
            expect(w.wiki.getTiddler(scratch)).toBeUndefined();
            expect(w.wiki.getTiddler(migratedScratch)).toBeUndefined();
            // Source view untouched.
            expect(w.wiki.getTiddler(SRC).fields["ca-view-roots"])
                .toBe("[all[tiddlers]!is[system]]");
        });

        it("overwrite converts the source view to explicit form, dropping the migrated fields", function () {
            var w = makeWidget([implicitFields(), sharedLayer()]);
            w.activeView = SRC;
            w._addLayerToView(L2);
            var scratch = w.activeView;

            w._commitScratchpad("overwrite");

            var sf = w.wiki.getTiddler(SRC).fields;
            var layers = sf["ca-view-channels"].split(" ");
            expect(layers.length).toBe(2);
            expect(layers[0].indexOf(C.CHANNELS_NS)).toBe(0);
            expect(layers[1]).toBe(L2);
            // Migrated structural fields removed from the (now explicit) view.
            expect(sf["ca-view-roots"]).toBeUndefined();
            expect(sf["ca-view-children"]).toBeUndefined();
            // View-level policy retained.
            expect(sf["ca-view-sort"]).toBe("alphabetical");
            // Scratchpad gone.
            expect(w.wiki.getTiddler(scratch)).toBeUndefined();
        });

        it("discard cleans up the migrated layer scratchpad, leaving the source intact", function () {
            var w = makeWidget([implicitFields(), sharedLayer()]);
            w.activeView = SRC;
            var before = JSON.stringify(w.wiki.getTiddler(SRC).fields);
            w._addLayerToView(L2);
            var scratch = w.activeView;
            var migratedScratch = w._viewLayerRefs(scratch)[0];

            w._commitScratchpad("discard");

            expect(w.wiki.getTiddler(scratch)).toBeUndefined();
            expect(w.wiki.getTiddler(migratedScratch)).toBeUndefined();
            expect(JSON.stringify(w.wiki.getTiddler(SRC).fields)).toBe(before);
        });
    });
});
