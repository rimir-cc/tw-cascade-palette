/*\
title: $:/plugins/rimir/cascade-palette/test/test-keyboard-dispatch.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the keyboard dispatch table hoisted out of cp-keyboard.js's
section-routing switch statement. The table is now pure data — testable
in isolation, and a new section ships by adding one row + writing the
handler.

  resolveSectionHandler(focus) → handler-method-name | null
  dispatchTableSnapshot()      → fresh {focus: handlerName} snapshot
  SECTION_HANDLERS             → frozen-by-convention source map

The companion contract — every entry in SECTION_HANDLERS must point at
a method ACTUALLY defined on the cp-keyboard-patched prototype — is the
key drift-detector. New sections that wire up a handler but forget the
table row (or vice versa) get caught here.
\*/
"use strict";

describe("cascade-palette: keyboard dispatch table", function () {

    var keyboard = require("$:/plugins/rimir/cascade-palette/widgets/cp-keyboard");

    describe("resolveSectionHandler", function () {
        it("returns the expected handler name for each known focus", function () {
            expect(keyboard.resolveSectionHandler("input")).toBe("_handleKeydownInput");
            expect(keyboard.resolveSectionHandler("menu")).toBe("_handleKeydownMenu");
            expect(keyboard.resolveSectionHandler("filter")).toBe("_handleKeydownFilter");
            expect(keyboard.resolveSectionHandler("visibility")).toBe("_handleKeydownVisibility");
            expect(keyboard.resolveSectionHandler("reach")).toBe("_handleKeydownReach");
            expect(keyboard.resolveSectionHandler("meta")).toBe("_handleKeydownMeta");
            expect(keyboard.resolveSectionHandler("field")).toBe("_handleKeydownField");
            expect(keyboard.resolveSectionHandler("view")).toBe("_handleKeydownView");
            expect(keyboard.resolveSectionHandler("viewconfig")).toBe("_handleKeydownViewConfig");
            expect(keyboard.resolveSectionHandler("leader")).toBe("_handleKeydownLeader");
            expect(keyboard.resolveSectionHandler("preset")).toBe("_handleKeydownPreset");
            expect(keyboard.resolveSectionHandler("details")).toBe("_handleKeydownDetails");
        });

        it("preview focus has NO dispatch entry (side-preview is native-focusable)", function () {
            expect(keyboard.resolveSectionHandler("preview")).toBeNull();
        });

        it("returns null for unknown focus values", function () {
            expect(keyboard.resolveSectionHandler("nope")).toBeNull();
            expect(keyboard.resolveSectionHandler("MENU")).toBeNull();  // case-sensitive
            expect(keyboard.resolveSectionHandler("")).toBeNull();
        });

        it("returns null for falsy / non-string inputs", function () {
            expect(keyboard.resolveSectionHandler(null)).toBeNull();
            expect(keyboard.resolveSectionHandler(undefined)).toBeNull();
            expect(keyboard.resolveSectionHandler(0)).toBeNull();
            expect(keyboard.resolveSectionHandler({})).toBeNull();
            expect(keyboard.resolveSectionHandler(["input"])).toBeNull();
        });

        it("rejects prototype-pollution attempts (constructor, __proto__, toString)", function () {
            expect(keyboard.resolveSectionHandler("constructor")).toBeNull();
            expect(keyboard.resolveSectionHandler("__proto__")).toBeNull();
            expect(keyboard.resolveSectionHandler("toString")).toBeNull();
            expect(keyboard.resolveSectionHandler("hasOwnProperty")).toBeNull();
        });
    });

    describe("dispatchTableSnapshot", function () {
        it("returns a fresh object each call (mutation isolated)", function () {
            var snap1 = keyboard.dispatchTableSnapshot();
            snap1.input = "hijacked";
            var snap2 = keyboard.dispatchTableSnapshot();
            expect(snap2.input).toBe("_handleKeydownInput");
        });

        it("includes every key resolveSectionHandler accepts", function () {
            var snap = keyboard.dispatchTableSnapshot();
            ["input", "menu", "filter", "visibility", "reach", "meta", "field",
             "view", "viewconfig", "leader", "preset", "details"
            ].forEach(function (focus) {
                expect(snap[focus]).toBe(keyboard.resolveSectionHandler(focus));
            });
        });

        it("snapshot key order is stable across calls", function () {
            var keys1 = Object.keys(keyboard.dispatchTableSnapshot());
            var keys2 = Object.keys(keyboard.dispatchTableSnapshot());
            expect(keys1).toEqual(keys2);
        });
    });

    describe("handler-method existence (drift detector)", function () {
        // Apply the patcher to a stub object and verify every named
        // handler is actually a function on the stub. Catches the
        // "added a section row but forgot the handler" mistake.
        var stub = {};
        keyboard(stub);

        Object.keys(keyboard.SECTION_HANDLERS).forEach(function (focus) {
            var name = keyboard.SECTION_HANDLERS[focus];
            it("'" + focus + "' → " + name + " exists on the patched prototype", function () {
                expect(typeof stub[name]).toBe("function");
            });
        });
    });

    describe("table contents", function () {
        it("covers exactly the 13 dispatched sections", function () {
            var keys = Object.keys(keyboard.dispatchTableSnapshot()).sort();
            expect(keys).toEqual([
                "context", "details", "field", "filter", "input", "leader", "menu",
                "meta", "preset", "reach", "view", "viewconfig", "visibility"
            ]);
        });

        it("every handler name follows the _handleKeydown<Section> convention", function () {
            var snap = keyboard.dispatchTableSnapshot();
            for (var focus in snap) {
                if (Object.prototype.hasOwnProperty.call(snap, focus)) {
                    expect(snap[focus]).toMatch(/^_handleKeydown[A-Z]/);
                }
            }
        });
    });
});
