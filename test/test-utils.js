/*\
title: $:/plugins/rimir/cascade-palette/test/test-utils.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for cp-utils: stateless helpers shared across cp-* subsystems.

  parseNumOrNull, parseNumOrDefault     used by cp-items for ca-min/max/step bindings
  sanitizeConstraintArg                 strip brackets / ctrl chars / cap at 200
  buildConstraintInstance               shared shape for filter + visibility pills

The previously identical _buildFilterInstance / _buildVisibilityInstance
methods now both delegate to buildConstraintInstance, so a single body
of tests covers both subsystems.
\*/
"use strict";

describe("cascade-palette: cp-utils", function () {

    var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");

    describe("parseNumOrNull", function () {
        it("returns null for empty / null / undefined", function () {
            expect(utils.parseNumOrNull(null)).toBeNull();
            expect(utils.parseNumOrNull(undefined)).toBeNull();
            expect(utils.parseNumOrNull("")).toBeNull();
        });
        it("returns null for non-numeric strings", function () {
            expect(utils.parseNumOrNull("abc")).toBeNull();
            expect(utils.parseNumOrNull("  ")).toBeNull();
        });
        it("parses integer / float / negative / decimal", function () {
            expect(utils.parseNumOrNull("3")).toBe(3);
            expect(utils.parseNumOrNull("3.5")).toBe(3.5);
            expect(utils.parseNumOrNull("-2")).toBe(-2);
            expect(utils.parseNumOrNull("0")).toBe(0);
        });
        it("tolerates leading whitespace (parseFloat behaviour)", function () {
            expect(utils.parseNumOrNull("  7")).toBe(7);
        });
    });

    describe("parseNumOrDefault", function () {
        it("returns fallback for empty / NaN", function () {
            expect(utils.parseNumOrDefault(null, 99)).toBe(99);
            expect(utils.parseNumOrDefault("abc", 99)).toBe(99);
            expect(utils.parseNumOrDefault("", 99)).toBe(99);
        });
        it("returns parsed number when valid", function () {
            expect(utils.parseNumOrDefault("5", 99)).toBe(5);
            expect(utils.parseNumOrDefault("0", 99)).toBe(0);
            expect(utils.parseNumOrDefault("-1.5", 99)).toBe(-1.5);
        });
    });

    describe("sanitizeConstraintArg", function () {
        it("returns empty string for null / undefined / empty", function () {
            expect(utils.sanitizeConstraintArg(null)).toBe("");
            expect(utils.sanitizeConstraintArg(undefined)).toBe("");
            expect(utils.sanitizeConstraintArg("")).toBe("");
        });
        it("strips control chars (CR/LF/TAB) to spaces", function () {
            expect(utils.sanitizeConstraintArg("a\nb")).toBe("a b");
            expect(utils.sanitizeConstraintArg("a\r\nb\tc")).toBe("a  b c");
        });
        it("drops literal square brackets", function () {
            expect(utils.sanitizeConstraintArg("foo[bar]baz")).toBe("foobarbaz");
            expect(utils.sanitizeConstraintArg("[[x]]")).toBe("x");
        });
        it("trims surrounding whitespace", function () {
            expect(utils.sanitizeConstraintArg("   hello   ")).toBe("hello");
        });
        it("caps at 200 chars", function () {
            var long = new Array(300).join("x"); // 299 'x's
            expect(utils.sanitizeConstraintArg(long).length).toBe(200);
        });
        it("coerces non-string input via String()", function () {
            expect(utils.sanitizeConstraintArg(42)).toBe("42");
            expect(utils.sanitizeConstraintArg(true)).toBe("true");
        });
    });

    describe("buildConstraintInstance", function () {

        var sampleMeta = {
            title:   "$:/plugins/example/filters/title-prefix",
            name:    "Restrict to title prefix",
            argType: "text",
            expr:    "+[prefix<arg>]",
            chip:    "prefix: <<arg>>",
            hint:    "Keep only tiddlers whose title starts with <<arg>>.",
            help:    "Detailed help: prefix is <<arg>>"
        };

        it("substitutes <arg> in expr with [safeArg] (bracket-wrapped)", function () {
            var inst = utils.buildConstraintInstance(sampleMeta, "work/");
            expect(inst.expr).toBe("+[prefix[work/]]");
        });

        it("substitutes <<arg>> in chip/hint/help with raw safeArg", function () {
            var inst = utils.buildConstraintInstance(sampleMeta, "work/");
            expect(inst.chip).toBe("prefix: work/");
            expect(inst.hint).toBe("Keep only tiddlers whose title starts with work/.");
            expect(inst.help).toBe("Detailed help: prefix is work/");
        });

        it("falls back to meta.name when chip template missing or empty", function () {
            var noChip = Object.assign({}, sampleMeta, { chip: "" });
            var inst = utils.buildConstraintInstance(noChip, "x");
            expect(inst.chip).toBe(sampleMeta.name);
        });

        it("preserves constraintTiddler / name / argType / arg", function () {
            var inst = utils.buildConstraintInstance(sampleMeta, "  foo  ");
            expect(inst.constraintTiddler).toBe(sampleMeta.title);
            expect(inst.name).toBe(sampleMeta.name);
            expect(inst.argType).toBe("text");
            expect(inst.arg).toBe("foo"); // post-sanitisation
        });

        it("returns sanitised arg on instance.arg (drops brackets, trims)", function () {
            var inst = utils.buildConstraintInstance(sampleMeta, " [foo] ");
            expect(inst.arg).toBe("foo");
            expect(inst.expr).toBe("+[prefix[foo]]");
        });

        it("multiple <arg> / <<arg>> occurrences all substituted", function () {
            var meta = Object.assign({}, sampleMeta, {
                expr: "[prefix<arg>] :filter[<arg>match[x]]",
                chip: "<<arg>>:<<arg>>"
            });
            var inst = utils.buildConstraintInstance(meta, "v");
            expect(inst.expr).toBe("[prefix[v]] :filter[[v]match[x]]");
            expect(inst.chip).toBe("v:v");
        });

        it("handles missing optional templates gracefully (empty strings)", function () {
            var sparse = {
                title: "x", name: "X", argType: "none",
                expr: "", chip: "", hint: "", help: ""
            };
            var inst = utils.buildConstraintInstance(sparse, "v");
            expect(inst.expr).toBe("");
            expect(inst.hint).toBe("");
            expect(inst.help).toBe("");
            expect(inst.chip).toBe("X"); // falls back to name
        });
    });
});
