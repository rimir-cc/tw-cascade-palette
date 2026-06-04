/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-editor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 — in-palette lens authoring (cp-lens-editor.js).

Create / edit / delete lenses via the scratchpad model, reusing the
view-editor's slug/identity helpers and the edit-mode filter editor. These
specs cover the DATA-MODEL flow (scratch creation, isolation, save-as-new,
overwrite, discard, delete) with the DOM/edit-mode bits stubbed:
`enterEditMode` is captured (not run), render/recompute are no-ops.
\*/
"use strict";

describe("cascade-palette: lens authoring (H4)", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;
    var LENS_NS = C.LENS_NS;
    var STATE = C.LENS_STATE_PREFIX;
    var SCRATCH = C.SCRATCHPAD_PREFIX;

    function makeWidget(tiddlers) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(proto);
        require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses")(proto);
        require("$:/plugins/rimir/cascade-palette/widgets/cp-row-decorations")(proto);
        require("$:/plugins/rimir/cascade-palette/widgets/cp-lens-editor")(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        w._parseNumOrDefault = function (raw, fb) {
            var n = parseInt(raw, 10); return isNaN(n) ? fb : n;
        };
        w._filterInScope = function () { return []; };       // no `when` lenses here
        w.topStage = function () { return null; };            // skip recompute path
        w.recomputeStage = function () {};
        w.renderStage = function () {};
        w._renderLensStrip = function () {};
        w._renderAllLensStrips = function () {};
        w.setFocus = function () {};
        w.hintEl = { textContent: "" };
        // Capture edit-mode invocations instead of opening the editor.
        w._edits = [];
        w.enterEditMode = function (item) { w._edits.push(item); };
        return w;
    }

    function lens(extra) {
        var f = { tags: [LENS_TAG], type: "text/vnd.tiddlywiki" };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    var DEFAULT_NAME_LENS = lens({
        title: "$:/plugins/rimir/cascade-palette/lens/caption-then-title",
        "ca-lens-name": "Caption → Title",
        "ca-lens-name-filter": "[<currentTiddler>get[caption]else<currentTiddler>]",
        "ca-lens-default": "name"
    });

    describe("_newLensScratchpad", function () {

        it("creates a scratch lens projecting the slot, with a starter filter", function () {
            var w = makeWidget([DEFAULT_NAME_LENS]);
            var scratch = w._newLensScratchpad("name");
            expect(scratch.indexOf(SCRATCH)).toBe(0);
            var f = w.wiki.getTiddler(scratch).fields;
            expect(f.tags).toContain(LENS_TAG);
            expect(f["cp-scratch-kind"]).toBe("lens");
            expect(f["cp-scratch-source"]).toBe("");
            expect(f["cp-scratch-slot"]).toBe("name");
            expect(f["ca-lens-name-filter"]).toBeTruthy(); // seeded, so it projects
            expect(w._lensScratchTitle).toBe(scratch);
        });

        it("selects the scratch as the active name lens (live preview) + opens the filter editor", function () {
            var w = makeWidget([DEFAULT_NAME_LENS]);
            var scratch = w._newLensScratchpad("name");
            expect(w._readActiveLensTitle("name")).toBe(scratch);
            expect(w._edits.length).toBe(1);
            expect(w._edits[0].bindTiddler).toBe(scratch);
            expect(w._edits[0].bindField).toBe("ca-lens-name-filter");
            expect(w._edits[0].editKind).toBe("filter");
        });

        it("leaves the shipped lens byte-identical (isolation)", function () {
            var w = makeWidget([DEFAULT_NAME_LENS]);
            var before = JSON.stringify(w.wiki.getTiddler(DEFAULT_NAME_LENS.title).fields);
            w._newLensScratchpad("name");
            var after = JSON.stringify(w.wiki.getTiddler(DEFAULT_NAME_LENS.title).fields);
            expect(after).toBe(before);
        });
    });

    describe("_finalizeLensSaveAsNew", function () {

        it("writes a new lens under LENS_NS, drops scratch bookkeeping, selects it", function () {
            var w = makeWidget([DEFAULT_NAME_LENS]);
            var scratch = w._newLensScratchpad("name");
            // pretend the user edited the filter:
            w.wiki.addTiddler(new $tw.Tiddler(w.wiki.getTiddler(scratch).fields,
                { "ca-lens-name-filter": "[<currentTiddler>get[caption]]" }));
            w._finalizeLensSaveAsNew("name", scratch, "My Lens");

            // finalize selects the new lens active — read its real title
            // (calling _slugTitle again would collision-bump to a -2 variant).
            var newTitle = w._readActiveLensTitle("name");
            expect(newTitle.indexOf(LENS_NS)).toBe(0);
            var f = w.wiki.getTiddler(newTitle).fields;
            expect(f.tags).toContain(LENS_TAG);
            expect(f["ca-lens-name"]).toBe("My Lens");
            expect(f["ca-lens-name-filter"]).toBe("[<currentTiddler>get[caption]]");
            expect(f["cp-scratch-kind"]).toBeUndefined();  // bookkeeping dropped
            expect(f["cp-scratch-slot"]).toBeUndefined();
            expect(f["ca-lens-default"]).toBeUndefined();  // a fresh user lens isn't a default
            expect(w.wiki.tiddlerExists(scratch)).toBe(false); // scratch consumed
            expect(w._readActiveLensTitle("name")).toBe(newTitle);
        });
    });

    describe("_beginLensEdit + _commitLensEdit", function () {

        var USER_LENS = lens({
            title: "$:/plugins/rimir/cascade-palette/lens/slug",
            "ca-lens-name": "Slug",
            "ca-lens-name-filter": "[<currentTiddler>split[/]last[]]"
        });

        it("clones an existing lens to scratch and opens its filter (original untouched)", function () {
            var w = makeWidget([USER_LENS]);
            var before = JSON.stringify(w.wiki.getTiddler(USER_LENS.title).fields);
            var scratch = w._beginLensEdit(USER_LENS.title, "name");
            var sf = w.wiki.getTiddler(scratch).fields;
            expect(sf["cp-scratch-source"]).toBe(USER_LENS.title);
            expect(sf["ca-lens-name-filter"]).toBe("[<currentTiddler>split[/]last[]]");
            expect(w._edits[0].bindField).toBe("ca-lens-name-filter");
            expect(JSON.stringify(w.wiki.getTiddler(USER_LENS.title).fields)).toBe(before);
        });

        it("overwrites the source IN PLACE on commit (user lens) and removes the scratch", function () {
            var w = makeWidget([USER_LENS]);
            var scratch = w._beginLensEdit(USER_LENS.title, "name");
            w.wiki.addTiddler(new $tw.Tiddler(w.wiki.getTiddler(scratch).fields,
                { "ca-lens-name-filter": "[<currentTiddler>]" }));
            w._commitLensEdit("name", scratch);
            expect(w.wiki.getTiddler(USER_LENS.title).fields["ca-lens-name-filter"])
                .toBe("[<currentTiddler>]");
            expect(w.wiki.getTiddler(USER_LENS.title).fields["ca-lens-name"]).toBe("Slug"); // ✎ stripped
            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
        });

        it("save-as-new instead of overwrite when the source isn't a real tiddler (shipped)", function () {
            var w = makeWidget([]);
            // simulate an edit-clone whose source has no real tiddler
            var scratch = SCRATCH + "x/lens";
            w.wiki.addTiddler(new $tw.Tiddler(lens({
                title: scratch,
                "ca-lens-name": "Kind ✎",
                "ca-lens-icon-filter": "[<currentTiddler>get[icon]]",
                "cp-scratch-kind": "lens",
                "cp-scratch-source": "$:/shipped/kind",
                "cp-scratch-slot": "icon"
            })));
            w._lensScratchTitle = scratch;
            w._commitLensEdit("icon", scratch);
            // No overwrite happened (source absent); the name prompt opened.
            expect(w._edits.length).toBe(1);
            expect(w._edits[0].bindField).toBe("ca-lens-name");
            expect(w.wiki.tiddlerExists(scratch)).toBe(true); // still pending the name
        });
    });

    describe("_discardLensScratch", function () {

        it("removes the scratch and restores the slot's prior pick", function () {
            var TITLE_LENS = lens({
                title: "$:/plugins/rimir/cascade-palette/lens/title",
                "ca-lens-name": "Title",
                "ca-lens-name-filter": "[<currentTiddler>]"
            });
            var w = makeWidget([DEFAULT_NAME_LENS, TITLE_LENS]);
            w._setSlotLens("name", TITLE_LENS.title);          // prior pick
            var scratch = w._newLensScratchpad("name");        // remembers prior, selects scratch
            expect(w._readActiveLensTitle("name")).toBe(scratch);
            w._discardLensScratch("name", scratch);
            expect(w.wiki.tiddlerExists(scratch)).toBe(false);
            expect(w._readActiveLensTitle("name")).toBe(TITLE_LENS.title); // restored
        });
    });

    describe("_cloneLensToUser", function () {

        var SHIPPED = lens({
            title: "$:/plugins/rimir/cascade-palette/lens/kind",
            "ca-lens-name": "Kind",
            "ca-lens-icon-filter": "[<currentTiddler>get[icon]]",
            "ca-lens-actions": "via-entity-type",
            "ca-lens-default": "icon",
            "ca-order": "50"
        });

        it("copies ca-lens-*/ca-order to a LENS_NS copy, drops the default, leaves the source intact", function () {
            var w = makeWidget([SHIPPED]);
            var before = JSON.stringify(w.wiki.getTiddler(SHIPPED.title).fields);
            var newTitle = w._cloneLensToUser(SHIPPED.title);
            expect(newTitle.indexOf(LENS_NS)).toBe(0);
            var f = w.wiki.getTiddler(newTitle).fields;
            expect(f.tags).toContain(LENS_TAG);
            expect(f["ca-lens-name"]).toBe("Kind (copy)");
            expect(f["ca-lens-icon-filter"]).toBe("[<currentTiddler>get[icon]]");
            expect(f["ca-lens-actions"]).toBe("via-entity-type");
            expect(f["ca-order"]).toBe("50");
            expect(f["ca-lens-default"]).toBeUndefined(); // a fresh copy isn't a default
            // Source untouched.
            expect(JSON.stringify(w.wiki.getTiddler(SHIPPED.title).fields)).toBe(before);
        });

        it("cloning twice yields two distinct titles (collision-bumped, never clobbered)", function () {
            var w = makeWidget([SHIPPED]);
            var t1 = w._cloneLensToUser(SHIPPED.title);
            var t2 = w._cloneLensToUser(SHIPPED.title);
            expect(t1).not.toBe(t2);
            expect(w.wiki.tiddlerExists(t1)).toBe(true);
            expect(w.wiki.tiddlerExists(t2)).toBe(true);
        });

        it("returns null for a missing source", function () {
            var w = makeWidget([]);
            expect(w._cloneLensToUser("$:/no/such/lens")).toBe(null);
        });
    });

    describe("_deleteLens", function () {

        it("deletes a user lens and clears any slot pointing at it", function () {
            var USER = lens({
                title: "$:/plugins/rimir/cascade-palette/lens/custom",
                "ca-lens-name": "Custom",
                "ca-lens-name-filter": "[<currentTiddler>]"
            });
            var w = makeWidget([USER]);
            w._setSlotLens("name", USER.title);
            expect(w._readActiveLensTitle("name")).toBe(USER.title);
            expect(w._deleteLens(USER.title)).toBe(true);
            expect(w.wiki.tiddlerExists(USER.title)).toBe(false);
            expect(w._readActiveLensTitle("name")).toBe(""); // slot cleared
        });
    });
});
