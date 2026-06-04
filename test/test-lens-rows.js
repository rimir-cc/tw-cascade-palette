/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 — the "Manage lenses" list rows (cp-lens-rows filteroperator).

`[cp-lens-rows[]]` emits one JSON cascade-item string per row:
  - three "+ New … lens…" creator rows (NEW_LENS_MESSAGE per slot)
  - one row per existing lens: ↵ edits (EDIT_LENS_MESSAGE); a USER lens also
    carries ca-on-delete (DELETE_LENS_MESSAGE behind the engine confirm),
    while a SHIPPED (shadow-only) lens omits it.
\*/
"use strict";

describe("cascade-palette: Manage-lenses rows (cp-lens-rows)", function () {

    var op = require("$:/plugins/rimir/cascade-palette/widgets/cp-lens-rows.js")["cp-lens-rows"];
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;

    function run(tiddlers, shippedTitles) {
        var wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            wiki.addTiddler(new $tw.Tiddler(f));
        });
        // Simulate shipped (shadow-only) lenses: isShadowTiddler true +
        // tiddlerExists false for the listed titles.
        var shipped = {};
        (shippedTitles || []).forEach(function (t) { shipped[t] = true; });
        var realExists = wiki.tiddlerExists.bind(wiki);
        wiki.isShadowTiddler = function (title) { return !!shipped[title]; };
        wiki.tiddlerExists = function (title) {
            return shipped[title] ? false : realExists(title);
        };
        return op(null, { operand: "" }, { wiki: wiki })
            .map(function (s) { return JSON.parse(s); });
    }

    function lensFields(extra) {
        var f = { tags: [LENS_TAG] };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    it("emits a creator row per slot, each firing NEW_LENS_MESSAGE with its slot", function () {
        var rows = run([]);
        var creators = rows.filter(function (r) { return r["ca-group"] === "Create"; });
        expect(creators.length).toBe(3);
        var slots = creators.map(function (r) {
            var m = /slot="([^"]+)"/.exec(r["ca-actions"]);
            return m && m[1];
        });
        expect(slots).toEqual(["name", "icon", "annotation"]);
        creators.forEach(function (r) {
            expect(r["ca-actions"]).toContain(C.NEW_LENS_MESSAGE);
            expect(r["ca-kind"]).toBe("leaf");
        });
    });

    it("emits one row per lens with an EDIT_LENS_MESSAGE action and a slot summary", function () {
        var rows = run([lensFields({
            title: "$:/my/caption", "ca-lens-name": "Caption", "ca-lens-chip": "💬 Caption",
            "ca-lens-name-filter": "[<currentTiddler>get[caption]]"
        })]);
        var row = rows.filter(function (r) { return r.title === "$:/my/caption"; })[0];
        expect(row).toBeDefined();
        expect(row["ca-name"]).toBe("Caption");
        expect(row["ca-icon"]).toBe("💬");
        expect(row["ca-actions"]).toContain(C.EDIT_LENS_MESSAGE);
        expect(row["ca-actions"]).toContain('lens="$:/my/caption"');
        expect(row["ca-hint"]).toContain("name");   // projected slot
        expect(row["ca-hint"]).toContain("custom");
    });

    it("summarises every projected slot for a multi-slot lens", function () {
        var rows = run([lensFields({
            title: "$:/my/multi", "ca-lens-name": "Multi",
            "ca-lens-icon-filter": "[<currentTiddler>get[icon]]",
            "ca-lens-annotation-template": "<<x>>"
        })]);
        var row = rows.filter(function (r) { return r.title === "$:/my/multi"; })[0];
        expect(row["ca-hint"]).toContain("icon + annotation");
    });

    it("gives a USER lens a delete action with a confirm consequence", function () {
        var rows = run([lensFields({
            title: "$:/my/caption", "ca-lens-name": "Caption",
            "ca-lens-name-filter": "[<currentTiddler>get[caption]]"
        })]);
        var row = rows.filter(function (r) { return r.title === "$:/my/caption"; })[0];
        expect(row["ca-on-delete"]).toContain(C.DELETE_LENS_MESSAGE);
        expect(row["ca-on-delete-consequence"]).toContain("Caption");
        expect(row["ca-group"]).toBe("Your lenses");
        expect(row["ca-hint"]).toContain("DEL delete");
    });

    it("omits the delete action for a SHIPPED (shadow-only) lens", function () {
        var rows = run([lensFields({
            title: "$:/plugins/rimir/cascade-palette/lens/caption", "ca-lens-name": "Caption",
            "ca-lens-name-filter": "[<currentTiddler>get[caption]]"
        })], ["$:/plugins/rimir/cascade-palette/lens/caption"]);
        var row = rows.filter(function (r) {
            return r.title === "$:/plugins/rimir/cascade-palette/lens/caption";
        })[0];
        expect(row["ca-on-delete"]).toBeUndefined();
        expect(row["ca-group"]).toBe("Shipped lenses");
        expect(row["ca-hint"]).toContain("shipped");
        expect(row["ca-hint"]).not.toContain("DEL delete");
        // Edit is still offered.
        expect(row["ca-actions"]).toContain(C.EDIT_LENS_MESSAGE);
    });
});
