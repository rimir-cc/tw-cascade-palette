/*\
title: $:/plugins/rimir/cascade-palette/test/test-search-meta-pills.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the cp-search-meta-pills module: loading from the
SEARCH_META_TAG-tagged tiddler set, _activeMetaKeys / _activeMetaPills
behaviour, and push/remove/clear lifecycle on the metaPills array.
The module is consumed by the matcher in cp-actions.js — these specs
exercise it in isolation so a regression surfaces against the meta
strip's own contract, independent of the wider widget tree.

\*/
"use strict";

describe("cascade-palette: search-meta pills", function () {

    var apply = require("$:/plugins/rimir/cascade-palette/widgets/cp-search-meta-pills");

    // Minimal stub: wiki with two pill tiddlers, no DOM. The push /
    // remove paths trigger render+recompute which we stub out so the
    // tests don't drag the whole widget tree in.
    function buildStub(pillTiddlers) {
        var stub = {
            metaPills: [],
            metaFocusIdx: 0,
            metaStripEl: null,
            focus: "input",
            wiki: {
                filterTiddlers: function (filter) {
                    if (filter.indexOf("search-meta") !== -1) {
                        return Object.keys(pillTiddlers || {});
                    }
                    return [];
                },
                getTiddler: function (title) {
                    if (pillTiddlers && pillTiddlers[title]) {
                        return { fields: pillTiddlers[title] };
                    }
                    return null;
                }
            },
            // No-op stubs for the side-effects the push path triggers
            topStage: function () { return null; },
            recomputeStage: function () {},
            renderStage: function () {},
            setFocus: function (s) { this.focus = s; },
            _parseNumOrDefault: function (raw, def) {
                var n = parseInt(raw, 10);
                return isNaN(n) ? def : n;
            }
        };
        apply(stub);
        return stub;
    }

    describe("_loadMetaTiddlers", function () {
        it("returns the canonical pill shape", function () {
            var s = buildStub({
                "$:/test/m/hint": {
                    "ca-meta-key": "hint",
                    "ca-chip": "💡 Hint",
                    "ca-hint": "subtitle",
                    "ca-help": "long-form",
                    "ca-order": "110"
                }
            });
            var metas = s._loadMetaTiddlers();
            expect(metas.length).toBe(1);
            expect(metas[0]).toEqual({
                title: "$:/test/m/hint",
                name: "hint",
                metaKey: "hint",
                chip: "💡 Hint",
                hint: "subtitle",
                help: "long-form",
                order: 110
            });
        });

        it("falls back to the title's last segment when ca-meta-key is empty", function () {
            var s = buildStub({
                "$:/test/m/somekey": {}
            });
            var metas = s._loadMetaTiddlers();
            expect(metas[0].name).toBe("somekey");
            expect(metas[0].metaKey).toBe("");
        });
    });

    describe("push / remove / clear", function () {
        function pushOne(stub, title) {
            var meta = stub._loadMetaTiddlers().filter(function (m) {
                return m.title === title;
            })[0];
            stub._pushMeta(stub._buildMetaInstance(meta));
        }

        it("push appends an instance to metaPills", function () {
            var s = buildStub({
                "$:/test/m/name": { "ca-meta-key": "name", "ca-chip": "🏷 Name" }
            });
            pushOne(s, "$:/test/m/name");
            expect(s.metaPills.length).toBe(1);
            expect(s.metaPills[0].metaKey).toBe("name");
            expect(s.metaPills[0].chip).toBe("🏷 Name");
        });

        it("push of the same pill twice dedupes (keeps most-recent)", function () {
            var s = buildStub({
                "$:/test/m/name": { "ca-meta-key": "name" }
            });
            pushOne(s, "$:/test/m/name");
            pushOne(s, "$:/test/m/name");
            expect(s.metaPills.length).toBe(1);
        });

        it("_removeMetaAt splices and clamps focus idx", function () {
            var s = buildStub({
                "$:/test/m/name": { "ca-meta-key": "name" },
                "$:/test/m/hint": { "ca-meta-key": "hint" }
            });
            pushOne(s, "$:/test/m/name");
            pushOne(s, "$:/test/m/hint");
            s.metaFocusIdx = 1;
            s._removeMetaAt(1);
            expect(s.metaPills.length).toBe(1);
            expect(s.metaFocusIdx).toBe(0);
        });

        it("_clearAllMeta empties the array and resets focus idx", function () {
            var s = buildStub({
                "$:/test/m/name": { "ca-meta-key": "name" },
                "$:/test/m/hint": { "ca-meta-key": "hint" }
            });
            pushOne(s, "$:/test/m/name");
            pushOne(s, "$:/test/m/hint");
            s._clearAllMeta();
            expect(s.metaPills.length).toBe(0);
            expect(s.metaFocusIdx).toBe(0);
        });
    });

    describe("_activeMetaKeys / _activeMetaPills", function () {
        it("returns null when no pills pushed", function () {
            var s = buildStub({});
            expect(s._activeMetaKeys()).toBe(null);
            expect(s._activeMetaPills()).toBe(null);
        });

        it("returns key array (dedupe by metaKey)", function () {
            var s = buildStub({});
            s.metaPills = [
                {metaKey: "name", chip: "🏷 Name", constraintTiddler: "a"},
                {metaKey: "hint", chip: "💡 Hint", constraintTiddler: "b"},
                {metaKey: "name", chip: "🏷 Name 2", constraintTiddler: "c"}
            ];
            expect(s._activeMetaKeys()).toEqual(["name", "hint"]);
        });

        it("returns instance array preserving order + dedup", function () {
            var s = buildStub({});
            s.metaPills = [
                {metaKey: "name", chip: "🏷 Name", constraintTiddler: "a"},
                {metaKey: "hint", chip: "💡 Hint", constraintTiddler: "b"}
            ];
            var pills = s._activeMetaPills();
            expect(pills.length).toBe(2);
            expect(pills[0].metaKey).toBe("name");
            expect(pills[1].metaKey).toBe("hint");
        });

        it("skips pills with empty metaKey", function () {
            var s = buildStub({});
            s.metaPills = [
                {metaKey: "", chip: "x", constraintTiddler: "a"},
                {metaKey: "hint", chip: "h", constraintTiddler: "b"}
            ];
            expect(s._activeMetaKeys()).toEqual(["hint"]);
        });
    });

    describe("_addMetaByTitle", function () {
        it("loads + pushes a meta pill by tiddler title", function () {
            var s = buildStub({
                "$:/test/m/hint": { "ca-meta-key": "hint", "ca-chip": "💡 Hint" }
            });
            s._addMetaByTitle("$:/test/m/hint");
            expect(s.metaPills.length).toBe(1);
            expect(s.metaPills[0].metaKey).toBe("hint");
        });

        it("silent no-op when the title is unknown", function () {
            var s = buildStub({});
            s._addMetaByTitle("$:/does/not/exist");
            expect(s.metaPills.length).toBe(0);
        });
    });
});
