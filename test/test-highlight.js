/*\
title: $:/plugins/rimir/cascade-palette/test/test-highlight.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the matcher core: `_highlightMatches(item, query, metaOverride,
fieldOverride, globalDefault)` and the two single-layer resolvers
`_resolveMetaField(item, key)` / `_resolveTiddlerField(item, fieldName)`.

Contract:
  Returns: [{field, label, value, start, len}]  one entry per match.
    `field` = slot name (meta key or tiddler field name).
    `label` = pill chip (from pushed pill) or slot name (fallback path).
    `value` = resolved text (array-flatten applied).
  Mutation: NONE — caller decides what to do with the match list.
  Empty query → [].
  Meta layer:    item[metaKey] only — no tiddler-field fallback.
  Field layer:   wiki.getTiddler(item.title).fields[fieldName] only,
                 skipped when item.title is empty.
  No overrides → meta layer uses item.searchFields / globalDefault as
                 plain meta keys; field layer is skipped.
\*/
"use strict";

describe("cascade-palette: _highlightMatches", function () {

    // Build a stub object with the cp-actions prototype-patch applied so
    // _highlightMatches / _resolveMetaField / _resolveTiddlerField /
    // _defaultSearchFields are reachable without instantiating the
    // widget.
    function buildStub(searchFieldsDefault, fakeTiddlers) {
        var stub = {
            wiki: {
                getTiddlerText: function (title, fallback) {
                    if (title === "$:/config/rimir/cascade-palette/search-fields-default") {
                        return searchFieldsDefault !== undefined ? searchFieldsDefault : fallback;
                    }
                    return fallback;
                },
                getTiddler: function (title) {
                    if (!fakeTiddlers) return null;
                    return fakeTiddlers[title] || null;
                }
            }
        };
        var patch = require("$:/plugins/rimir/cascade-palette/widgets/cp-actions");
        patch(stub);
        return stub;
    }

    // Helper — meta pill object as the matcher expects.
    function metaPill(key, chip) {
        return {metaKey: key, chip: chip || key};
    }
    // Helper — field pill object as the matcher expects.
    function fieldPill(name, chip) {
        return {tiddlerField: name, chip: chip || name};
    }

    describe("query handling", function () {
        it("returns [] for empty query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Alice" }, "")).toEqual([]);
        });

        it("returns [] for null query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Alice" }, null)).toEqual([]);
        });

        it("returns [] when no slot text matches the query", function () {
            var s = buildStub();
            expect(s._highlightMatches({ name: "Bob", hint: "engineer" }, "alice"))
                .toEqual([]);
        });
    });

    describe("meta layer — single-slot matches", function () {
        it("finds substring match in name slot", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "Alice Wonderland", hint: "" }, "wonder");
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("name");
            expect(m[0].value).toBe("Alice Wonderland");
            expect(m[0].start).toBe(6);
            expect(m[0].len).toBe(6);
        });

        it("is case-insensitive", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "ALICE", hint: "" }, "ali");
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("name");
        });

        it("returns the FIRST occurrence in the slot", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "aaa-foo-aaa", hint: "" }, "aaa");
            expect(m.length).toBe(1);
            expect(m[0].start).toBe(0);
        });

        it("len matches query length", function () {
            var s = buildStub();
            var m = s._highlightMatches({ name: "abcdef", hint: "" }, "AB");
            expect(m[0].len).toBe(2);
        });
    });

    describe("meta layer — multi-slot matches", function () {
        it("collects matches across multiple slots", function () {
            var s = buildStub();
            var m = s._highlightMatches(
                { name: "alpha", hint: "alphabet" }, "alph"
            );
            expect(m.length).toBe(2);
            var fields = m.map(function (x) { return x.field; });
            expect(fields).toContain("name");
            expect(fields).toContain("hint");
        });

        it("includes ONLY slots where the query matched", function () {
            var s = buildStub();
            var m = s._highlightMatches(
                { name: "alpha", hint: "no-match-here" }, "alpha"
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("name");
        });

        it("preserves slot-list ORDER from the resolved key set", function () {
            var s = buildStub("a b c");
            var m = s._highlightMatches(
                { a: "x match", b: "match", c: "match x" }, "match"
            );
            expect(m.map(function (x) { return x.field; })).toEqual(["a", "b", "c"]);
        });
    });

    describe("meta layer — slot resolution chain", function () {
        it("uses metaOverride when caller supplies it (active pills win)", function () {
            var s = buildStub("name hint");
            var m = s._highlightMatches(
                { name: "no", hint: "no", description: "yes-match" },
                "match",
                [metaPill("description")],
                null
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("description");
        });

        it("uses item.searchFields when no metaOverride is given", function () {
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

        it("falls back to globalDefault when no override AND no per-item searchFields", function () {
            var s = buildStub("custom-key");
            var m = s._highlightMatches(
                { "custom-key": "match here", name: "no", hint: "no" },
                "match"
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("custom-key");
        });

        it("explicit globalDefault parameter wins over the config read", function () {
            var s = buildStub("name hint");
            var m = s._highlightMatches(
                { name: "match", hint: "match" },
                "match",
                null,
                null,
                ["hint"]
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("hint");
        });

        it("metaOverride beats both item.searchFields AND globalDefault", function () {
            var s = buildStub("default-key");
            var m = s._highlightMatches(
                {
                    name: "match", hint: "match",
                    "default-key": "match",
                    searchFields: ["name"]
                },
                "match",
                [metaPill("hint")],
                null
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("hint");
        });
    });

    describe("meta layer — chip labels", function () {
        it("stamps the pill's chip onto match.label when an override is active", function () {
            var s = buildStub();
            var m = s._highlightMatches(
                { description: "found match here" },
                "match",
                [metaPill("description", "📝 Description")],
                null
            );
            expect(m.length).toBe(1);
            expect(m[0].label).toBe("📝 Description");
        });

        it("uses the slot name as label when no pill stamped one (fallback path)", function () {
            var s = buildStub("name");
            var m = s._highlightMatches({ name: "match" }, "match");
            expect(m[0].label).toBe("name");
        });
    });

    describe("field layer — tiddler-field matches", function () {
        function tiddlerWithFields(fields) {
            return {fields: fields};
        }

        it("reads tiddler.fields[name] when a field pill is pushed", function () {
            var s = buildStub("name hint", {
                "MyTiddler": tiddlerWithFields({text: "body content here"})
            });
            var m = s._highlightMatches(
                { title: "MyTiddler", name: "" },
                "body",
                null,
                [fieldPill("text", "📄 Text")]
            );
            expect(m.length).toBe(1);
            expect(m[0].field).toBe("text");
            expect(m[0].label).toBe("📄 Text");
            expect(m[0].value).toBe("body content here");
        });

        it("skips field pills on synthetic rows (no title)", function () {
            var s = buildStub("name hint", {});
            var m = s._highlightMatches(
                { name: "" },  // no title
                "anything",
                null,
                [fieldPill("text")]
            );
            expect(m).toEqual([]);
        });

        it("flattens array-typed fields for substring matching", function () {
            var s = buildStub("name hint", {
                "Tagged": tiddlerWithFields({tags: ["work", "urgent"]})
            });
            var m = s._highlightMatches(
                { title: "Tagged", name: "" },
                "urgen",
                null,
                [fieldPill("tags")]
            );
            expect(m.length).toBe(1);
            expect(m[0].value).toBe("work urgent");
        });

        it("returns [] when the tiddler exists but the field is missing", function () {
            var s = buildStub("name hint", {
                "MyTiddler": tiddlerWithFields({title: "MyTiddler"})
            });
            var m = s._highlightMatches(
                { title: "MyTiddler", name: "" },
                "anything",
                null,
                [fieldPill("text")]
            );
            expect(m).toEqual([]);
        });

        it("does NOT fall back to item[key] — strict tiddler-field lookup", function () {
            var s = buildStub("name hint", {});  // no tiddler in store
            var m = s._highlightMatches(
                { title: "MissingTid", text: "would-be-fallback" },
                "fallback",
                null,
                [fieldPill("text")]
            );
            // Even though item.text contains "fallback", the field layer
            // does NOT consult cascade-item props — that's the meta
            // layer's job. Empty match list.
            expect(m).toEqual([]);
        });
    });

    describe("combined meta + field layers", function () {
        it("unions matches from both layers", function () {
            var s = buildStub("name hint", {
                "Tid": { fields: { text: "tiddler body match" } }
            });
            var m = s._highlightMatches(
                { title: "Tid", name: "name match", hint: "" },
                "match",
                [metaPill("name")],
                [fieldPill("text")]
            );
            expect(m.length).toBe(2);
            var fields = m.map(function (x) { return x.field; });
            expect(fields).toContain("name");
            expect(fields).toContain("text");
        });
    });

    describe("no mutation guarantee", function () {
        it("does NOT mutate the input item", function () {
            var s = buildStub();
            var item = {
                name: "Alice", hint: "engineer",
                _match: "should-stay", _matches: "should-stay"
            };
            s._highlightMatches(item, "alice");
            expect(item._match).toBe("should-stay");
            expect(item._matches).toBe("should-stay");
        });

        it("does not mutate the override lists", function () {
            var s = buildStub();
            var mo = [metaPill("name")];
            s._highlightMatches({ name: "match" }, "match", mo, null);
            expect(mo.length).toBe(1);
            expect(mo[0].metaKey).toBe("name");
        });
    });

    describe("filterByQuery integration", function () {
        function buildStubWithPills(metaOverride, fieldOverride) {
            var s = buildStub("name hint");
            s._activeMetaPills = function () { return metaOverride || null; };
            s._activeFieldPills = function () { return fieldOverride || null; };
            return s;
        }

        it("narrows items + stamps _match / _matches", function () {
            var s = buildStubWithPills();
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

        it("clears stale _match / _matches on non-matching items", function () {
            var s = buildStubWithPills();
            var items = [
                { name: "Alice", hint: "", _match: "stale", _matches: ["stale"] },
                { name: "Bob", hint: "", _match: "stale", _matches: ["stale"] }
            ];
            s.filterByQuery(items, "alice");
            expect(items[1]._match).toBeNull();
            expect(items[1]._matches).toBeNull();
        });

        it("empty query keeps all items + clears annotations", function () {
            var s = buildStubWithPills();
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
