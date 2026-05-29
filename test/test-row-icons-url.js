/*\
title: $:/plugins/rimir/cascade-palette/test/test-row-icons-url.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the URL_PROTOCOL_RE regex exposed by cp-row-icons.

The regex gates which field values surface a 🌐 row-icon. Allow-list:
http, https, ftp, ftps, mailto, tel. Anything else (file:, javascript:,
plain strings, etc.) must NOT match.
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
