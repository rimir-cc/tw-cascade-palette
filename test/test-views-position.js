/*\
title: $:/plugins/rimir/cascade-palette/test/test-views-position.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for ca-position field parsing in cp-views.

parsePositionField interprets the ca-position-<slug> / ca-position field
on an entry tiddler. Special return values:
  ["at-root"]         — default placement (root of view)
  null                — entry excluded from this view ("none")
  ["a", "b", ...]     — multi-position via colon or newline separator

resolveEntryPositions combines per-view (ca-position-<slug>) with the
generic (ca-position) fallback.
\*/
"use strict";

describe("cascade-palette: position field parsing", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");
    var parse = setup.parsePositionField;
    var resolve = setup.resolveEntryPositions;

    describe("parsePositionField", function () {

        it("missing / empty / null = [at-root]", function () {
            expect(parse(undefined)).toEqual(["at-root"]);
            expect(parse(null)).toEqual(["at-root"]);
            expect(parse("")).toEqual(["at-root"]);
        });

        it("'none' returns null (signal: exclude)", function () {
            expect(parse("none")).toBeNull();
        });

        it("single non-colon value passes through", function () {
            expect(parse("at-root")).toEqual(["at-root"]);
            expect(parse("Tools/Search")).toEqual(["Tools/Search"]);
        });

        // KNOWN LIMITATION: the multi-value separator `:` collides with the
        // TW system-tiddler title prefix (`$:/...`). `parse("$:/some/path")`
        // returns ["$", "/some/path"], not the intended single position.
        // Workaround until Phase D migration to JSON arrays: position values
        // should be non-system tiddler titles or use newline separators.
        it("KNOWN: system tiddler titles get split on colon", function () {
            // Documents the limitation so anyone touching the parser
            // doesn't accidentally "fix" this by changing the regex —
            // the JSON migration in plan Phase D is the proper resolution.
            expect(parse("$:/some/path")).toEqual(["$", "/some/path"]);
        });

        // Newline separator ALSO splits on colon — same limitation, since
        // the regex /[:\n]/ matches either character. So system tiddler
        // titles can't be used as position values today, regardless of how
        // they are listed. Phase D JSON migration removes the constraint.
        it("KNOWN: newline-separator does not save system titles either", function () {
            expect(parse("$:/a\n$:/b")).toEqual(["$", "/a", "$", "/b"]);
        });

        it("colon-separated splits", function () {
            expect(parse("a:b:c")).toEqual(["a", "b", "c"]);
        });

        it("newline-separated splits", function () {
            expect(parse("a\nb\nc")).toEqual(["a", "b", "c"]);
        });

        it("mixed colon + newline splits", function () {
            expect(parse("a:b\nc")).toEqual(["a", "b", "c"]);
        });

        it("trims whitespace around each position", function () {
            expect(parse("  a  :  b  ")).toEqual(["a", "b"]);
        });

        it("drops empty segments", function () {
            expect(parse(":a::b:")).toEqual(["a", "b"]);
            expect(parse("\n\na\n\n")).toEqual(["a"]);
        });

        it("all-empty after trim falls back to [at-root]", function () {
            expect(parse(":::")).toEqual(["at-root"]);
            expect(parse("   ")).toEqual(["at-root"]);
        });
    });

    describe("resolveEntryPositions", function () {

        it("prefers ca-position-<slug> over ca-position", function () {
            var fields = {
                "ca-position-by-namespace": "a",
                "ca-position": "z"
            };
            expect(resolve(fields, "by-namespace")).toEqual(["a"]);
        });

        it("falls through to ca-position when slug field absent", function () {
            var fields = { "ca-position": "z" };
            expect(resolve(fields, "by-namespace")).toEqual(["z"]);
        });

        it("falls through to [at-root] when both absent", function () {
            expect(resolve({}, "by-namespace")).toEqual(["at-root"]);
        });

        it("returns null on per-view 'none'", function () {
            var fields = {
                "ca-position-by-namespace": "none",
                "ca-position": "a"
            };
            expect(resolve(fields, "by-namespace")).toBeNull();
        });

        it("returns null on generic 'none' when slug field absent", function () {
            var fields = { "ca-position": "none" };
            expect(resolve(fields, "by-namespace")).toBeNull();
        });

        it("multi-position resolves to array", function () {
            var fields = { "ca-position": "a:b:c" };
            expect(resolve(fields, "any-slug")).toEqual(["a", "b", "c"]);
        });
    });
});
