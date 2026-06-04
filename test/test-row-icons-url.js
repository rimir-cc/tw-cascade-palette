/*\
title: $:/plugins/rimir/cascade-palette/test/test-row-icons-url.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for cp-row-icons:
  - the URL_PROTOCOL_RE regex (which field values surface a 🌐 row-icon;
    allow-list http/https/ftp/ftps/mailto/tel, everything else denied);
  - computeRowIconsForItem's `ca-row-icon-applies` / `-payload` filter
    resolution for custom (non-`url`) icon keys.
\*/
"use strict";

describe("cascade-palette: row-icons URL regex", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-row-icons");
    var RE = setup.URL_PROTOCOL_RE;

    it("is exposed on the module export and is a RegExp", function () {
        expect(RE).toBeDefined();
        // `instanceof RegExp` can fail across realms in the TW test sandbox.
        // Use a duck-typed check instead.
        expect(typeof RE.test).toBe("function");
        expect(typeof RE.source).toBe("string");
    });

    var allow = [
        "http://example.com",
        "https://example.com/path",
        "HTTPS://EXAMPLE.COM",          // case-insensitive
        "ftp://ftp.example.com",
        "ftps://ftp.example.com",
        "mailto:user@example.com",
        "tel:+1-555-0100",
        "https://example.com?q=foo&b=bar#anchor"
    ];

    var deny = [
        "",
        "example.com",                  // bare host, no protocol
        "/relative/path",
        "file:///etc/passwd",           // not in allow-list
        "javascript:alert(1)",          // XSS guard
        "data:text/html,<script>",
        "magnet:?xt=urn:btih:abc",
        "vscode://file/path",
        "  https://example.com",        // unstripped leading whitespace
        "http",                          // no colon
        "https"
    ];

    allow.forEach(function (s) {
        it("matches: " + s, function () { expect(RE.test(s)).toBe(true); });
    });
    deny.forEach(function (s) {
        it("does NOT match: '" + s + "'", function () {
            expect(RE.test(s)).toBe(false);
        });
    });
});

describe("cascade-palette: row-icon applies/payload resolution", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-row-icons");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var ROW_ICON_TAG = C.ROW_ICON_TAG;

    // Stub widget: real wiki (so _loadRowIcons' filterTiddlers works) with a
    // deterministic _filterInScope registry (key = filter, value =
    // function(currentTiddler) -> array).
    function makeWidget(tiddlers, filters) {
        var proto = {};
        setup(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        w._filterResults = filters || {};
        w._filterInScope = function (filter, vars) {
            var fn = w._filterResults[filter];
            return fn ? (fn((vars || {}).currentTiddler) || []) : [];
        };
        return w;
    }
    function iconDef(extra) {
        var f = { tags: [ROW_ICON_TAG] };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    it("surfaces a custom icon when ca-row-icon-applies matches, resolving the payload", function () {
        var w = makeWidget([
            iconDef({
                title: "$:/icon/star", "ca-row-icon-key": "star",
                "ca-row-icon-glyph": "⭐",
                "ca-row-icon-applies": "F_APPLIES",
                "ca-row-icon-payload": "F_PAYLOAD"
            })
        ], {
            F_APPLIES: function (ct) { return ct === "Anna" ? ["Anna"] : []; },
            F_PAYLOAD: function () { return ["payload-value"]; }
        });
        var icons = w.computeRowIconsForItem({ title: "Anna" });
        expect(icons.length).toBe(1);
        expect(icons[0].glyph).toBe("⭐");
        expect(icons[0].payload).toBe("payload-value");
        expect(icons[0].source).toBe("$:/icon/star");
    });

    it("does NOT surface when ca-row-icon-applies yields empty for the row", function () {
        var w = makeWidget([
            iconDef({
                title: "$:/icon/star", "ca-row-icon-key": "star",
                "ca-row-icon-glyph": "⭐", "ca-row-icon-applies": "F_APPLIES"
            })
        ], { F_APPLIES: function (ct) { return ct === "Anna" ? ["Anna"] : []; } });
        expect(w.computeRowIconsForItem({ title: "Bob" })).toEqual([]);
    });

    it("applies-match with no payload filter leaves payload an empty string", function () {
        var w = makeWidget([
            iconDef({
                title: "$:/icon/flag", "ca-row-icon-key": "flag",
                "ca-row-icon-glyph": "🚩", "ca-row-icon-applies": "F_A"
            })
        ], { F_A: function () { return ["x"]; } });
        var icons = w.computeRowIconsForItem({ title: "Anna" });
        expect(icons.length).toBe(1);
        expect(icons[0].payload).toBe("");
    });

    it("a def with no built-in key and no applies filter never shows", function () {
        var w = makeWidget([
            iconDef({ title: "$:/icon/dead", "ca-row-icon-key": "dead", "ca-row-icon-glyph": "x" })
        ]);
        expect(w.computeRowIconsForItem({ title: "Anna" })).toEqual([]);
    });

    it("returns [] for synthetic rows and rows with no backing title", function () {
        var w = makeWidget([
            iconDef({
                title: "$:/icon/star", "ca-row-icon-key": "star",
                "ca-row-icon-glyph": "⭐", "ca-row-icon-applies": "F_A"
            })
        ], { F_A: function () { return ["x"]; } });
        expect(w.computeRowIconsForItem({ isSynthetic: true, title: "Anna" })).toEqual([]);
        expect(w.computeRowIconsForItem({})).toEqual([]);
    });
});
