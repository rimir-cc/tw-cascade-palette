/*\
title: $:/plugins/rimir/cascade-palette/test/test-def-editor.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase 5 — the entry + action editors: lifecycle (cp-def-editor: new / clone /
delete, one generic path for both kinds), the "Manage entries" / "Manage
actions" lists (cp-def-rows), and the per-definition field editors
(cp-entry-edit-rows / cp-action-edit-rows). All driven without DOM: lifecycle
over a stub widget (real cp-view-editor _slugTitle + cp-def-editor, enterEditMode
stubbed to fire its commit), operators called directly.
\*/
"use strict";

describe("cascade-palette: entry + action editor (Phase 5)", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var entryRows = require("$:/plugins/rimir/cascade-palette/widgets/cp-def-rows.js")["cp-entry-rows"];
    var actionRows = require("$:/plugins/rimir/cascade-palette/widgets/cp-def-rows.js")["cp-action-rows"];
    var entryEdit = require("$:/plugins/rimir/cascade-palette/widgets/cp-entry-edit-rows.js")["cp-entry-edit-rows"];
    var actionEdit = require("$:/plugins/rimir/cascade-palette/widgets/cp-action-edit-rows.js")["cp-action-edit-rows"];
    var ENTRY_TAG = C.ENTRY_TAG;
    var ACTION_TAG = C.ACTION_TAG;

    // ---- shared helpers ---------------------------------------------------

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
    function run(op, operand, wiki) {
        return op(null, { operand: operand }, { wiki: wiki }).map(function (s) { return JSON.parse(s); });
    }
    function byField(rows, field) {
        return rows.filter(function (r) { return r["ca-bind-field"] === field; })[0];
    }

    function makeWidget(tiddlers, commitName) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(proto); // _slugTitle / _titleTaken
        require("$:/plugins/rimir/cascade-palette/widgets/cp-def-editor")(proto);
        var self = Object.create(proto);
        self.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) { self.wiki.addTiddler(new $tw.Tiddler(f)); });
        self._commitName = commitName;
        self.opened = [];
        // enterEditMode stub: immediately fire the commit with the prepared name.
        self.enterEditMode = function (opts) {
            self._lastEdit = opts;
            if (opts.onCommitFn) opts.onCommitFn(self._commitName);
        };
        self.openPaletteAtEntry = function (e) { self.opened.push(e); };
        self.hintEl = { textContent: "" };
        return self;
    }

    // ===================================================================
    // Lifecycle (cp-def-editor)
    // ===================================================================

    describe("lifecycle — new", function () {
        it("_newEntry prompts a name then saves a leaf entry under ENTRIES_NS, reopening the list", function () {
            var w = makeWidget([], "My Entry");
            w._newEntry();
            expect(w._lastEdit.name).toBe("New entry name");
            var made = w.wiki.filterTiddlers("[all[tiddlers]tag[" + ENTRY_TAG + "]]");
            expect(made.length).toBe(1);
            expect(made[0].indexOf(C.ENTRIES_NS)).toBe(0);
            var f = w.wiki.getTiddler(made[0]).fields;
            expect(f["ca-name"]).toBe("My Entry");
            expect(f["ca-kind"]).toBe("leaf");
            expect(w.opened).toContain("$:/plugins/rimir/cascade-palette/entries/manage-entries");
            // the transient name-prompt holder is cleaned up
            expect(w.wiki.tiddlerExists("$:/state/rimir/cascade-palette/def-name-prompt")).toBe(false);
        });

        it("_newAction saves under ACTIONS_NS with the action defaults", function () {
            var w = makeWidget([], "My Action");
            w._newAction();
            var made = w.wiki.filterTiddlers("[all[tiddlers]tag[" + ACTION_TAG + "]]");
            expect(made.length).toBe(1);
            expect(made[0].indexOf(C.ACTIONS_NS)).toBe(0);
            var f = w.wiki.getTiddler(made[0]).fields;
            expect(f["ca-name"]).toBe("My Action");
            expect(f["ca-applies"]).toBe(""); // action default
        });

        it("falls back to a default name when the prompt is blank", function () {
            var w = makeWidget([], "   ");
            w._newEntry();
            var f = w.wiki.getTiddler(w.wiki.filterTiddlers("[all[tiddlers]tag[" + ENTRY_TAG + "]]")[0]).fields;
            expect(f["ca-name"]).toBe("New entry");
        });
    });

    describe("lifecycle — clone + delete", function () {
        var SHIPPED = "$:/plugins/rimir/cascade-palette/entries/configurations";

        it("_cloneEntryToUser copies a shipped entry to an editable (copy) under ENTRIES_NS", function () {
            var w = makeWidget([], "");
            w.wiki.addTiddler(new $tw.Tiddler({ title: SHIPPED, tags: [ENTRY_TAG],
                "ca-name": "Configurations", "ca-kind": "drill", "ca-next-scope": "[tag[x]]" }));
            var realExists = w.wiki.tiddlerExists.bind(w.wiki);
            w.wiki.isShadowTiddler = function (t) { return t === SHIPPED; };
            w.wiki.tiddlerExists = function (t) { return t === SHIPPED ? false : realExists(t); };
            var nt = w._cloneEntryToUser(SHIPPED);
            expect(nt.indexOf(C.ENTRIES_NS)).toBe(0);
            var f = w.wiki.getTiddler(nt).fields;
            expect(f["ca-name"]).toBe("Configurations (copy)");
            expect(f["ca-next-scope"]).toBe("[tag[x]]"); // fields carried
            expect((f.tags || []).indexOf(ENTRY_TAG)).toBeGreaterThan(-1);
        });

        it("_deleteEntry removes a user entry but refuses a shipped one (hint set)", function () {
            var USER = C.ENTRIES_NS + "mine";
            var w = makeWidget([{ title: USER, tags: [ENTRY_TAG], "ca-name": "Mine" }], "");
            expect(w._deleteEntry(USER)).toBe(true);
            expect(w.wiki.tiddlerExists(USER)).toBe(false);

            var w2 = makeWidget([], "");
            w2.wiki.addTiddler(new $tw.Tiddler({ title: SHIPPED, tags: [ENTRY_TAG], "ca-name": "C" }));
            var realExists = w2.wiki.tiddlerExists.bind(w2.wiki);
            w2.wiki.isShadowTiddler = function (t) { return t === SHIPPED; };
            w2.wiki.tiddlerExists = function (t) { return t === SHIPPED ? false : realExists(t); };
            expect(w2._deleteEntry(SHIPPED)).toBe(false);
            expect(w2.hintEl.textContent).toMatch(/clone/i);
        });
    });

    // ===================================================================
    // Lists (cp-def-rows)
    // ===================================================================

    describe("cp-entry-rows / cp-action-rows", function () {
        it("emits a '+ New …' creator firing the right message", function () {
            expect(run(entryRows, "", wikiWith([]))[0]["ca-actions"]).toContain(C.NEW_ENTRY_MESSAGE);
            expect(run(actionRows, "", wikiWith([]))[0]["ca-actions"]).toContain(C.NEW_ACTION_MESSAGE);
        });

        it("drills each entry into cp-entry-edit-rows, grouping shipped vs user + DEL on user only", function () {
            var USER = C.ENTRIES_NS + "mine";
            var SHIP = "$:/plugins/rimir/cascade-palette/entries/shipped-one";
            var wiki = wikiWith([
                { title: USER, tags: [ENTRY_TAG], "ca-name": "Mine", "ca-kind": "leaf" },
                { title: SHIP, tags: [ENTRY_TAG], "ca-name": "Shipped", "ca-kind": "drill" }
            ], SHIP);
            var r = run(entryRows, "", wiki);
            var user = r.filter(function (x) { return x.title === USER; })[0];
            var ship = r.filter(function (x) { return x.title === SHIP; })[0];
            expect(user["ca-items-from"]).toBe("[cp-entry-edit-rows[" + USER + "]]");
            expect(user["ca-group"]).toBe("Your entries");
            expect(user["ca-on-delete"]).toContain(C.DELETE_ENTRY_MESSAGE);
            expect(ship["ca-on-delete"]).toBeUndefined();
            expect(ship["ca-group"]).toMatch(/Shipped/);
        });
    });

    // ===================================================================
    // Field editors (cp-entry-edit-rows / cp-action-edit-rows)
    // ===================================================================

    describe("cp-entry-edit-rows", function () {
        var T = C.ENTRIES_NS + "mine";
        function rows() { return run(entryEdit, T, wikiWith([{ title: T, tags: [ENTRY_TAG], "ca-name": "Mine" }])); }

        it("binds identity / kind / leaf / drill facets in place", function () {
            var r = rows();
            ["ca-name", "ca-icon", "ca-hint", "ca-order", "ca-kind", "ca-actions",
             "ca-after-fire", "ca-confirm-consequence", "ca-next-scope", "ca-items-from",
             "ca-next-title", "ca-next-entity-type"].forEach(function (fld) {
                var row = byField(r, fld);
                expect(row).toBeDefined();
                expect(row["ca-bind-tiddler"]).toBe(T);
            });
            expect(byField(r, "ca-confirm")["ca-kind"]).toBe("toggle");
        });

        it("offers a confirm-gated Delete that reopens Manage entries", function () {
            var del = rows().filter(function (x) { return /Delete this entry/.test(x["ca-name"]); })[0];
            expect(del["ca-confirm"]).toBe("yes");
            expect(del["ca-actions"]).toContain(C.DELETE_ENTRY_MESSAGE);
            expect(del["ca-actions"]).toContain(C.OPEN_ENTRY_MESSAGE);
        });

        it("is clone-only for a shipped entry (no bind rows)", function () {
            var S = "$:/plugins/rimir/cascade-palette/entries/conf";
            var r = run(entryEdit, S, wikiWith([{ title: S, tags: [ENTRY_TAG], "ca-name": "Conf" }], S));
            expect(r.filter(function (x) { return x["ca-bind-field"]; }).length).toBe(0);
            expect(r.filter(function (x) { return /Clone to a custom entry/.test(x["ca-name"]); })[0]["ca-actions"])
                .toContain(C.CLONE_ENTRY_MESSAGE);
        });
    });

    describe("cp-action-edit-rows", function () {
        var T = C.ACTIONS_NS + "mine";
        function rows() { return run(actionEdit, T, wikiWith([{ title: T, tags: [ACTION_TAG], "ca-name": "Mine" }])); }

        it("binds identity + the three discovery facets + behaviour in place", function () {
            var r = rows();
            ["ca-name", "ca-icon", "ca-hint", "ca-order",
             "ca-entity-type", "ca-applies", "ca-action-when",
             "ca-actions", "ca-after-fire", "ca-confirm-consequence"].forEach(function (fld) {
                expect(byField(r, fld)).toBeDefined();
                expect(byField(r, fld)["ca-bind-tiddler"]).toBe(T);
            });
            expect(byField(r, "ca-confirm")["ca-kind"]).toBe("toggle");
        });

        it("does not leak entry-only drill facets (next-scope/items-from)", function () {
            var r = rows();
            ["ca-next-scope", "ca-items-from", "ca-next-title"].forEach(function (fld) {
                expect(byField(r, fld)).toBeUndefined();
            });
        });

        it("is clone-only for a shipped action", function () {
            var S = "$:/plugins/rimir/cascade-palette/actions/open";
            var r = run(actionEdit, S, wikiWith([{ title: S, tags: [ACTION_TAG], "ca-name": "Open" }], S));
            expect(r.filter(function (x) { return x["ca-bind-field"]; }).length).toBe(0);
            expect(r.filter(function (x) { return /Clone to a custom action/.test(x["ca-name"]); })[0]["ca-actions"])
                .toContain(C.CLONE_ACTION_MESSAGE);
        });
    });
});
