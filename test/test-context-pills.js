/*\
title: $:/plugins/rimir/cascade-palette/test/test-context-pills.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the cp-context-pills module — the sticky-context pill strip.

Two layers:
  1. State-tiddler I/O (_read / _write / _pin / _unpin / _clear) —
     pure prototype methods, applied to a stub against the real
     $tw.wiki and cleaned up afterwards.
  2. Strip rendering — uses the same fakeDocument harness as
     test-pillstrip.js: a wrappedDoc that shims classList + dataset
     onto each created element so the renderer's DOM walks survive.

The render layer doubles as the regression guard for the post-process
stale-pin class: the shared renderPillStripSection helper has no
per-pill class hook, so cp-context-pills.js iterates the rendered
pills and adds `rcp-pill-stale` itself.
\*/
"use strict";

describe("cascade-palette: cp-context-pills", function () {

    var applyCpContext = require("$:/plugins/rimir/cascade-palette/widgets/cp-context-pills");
    var STICKY_TITLE = "$:/temp/rimir/cascade-palette/sticky-context";

    afterEach(function () {
        $tw.wiki.deleteTiddler(STICKY_TITLE);
        // Drop any test-tiddlers the render specs created.
        $tw.wiki.deleteTiddler("Alice");
        $tw.wiki.deleteTiddler("BobJones");
        $tw.wiki.deleteTiddler("Carol");
    });

    // -------- State-tiddler I/O --------

    function ioStub() {
        var s = { wiki: $tw.wiki };
        applyCpContext(s);
        return s;
    }

    it("_readStickyContextList: returns [] when state tiddler absent", function () {
        var s = ioStub();
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_readStickyContextList: returns [] when list field empty", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "" }));
        var s = ioStub();
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_readStickyContextList: parses string-format list with brackets", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({
            title: STICKY_TITLE,
            list: "Alice [[Bob Jones]] Carol"
        }));
        var s = ioStub();
        expect(s._readStickyContextList()).toEqual(["Alice", "Bob Jones", "Carol"]);
    });

    it("_readStickyContextList: accepts array-typed list field", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({
            title: STICKY_TITLE,
            list: $tw.utils.parseStringArray("X Y Z")
        }));
        var s = ioStub();
        expect(s._readStickyContextList()).toEqual(["X", "Y", "Z"]);
    });

    it("_writeStickyContextList: round-trips through stringifyList", function () {
        var s = ioStub();
        s._writeStickyContextList(["Alice", "Bob Jones", "Carol"]);
        expect(s._readStickyContextList()).toEqual(["Alice", "Bob Jones", "Carol"]);
    });

    it("_writeStickyContextList: de-duplicates, preserving first occurrence order", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "B", "A", "C", "B"]);
        expect(s._readStickyContextList()).toEqual(["A", "B", "C"]);
    });

    it("_writeStickyContextList: drops empty/non-string entries", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "", null, undefined, "B"]);
        expect(s._readStickyContextList()).toEqual(["A", "B"]);
    });

    it("_pinStickyContext: appends to existing list", function () {
        var s = ioStub();
        s._writeStickyContextList(["A"]);
        s._pinStickyContext("B");
        expect(s._readStickyContextList()).toEqual(["A", "B"]);
    });

    it("_pinStickyContext: no-op on duplicate", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "B"]);
        s._pinStickyContext("A");
        expect(s._readStickyContextList()).toEqual(["A", "B"]);
    });

    it("_pinStickyContext: ignores empty title", function () {
        var s = ioStub();
        s._writeStickyContextList(["A"]);
        s._pinStickyContext("");
        expect(s._readStickyContextList()).toEqual(["A"]);
    });

    it("_unpinStickyContext: removes matching title", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "B", "C"]);
        s._unpinStickyContext("B");
        expect(s._readStickyContextList()).toEqual(["A", "C"]);
    });

    it("_unpinStickyContext: no-op when title not present", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "B"]);
        s._unpinStickyContext("Z");
        expect(s._readStickyContextList()).toEqual(["A", "B"]);
    });

    it("_clearStickyContext: empties the list", function () {
        var s = ioStub();
        s._writeStickyContextList(["A", "B", "C"]);
        s._clearStickyContext();
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_clearStickyContext: no-op when already empty", function () {
        var s = ioStub();
        expect(function () { s._clearStickyContext(); }).not.toThrow();
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_refreshContextPills: builds pill instances with caption/ca-name/title fallback", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "Alice", caption: "Alice Smith" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "BobJones", "ca-name": "Bob J." }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "Carol" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({
            title: STICKY_TITLE,
            list: "Alice BobJones Carol"
        }));
        var s = ioStub();
        s._refreshContextPills();
        expect(s.contextPills.length).toBe(3);
        expect(s.contextPills[0]).toEqual(jasmine.objectContaining({
            title: "Alice", chip: "Alice Smith", hint: "Alice", stale: false
        }));
        expect(s.contextPills[1].chip).toBe("Bob J.");
        expect(s.contextPills[2].chip).toBe("Carol");
    });

    it("_refreshContextPills: marks stale pin when target tiddler missing", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "Ghost" }));
        var s = ioStub();
        s._refreshContextPills();
        expect(s.contextPills.length).toBe(1);
        expect(s.contextPills[0].stale).toBe(true);
        expect(s.contextPills[0].chip).toBe("Ghost"); // title fallback
    });

    // -------- Strip rendering (fakeDocument harness; mirrors test-pillstrip.js shape) --------

    function enhance(el) {
        if (!el || el._enhanced) return el;
        el._enhanced = true;
        var classListImpl = {
            add: function (name) {
                var c = (el.className || "").split(/\s+/).filter(Boolean);
                if (c.indexOf(name) === -1) c.push(name);
                el.className = c.join(" ");
            },
            remove: function (name) {
                var c = (el.className || "").split(/\s+/).filter(Boolean);
                el.className = c.filter(function (n) { return n !== name; }).join(" ");
            },
            toggle: function (name, force) {
                var c = (el.className || "").split(/\s+/).filter(Boolean);
                var present = c.indexOf(name) !== -1;
                var wanted = (force === undefined) ? !present : !!force;
                if (wanted === present) return wanted;
                if (wanted) c.push(name);
                else c = c.filter(function (n) { return n !== name; });
                el.className = c.join(" ");
                return wanted;
            },
            contains: function (name) {
                return (el.className || "").split(/\s+/).indexOf(name) !== -1;
            }
        };
        Object.defineProperty(el, "classList", { configurable: true, get: function () { return classListImpl; } });
        var datasetStore = {};
        Object.defineProperty(el, "dataset", { configurable: true, get: function () { return datasetStore; } });
        // Patch querySelectorAll on the strip element so the post-process
        // pass in _renderContextStrip can iterate its rendered pills.
        if (!el.querySelectorAll) {
            el.querySelectorAll = function (sel) {
                // Only used for ".rcp-pill" — simple substring match on className.
                var out = [];
                for (var i = 0; i < el.childNodes.length; i++) {
                    var c = el.childNodes[i];
                    if (c && (c.className || "").split(/\s+/).indexOf("rcp-pill") !== -1) {
                        out.push(c);
                    }
                }
                return out;
            };
        }
        return el;
    }

    function wrappedDoc() {
        return {
            createElement: function (tag) {
                return enhance($tw.fakeDocument.createElement(tag));
            }
        };
    }

    function renderStub() {
        var doc = wrappedDoc();
        var s = {
            wiki: $tw.wiki,
            document: doc,
            popupEl: doc.createElement("div"),
            contextStripEl: doc.createElement("div"),
            focus: "menu",
            setFocus: function () {}
        };
        applyCpContext(s);
        return s;
    }

    it("strip: renders nothing visible when empty", function () {
        var s = renderStub();
        s._renderContextStrip();
        expect(s.contextStripEl.childNodes.length).toBe(0);
        expect(s.popupEl.classList.contains("rcp-has-context")).toBe(false);
    });

    it("strip: renders one pill per non-stale title with chip + ×", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "Alice", caption: "Alice Smith" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "Alice" }));
        var s = renderStub();
        s._renderContextStrip();
        expect(s.contextStripEl.childNodes.length).toBe(1);
        var pill = s.contextStripEl.childNodes[0];
        expect(pill.className).toContain("rcp-pill");
        expect(pill.className).toContain("rcp-pill-context");
        expect(pill.className).not.toContain("rcp-pill-stale");
        expect(pill.textContent).toContain("Alice Smith");
        expect(pill.textContent).toContain("×");
        expect(s.popupEl.classList.contains("rcp-has-context")).toBe(true);
    });

    it("strip: stale pin gets rcp-pill-stale class (post-process)", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "Alice", caption: "Alice Smith" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "Alice Ghost" }));
        var s = renderStub();
        s._renderContextStrip();
        expect(s.contextStripEl.childNodes.length).toBe(2);
        expect(s.contextStripEl.childNodes[0].className).not.toContain("rcp-pill-stale");
        expect(s.contextStripEl.childNodes[1].className).toContain("rcp-pill-stale");
    });

    it("strip: focused pill gets rcp-pill-focused when focus === 'context'", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "Alice" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: "BobJones" }));
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "Alice BobJones" }));
        var s = renderStub();
        s.focus = "context";
        s.contextFocusIdx = 1;
        s._renderContextStrip();
        var pills = s.contextStripEl.childNodes;
        expect(pills[0].className).not.toContain("rcp-pill-focused");
        expect(pills[1].className).toContain("rcp-pill-focused");
    });

    // -------- "+" input prefix --------

    it("_detectContextPrefix: returns null on empty / non-+ input", function () {
        var s = ioStub();
        expect(s._detectContextPrefix("")).toBe(null);
        expect(s._detectContextPrefix(null)).toBe(null);
        expect(s._detectContextPrefix(undefined)).toBe(null);
        expect(s._detectContextPrefix("Alice")).toBe(null);
        expect(s._detectContextPrefix("/foo")).toBe(null);
        expect(s._detectContextPrefix("@bar")).toBe(null);
    });

    it("_detectContextPrefix: returns text after + (including spaces)", function () {
        var s = ioStub();
        expect(s._detectContextPrefix("+")).toBe("");
        expect(s._detectContextPrefix("+Alice")).toBe("Alice");
        expect(s._detectContextPrefix("+Alice Smith")).toBe("Alice Smith");
        expect(s._detectContextPrefix("+  trim-me  ")).toBe("  trim-me  ");
    });

    it("_commitContextFromInput: pins typed title and clears input", function () {
        // Need an inputEl stub for _commitContextFromInput
        var s = ioStub();
        s.inputEl = { value: "+Alice Smith", classList: { remove: function () {}, contains: function () { return false; } } };
        s.topStage = function () { return null; }; // no stage in this minimal stub
        s.recomputeStage = function () {};
        s.renderStage = function () {};
        expect(s._commitContextFromInput()).toBe(true);
        expect(s.inputEl.value).toBe("");
        expect(s._readStickyContextList()).toEqual(["Alice Smith"]);
    });

    it("_commitContextFromInput: bare + is silent no-op", function () {
        var s = ioStub();
        s.inputEl = { value: "+", classList: { remove: function () {}, contains: function () { return false; } } };
        expect(s._commitContextFromInput()).toBe(false);
        expect(s.inputEl.value).toBe("+"); // not cleared — no commit happened
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_commitContextFromInput: returns false on non-+ input (lets caller fall through)", function () {
        var s = ioStub();
        s.inputEl = { value: "Alice", classList: { remove: function () {}, contains: function () { return false; } } };
        expect(s._commitContextFromInput()).toBe(false);
        expect(s.inputEl.value).toBe("Alice");
        expect(s._readStickyContextList()).toEqual([]);
    });

    it("_commitContextFromInput: de-dupes via _pinStickyContext", function () {
        var s = ioStub();
        s._writeStickyContextList(["Alice"]);
        s.inputEl = { value: "+Alice", classList: { remove: function () {}, contains: function () { return false; } } };
        s.topStage = function () { return null; };
        expect(s._commitContextFromInput()).toBe(true);
        expect(s._readStickyContextList()).toEqual(["Alice"]); // still one
    });
});
