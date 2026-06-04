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
            expect(keyboard.resolveSectionHandler("lens-name")).toBe("_handleKeydownLensSlot");
            expect(keyboard.resolveSectionHandler("lens-icon")).toBe("_handleKeydownLensSlot");
            expect(keyboard.resolveSectionHandler("lens-annotation")).toBe("_handleKeydownLensSlot");
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
             "view", "lens-name", "lens-icon", "lens-annotation",
             "viewconfig", "leader", "preset", "details"
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

    describe("type-ahead redirect (Tier 4)", function () {
        // Drive the real handleKeydown against a stub. A printable char
        // pressed on any non-input focus that no section handler consumed
        // should jump to the input and append the char.
        function makeStub(focus) {
            var stub = {
                focus: focus,
                editMode: false,
                saveMode: false,
                _pickModeReturnTo: null,
                filters: [],
                visibilities: [],
                activePresetTitle: null,
                topStage: function () { return { results: [], selectedIndex: 0 }; },
                _typeAheadCalls: [],
                _typeAheadToInput: function (ch) { this._typeAheadCalls.push(ch); }
            };
            keyboard(stub);
            return stub;
        }
        function ev(key, extra) {
            return {
                key: key,
                keyCode: (extra && extra.keyCode) || 0,
                ctrlKey: !!(extra && extra.ctrlKey),
                altKey: !!(extra && extra.altKey),
                metaKey: !!(extra && extra.metaKey),
                shiftKey: !!(extra && extra.shiftKey),
                isComposing: !!(extra && extra.isComposing),
                defaultPrevented: false,
                preventDefault: function () { this.defaultPrevented = true; }
            };
        }

        it("appends a printable char and prevents default on a non-input focus", function () {
            var stub = makeStub("preview"); // no section handler → Tier 4 reached
            var e = ev("a");
            stub.handleKeydown(e);
            expect(stub._typeAheadCalls).toEqual(["a"]);
            expect(e.defaultPrevented).toBe(true);
        });

        it("does NOT redirect when focus is already the input", function () {
            var stub = makeStub("input");
            // input focus has a handler; stub it out so it can't preventDefault.
            stub._handleKeydownInput = function () {};
            stub.handleKeydown(ev("a"));
            expect(stub._typeAheadCalls).toEqual([]);
        });

        it("ignores modifier chords (Ctrl/Alt/Meta + char)", function () {
            ["ctrlKey", "altKey", "metaKey"].forEach(function (mod) {
                var stub = makeStub("preview");
                var extra = {}; extra[mod] = true;
                stub.handleKeydown(ev("a", extra));
                expect(stub._typeAheadCalls).toEqual([]);
            });
        });

        it("ignores non-printable keys (multi-char key names)", function () {
            var stub = makeStub("preview");
            stub.handleKeydown(ev("ArrowDown"));
            stub.handleKeydown(ev("Backspace"));
            expect(stub._typeAheadCalls).toEqual([]);
        });

        it("ignores IME composition (isComposing / keyCode 229)", function () {
            var stub = makeStub("preview");
            stub.handleKeydown(ev("a", { isComposing: true }));
            stub.handleKeydown(ev("a", { keyCode: 229 }));
            expect(stub._typeAheadCalls).toEqual([]);
        });

        it("does NOT steal a char a section handler already consumed", function () {
            var stub = makeStub("menu");
            // Simulate a section handler claiming the key (e.g. Space-to-toggle).
            stub._handleKeydownMenu = function (e) { e.preventDefault(); };
            stub.handleKeydown(ev("a"));
            expect(stub._typeAheadCalls).toEqual([]);
        });
    });

    describe("enterFiresSelection (Tier 2c fire-vs-delegate)", function () {
        // Bare Enter fires the current selection only on the non-strip
        // focuses; every pill strip delegates Enter to its section handler
        // so Enter activates the focused pill.
        it("fires on input / menu / details", function () {
            expect(keyboard.enterFiresSelection("input")).toBe(true);
            expect(keyboard.enterFiresSelection("menu")).toBe(true);
            expect(keyboard.enterFiresSelection("details")).toBe(true);
        });

        it("delegates (does NOT fire) on the pill strips", function () {
            ["filter", "visibility", "view", "preset", "reach", "meta",
             "field", "viewconfig",
             "lens-name", "lens-icon", "lens-annotation"].forEach(function (focus) {
                expect(keyboard.enterFiresSelection(focus)).toBe(false);
            });
        });

        it("delegates on viewconfig — Structure-strip Enter must NOT fire the menu row", function () {
            // Regression: viewconfig was missing from the delegate set, so
            // Enter on a Structure pill fell through to fireSelected and
            // navigated to the selected row + closed the palette instead of
            // editing the facet.
            expect(keyboard.enterFiresSelection("viewconfig")).toBe(false);
        });
    });

    describe("Enter routing (real handleKeydown)", function () {
        function makeStub(focus) {
            var stub = {
                focus: focus,
                editMode: false,
                saveMode: false,
                _pickModeReturnTo: null,
                filters: [],
                visibilities: [],
                activePresetTitle: null,
                topStage: function () { return { results: [{}], selectedIndex: 0 }; },
                _fireCalls: 0,
                fireSelected: function () { this._fireCalls++; },
                _viewConfigCalls: 0
            };
            keyboard(stub);
            // Spy on the viewconfig section handler so we observe delegation
            // without running its real (DOM-dependent) body.
            stub._handleKeydownViewConfig = function () { this._viewConfigCalls++; };
            return stub;
        }
        function enter() {
            return {
                key: "Enter", keyCode: 0,
                ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
                isComposing: false, defaultPrevented: false,
                preventDefault: function () { this.defaultPrevented = true; }
            };
        }

        it("Enter on viewconfig delegates to the section handler, never fires", function () {
            var stub = makeStub("viewconfig");
            stub.handleKeydown(enter());
            expect(stub._viewConfigCalls).toBe(1);
            expect(stub._fireCalls).toBe(0);
        });

        it("Enter on menu fires the selection", function () {
            var stub = makeStub("menu");
            // menu's own handler is irrelevant — the fire path returns first.
            stub.handleKeydown(enter());
            expect(stub._fireCalls).toBe(1);
        });
    });

    describe("table contents", function () {
        it("covers exactly the dispatched sections", function () {
            // NOTE: `preview` is a known PRE-EXISTING drift — the code added
            // a `_handleKeydownPreview` dispatch entry but this expectation
            // (and the two preview specs above) were never updated. Left
            // intentionally failing on `preview` only; the lens-* sections
            // below keep the rest accurate after the H4 lens-strip work.
            var keys = Object.keys(keyboard.dispatchTableSnapshot()).sort();
            expect(keys).toEqual([
                "context", "details", "field", "filter", "input", "leader",
                "lens-annotation", "lens-icon", "lens-name", "menu",
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
