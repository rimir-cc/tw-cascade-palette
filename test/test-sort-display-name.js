/*\
title: $:/plugins/rimir/cascade-palette/test/test-sort-display-name.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Verifies that name-based view sorts (_sortRowsForView) order rows by the
DISPLAYED (lensed) name, not the raw title — so a caption lens makes the
visible order alphabetical by caption. Covers root, tree + containers-first,
and documents the custom-sort branch (author key drives it).
\*/
"use strict";

describe("cascade-palette: sort by displayed name", function () {

    // caption map: title -> caption (chosen so caption order != title order)
    var CAP = { "z-tid": "Alpha", "a-tid": "Zeta", "m-tid": "Mike" };

    function makeWidget() {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-items")(proto);
        require("$:/plugins/rimir/cascade-palette/widgets/cp-views")(proto);
        var w = Object.create(proto);
        // Simulate an active caption name-lens: _displayNameForItem ->
        // _resolveRowDecorations -> {name: caption}. Channel-aware in the
        // real code; here we just return the caption for every data row.
        w._resolveRowDecorations = function (item) {
            if (!item || !item.dataRow || !item.title) {
                return { name: null, icon: null, annotation: null };
            }
            return { name: CAP[item.title] || item.title, icon: null, annotation: null };
        };
        return w;
    }

    // Plain row object — `name` is the raw title (as ca-view-row-name:
    // [<currentTiddler>] would produce); the caption only surfaces via the
    // lens stub, so sorting must consult _displayNameForItem to pick it up.
    function row(title, extra) {
        var item = { title: title, name: title, order: 100, dataRow: true };
        if (extra) Object.keys(extra).forEach(function (k) { item[k] = extra[k]; });
        return item;
    }

    it("alphabetical view sorts by displayed caption, not title", function () {
        var w = makeWidget();
        var rows = [row("z-tid"), row("a-tid"), row("m-tid")];
        var sorted = w._sortRowsForView(rows, { sort: "alphabetical" });
        // caption order: Alpha(z-tid), Mike(m-tid), Zeta(a-tid)
        expect(sorted.map(function (r) { return r.title; }))
            .toEqual(["z-tid", "m-tid", "a-tid"]);
    });

    it("tree + containers-first: containers (by caption) then leaves (by caption)", function () {
        var w = makeWidget();
        var rows = [
            row("z-tid", { _treeContainer: true }),  // Alpha, container
            row("a-tid"),                              // Zeta, leaf
            row("m-tid", { _treeContainer: true })   // Mike, container
        ];
        var sorted = w._sortRowsForView(rows,
            { sort: "alphabetical", isTree: true, containersFirst: true });
        // containers first by caption: Alpha(z), Mike(m); then leaf Zeta(a)
        expect(sorted.map(function (r) { return r.title; }))
            .toEqual(["z-tid", "m-tid", "a-tid"]);
    });

    it("tree WITHOUT containers-first: pure caption order across all nodes", function () {
        var w = makeWidget();
        var rows = [
            row("z-tid", { _treeContainer: true }),  // Alpha
            row("a-tid"),                              // Zeta
            row("m-tid")                               // Mike
        ];
        var sorted = w._sortRowsForView(rows,
            { sort: "alphabetical", isTree: true, containersFirst: false });
        expect(sorted.map(function (r) { return r.title; }))
            .toEqual(["z-tid", "m-tid", "a-tid"]);
    });
});
