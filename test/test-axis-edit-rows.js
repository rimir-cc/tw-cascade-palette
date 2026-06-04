/*\
title: $:/plugins/rimir/cascade-palette/test/test-axis-edit-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase 3 — the "Manage axes" list + per-axis field editor (cp-axis-rows +
cp-axis-edit-rows), mirroring the lens equivalents.

`[cp-axis-rows[]]` emits the list (a "+ New axis…" creator + one drill per
axis). `[cp-axis-edit-rows[<axis>]]` is the drill behind each row: for a
USER axis, bind-edit facet rows (name/hint/icon/order, key, label, sort/
sort-keys/empty-label, delete) + a params info row when the key is
parametric; for a SHIPPED (shadow-only) axis, a clone-to-edit leaf only.
\*/
"use strict";

describe("cascade-palette: axis list + field editor (Phase 3)", function () {

    var rowsOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-axis-rows.js")["cp-axis-rows"];
    var editOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-axis-edit-rows.js")["cp-axis-edit-rows"];
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var AXIS_TAG = C.AXIS_TAG;

    function wikiWith(fieldsList, shippedTitle) {
        var wiki = new $tw.Wiki();
        (fieldsList || []).forEach(function (f) { wiki.addTiddler(new $tw.Tiddler(f)); });
        if (shippedTitle) {
            var realExists = wiki.tiddlerExists.bind(wiki);
            wiki.isShadowTiddler = function (title) { return title === shippedTitle; };
            wiki.tiddlerExists = function (title) {
                return title === shippedTitle ? false : realExists(title);
            };
        }
        return wiki;
    }
    function run(op, operand, wiki) {
        return op(null, { operand: operand }, { wiki: wiki }).map(function (s) { return JSON.parse(s); });
    }
    function byField(rows, field) {
        return rows.filter(function (r) { return r["ca-bind-field"] === field; });
    }
    function axisFields(extra) {
        var f = { tags: [AXIS_TAG], type: "text/vnd.tiddlywiki" };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    describe("cp-axis-rows", function () {

        it("emits a '+ New axis…' creator firing NEW_AXIS_MESSAGE", function () {
            var r = run(rowsOp, "", wikiWith([]));
            var creator = r.filter(function (x) { return /New axis/.test(x["ca-name"]); })[0];
            expect(creator).toBeDefined();
            expect(creator["ca-kind"]).toBe("leaf");
            expect(creator["ca-actions"]).toContain(C.NEW_AXIS_MESSAGE);
        });

        it("drills each axis into cp-axis-edit-rows, grouped by origin", function () {
            var TITLE = "$:/axes/by-status";
            var r = run(rowsOp, "", wikiWith([
                axisFields({ title: TITLE, "ca-axis-name": "By status",
                    "ca-axis-key": "[<currentTiddler>get[status]]" })
            ]));
            var row = r.filter(function (x) { return x.title === TITLE; })[0];
            expect(row["ca-kind"]).toBe("drill");
            expect(row["ca-items-from"]).toBe("[cp-axis-edit-rows[" + TITLE + "]]");
            expect(row["ca-group"]).toBe("Your axes");
            // A user axis row carries the confirm-delete hook.
            expect(row["ca-on-delete"]).toContain(C.DELETE_AXIS_MESSAGE);
        });

        it("omits ca-on-delete for a shipped (shadow-only) axis", function () {
            var TITLE = "$:/plugins/rimir/cascade-palette/axes/by-year-created";
            var r = run(rowsOp, "", wikiWith([
                axisFields({ title: TITLE, "ca-axis-name": "Year (created)",
                    "ca-axis-key": "[<currentTiddler>get[created]format:date[YYYY]]" })
            ], TITLE));
            var row = r.filter(function (x) { return x.title === TITLE; })[0];
            expect(row["ca-group"]).toBe("Shipped axes");
            expect(row["ca-on-delete"]).toBeUndefined();
        });
    });

    describe("cp-axis-edit-rows — USER axis", function () {
        var TITLE = "$:/axes/by-status";
        function rows(extra) {
            var f = { title: TITLE, tags: [AXIS_TAG], "ca-axis-name": "By status",
                "ca-axis-key": "[<currentTiddler>get[status]]" };
            for (var k in (extra || {})) f[k] = extra[k];
            return run(editOp, TITLE, wikiWith([axisFields(f)]));
        }

        it("binds the facet fields to the axis in place", function () {
            var r = rows();
            ["ca-axis-name", "ca-axis-hint", "ca-axis-icon", "ca-order",
             "ca-axis-key", "ca-axis-label", "ca-axis-sort",
             "ca-axis-sort-keys", "ca-axis-empty-label"].forEach(function (field) {
                var row = byField(r, field)[0];
                expect(row).toBeDefined();
                expect(row["ca-kind"]).toBe("text");
                expect(row["ca-bind-tiddler"]).toBe(TITLE);
            });
        });

        it("emits a confirm-gated delete leaf firing DELETE_AXIS_MESSAGE", function () {
            var del = rows().filter(function (r) { return r["ca-group"] === "danger"; })[0];
            expect(del["ca-kind"]).toBe("leaf");
            expect(del["ca-confirm"]).toBe("yes");
            expect(del["ca-actions"]).toContain(C.DELETE_AXIS_MESSAGE);
        });

        it("surfaces a params info row only when the key is parametric", function () {
            // Non-parametric key → no params row.
            var plain = rows().filter(function (r) { return /^params:/.test(r["ca-name"]); });
            expect(plain.length).toBe(0);
            // Parametric key → one info row naming the param(s).
            var paramRows = rows({ "ca-axis-key": "[<currentTiddler>get<axis-param-field>]" })
                .filter(function (r) { return /^params:/.test(r["ca-name"]); });
            expect(paramRows.length).toBe(1);
            expect(paramRows[0]["ca-name"]).toContain("field");
            expect(paramRows[0]["ca-bind-field"]).toBeUndefined(); // read-only, not editable
        });
    });

    describe("cp-axis-edit-rows — SHIPPED axis", function () {
        var TITLE = "$:/plugins/rimir/cascade-palette/axes/by-year-created";

        it("offers a clone-to-edit leaf (CLONE_AXIS_MESSAGE) + reopen, no bind rows", function () {
            var r = run(editOp, TITLE, wikiWith([
                axisFields({ title: TITLE, "ca-axis-name": "Year (created)",
                    "ca-axis-key": "[<currentTiddler>get[created]format:date[YYYY]]" })
            ], TITLE));
            expect(byField(r, "ca-axis-key").length).toBe(0); // nothing editable in place
            var clone = r.filter(function (x) { return /Clone/.test(x["ca-name"]); })[0];
            expect(clone).toBeDefined();
            expect(clone["ca-actions"]).toContain(C.CLONE_AXIS_MESSAGE);
            expect(clone["ca-actions"]).toContain(C.OPEN_ENTRY_MESSAGE);
        });
    });
});
