/*\
title: $:/plugins/rimir/cascade-palette/test/test-label-highlight-render.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the label match-highlight rendering (cp-rendering.js):

  _renderRowNameContent(nameEl, item)
    - renders the DISPLAYED label (name-lens / row-label override, else
      item.name) and highlights the `name` match in place via a
      `.rcp-match` span — no longer skipped when an override fired.
    - stamps the inline-drawn match onto item._inlineDrawn so the snippet
      pass below the row doesn't re-render it.
    - under a rich-markup template lens (can't substring-highlight) it
      renders the template and leaves the match un-drawn (item._inlineDrawn
      stays empty) so the snippet pass surfaces it.

  _findMatch(item, field) — first match for a field, scanning _matches.
\*/
"use strict";

describe("cascade-palette: label highlight rendering", function () {

    function makeWidget() {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-rendering")(proto);
        var w = Object.create(proto);
        w.document = $tw.fakeDocument;
        // Default stubs — overridden per test.
        w._resolveRowDecorations = function () { return { name: null }; };
        w._activeSlotTemplate = null;
        return w;
    }

    // The text of the first child element carrying the rcp-match class, or
    // null when no highlight span was emitted.
    function matchSpanText(el) {
        var kids = el.childNodes || [];
        for (var i = 0; i < kids.length; i++) {
            var k = kids[i];
            if (k && k.className && String(k.className).indexOf("rcp-match") !== -1) {
                return k.textContent;
            }
        }
        return null;
    }

    describe("_findMatch", function () {
        it("returns the first match for the field", function () {
            var w = makeWidget();
            var item = { _matches: [
                { field: "title", start: 0, len: 1 },
                { field: "name", start: 2, len: 3 }
            ] };
            expect(w._findMatch(item, "name").start).toBe(2);
        });
        it("returns null when no match for the field (or no matches)", function () {
            var w = makeWidget();
            expect(w._findMatch({ _matches: [{ field: "text" }] }, "name")).toBeNull();
            expect(w._findMatch({}, "name")).toBeNull();
        });
    });

    describe("_renderRowNameContent — highlight in the displayed label", function () {
        it("highlights the lensed override label (caption), not skipped", function () {
            var w = makeWidget();
            w._resolveRowDecorations = function () { return { name: "Alpha" }; };
            var item = {
                name: "z-tid",                       // raw title
                _match: { field: "name", start: 0, len: 4 },
                _matches: [{ field: "name", start: 0, len: 4 }]
            };
            var nameEl = w.document.createElement("span");
            w._renderRowNameContent(nameEl, item);
            expect(nameEl.textContent).toBe("Alpha");   // displayed label, not title
            expect(matchSpanText(nameEl)).toBe("Alph");  // highlight in place
            expect(item._inlineDrawn).toContain(item._match);
        });

        it("renders the label plain when there is no name match", function () {
            var w = makeWidget();
            w._resolveRowDecorations = function () { return { name: "Alpha" }; };
            var item = { name: "z-tid", _match: null, _matches: null };
            var nameEl = w.document.createElement("span");
            w._renderRowNameContent(nameEl, item);
            expect(nameEl.textContent).toBe("Alpha");
            expect(matchSpanText(nameEl)).toBeNull();
            expect(item._inlineDrawn).toEqual([]);
        });

        it("falls back to item.name when no override (label == name)", function () {
            var w = makeWidget();   // default deco {name:null}
            var item = {
                name: "Find entity",
                _matches: [{ field: "name", start: 5, len: 6 }]
            };
            var nameEl = w.document.createElement("span");
            w._renderRowNameContent(nameEl, item);
            expect(nameEl.textContent).toBe("Find entity");
            expect(matchSpanText(nameEl)).toBe("entity");
            expect(item._inlineDrawn.length).toBe(1);
        });

        it("finds the name match even when _match led with another field", function () {
            var w = makeWidget();
            w._resolveRowDecorations = function () { return { name: "Alpha" }; };
            var item = {
                name: "z-tid",
                _match: { field: "title", start: 0, len: 5 },   // led by title
                _matches: [
                    { field: "title", start: 0, len: 5 },
                    { field: "name", start: 1, len: 3 }
                ]
            };
            var nameEl = w.document.createElement("span");
            w._renderRowNameContent(nameEl, item);
            expect(matchSpanText(nameEl)).toBe("lph");        // "Alpha"[1..4)
            expect(item._inlineDrawn).toContain(item._matches[1]);
            expect(item._inlineDrawn).not.toContain(item._matches[0]); // title → snippet
        });

        it("template lens: renders the template and leaves the match for the snippet", function () {
            var w = makeWidget();
            w._resolveRowDecorations = function () { return { name: null }; };
            w._activeSlotTemplate = function () { return "<<tpl>>"; };
            w._renderSlotTemplateInto = function (el) {
                el.textContent = "RICH";
                return true;   // template handled the slot
            };
            var item = {
                name: "z-tid",
                _matches: [{ field: "name", start: 0, len: 4 }]
            };
            var nameEl = w.document.createElement("span");
            w._renderRowNameContent(nameEl, item);
            expect(nameEl.textContent).toBe("RICH");
            expect(matchSpanText(nameEl)).toBeNull();      // can't inline-highlight HTML
            expect(item._inlineDrawn).toEqual([]);          // → snippet pass surfaces it
        });
    });
});
