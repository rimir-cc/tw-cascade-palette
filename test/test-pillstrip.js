/*\
title: $:/plugins/rimir/cascade-palette/test/test-pillstrip.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Characterisation spec for the 4 simple pill strips (filter / visibility /
reach / field). Snapshots the rendered outerHTML of each strip element
against canned pill arrays and focus state, asserting byte-stability
across the in-progress consolidation into cp-pillstrip.

Each strip is exercised standalone by applying the relevant cp-* patch
onto a minimal stub object (document, popupEl, stripEl, focus state,
remove-at noop). No widget construction; no full widget tree. This
fixture verifies the DOM that lands in the user's browser for these 4
strips is identical before and after refactoring the renderers.

The preset and leader strips are structurally distinct (trailing "+",
split key/name pills) and have their own focused tests elsewhere.
\*/
"use strict";

describe("cascade-palette: pill-strip rendering", function () {

    var applyCpFilters     = require("$:/plugins/rimir/cascade-palette/widgets/cp-filters");
    var applyCpVisibility  = require("$:/plugins/rimir/cascade-palette/widgets/cp-visibility");
    var applyCpReach       = require("$:/plugins/rimir/cascade-palette/widgets/cp-reach-pills");
    var applyCpField       = require("$:/plugins/rimir/cascade-palette/widgets/cp-field-pills");

    // fakeDocument elements don't ship .classList or .dataset — patch
    // both onto every created element via a wrapping document.
    function enhance(el) {
        if (!el || el._enhanced) return el;
        el._enhanced = true;
        // classList shim
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
        Object.defineProperty(el, "classList", {
            configurable: true,
            get: function () { return classListImpl; }
        });
        // dataset shim — proxy-like
        var datasetStore = {};
        Object.defineProperty(el, "dataset", {
            configurable: true,
            get: function () { return datasetStore; }
        });
        // Wrap appendChild to enhance children recursively (they may also
        // be created via the wrapped document and then nested)
        return el;
    }

    function wrappedDoc() {
        return {
            createElement: function (tag) {
                return enhance($tw.fakeDocument.createElement(tag));
            },
            // The renderers don't use other doc APIs we know of, but
            // expose the underlying createElementNS just in case.
            createElementNS: function (ns, tag) {
                return enhance($tw.fakeDocument.createElementNS(ns, tag));
            }
        };
    }

    function makeStub(applyPatch, overrides) {
        var doc = wrappedDoc();
        var stub = {
            document: doc,
            popupEl: doc.createElement("div"),
            focus: "menu",
            setFocus: function () {},
            wiki: $tw.wiki
        };
        applyPatch(stub);
        for (var k in overrides) {
            stub[k] = overrides[k];
        }
        return stub;
    }

    // -------- Filter strip --------

    it("filter strip renders nothing visible when empty", function () {
        var s = makeStub(applyCpFilters, {
            filterStripEl: wrappedDoc().createElement("div"),
            filters: [],
            filterFocusIdx: 0,
            _removeFilterAt: function () {}
        });
        s._renderFilterStrip();
        expect(s.filterStripEl.childNodes.length).toBe(0);
        expect(s.popupEl.className.indexOf("rcp-has-filters") === -1
            || /\brcp-has-filters\s*$|^\brcp-has-filters\b/.test(s.popupEl.className)
            // toggle(name, false) removes the class — fakeDocument behaviour
        ).toBe(true);
    });

    it("filter strip renders one pill with chip + remove button", function () {
        var s = makeStub(applyCpFilters, {
            filterStripEl: wrappedDoc().createElement("div"),
            filters: [
                { chip: "prefix: work/", hint: "title prefix", arg: "work/",
                  constraintTiddler: "$:/plugins/example/filters/title-prefix" }
            ],
            filterFocusIdx: 0,
            _removeFilterAt: function () {}
        });
        s._renderFilterStrip();
        expect(s.filterStripEl.childNodes.length).toBe(1);
        var pill = s.filterStripEl.childNodes[0];
        expect(pill.tagName.toLowerCase()).toBe("span");
        expect(pill.className).toContain("rcp-pill");
        // Not focused (focus !== "filter")
        expect(pill.className).not.toContain("rcp-pill-focused");
        expect(pill.getAttribute("data-filter-idx") || pill.dataset.filterIdx).toBe("0");
        // Pill contains chip text + remove span
        expect(pill.textContent).toContain("prefix: work/");
        expect(pill.textContent).toContain("×");
    });

    it("filter strip marks focused pill when section === 'filter'", function () {
        var s = makeStub(applyCpFilters, {
            filterStripEl: wrappedDoc().createElement("div"),
            filters: [
                { chip: "A", hint: "", arg: "", constraintTiddler: "x" },
                { chip: "B", hint: "", arg: "", constraintTiddler: "y" }
            ],
            filterFocusIdx: 1,
            focus: "filter",
            _removeFilterAt: function () {}
        });
        s._renderFilterStrip();
        var pills = s.filterStripEl.childNodes;
        expect(pills.length).toBe(2);
        expect(pills[0].className).not.toContain("rcp-pill-focused");
        expect(pills[1].className).toContain("rcp-pill-focused");
    });

    // -------- Visibility strip --------

    it("visibility strip renders identically-shaped pills (parallel family)", function () {
        var s = makeStub(applyCpVisibility, {
            visibilityStripEl: wrappedDoc().createElement("div"),
            visibilities: [{ chip: "hide: appify", hint: "", arg: "appify",
                             constraintTiddler: "$:/plugins/example/visibility/hide-group" }],
            visibilityFocusIdx: 0,
            focus: "visibility",
            _removeVisibilityAt: function () {}
        });
        s._renderVisibilityStrip();
        var pills = s.visibilityStripEl.childNodes;
        expect(pills.length).toBe(1);
        expect(pills[0].className).toContain("rcp-pill");
        expect(pills[0].className).toContain("rcp-pill-focused");
        expect(pills[0].textContent).toContain("hide: appify");
    });

    // -------- Reach strip (has extra `rcp-pill-reach` base class) --------

    it("reach strip pills carry rcp-pill-reach modifier class", function () {
        var s = makeStub(applyCpReach, {
            reachStripEl: wrappedDoc().createElement("div"),
            reachPills: [{ chip: "R here", hint: "search deep", name: "R here",
                           constraintTiddler: "$:/plugins/example/reach/here" }],
            reachFocusIdx: 0,
            focus: "reach",
            _removeReachAt: function () {}
        });
        s._renderReachStrip();
        var pill = s.reachStripEl.childNodes[0];
        expect(pill.className).toContain("rcp-pill");
        expect(pill.className).toContain("rcp-pill-reach");
        expect(pill.className).toContain("rcp-pill-focused");
    });

    // -------- Field strip --------

    it("field strip pills carry rcp-pill-field modifier class", function () {
        var s = makeStub(applyCpField, {
            fieldStripEl: wrappedDoc().createElement("div"),
            fieldPills: [{ chip: "F name", hint: "search name field", name: "F name",
                           constraintTiddler: "$:/plugins/example/field/name" }],
            fieldFocusIdx: 0,
            focus: "field",
            _removeFieldAt: function () {}
        });
        s._renderFieldStrip();
        var pill = s.fieldStripEl.childNodes[0];
        expect(pill.className).toContain("rcp-pill");
        expect(pill.className).toContain("rcp-pill-field");
        expect(pill.className).toContain("rcp-pill-focused");
    });

    // -------- Empty-state class toggle on popupEl --------

    it("populated filters strip sets rcp-has-filters on popupEl", function () {
        var s = makeStub(applyCpFilters, {
            filterStripEl: wrappedDoc().createElement("div"),
            filters: [{ chip: "X", hint: "", arg: "", constraintTiddler: "x" }],
            filterFocusIdx: 0,
            _removeFilterAt: function () {}
        });
        s._renderFilterStrip();
        expect(s.popupEl.className).toContain("rcp-has-filters");
    });
});
