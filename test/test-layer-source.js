/*\
title: $:/plugins/rimir/cascade-palette/test/test-layer-source.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H1 (model harmonization) — the `ca-layer-source` discriminator.

A structure-layer's producer is selected by `ca-layer-source`:
  "filter" (default) — raw-filter layer (ca-layer-roots/children/leaf)
  "entries"          — JS-backed position-driven producer

`isBuiltIn` is derived (`source !== "filter"`), the shipped entries
tiddler is the single source of truth (_builtInEntriesLayer loads it),
and the entries layer is auto-appended only when not already referenced
explicitly (no double-add).
\*/
"use strict";

describe("cascade-palette: ca-layer-source (H1)", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LAYER_TAG = C.STRUCTURE_LAYER_TAG;
    var VIEW_TAG = C.VIEW_TAG;
    var ENTRY_TAG = C.ENTRY_TAG;
    var ENTRIES_LAYER =
        "$:/plugins/rimir/cascade-palette/channels/entries";

    // A proto carrying the real cp-views methods over a fresh wiki.
    function makeWidget(tiddlers) {
        var proto = {};
        setup(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        return w;
    }

    function entriesLayerFields() {
        return {
            title: ENTRIES_LAYER,
            tags: [LAYER_TAG],
            type: "text/vnd.tiddlywiki",
            "ca-layer-name": "Entries",
            "ca-layer-source": "entries",
            "ca-layer-roots": "[tag[" + ENTRY_TAG + "]]",
            "ca-layer-children": "[tag[" + ENTRY_TAG + "]]"
        };
    }

    function entriesCount(view) {
        return view.layers.filter(function (l) {
            return l.source === "entries";
        }).length;
    }

    describe("_loadLayer", function () {

        it("a plain layer defaults to source 'filter' and is not built-in", function () {
            var w = makeWidget([{
                title: "$:/x/tag-tree",
                tags: [LAYER_TAG],
                "ca-layer-name": "Tag tree",
                "ca-layer-roots": "[tag[TableOfContents]]",
                "ca-layer-children": "[tag<currentTiddler>]"
            }]);
            var layer = w._loadLayer("$:/x/tag-tree");
            expect(layer.source).toBe("filter");
            expect(layer.isBuiltIn).toBe(false);
            expect(layer.roots).toBe("[tag[TableOfContents]]");
        });

        it("ca-layer-source: entries yields source 'entries', derived built-in", function () {
            var w = makeWidget([entriesLayerFields()]);
            var layer = w._loadLayer(ENTRIES_LAYER);
            expect(layer.source).toBe("entries");
            expect(layer.isBuiltIn).toBe(true);
            expect(layer.name).toBe("Entries");
        });
    });

    describe("_builtInEntriesLayer", function () {

        it("loads the shipped entries tiddler as the single source of truth", function () {
            var w = makeWidget([entriesLayerFields()]);
            var layer = w._builtInEntriesLayer();
            expect(layer.title).toBe(ENTRIES_LAYER);
            expect(layer.source).toBe("entries");
            expect(layer.name).toBe("Entries");
        });

        it("falls back to a synthetic descriptor when the tiddler is absent", function () {
            var w = makeWidget([]); // no entries tiddler
            var layer = w._builtInEntriesLayer();
            expect(layer.source).toBe("entries");
            expect(layer.isBuiltIn).toBe(true);
            expect(layer.title).toBe(ENTRIES_LAYER);
        });
    });

    describe("_loadView entries-layer inclusion", function () {

        it("auto-appends one entries layer to a tree view (children present)", function () {
            var w = makeWidget([entriesLayerFields(), {
                title: "$:/v/tree",
                tags: [VIEW_TAG],
                "ca-view-name": "Tree",
                "ca-view-roots": "[!is[system]]",
                "ca-view-children": "[!is[system]cp-child-of<currentTiddler>]"
            }]);
            var view = w._loadView("$:/v/tree");
            expect(entriesCount(view)).toBe(1);
        });

        it("does NOT auto-append for a flat view (no children, auto)", function () {
            var w = makeWidget([entriesLayerFields(), {
                title: "$:/v/flat",
                tags: [VIEW_TAG],
                "ca-view-name": "Flat",
                "ca-view-roots": "[!is[system]]"
            }]);
            var view = w._loadView("$:/v/flat");
            expect(entriesCount(view)).toBe(0);
        });

        it("does not double-add when entries is referenced explicitly", function () {
            // include-entries auto + the explicit entries layer (whose own
            // children make _shouldIncludeEntriesLayer true) must still yield
            // exactly one entries layer.
            var w = makeWidget([entriesLayerFields(), {
                title: "$:/v/explicit",
                tags: [VIEW_TAG],
                "ca-view-name": "Explicit",
                "ca-view-layers": ENTRIES_LAYER
            }]);
            var view = w._loadView("$:/v/explicit");
            expect(entriesCount(view)).toBe(1);
        });

        it("ca-view-include-entries: no suppresses the auto-append", function () {
            var w = makeWidget([entriesLayerFields(), {
                title: "$:/v/notree",
                tags: [VIEW_TAG],
                "ca-view-name": "No entries",
                "ca-view-roots": "[!is[system]]",
                "ca-view-children": "[!is[system]cp-child-of<currentTiddler>]",
                "ca-view-include-entries": "no"
            }]);
            var view = w._loadView("$:/v/notree");
            expect(entriesCount(view)).toBe(0);
        });
    });
});
