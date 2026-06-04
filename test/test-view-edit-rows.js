/*\
title: $:/plugins/rimir/cascade-palette/test/test-view-edit-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase 4 — the view LONG-TAIL field editor (cp-view-edit-rows), the drill
behind Manage views → "Edit all fields…". For a USER view it emits grouped
`ca-bind-*` rows covering the genuinely view-scoped long tail (identity /
display toggles / sort detail / picking / row defaults) plus Fork + confirm-
Delete leaves. For a SHIPPED (shadow-only) view it offers a single fork-to-edit
leaf + read-only summary. The operand defaults to the active view (state
tiddler), self-healing to the default view when unset.
\*/
"use strict";

describe("cascade-palette: view field editor (Phase 4)", function () {

    var editOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-view-edit-rows.js")["cp-view-edit-rows"];
    var layerOp = require("$:/plugins/rimir/cascade-palette/widgets/cp-layer-edit-rows.js")["cp-layer-edit-rows"];
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var VIEW_TAG = C.VIEW_TAG;
    var LAYER_TAG = C.STRUCTURE_LAYER_TAG;
    var BUILTIN_ENTRIES = "$:/plugins/rimir/cascade-palette/structure-layers/entries";

    function wikiWith(fieldsList, shippedTitle) {
        var wiki = new $tw.Wiki();
        (fieldsList || []).forEach(function (f) { wiki.addTiddler(new $tw.Tiddler(f)); });
        if (shippedTitle) {
            var realExists = wiki.tiddlerExists.bind(wiki);
            var realShadow = wiki.isShadowTiddler.bind(wiki);
            wiki.isShadowTiddler = function (title) { return title === shippedTitle || realShadow(title); };
            wiki.tiddlerExists = function (title) {
                return title === shippedTitle ? false : realExists(title);
            };
        }
        return wiki;
    }
    function run(operand, wiki) {
        return editOp(null, { operand: operand }, { wiki: wiki }).map(function (s) { return JSON.parse(s); });
    }
    function byField(rows, field) {
        return rows.filter(function (r) { return r["ca-bind-field"] === field; })[0];
    }
    function viewFields(title, extra) {
        var f = { title: title, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki", "ca-view-name": "V" };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    describe("USER view", function () {
        var TITLE = "$:/plugins/rimir/cascade-palette/views/mine";
        function rows() { return run(TITLE, wikiWith([viewFields(TITLE, {})])); }

        it("binds every editable facet to the view tiddler via ca-bind-*", function () {
            var r = rows();
            r.filter(function (x) { return x["ca-kind"] === "text" || x["ca-kind"] === "toggle"; })
                .forEach(function (x) { expect(x["ca-bind-tiddler"]).toBe(TITLE); });
        });

        it("emits the identity text fields", function () {
            var r = rows();
            ["ca-view-name", "ca-view-hint", "ca-icon", "ca-order"].forEach(function (fld) {
                var row = byField(r, fld);
                expect(row).toBeDefined();
                expect(row["ca-kind"]).toBe("text");
                expect(row["ca-group"]).toBe("identity");
            });
        });

        it("emits the boolean display facets as yes/no toggles", function () {
            var r = rows();
            ["ca-view-show-count", "ca-view-containers-first", "ca-view-show-action-preview",
             "ca-view-show-side-preview", "ca-view-context-aware"].forEach(function (fld) {
                var row = byField(r, fld);
                expect(row).toBeDefined();
                expect(row["ca-kind"]).toBe("toggle");
                expect(row["ca-true-value"]).toBe("yes");
                expect(row["ca-false-value"]).toBe("no");
            });
        });

        it("emits picking + sort-detail + row-default text facets", function () {
            var r = rows();
            ["ca-view-count-format", "ca-view-sort-field", "ca-view-sort-key",
             "ca-view-pick-mode", "ca-view-after-fire",
             "ca-view-row-hint", "ca-view-row-icon", "ca-view-row-order",
             "ca-view-row-next-scope", "ca-view-row-items-from"].forEach(function (fld) {
                expect(byField(r, fld)).toBeDefined();
            });
            expect(byField(r, "ca-view-pick-emits-filter")["ca-kind"]).toBe("toggle");
        });

        it("does NOT repeat the Structure-strip facets (roots/children/leaf/label/axes/sort/include-entries/grouping)", function () {
            var r = rows();
            ["ca-view-roots", "ca-view-children", "ca-view-leaf", "ca-view-label",
             "ca-view-axes", "ca-view-sort", "ca-view-include-entries", "ca-view-grouping"]
                .forEach(function (fld) { expect(byField(r, fld)).toBeUndefined(); });
        });

        it("offers Fork + a confirm-gated Delete that reopens Manage views", function () {
            var r = rows();
            var fork = r.filter(function (x) { return /Fork this view/.test(x["ca-name"]); })[0];
            expect(fork["ca-actions"]).toContain(C.FORK_VIEW_MESSAGE);
            var del = r.filter(function (x) { return /Delete this view/.test(x["ca-name"]); })[0];
            expect(del["ca-confirm"]).toBe("yes");
            expect(del["ca-actions"]).toContain(C.DELETE_VIEW_MESSAGE);
            expect(del["ca-actions"]).toContain(C.OPEN_ENTRY_MESSAGE);
        });
    });

    describe("SHIPPED view", function () {
        var TITLE = "$:/plugins/rimir/cascade-palette/views/by-date";

        it("offers only a fork-to-edit leaf + read-only summary (no bind rows)", function () {
            var wiki = wikiWith([viewFields(TITLE, { "ca-view-sort": "natural", "ca-view-roots": "[!is[system]]" })], TITLE);
            var r = run(TITLE, wiki);
            expect(r.filter(function (x) { return x["ca-bind-field"]; }).length).toBe(0);
            var fork = r.filter(function (x) { return /Fork to a custom view/.test(x["ca-name"]); })[0];
            expect(fork).toBeDefined();
            expect(fork["ca-actions"]).toContain(C.FORK_VIEW_MESSAGE);
            expect(r.filter(function (x) { return /shipped/.test(x["ca-name"]); }).length).toBe(1);
        });
    });

    describe("explicit-layer view → layer drill rows", function () {
        var VT = "$:/plugins/rimir/cascade-palette/views/v";
        var L1 = "$:/plugins/rimir/cascade-palette/structure-layers/tree";

        function rows() {
            return run(VT, wikiWith([
                viewFields(VT, { "ca-view-layers": BUILTIN_ENTRIES + " " + L1 }),
                { title: L1, tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
                  "ca-layer-name": "Tree", "ca-layer-roots": "[!is[system]]" }
            ]));
        }

        it("drills each explicit layer into cp-layer-edit-rows, skipping the built-in entries layer", function () {
            var r = rows();
            var layerRows = r.filter(function (x) { return x["ca-group"] === "layers"; });
            expect(layerRows.length).toBe(1); // entries layer excluded
            expect(layerRows[0]["ca-kind"]).toBe("drill");
            expect(layerRows[0]["ca-items-from"]).toBe("[cp-layer-edit-rows[" + L1 + "]]");
            expect(layerRows[0]["ca-name"]).toContain("Tree");
        });
    });

    describe("cp-layer-edit-rows", function () {
        var LT = "$:/plugins/rimir/cascade-palette/structure-layers/mine";
        function layerRows(operand, wiki) {
            return layerOp(null, { operand: operand }, { wiki: wiki }).map(function (s) { return JSON.parse(s); });
        }
        function lbind(rows, field) {
            return rows.filter(function (r) { return r["ca-bind-field"] === field; })[0];
        }

        it("emits identity / producer / row-default facets for a USER layer, bound in place", function () {
            var wiki = wikiWith([{ title: LT, tags: [LAYER_TAG], type: "text/vnd.tiddlywiki", "ca-layer-name": "L" }]);
            var r = layerRows(LT, wiki);
            ["ca-layer-name", "ca-layer-source", "ca-layer-row-hint", "ca-layer-row-icon",
             "ca-layer-row-order", "ca-layer-row-next-scope", "ca-layer-row-items-from"]
                .forEach(function (fld) {
                    expect(lbind(r, fld)).toBeDefined();
                    expect(lbind(r, fld)["ca-bind-tiddler"]).toBe(LT);
                });
            expect(lbind(r, "ca-layer-include-position")["ca-kind"]).toBe("toggle");
        });

        it("does NOT repeat Structure-strip layer facets (roots/children/leaf/label/axes/row-name/...)", function () {
            var wiki = wikiWith([{ title: LT, tags: [LAYER_TAG], type: "text/vnd.tiddlywiki", "ca-layer-name": "L" }]);
            var r = layerRows(LT, wiki);
            ["ca-layer-roots", "ca-layer-children", "ca-layer-leaf", "ca-layer-label",
             "ca-layer-axes", "ca-layer-row-name", "ca-layer-row-group", "ca-layer-row-kind",
             "ca-layer-row-actions", "ca-layer-row-entity-type"]
                .forEach(function (fld) { expect(lbind(r, fld)).toBeUndefined(); });
        });

        it("is read-only for a SHIPPED layer (summary + Structure-strip hint, no bind rows)", function () {
            var wiki = wikiWith([{ title: LT, tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
                "ca-layer-name": "L", "ca-layer-roots": "[tag[x]]" }], LT);
            var r = layerRows(LT, wiki);
            expect(r.filter(function (x) { return x["ca-bind-field"]; }).length).toBe(0);
            expect(r.filter(function (x) { return /Structure strip/.test(x["ca-name"]); }).length).toBe(1);
        });
    });

    describe("operand resolution", function () {
        it("falls back to the active-view state tiddler when no operand is given", function () {
            var TITLE = "$:/plugins/rimir/cascade-palette/views/active-one";
            var wiki = wikiWith([
                viewFields(TITLE, {}),
                { title: C.ACTIVE_VIEW_STATE, text: TITLE }
            ]);
            var r = run("", wiki);
            expect(byField(r, "ca-view-name")["ca-bind-tiddler"]).toBe(TITLE);
        });

        it("self-heals to the default view when no operand and no state", function () {
            var DEF = "$:/plugins/rimir/cascade-palette/views/def";
            var OTHER = "$:/plugins/rimir/cascade-palette/views/other";
            var wiki = wikiWith([
                viewFields(OTHER, {}),
                viewFields(DEF, { "ca-view-default": "yes" })
            ]);
            var r = run("", wiki);
            expect(byField(r, "ca-view-name")["ca-bind-tiddler"]).toBe(DEF);
        });

        it("returns no rows when there is no view to target", function () {
            expect(run("", wikiWith([])).length).toBe(0);
        });
    });
});
