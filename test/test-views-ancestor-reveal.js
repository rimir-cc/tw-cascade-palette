/*\
title: $:/plugins/rimir/cascade-palette/test/test-views-ancestor-reveal.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the filter-pill ancestor-reveal mechanic in cp-views.

In tree-container layers (have `children`, no `axes`), a filter pill
that matches only deep descendants would normally empty the tree —
`_applyFilterSuffix` applies per-level and drops any ancestor that
didn't itself match. `_getRevealedSet` walks the layer skeleton once,
collects matching titles + all their ancestors, and returns
`{matched, revealed}` consumed by `_evaluateLayer` / `_isLeafInLayer`.

These specs exercise `_getRevealedSet` with a mocked layer + filter
helpers so the BFS logic is testable without spinning up a real wiki.
\*/
"use strict";

describe("cascade-palette: filter-pill ancestor reveal (_getRevealedSet)", function () {

    var cpViewsModule = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");

    // Build a tree as a parent->children map. Used by the stubs below
    // to answer `_filterInScope(layer.children, {currentTiddler: p})`
    // and `_filterInScope(layer.roots, null)`.
    //
    // Schema:
    //   tree = { _roots: [t1, t2, ...], <title>: [child1, child2, ...] }
    // Filter:
    //   matched = Set<title> — those that match the active filter
    //   suffix  = string — _composeFilterSuffix() return value
    //   visible = Set<title> | true — those passing isEntryVisible (true = all)
    function buildStub(tree, matched, suffix, visible) {
        var stub = {
            wiki: {},
            _composeFilterSuffix: function () { return suffix || ""; },
            _filterInScope: function (filterExpr, vars) {
                // Distinguish "roots" from "children": roots has no
                // currentTiddler in vars; children has one. Filter
                // expression text is ignored (the tree map is the
                // source of truth in this stub).
                if (!vars) return (tree._roots || []).slice();
                var p = vars.currentTiddler;
                return (tree[p] || []).slice();
            },
            _applyFilterSuffix: function (filterExpr, vars) {
                var raw = this._filterInScope(filterExpr, vars);
                if (!suffix) return raw;
                return raw.filter(function (t) { return matched[t]; });
            },
            isEntryVisible: function (title) {
                if (visible === true || visible === undefined) return true;
                return !!visible[title];
            }
        };
        cpViewsModule(stub);
        return stub;
    }

    function setOf(obj) {
        var out = [];
        for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(k);
        out.sort();
        return out;
    }

    var layer = { title: "L", roots: "ROOTS", children: "CHILDREN" };
    var layerAxes = {
        title: "L", roots: "ROOTS", children: "CHILDREN", axes: "AX"
    };
    var layerNoChildren = { title: "L", roots: "ROOTS", children: "" };

    describe("gate conditions", function () {
        it("returns null when no filter pills active", function () {
            var s = buildStub({ _roots: ["a"], a: [] }, {}, "");
            expect(s._getRevealedSet(layer)).toBeNull();
        });

        it("returns null when layer has no children filter", function () {
            var s = buildStub({ _roots: ["a"] }, { a: true }, "+[tag[X]]");
            expect(s._getRevealedSet(layerNoChildren)).toBeNull();
        });

        it("returns null when layer drives an axis chain", function () {
            var s = buildStub({ _roots: ["a"] }, { a: true }, "+[tag[X]]");
            expect(s._getRevealedSet(layerAxes)).toBeNull();
        });

        it("returns null when layer is missing", function () {
            var s = buildStub({}, {}, "+[tag[X]]");
            expect(s._getRevealedSet(null)).toBeNull();
        });
    });

    describe("BFS + back-walk", function () {
        it("filter matches a root only: revealed = matched = {root}", function () {
            var tree = { _roots: ["A", "B"], A: [], B: [] };
            var s = buildStub(tree, { A: true }, "+[tag[X]]");
            var r = s._getRevealedSet(layer);
            expect(setOf(r.matched)).toEqual(["A"]);
            expect(setOf(r.revealed)).toEqual(["A"]);
        });

        it("filter matches a leaf 3 deep: ancestors revealed", function () {
            // R -> P -> C -> L (L matches)
            var tree = {
                _roots: ["R"],
                R: ["P"], P: ["C"], C: ["L"], L: []
            };
            var s = buildStub(tree, { L: true }, "+[tag[X]]");
            var r = s._getRevealedSet(layer);
            expect(setOf(r.matched)).toEqual(["L"]);
            expect(setOf(r.revealed)).toEqual(["C", "L", "P", "R"]);
        });

        it("filter matches multiple siblings: separate paths reveal", function () {
            // R -> {A, B}; A -> {a1, a2}; B -> {b1}
            // matches: a2, b1
            var tree = {
                _roots: ["R"],
                R: ["A", "B"], A: ["a1", "a2"], B: ["b1"],
                a1: [], a2: [], b1: []
            };
            var s = buildStub(tree, { a2: true, b1: true }, "+[tag[X]]");
            var r = s._getRevealedSet(layer);
            expect(setOf(r.matched)).toEqual(["a2", "b1"]);
            expect(setOf(r.revealed)).toEqual(["A", "B", "R", "a2", "b1"]);
        });

        it("multiple roots, filter matches a leaf under one only", function () {
            var tree = {
                _roots: ["R1", "R2"],
                R1: ["x"], R2: ["y"], x: [], y: []
            };
            var s = buildStub(tree, { x: true }, "+[tag[X]]");
            var r = s._getRevealedSet(layer);
            expect(setOf(r.revealed)).toEqual(["R1", "x"]);
        });

        it("BFS terminates on cycles (A is parent of B, B is parent of A)", function () {
            var tree = {
                _roots: ["A"],
                A: ["B"], B: ["A"]
            };
            var s = buildStub(tree, { B: true }, "+[tag[X]]");
            var r = s._getRevealedSet(layer);
            // BFS sees A first (root), enqueues B as A's child, then
            // when processing B sees A already in `seen` so doesn't
            // re-enqueue. Walk-up from B: parentOf[B]=A, A has no
            // parentOf entry (root), so revealed = {B, A}.
            expect(setOf(r.matched)).toEqual(["B"]);
            expect(setOf(r.revealed)).toEqual(["A", "B"]);
        });
    });

    describe("visibility integration", function () {
        it("hidden tiddlers do not reveal ancestors", function () {
            // R -> P -> L (L matches but L is invisible)
            var tree = {
                _roots: ["R"],
                R: ["P"], P: ["L"], L: []
            };
            var s = buildStub(
                tree,
                { L: true },
                "+[tag[X]]",
                { R: true, P: true } // L not visible
            );
            var r = s._getRevealedSet(layer);
            expect(setOf(r.matched)).toEqual([]);
            expect(setOf(r.revealed)).toEqual([]);
        });

        it("hidden ancestors still get walked-up through (no break)", function () {
            // R -> P -> L (P invisible, L matches and is visible)
            // The walk-up doesn't apply visibility — it traverses
            // parent pointers from a visible match. So R appears
            // even though P is invisible (P appears too, since
            // revealed tracks the parent chain).
            var tree = {
                _roots: ["R"],
                R: ["P"], P: ["L"], L: []
            };
            var s = buildStub(
                tree,
                { L: true },
                "+[tag[X]]",
                { R: true, L: true } // P invisible
            );
            var r = s._getRevealedSet(layer);
            expect(setOf(r.matched)).toEqual(["L"]);
            expect(setOf(r.revealed)).toEqual(["L", "P", "R"]);
        });
    });

    describe("caching", function () {
        it("same (layer, suffix) returns cached result", function () {
            var tree = { _roots: ["A"], A: [] };
            var s = buildStub(tree, { A: true }, "+[tag[X]]");
            var first = s._getRevealedSet(layer);
            var second = s._getRevealedSet(layer);
            expect(second).toBe(first);
        });

        it("different suffix invalidates the cache", function () {
            var tree = { _roots: ["A", "B"], A: [], B: [] };
            // First pass: match A only
            var s = buildStub(tree, { A: true }, "+[tag[X]]");
            var first = s._getRevealedSet(layer);
            expect(setOf(first.matched)).toEqual(["A"]);
            // Mutate the stub to change suffix + matches, simulating
            // the user adding a new pill
            s._composeFilterSuffix = function () { return "+[tag[Y]]"; };
            s._applyFilterSuffix = function (filterExpr, vars) {
                var raw = this._filterInScope(filterExpr, vars);
                return raw.filter(function (t) { return t === "B"; });
            };
            var second = s._getRevealedSet(layer);
            expect(second).not.toBe(first);
            expect(setOf(second.matched)).toEqual(["B"]);
        });
    });
});
