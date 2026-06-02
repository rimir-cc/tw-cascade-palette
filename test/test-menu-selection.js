/*\
title: $:/plugins/rimir/cascade-palette/test/test-menu-selection.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the lightweight arrow-key selection move (_moveMenuSelection
in cp-rendering.js). It exists to avoid a full renderResults() per
keystroke — that O(N) rebuild under key auto-repeat is what made the
selection marker hang and jump several rows at once. The move must:
  - update stage.selectedIndex
  - move the `rcp-row-selected` class from the old row to the new row
  - scroll the new row into view
  - refresh the hint
  - NOT call the heavy full renderResults when the row map is present
  - fall back to renderResults when the row map is missing
\*/
"use strict";

describe("cascade-palette: lightweight menu selection move", function () {

    var rendering = require("$:/plugins/rimir/cascade-palette/widgets/cp-rendering");

    function fakeRow(name) {
        var classes = {};
        return {
            name: name,
            classes: classes,
            classList: {
                add: function (c) { classes[c] = true; },
                remove: function (c) { delete classes[c]; }
            },
            scrollIntoView: function () { this._scrolled = true; }
        };
    }

    function makeStub(rowEls) {
        var stub = {
            _rowEls: rowEls,
            detailsOpen: false,
            _renderHintCalls: 0,
            _renderResultsCalls: 0,
            _renderHint: function () { this._renderHintCalls++; },
            // Preview refresh is irrelevant here — opt out so the debounce
            // path returns early without touching timers / DOM.
            _shouldRerenderPreviewOnRowChange: function () { return false; }
        };
        rendering(stub);
        // The patcher defines the REAL renderResults on the stub; replace
        // it with a spy AFTER patching so the fallback path is observable
        // without needing a real DOM.
        stub.renderResults = function () { this._renderResultsCalls++; };
        return stub;
    }

    it("moves the selected class from the old row to the new row", function () {
        var rows = [fakeRow("a"), fakeRow("b"), fakeRow("c")];
        rows[0].classes["rcp-row-selected"] = true;
        var stub = makeStub(rows);
        var stage = { selectedIndex: 0 };
        var handled = stub._moveMenuSelection(stage, 2);
        expect(handled).toBe(true);
        expect(stage.selectedIndex).toBe(2);
        expect(rows[0].classes["rcp-row-selected"]).toBeUndefined();
        expect(rows[2].classes["rcp-row-selected"]).toBe(true);
        expect(rows[2]._scrolled).toBe(true);
        expect(stub._selectedRowEl).toBe(rows[2]);
    });

    it("refreshes the hint and does NOT do a full re-render", function () {
        var stub = makeStub([fakeRow("a"), fakeRow("b")]);
        var stage = { selectedIndex: 0 };
        stub._moveMenuSelection(stage, 1);
        expect(stub._renderHintCalls).toBe(1);
        expect(stub._renderResultsCalls).toBe(0);
    });

    it("falls back to a full renderResults when the row map is missing", function () {
        var stub = makeStub(null);
        var stage = { selectedIndex: 3 };
        var handled = stub._moveMenuSelection(stage, 4);
        expect(handled).toBe(true);
        expect(stage.selectedIndex).toBe(4);
        expect(stub._renderResultsCalls).toBe(1);
    });
});
