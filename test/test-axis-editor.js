/*\
title: $:/plugins/rimir/cascade-palette/test/test-axis-editor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase 3 — in-palette axis lifecycle (cp-axis-editor.js), mirroring
test-lens-editor.js. Covers the data-model flow with DOM/edit-mode stubbed:
new-axis scratch + key-editor open, save-as-new under AXES_NS, clone a
shipped axis, delete (refuses shipped). `enterEditMode` is captured.
\*/
"use strict";

describe("cascade-palette: axis authoring (Phase 3)", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var AXIS_TAG = C.AXIS_TAG;
    var AXES_NS = C.AXES_NS;
    var SCRATCH = C.SCRATCHPAD_PREFIX;

    function makeWidget(tiddlers, shippedTitle) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(proto); // _slugTitle/_titleTaken
        require("$:/plugins/rimir/cascade-palette/widgets/cp-axis-editor")(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) { w.wiki.addTiddler(new $tw.Tiddler(f)); });
        if (shippedTitle) {
            var realExists = w.wiki.tiddlerExists.bind(w.wiki);
            w.wiki.isShadowTiddler = function (title) { return title === shippedTitle; };
            w.wiki.tiddlerExists = function (title) {
                return title === shippedTitle ? false : realExists(title);
            };
        }
        w._edits = [];
        w.enterEditMode = function (item) { w._edits.push(item); };
        w._reopened = [];
        w.openPaletteAtEntry = function (entry) { w._reopened.push(entry); };
        w.hintEl = { textContent: "" };
        return w;
    }
    function axis(extra) {
        var f = { tags: [AXIS_TAG], type: "text/vnd.tiddlywiki" };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    describe("_newAxisScratchpad", function () {

        it("creates a scratch axis with a starter key and opens the key editor (live count)", function () {
            var w = makeWidget([]);
            var scratch = w._newAxisScratchpad();
            expect(scratch.indexOf(SCRATCH)).toBe(0);
            var f = w.wiki.getTiddler(scratch).fields;
            expect(f.tags).toContain(AXIS_TAG);
            expect(f["ca-axis-key"]).toBeTruthy(); // seeded, so it groups
            expect(w._axisScratchTitle).toBe(scratch);
            // Opened the raw-filter editor on ca-axis-key with live count.
            expect(w._edits.length).toBe(1);
            expect(w._edits[0].bindField).toBe("ca-axis-key");
            expect(w._edits[0].editKind).toBe("filter");
        });
    });

    describe("_finalizeAxisSaveAsNew", function () {

        it("writes a new axis under AXES_NS, drops the scratch, reopens the list", function () {
            var w = makeWidget([]);
            var scratch = w._newAxisScratchpad();
            w.wiki.addTiddler(new $tw.Tiddler(w.wiki.getTiddler(scratch).fields,
                { "ca-axis-key": "[<currentTiddler>get[status]]" }));
            var newTitle = w._finalizeAxisSaveAsNew(scratch, "By status");
            expect(newTitle.indexOf(AXES_NS)).toBe(0);
            var f = w.wiki.getTiddler(newTitle).fields;
            expect(f.tags).toContain(AXIS_TAG);
            expect(f["ca-axis-name"]).toBe("By status");
            expect(f["ca-axis-key"]).toBe("[<currentTiddler>get[status]]");
            expect(f["cp-scratch-kind"]).toBeUndefined();
            expect(w.wiki.tiddlerExists(scratch)).toBe(false); // scratch consumed
            expect(w._reopened).toContain("$:/plugins/rimir/cascade-palette/entries/manage-axes");
        });
    });

    describe("_cloneAxisToUser", function () {
        var SHIPPED = axis({
            title: "$:/plugins/rimir/cascade-palette/axes/by-year-created",
            "ca-axis-name": "Year (created)",
            "ca-axis-key": "[<currentTiddler>get[created]format:date[YYYY]]",
            "ca-axis-sort": "desc", "ca-order": "50"
        });

        it("copies ca-axis-*/ca-order to an AXES_NS copy, source intact", function () {
            var w = makeWidget([SHIPPED]);
            var before = JSON.stringify(w.wiki.getTiddler(SHIPPED.title).fields);
            var newTitle = w._cloneAxisToUser(SHIPPED.title);
            expect(newTitle.indexOf(AXES_NS)).toBe(0);
            var f = w.wiki.getTiddler(newTitle).fields;
            expect(f.tags).toContain(AXIS_TAG);
            expect(f["ca-axis-name"]).toBe("Year (created) (copy)");
            expect(f["ca-axis-key"]).toBe("[<currentTiddler>get[created]format:date[YYYY]]");
            expect(f["ca-axis-sort"]).toBe("desc");
            expect(f["ca-order"]).toBe("50");
            expect(JSON.stringify(w.wiki.getTiddler(SHIPPED.title).fields)).toBe(before);
        });

        it("cloning twice yields two distinct titles (never clobbered)", function () {
            var w = makeWidget([SHIPPED]);
            var t1 = w._cloneAxisToUser(SHIPPED.title);
            var t2 = w._cloneAxisToUser(SHIPPED.title);
            expect(t1).not.toBe(t2);
            expect(w.wiki.tiddlerExists(t1)).toBe(true);
            expect(w.wiki.tiddlerExists(t2)).toBe(true);
        });

        it("returns null for a missing source", function () {
            expect(makeWidget([])._cloneAxisToUser("$:/no/such/axis")).toBe(null);
        });
    });

    describe("_deleteAxis", function () {

        it("deletes a user axis", function () {
            var USER = axis({ title: "$:/axes/mine", "ca-axis-name": "Mine",
                "ca-axis-key": "[<currentTiddler>get[x]]" });
            var w = makeWidget([USER]);
            expect(w._deleteAxis(USER.title)).toBe(true);
            expect(w.wiki.tiddlerExists(USER.title)).toBe(false);
        });

        it("refuses to delete a shipped (shadow-only) axis", function () {
            var TITLE = "$:/plugins/rimir/cascade-palette/axes/by-year-created";
            var w = makeWidget([axis({ title: TITLE, "ca-axis-name": "Year" })], TITLE);
            expect(w._deleteAxis(TITLE)).toBe(false);
            expect(w.hintEl.textContent).toContain("Shipped axes can't be deleted");
        });
    });
});
