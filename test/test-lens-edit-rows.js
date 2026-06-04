/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-edit-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 — the per-lens field editor (cp-lens-edit-rows + cp-lens-actions-rows).

`[cp-lens-edit-rows[<lens>]]` is the drill behind each "Manage lenses" row:
for a USER lens it emits bind-edit facet rows (name/chip/when/order, default
toggles, per-slot filter+template, an actions sub-drill, delete); for a
SHIPPED (shadow-only) lens it emits only a clone-to-edit leaf.
`[cp-lens-actions-rows[<lens>]]` is the actions chooser (none / via-entity-
type / custom filter, current marked ✓).
\*/
"use strict";

describe("cascade-palette: per-lens field editor", function () {

    var editOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-lens-edit-rows.js")["cp-lens-edit-rows"];
    var actOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-lens-actions-rows.js")["cp-lens-actions-rows"];
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;

    function wikiWith(fields, shippedTitle) {
        var wiki = new $tw.Wiki();
        wiki.addTiddler(new $tw.Tiddler(fields));
        if (shippedTitle) {
            var realExists = wiki.tiddlerExists.bind(wiki);
            wiki.isShadowTiddler = function (title) { return title === shippedTitle; };
            wiki.tiddlerExists = function (title) {
                return title === shippedTitle ? false : realExists(title);
            };
        }
        return wiki;
    }
    function rowsFor(op, title, wiki) {
        return op(null, { operand: title }, { wiki: wiki }).map(function (s) { return JSON.parse(s); });
    }
    function byField(rows, field) {
        return rows.filter(function (r) { return r["ca-bind-field"] === field; });
    }

    describe("cp-lens-edit-rows — USER lens", function () {
        var TITLE = "$:/my/vac";
        function rows() {
            return rowsFor(editOp, TITLE, wikiWith({
                title: TITLE, tags: [LENS_TAG], "ca-lens-name": "Vacation",
                "ca-lens-annotation-filter": "[<currentTiddler>get[vac]]"
            }));
        }

        it("binds the scalar facets to the lens in place", function () {
            var r = rows();
            ["ca-lens-name", "ca-lens-chip", "ca-lens-when", "ca-order"].forEach(function (field) {
                var row = byField(r, field)[0];
                expect(row).toBeDefined();
                expect(row["ca-kind"]).toBe("text");
                expect(row["ca-bind-tiddler"]).toBe(TITLE);
            });
        });

        it("emits a default-slot toggle per slot (string-array membership)", function () {
            var toggles = byField(rows(), "ca-lens-default");
            expect(toggles.length).toBe(3);
            expect(toggles.map(function (t) { return t["ca-true-value"]; })).toEqual(["name", "icon", "annotation"]);
            toggles.forEach(function (t) {
                expect(t["ca-kind"]).toBe("toggle");
                expect(t["ca-bind-type"]).toBe("application/x-string-array");
            });
        });

        it("emits a filter AND a template bind row for every slot", function () {
            var r = rows();
            ["name", "icon", "annotation"].forEach(function (slot) {
                expect(byField(r, "ca-lens-" + slot + "-filter").length).toBe(1);
                expect(byField(r, "ca-lens-" + slot + "-template").length).toBe(1);
            });
        });

        it("auto-resolves the filter/template conflict — each commits-clears its sibling (non-blank only)", function () {
            var r = rows();
            var fil = byField(r, "ca-lens-name-filter")[0];
            var tpl = byField(r, "ca-lens-name-template")[0];
            // Committing the filter clears the template; committing the
            // template clears the filter — both guarded so clearing one field
            // does not wipe the other.
            expect(fil["ca-on-commit"]).toContain("[<picked>!is[blank]]");
            expect(fil["ca-on-commit"]).toContain('ca-lens-name-template=""');
            expect(tpl["ca-on-commit"]).toContain("[<picked>!is[blank]]");
            expect(tpl["ca-on-commit"]).toContain('ca-lens-name-filter=""');
        });

        it("marks a pre-existing both-set conflict (filter active / template ignored), else no marker", function () {
            // No conflict on the base lens (annotation-filter only).
            var clean = rows();
            expect(byField(clean, "ca-lens-annotation-filter")[0]["ca-name"]).toBe("filter");
            expect(byField(clean, "ca-lens-annotation-template")[0]["ca-name"]).toBe("template");
            // A lens with BOTH a filter and a template on one slot gets markers.
            var conflicted = rowsFor(editOp, TITLE, wikiWith({
                title: TITLE, tags: [LENS_TAG], "ca-lens-name": "Both",
                "ca-lens-name-filter": "[<currentTiddler>get[caption]]",
                "ca-lens-name-template": "<<currentTiddler>>"
            }));
            expect(byField(conflicted, "ca-lens-name-filter")[0]["ca-name"]).toBe("filter ● active");
            var ignored = byField(conflicted, "ca-lens-name-template")[0];
            expect(ignored["ca-name"]).toBe("template ⚠ ignored");
            expect(ignored["ca-hint"]).toContain("IGNORED");
        });

        it("drills the actions facet into cp-lens-actions-rows for this lens", function () {
            var act = rows().filter(function (r) { return r["ca-name"] === "actions"; })[0];
            expect(act["ca-kind"]).toBe("drill");
            expect(act["ca-items-from"]).toBe("[cp-lens-actions-rows[" + TITLE + "]]");
        });

        it("emits a confirm-gated delete leaf firing DELETE_LENS_MESSAGE", function () {
            var del = rows().filter(function (r) { return r["ca-group"] === "danger"; })[0];
            expect(del["ca-kind"]).toBe("leaf");
            expect(del["ca-confirm"]).toBe("yes");
            expect(del["ca-actions"]).toContain(C.DELETE_LENS_MESSAGE);
        });
    });

    describe("cp-lens-edit-rows — SHIPPED lens", function () {
        var TITLE = "$:/plugins/rimir/cascade-palette/lens/caption";
        function rows() {
            return rowsFor(editOp, TITLE, wikiWith({
                title: TITLE, tags: [LENS_TAG], "ca-lens-name": "Caption",
                "ca-lens-name-filter": "[<currentTiddler>get[caption]]"
            }, TITLE));
        }

        it("offers a clone-to-edit leaf (CLONE_LENS_MESSAGE) + reopens the list, and no bind rows", function () {
            var r = rows();
            expect(byField(r, "ca-lens-name").length).toBe(0); // nothing editable in place
            var clone = r.filter(function (x) { return /Clone/.test(x["ca-name"]); })[0];
            expect(clone).toBeDefined();
            expect(clone["ca-actions"]).toContain(C.CLONE_LENS_MESSAGE);
            expect(clone["ca-actions"]).toContain(C.OPEN_ENTRY_MESSAGE);
        });
    });

    describe("cp-lens-actions-rows", function () {
        var TITLE = "$:/my/lens";
        function rows(actionsVal) {
            var f = { title: TITLE, tags: [LENS_TAG], "ca-lens-name": "L" };
            if (actionsVal !== undefined) f["ca-lens-actions"] = actionsVal;
            return rowsFor(actOp, TITLE, wikiWith(f));
        }

        it("marks (none) current when ca-lens-actions is empty", function () {
            var r = rows();
            expect(r[0]["ca-name"]).toBe("✓ (none)");
            expect(r[0]["ca-actions"]).toBe('<$action-setfield $tiddler="' + TITLE + '" ca-lens-actions=""/>');
        });

        it("marks via-entity-type current and sets it on its leaf", function () {
            var r = rows("via-entity-type");
            expect(r[1]["ca-name"]).toBe("✓ via-entity-type");
            expect(r[1]["ca-actions"]).toContain('ca-lens-actions="via-entity-type"');
            expect(r[0]["ca-name"]).toBe("(none)"); // not current
        });

        it("marks Custom current (showing the filter) and binds it for editing", function () {
            var r = rows("[tag[Action]]");
            expect(r[2]["ca-name"]).toContain("✓ Custom filter…");
            expect(r[2]["ca-name"]).toContain("[tag[Action]]");
            expect(r[2]["ca-kind"]).toBe("text");
            expect(r[2]["ca-bind-field"]).toBe("ca-lens-actions");
        });
    });
});
