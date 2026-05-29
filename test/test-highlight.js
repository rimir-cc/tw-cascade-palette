/*\
title: $:/plugins/rimir/cascade-palette/test/test-highlight.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the extracted `_highlightMatches(item, query, fieldOverride,
globalDefault)` pure helper. Pre-Phase-E this logic was inline inside
`filterByQuery`; carving it out makes per-item highlight computation
testable in isolation AND reusable by future ad-hoc renderers (e.g. a
diagnostics view that wants to highlight a query against an arbitrary
cascade item without going through the full result-narrowing path).

Contract:
  Returns: [{field, value, start, len}]  one entry per matching field
  Mutation: NONE — caller decides what to do with the match list
  Empty query → []
  No matches → []
  Match field text resolved via _resolveMatchableField (array-flatten,
    tiddler-field fallback when the item property is missing).
\*/
"use strict";

describe("cascade-palette: _highlightMatches", function () {

    // Build a stub object with the cp-actions prototype-patch applied so
    // _highlightMatches / _resolveMatchableField / _defaultSearchFields
    // are reachable without instantiating the widget.
    function buildStub(searchFieldsDefault, fakeActiveFields) {
        var stub = {
            wiki: {
                getTiddlerText: function (title, fallback) {
                    if (title === "$:/config/rimir/cascade-palette/search-fields-default") {
                        return searchFieldsDefault !== undefined ? searchFieldsDefault : fallback;
                    }
                    return fallback;
                },
                getTiddler: function () { return null; }
            }
        };
        var patch = require("$:/plugins/rimir/cascade-palette/widgets/cp-actions");
        patch(stub);
        if (fakeActiveFields !== undefined) {
            stub._activeFieldNames = function () { return fakeActiveFields; };
        }
        return stub;
    }

    describe("query handling", function () {
        it("returns [] for empty query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Alice" }, "")).toEqual([]);
        });

        it("returns [] for null / undefined query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Alice" }, null)).toEqual([]);
            expect(s._highlightMatches({ name: "Alice" })).toEqual([]);
        });

        it("returns [] when no field text matches the query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Bob", hint: "engineer" }, "alice"))
                .toEqual([]);
        });
    });

    describe("single-field matches", function () {
        it("finds substring match in name field", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "Alice Wonderland", hint: "" }, "wonder");
            expect(m.length).toBe(1);
            expect(m[0]).toEqual({
                field: "name", value: "Alice Wonderland", start: 6, len: 6
            });
        });

        it("is case-insensitive (lowercases both sides)", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "ALICE", hint: "" }, "ali");
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("name");
            expect(m[0].start).toBe(0);
        });

        it("returns the FIRST occurrence of the query in the field", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "aaa-foo-aaa", hint: "" }, "aaa");
            expect(m.length).toBe(1);
            expect(m[0].start).toBe(0);
        });

        it("len matches the query length, not the matched substring's", function () {
            var s = buildStub();
            // Mixed case: query "AB" finds position 0 in "ab", but len is 2.
            var m = s._highlightMatches({ name: "abcdef", hint: "" }, "AB");
            expect(m[0].len).toBe(2);
        });
    });

    describe("multi-field matches", function () {
        it("collects matches across multiple search fields", function () {
            var s = buildStub();
            var m = s._highlightMatches(
                { name: "alpha", hint: "alphabet" }, "alph"
            );
            expect(m.length).toBe(2);
            var fields = m.map(function (x) { return x.field; });
            expect(fields).toContain("name");
            expect(fields).toContain("hint");
        });

        it("includes ONLY fields where the query matched", function () {
            var s = buildStub();
            var m = s._highlightMatches(
                { name: "alpha", hint: "no-match-here" }, "alpha"
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("name");
        });

        it("preserves field-list ORDER from the resolved field set", function () {
            var s = buildStub("a b c");
            var m = s._highlightMatches(
                { a: "x match", b: "match", c: "match x" }, "match"
            );
            expect(m.map(function (x) { return x.field; })).toEqual(["a", "b", "c"]);
        });
    });

    describe("field resolution chain", function () {
        it("uses fieldOverride when caller supplies it (active pills wins)", function () {
            var s = buildStub("name hint");  // default = name hint
            var m = s._highlightMatches(
                { name: "no", hint: "no", description: "yes-match" },
                "match",
                ["description"]
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("description");
        });

        it("uses item.searchFields when no override is given", function () {
            var s = buildStub("name hint");
            var m = s._highlightMatches(
                {
                    name: "no", hint: "no", description: "match",
                    searchFields: ["description"]
                },
                "match"
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("description");
        });

        it("falls back to global default when no override AND no per-item searchFields", function () {
            var s = buildStub("custom-field");
            var m = s._highlightMatches(
                { "custom-field": "match here", name: "no", hint: "no" },
                "match"
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("custom-field");
        });

        it("globalDefault parameter takes precedence over resolving from config", function () {
            // searchFieldsDefault returns "name hint" but caller injects ["hint"].
            var s = buildStub("name hint");
            var m = s._highlightMatches(
                { name: "match", hint: "match" },
                "match",
                null,
                ["hint"]
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("hint");
        });

        it("fieldOverride wins over both item.searchFields AND globalDefault", function () {
            var s = buildStub("default-field");
            var m = s._highlightMatches(
                {
                    name: "match", hint: "match",
                    "default-field": "match",
                    searchFields: ["name"]
                },
                "match",
                ["hint"]
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("hint");
        });
    });

    describe("no mutation guarantee", function () {
        it("does NOT mutate the input item's _match / _matches / other fields", function () {
            var s = buildStub();
            var item = {
                name: "Alice", hint: "engineer", _match: "should-stay", _matches: "should-stay"
            };
            s._highlightMatches(item, "alice");
            expect(item._match).toBe("should-stay");
            expect(item._matches).toBe("should-stay");
        });

        it("does not mutate the resolved fields list", function () {
            var s = buildStub();
            var override = ["name", "hint"];
            s._highlightMatches({ name: "match", hint: "" }, "match", override);
            expect(override).toEqual(["name", "hint"]);
        });
    });

    describe("filterByQuery integration", function () {
        it("filterByQuery still narrows items + stamps _match / _matches", function () {
            var s = buildStub("name hint");
            var items = [
                { name: "Alice", hint: "alice" },
                { name: "Bob", hint: "bob" }
            ];
            var kept = s.filterByQuery(items, "alice");
            expect(kept.length).toBe(1);
            expect(kept[0].name).toBe("Alice");
            expect(kept[0]._match.field).toBe("name");
            expect(kept[0]._matches.length).toBe(2);  // matches in BOTH name and hint
        });

        it("filterByQuery clears stale _match / _matches on non-matching items", function () {
            var s = buildStub("name hint");
            var items = [
                { name: "Alice", hint: "", _match: "stale", _matches: ["stale"] },
                { name: "Bob", hint: "", _match: "stale", _matches: ["stale"] }
            ];
            s.filterByQuery(items, "alice");
            expect(items[1]._match).toBeNull();
            expect(items[1]._matches).toBeNull();
        });

        it("filterByQuery with empty query keeps all items + clears annotations", function () {
            var s = buildStub("name hint");
            var items = [
                { name: "Alice", _match: "stale", _matches: ["stale"] },
                { name: "Bob", _match: "stale", _matches: ["stale"] }
            ];
            var kept = s.filterByQuery(items, "");
            expect(kept.length).toBe(2);
            expect(items[0]._match).toBeNull();
            expect(items[1]._matches).toBeNull();
        });
    });
});
