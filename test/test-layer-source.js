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

    // dataRow gates the row-decoration lenses (name / icon). An entry tiddler
    // is a palette COMMAND with an authored ca-name — never user data — so it
    // must stay dataRow:false even when a view surfaces it through its OWN
    // roots filter (the shipped "Entries" view does: ca-view-roots
    // [...tag[entry]]). Without the tag check the default Caption→Title name
    // lens relabelled every command to its raw $:/… title.
    describe("data-row exemption for entry COMMAND tiddlers", function () {

        var setupItems =
            require("$:/plugins/rimir/cascade-palette/widgets/cp-items");

        // Widget carrying the row-building (cp-views) + item (cp-items)
        // methods; filters/visibility neutralised so _evaluateLayer takes the
        // plain roots path.
        function rowWidget(tiddlers) {
            var proto = {};
            setup(proto);
            setupItems(proto);
            var w = Object.create(proto);
            w.wiki = new $tw.Wiki();
            w.filters = [];
            (tiddlers || []).forEach(function (f) {
                w.wiki.addTiddler(new $tw.Tiddler(f));
            });
            w._composeFilterSuffix = function () { return ""; }; // no active filters
            w.isEntryVisible = function () { return true; };      // isolate visibility
            w.resolveGroup = function (t, f) {                    // cp-actions dep
                return (f && f["ca-group"]) || "";
            };
            return w;
        }

        // A bare implicit "filter" channel mimicking the Entries view's
        // ca-view-roots — surfaces the candidate as a data source, NOT via the
        // built-in entries channel.
        function filterLayer() {
            return {
                title: "$:/v/x", source: "filter", isImplicit: true,
                roots: "[tag[" + ENTRY_TAG + "]]", children: "", leaf: "",
                axes: "", includePosition: true, name: "Entries",
                rowName: "", rowHint: "", rowIcon: "", rowKind: "",
                rowGroup: "", rowOrder: "", rowActions: "",
                rowEntityType: "", rowNextScope: "", rowItemsFrom: ""
            };
        }
        var view = {
            title: "$:/v/x", name: "Entries", layers: [],
            showCount: false, pickMode: false
        };

        it("an entry surfaced via a roots filter is NOT a data row (keeps ca-name)", function () {
            var w = rowWidget([{
                title: "$:/cp/entries/find-entity",
                tags: [ENTRY_TAG],
                "ca-name": "Find entity"
            }]);
            w._applyFilterSuffix = function () { return ["$:/cp/entries/find-entity"]; };
            var rows = w._evaluateLayer(view, filterLayer(), 0, "", []);
            expect(rows.length).toBe(1);
            expect(rows[0].dataRow).toBe(false);      // command → name lens skipped
            expect(rows[0].name).toBe("Find entity"); // ca-name preserved, not title
        });

        it("a non-entry tiddler surfaced the same way IS a data row", function () {
            var w = rowWidget([{ title: "PlainNote", text: "hi" }]);
            w._applyFilterSuffix = function () { return ["PlainNote"]; };
            var rows = w._evaluateLayer(view, filterLayer(), 0, "", []);
            expect(rows.length).toBe(1);
            expect(rows[0].dataRow).toBe(true);
        });
    });
});
