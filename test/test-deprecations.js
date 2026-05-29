/*\
title: $:/plugins/rimir/cascade-palette/test/test-deprecations.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for Phase D — schema modernisation back-compat.

  cp.deprecationWarning(key, message, wiki)  — once-per-session console.warn
                                              + DEPRECATION_COUNTS counter
  cp.deprecationCounts()                     — read-only snapshot
  cp.resetDeprecationsForTesting()           — spec hook

  _resolveBindKey + _parseCaBind             — JSON ca-bind precedence with
                                              per-field fallback (cp-items)

The deprecation helper is module-level state; specs MUST reset it in
`beforeEach` to get a clean "first call of session" baseline.
\*/
"use strict";

describe("cascade-palette: deprecations + Phase D schema compat", function () {

    var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");

    /* ====================== deprecation helper ====================== */

    describe("deprecationWarning", function () {

        var warnSpy;

        beforeEach(function () {
            utils.resetDeprecationsForTesting();
            warnSpy = spyOn(console, "warn");
        });

        it("emits a warning the first time a key is seen", function () {
            utils.deprecationWarning("field:foo", "use bar instead");
            expect(warnSpy).toHaveBeenCalled();
            var args = warnSpy.calls.mostRecent().args;
            expect(args[0]).toBe("[cascade-palette] deprecated:");
            expect(args[1]).toBe("field:foo");
        });

        it("does NOT emit a second warning for the same key", function () {
            utils.deprecationWarning("k", "msg");
            utils.deprecationWarning("k", "msg");
            expect(warnSpy.calls.count()).toBe(1);
        });

        it("emits separate warnings for different keys", function () {
            utils.deprecationWarning("k1", "msg1");
            utils.deprecationWarning("k2", "msg2");
            expect(warnSpy.calls.count()).toBe(2);
        });

        it("counts every call regardless of warn dedup", function () {
            utils.deprecationWarning("k", "msg");
            utils.deprecationWarning("k", "msg");
            utils.deprecationWarning("k", "msg");
            var counts = utils.deprecationCounts();
            expect(counts.k).toBe(3);
        });

        it("returns an isolated snapshot (mutating snapshot doesn't affect state)", function () {
            utils.deprecationWarning("k", "msg");
            var snap1 = utils.deprecationCounts();
            snap1.k = 999;
            var snap2 = utils.deprecationCounts();
            expect(snap2.k).toBe(1);
        });

        it("ignores empty / falsy keys", function () {
            utils.deprecationWarning("", "msg");
            utils.deprecationWarning(null, "msg");
            utils.deprecationWarning(undefined, "msg");
            expect(warnSpy).not.toHaveBeenCalled();
            expect(Object.keys(utils.deprecationCounts()).length).toBe(0);
        });

        it("silences console output when show-deprecations config is not 'yes'", function () {
            var wiki = new $tw.Wiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "$:/config/rimir/cascade-palette/show-deprecations",
                text: "no"
            }));
            wiki.addIndexersToWiki();
            utils.deprecationWarning("k", "msg", wiki);
            expect(warnSpy).not.toHaveBeenCalled();
            // Count still increments — diagnostics surface stays accurate.
            expect(utils.deprecationCounts().k).toBe(1);
        });

        it("warns when config is missing (defaults to 'yes')", function () {
            var wiki = new $tw.Wiki();
            wiki.addIndexersToWiki();
            utils.deprecationWarning("k", "msg", wiki);
            expect(warnSpy).toHaveBeenCalled();
        });

        it("resetDeprecationsForTesting clears both seen + counts", function () {
            utils.deprecationWarning("k", "msg");
            expect(utils.deprecationCounts().k).toBe(1);
            utils.resetDeprecationsForTesting();
            expect(Object.keys(utils.deprecationCounts()).length).toBe(0);
            utils.deprecationWarning("k", "msg");
            expect(warnSpy.calls.count()).toBe(2);
        });
    });

    /* ====================== ca-bind JSON resolver ====================== */

    describe("ca-bind JSON form", function () {

        // Build a stub object with the cp-items prototype-patch applied so
        // _resolveBindKey / _parseCaBind are reachable without instantiating
        // the widget.
        function buildStub() {
            var stub = {};
            var patch = require("$:/plugins/rimir/cascade-palette/widgets/cp-items");
            // cp-items.js exports a function that mutates proto in-place.
            // We hijack a temporary proto for our stub. The patch attaches
            // many other methods we don't exercise — harmless side effect.
            patch(stub);
            return stub;
        }

        var stub;
        beforeEach(function () {
            stub = buildStub();
            spyOn(console, "warn");
        });

        it("legacy ca-bind-* fields read unchanged when no ca-bind JSON", function () {
            var f = {
                "ca-bind-tiddler": "$:/state/legacy",
                "ca-bind-field": "value",
                "ca-bind-type": "text/plain"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/legacy");
            expect(stub._resolveBindKey(f, "field", "text")).toBe("value");
            expect(stub._resolveBindKey(f, "type", "default")).toBe("text/plain");
            expect(stub._resolveBindKey(f, "path", "")).toBe("");
        });

        it("JSON ca-bind takes precedence over per-field fallback", function () {
            var f = {
                "ca-bind": '{"tiddler":"$:/state/json","field":"v","type":"text/plain"}',
                "ca-bind-tiddler": "$:/state/legacy",
                "ca-bind-field": "old"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/json");
            expect(stub._resolveBindKey(f, "field", "text")).toBe("v");
        });

        it("partial JSON falls back to per-field for missing keys", function () {
            var f = {
                "ca-bind": '{"tiddler":"$:/state/mixed"}',
                "ca-bind-field": "legacyField",
                "ca-bind-type": "text/plain"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/mixed");
            expect(stub._resolveBindKey(f, "field", "text")).toBe("legacyField");
            expect(stub._resolveBindKey(f, "type", "default")).toBe("text/plain");
        });

        it("invalid JSON falls back to per-field silently", function () {
            var f = {
                "ca-bind": "{not-json",
                "ca-bind-tiddler": "$:/state/fallback",
                "ca-bind-field": "value"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/fallback");
            expect(stub._resolveBindKey(f, "field", "text")).toBe("value");
            expect(console.warn).toHaveBeenCalled();
        });

        it("JSON-array ca-bind is ignored (must be an object)", function () {
            var f = {
                "ca-bind": '["a","b"]',
                "ca-bind-tiddler": "$:/state/fallback"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/fallback");
        });

        it("blank ca-bind value falls through to per-field", function () {
            var f = {
                "ca-bind": "   ",
                "ca-bind-tiddler": "$:/state/fallback"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/fallback");
        });

        it("empty-string JSON value falls back to per-field", function () {
            var f = {
                "ca-bind": '{"tiddler":""}',
                "ca-bind-tiddler": "$:/state/fallback"
            };
            expect(stub._resolveBindKey(f, "tiddler", "")).toBe("$:/state/fallback");
        });

        it("falls through to defaultValue when neither JSON nor per-field has key", function () {
            var f = {
                "ca-bind": '{"tiddler":"$:/state/json"}'
            };
            expect(stub._resolveBindKey(f, "field", "DEFAULT")).toBe("DEFAULT");
        });

        it("caches the parsed JSON on the field map for repeated lookups", function () {
            var f = {
                "ca-bind": '{"tiddler":"$:/state/json","field":"v"}'
            };
            stub._resolveBindKey(f, "tiddler", "");
            expect(Object.prototype.hasOwnProperty.call(f, "__cpBindParsed")).toBe(true);
            // Subsequent lookups read the cached value.
            stub._resolveBindKey(f, "field", "");
            expect(f.__cpBindParsed.tiddler).toBe("$:/state/json");
        });
    });

    /* ====================== ca-position JSON form ====================== */

    describe("cp-position-of: JSON array form", function () {

        function freshWiki() {
            var wiki = new $tw.Wiki();
            wiki.addIndexersToWiki();
            return wiki;
        }

        var ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";

        it("parses JSON array as multi-value positions", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG, "ca-position": '["A","B","C"]'
            }));
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["A", "B", "C"]);
        });

        it("returns at-root for empty JSON array", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG, "ca-position": "[]"
            }));
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["at-root"]);
        });

        it("trims whitespace inside JSON values", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG, "ca-position": '["  A  ","B"]'
            }));
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["A", "B"]);
        });

        it("drops empty / null / blank entries from JSON array", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG, "ca-position": '["A","",null,"B"]'
            }));
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["A", "B"]);
        });

        it("falls back to legacy parser on invalid JSON", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG, "ca-position": "[not-json"
            }));
            // Legacy parser: no colon / newline → single position "[not-json"
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["[not-json"]);
        });

        it("mixed schemas — legacy base + JSON slug override", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "E", tags: ENTRY_TAG,
                "ca-position": "LegacyA:LegacyB",
                "ca-position-by-namespace": '["NsA","NsB"]'
            }));
            expect(wiki.filterTiddlers("[[E]cp-position-of[default]]")).toEqual(["LegacyA", "LegacyB"]);
            expect(wiki.filterTiddlers("[[E]cp-position-of[by-namespace]]")).toEqual(["NsA", "NsB"]);
        });
    });

    /* ====================== field tag union ====================== */

    describe("search-field tag union (legacy + new)", function () {

        function freshWiki() {
            var wiki = new $tw.Wiki();
            wiki.addIndexersToWiki();
            return wiki;
        }

        it("a single filter returns the union of both tagged tiddler sets", function () {
            var wiki = freshWiki();
            wiki.addTiddler(new $tw.Tiddler({
                title: "LegacyP", tags: "$:/tags/rimir/cascade-palette/field"
            }));
            wiki.addTiddler(new $tw.Tiddler({
                title: "NewP", tags: "$:/tags/rimir/cascade-palette/search-field"
            }));
            wiki.addTiddler(new $tw.Tiddler({
                title: "BothP",
                tags: ["$:/tags/rimir/cascade-palette/field", "$:/tags/rimir/cascade-palette/search-field"]
            }));
            var results = wiki.filterTiddlers(
                "[all[shadows+tiddlers]tag[$:/tags/rimir/cascade-palette/search-field]] " +
                "[all[shadows+tiddlers]tag[$:/tags/rimir/cascade-palette/field]] " +
                "+[sort[title]]"
            );
            // Both-tagged tiddler should appear exactly once (filter-run union dedupes).
            expect(results).toEqual(["BothP", "LegacyP", "NewP"]);
        });
    });
});
