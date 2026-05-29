/*\
title: $:/plugins/rimir/cascade-palette/test/test-axes.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for cp-axes pure functions: parseChainSpec, groupBy, sortGroups.

These are framework-free helpers that the engine uses for grouping rows
by derived keys. They have no dependencies on $tw.wiki state or DOM, so
they're trivially testable here.
\*/
"use strict";

describe("cascade-palette: cp-axes", function () {

    var axes = require("$:/plugins/rimir/cascade-palette/widgets/cp-axes");

    describe("parseChainSpec", function () {

        it("returns empty array for null/undefined/empty inputs", function () {
            expect(axes.parseChainSpec(null)).toEqual([]);
            expect(axes.parseChainSpec(undefined)).toEqual([]);
            expect(axes.parseChainSpec("")).toEqual([]);
            expect(axes.parseChainSpec("   ")).toEqual([]);
        });

        it("parses space-separated axis titles", function () {
            var spec = axes.parseChainSpec("axis-a axis-b axis-c");
            expect(spec.length).toBe(3);
            expect(spec[0]).toEqual({ title: "axis-a", params: null });
            expect(spec[1]).toEqual({ title: "axis-b", params: null });
            expect(spec[2]).toEqual({ title: "axis-c", params: null });
        });

        it("collapses multiple whitespace", function () {
            var spec = axes.parseChainSpec("  axis-a   axis-b\taxis-c  ");
            expect(spec.length).toBe(3);
        });

        it("parses JSON array of strings", function () {
            var spec = axes.parseChainSpec('["axis-a","axis-b"]');
            expect(spec.length).toBe(2);
            expect(spec[0]).toEqual({ title: "axis-a", params: null });
            expect(spec[1]).toEqual({ title: "axis-b", params: null });
        });

        it("parses JSON array of objects with params", function () {
            var spec = axes.parseChainSpec(
                '[{"title":"by-field","params":{"field":"status"}},{"title":"by-year"}]'
            );
            expect(spec.length).toBe(2);
            expect(spec[0].title).toBe("by-field");
            expect(spec[0].params).toEqual({ field: "status" });
            expect(spec[1].title).toBe("by-year");
            expect(spec[1].params).toBeNull();
        });

        it("filters out entries without a title", function () {
            var spec = axes.parseChainSpec('[{"title":"a"},{"params":{"x":1}},{"title":"b"}]');
            expect(spec.length).toBe(2);
            expect(spec[0].title).toBe("a");
            expect(spec[1].title).toBe("b");
        });

        it("falls back to space-separated on malformed JSON", function () {
            // Open bracket but invalid JSON — falls through to space-split.
            var spec = axes.parseChainSpec("[bad json");
            expect(spec.length).toBe(2);
            expect(spec[0].title).toBe("[bad");
            expect(spec[1].title).toBe("json");
        });
    });

    describe("groupBy", function () {

        it("returns [] for empty input", function () {
            var groups = axes.groupBy([], function (x) { return x; });
            expect(groups).toEqual([]);
        });

        it("groups items by key in first-seen order", function () {
            var items = ["a1", "b1", "a2", "c1", "b2"];
            var groups = axes.groupBy(items, function (s) { return s.charAt(0); });
            expect(groups.length).toBe(3);
            expect(groups[0].key).toBe("a");
            expect(groups[0].items).toEqual(["a1", "a2"]);
            expect(groups[1].key).toBe("b");
            expect(groups[1].items).toEqual(["b1", "b2"]);
            expect(groups[2].key).toBe("c");
            expect(groups[2].items).toEqual(["c1"]);
        });

        it("collapses empty/null/undefined keys to UNSET_KEY", function () {
            var items = ["a", "b", "c"];
            var keys = ["X", null, ""];
            var groups = axes.groupBy(items, function (s) {
                return keys[items.indexOf(s)];
            });
            expect(groups.length).toBe(2);
            var unsetGroup = groups.filter(function (g) { return g.key === axes.UNSET_KEY; })[0];
            expect(unsetGroup).toBeDefined();
            expect(unsetGroup.items.length).toBe(2);
            expect(unsetGroup.items.indexOf("b")).toBeGreaterThan(-1);
            expect(unsetGroup.items.indexOf("c")).toBeGreaterThan(-1);
        });
    });

    describe("sortGroups", function () {

        function makeEntries(keys) {
            return keys.map(function (k) { return { key: k, label: k, count: 1 }; });
        }

        it("first-seen / no axis = no change", function () {
            var entries = makeEntries(["c", "a", "b"]);
            axes.sortGroups(entries, { sort: "first-seen" });
            expect(entries.map(function (e) { return e.key; })).toEqual(["c", "a", "b"]);
        });

        it("asc = locale-compare ascending", function () {
            var entries = makeEntries(["c", "a", "b"]);
            axes.sortGroups(entries, { sort: "asc" });
            expect(entries.map(function (e) { return e.key; })).toEqual(["a", "b", "c"]);
        });

        it("desc = locale-compare descending", function () {
            var entries = makeEntries(["a", "c", "b"]);
            axes.sortGroups(entries, { sort: "desc" });
            expect(entries.map(function (e) { return e.key; })).toEqual(["c", "b", "a"]);
        });

        it("enum = explicit order from sortKeys, unknowns at end alpha", function () {
            var entries = makeEntries(["high", "low", "unknown", "normal"]);
            axes.sortGroups(entries, {
                sort: "enum",
                sortKeys: ["low", "normal", "high"]
            });
            expect(entries.map(function (e) { return e.key; }))
                .toEqual(["low", "normal", "high", "unknown"]);
        });
    });
});
