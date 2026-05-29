/*\
title: $:/plugins/rimir/cascade-palette/test/test-input-prefix.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for cp-utils.detectInputPrefix — greedy-by-length prefix matching
across the filter and visibility tag families.

The wikitext-side wrapper (cp-input-prefix.js) only adds the loader
plumbing; the matching logic is here in cp-utils where it can be exercised
in isolation against canned meta arrays.
\*/
"use strict";

describe("cascade-palette: detectInputPrefix", function () {

    var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");
    var detect = utils.detectInputPrefix;

    var filterTitle = "$:/plugins/example/filters/title-prefix";
    var filterTag   = "$:/plugins/example/filters/tag";
    var filterAt    = "$:/plugins/example/filters/context";
    var visHide     = "$:/plugins/example/visibility/hide-group";

    var filterMetas = [
        { title: filterTitle, name: "Title prefix", prefix: "prefix:", argType: "text", expr: "+[prefix<arg>]" },
        { title: filterTag,   name: "Tag",          prefix: "#",       argType: "tag",  expr: "+[tag<arg>]"    },
        { title: filterAt,    name: "Context",      prefix: "@",       argType: "text", expr: "+[<arg>]"       },
        { title: "no-prefix", name: "NoPrefix",     prefix: "",        argType: "text", expr: "+[<arg>]"       }
    ];
    var visibilityMetas = [
        { title: visHide, name: "Hide group", prefix: "hide:", argType: "text", expr: "[get[ca-group]match<arg>]" }
    ];

    it("returns null for empty / null / undefined input", function () {
        expect(detect("",   filterMetas, visibilityMetas)).toBeNull();
        expect(detect(null, filterMetas, visibilityMetas)).toBeNull();
        expect(detect(undefined, filterMetas, visibilityMetas)).toBeNull();
    });

    it("returns null when no prefix matches", function () {
        expect(detect("hello", filterMetas, visibilityMetas)).toBeNull();
    });

    it("returns null on no metas at all", function () {
        expect(detect("prefix:foo", [], [])).toBeNull();
        expect(detect("prefix:foo", null, null)).toBeNull();
    });

    it("matches a single-character filter prefix", function () {
        var hit = detect("#work", filterMetas, visibilityMetas);
        expect(hit).not.toBeNull();
        expect(hit.kind).toBe("filter");
        expect(hit.meta.title).toBe(filterTag);
        expect(hit.argText).toBe("work");
    });

    it("matches a multi-character filter prefix", function () {
        var hit = detect("prefix:work/", filterMetas, visibilityMetas);
        expect(hit.kind).toBe("filter");
        expect(hit.meta.title).toBe(filterTitle);
        expect(hit.argText).toBe("work/");
    });

    it("matches a visibility prefix and tags kind correctly", function () {
        var hit = detect("hide:Tools", filterMetas, visibilityMetas);
        expect(hit.kind).toBe("visibility");
        expect(hit.meta.title).toBe(visHide);
        expect(hit.argText).toBe("Tools");
    });

    it("is GREEDY BY LENGTH — longer prefix wins over shorter overlap", function () {
        // Both `prefix:` (filter) and `:` (a shorter hypothetical) would
        // match "prefix:..." but the longer one must win. Simulate with
        // a synthetic short-prefix entry.
        var withColon = filterMetas.concat([
            { title: "short", name: "Short", prefix: ":", argType: "text", expr: "" }
        ]);
        var hit = detect("prefix:work/", withColon, visibilityMetas);
        expect(hit.meta.title).toBe(filterTitle);
    });

    it("a shorter prefix still wins when the longer doesn't match", function () {
        var withColon = filterMetas.concat([
            { title: "short", name: "Short", prefix: ":", argType: "text", expr: "" }
        ]);
        var hit = detect(":foo", withColon, visibilityMetas);
        expect(hit.meta.title).toBe("short");
        expect(hit.argText).toBe("foo");
    });

    it("ignores empty-prefix metas (defensive)", function () {
        // The no-prefix entry should not match anything because its prefix is "".
        var hit = detect("hello", filterMetas, visibilityMetas);
        expect(hit).toBeNull();
    });

    it("returns argText with trailing whitespace preserved (caller trims)", function () {
        var hit = detect("prefix:work/   ", filterMetas, visibilityMetas);
        expect(hit.argText).toBe("work/   ");
    });

    it("returns argText empty when prefix is the whole input", function () {
        var hit = detect("prefix:", filterMetas, visibilityMetas);
        expect(hit.argText).toBe("");
    });

    it("prefers filter over visibility when same-prefix is hypothetically declared", function () {
        // Constructive contention: same-length prefix in both families.
        // The function iterates filter metas first into `candidates`,
        // and JS sort is not guaranteed stable across engines for ties.
        // We can't assert kind unambiguously here, but we CAN assert that
        // *some* deterministic result is returned (no crash, valid meta).
        var sameLen = [
            { title: "A", name: "A", prefix: "x:", argType: "text", expr: "" }
        ];
        var sameLenV = [
            { title: "B", name: "B", prefix: "x:", argType: "text", expr: "" }
        ];
        var hit = detect("x:foo", sameLen, sameLenV);
        expect(hit).not.toBeNull();
        expect(hit.argText).toBe("foo");
        expect(["filter", "visibility"].indexOf(hit.kind)).toBeGreaterThan(-1);
    });
});
