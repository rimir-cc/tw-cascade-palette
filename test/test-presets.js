/*\
title: $:/plugins/rimir/cascade-palette/test/test-presets.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase D — presets capture/restore the six transient subsystems (filters,
visibility, reach, search-meta, search-field, sticky-context). Lenses are
deliberately EXCLUDED (they travel with the view). A v1 preset (no `v`,
filters + visibility only) restores the new subsystems to empty.
\*/
"use strict";

describe("cascade-palette: presets (Phase D)", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-pick-presets");

    // A widget carrying the real preset methods over fully mocked state +
    // collaborators. Constraint instances are minimal {constraintTiddler,arg}.
    function makeWidget(state) {
        state = state || {};
        var proto = {};
        setup(proto);
        var w = Object.create(proto);
        w.activeView = state.view || "$:/v/one";
        w.filters = state.filters || [];
        w.visibilities = state.visibilities || [];
        w.reachPills = state.reachPills || [];
        w.metaPills = state.metaPills || [];
        w.fieldPills = state.fieldPills || [];
        w._ctx = state.context || [];

        w._readStickyContextList = function () { return w._ctx.slice(); };
        w._writeStickyContextList = function (titles) { w._ctx = titles.slice(); };
        w._refreshContextPills = function () {};

        // Loaders echo any title as an installed meta.
        function loader() {
            return {
                _byTitle: {},
                push: null
            };
        }
        function metasFor(titles) {
            return (titles || []).map(function (t) { return { title: t }; });
        }
        // The universe of installed constraint tiddlers (so apply can resolve).
        w._installed = state.installed || {
            filter: ["$:/f/a", "$:/f/b"],
            visibility: ["$:/vis/a"],
            reach: ["$:/reach/here", "$:/reach/everywhere"],
            meta: ["$:/meta/name"],
            field: ["$:/field/text"]
        };
        w._loadFilterTiddlers = function () { return metasFor(w._installed.filter); };
        w._loadVisibilityTiddlers = function () { return metasFor(w._installed.visibility); };
        w._loadReachTiddlers = function () { return metasFor(w._installed.reach); };
        w._loadMetaTiddlers = function () { return metasFor(w._installed.meta); };
        w._loadFieldTiddlers = function () { return metasFor(w._installed.field); };

        w._buildFilterInstance = function (meta, arg) {
            return { constraintTiddler: meta.title, arg: arg || "" };
        };
        w._visibilityInstanceFor = function (meta, arg) {
            return { constraintTiddler: meta.title, arg: arg || "" };
        };
        w._buildReachInstance = function (meta) {
            return { constraintTiddler: meta.title };
        };
        w._buildMetaInstance = function (meta) {
            return { constraintTiddler: meta.title };
        };
        w._buildFieldInstance = function (meta) {
            return { constraintTiddler: meta.title };
        };

        // Render / view collaborators — no-ops for the unit under test.
        ["_renderFilterStrip", "_renderVisibilityStrip", "_renderReachStrip",
         "_renderMetaStrip", "_renderFieldStrip", "_renderContextStrip",
         "recomputeStage", "renderStage"].forEach(function (m) {
            w[m] = function () {};
        });
        w.topStage = function () { return null; };
        w._getViewByTitle = function (t) { return state.knownViews !== false ? { title: t } : null; };
        w._setActiveView = function (t) { w.activeView = t; };

        // Minimal wiki for _applyPreset's getTiddler.
        w.wiki = {
            _tiddlers: {},
            getTiddler: function (title) { return this._tiddlers[title]; },
            addTiddler: function (t) { this._tiddlers[t.fields.title] = t; }
        };
        return w;
    }

    function presetTiddler(bundle, view) {
        return { fields: {
            title: "$:/p/test",
            "ca-preset-view": view || "$:/v/two",
            "ca-preset-constraints": JSON.stringify(bundle)
        } };
    }

    describe("_currentPresetBundle", function () {
        it("captures all six subsystems + v:2, excluding lenses", function () {
            var w = makeWidget({
                filters: [{ constraintTiddler: "$:/f/a", arg: "x" }],
                visibilities: [{ constraintTiddler: "$:/vis/a", arg: "" }],
                reachPills: [{ constraintTiddler: "$:/reach/here" }],
                metaPills: [{ constraintTiddler: "$:/meta/name" }],
                fieldPills: [{ constraintTiddler: "$:/field/text" }],
                context: ["Anna", "Bob"]
            });
            var b = w._currentPresetBundle();
            expect(b.v).toBe(2);
            expect(b.filters).toEqual([{ title: "$:/f/a", arg: "x" }]);
            expect(b.visibility).toEqual([{ title: "$:/vis/a", arg: "" }]);
            expect(b.reach).toEqual([{ title: "$:/reach/here", arg: "" }]);
            expect(b.meta).toEqual([{ title: "$:/meta/name", arg: "" }]);
            expect(b.field).toEqual([{ title: "$:/field/text", arg: "" }]);
            expect(b.context).toEqual(["Anna", "Bob"]);
            expect(b.lenses).toBeUndefined();
        });
    });

    describe("_applyPreset round-trip", function () {
        it("restores filters + reach + meta + field + context", function () {
            var w = makeWidget({});
            w.wiki.addTiddler(presetTiddler({
                v: 2,
                filters: [{ title: "$:/f/b", arg: "q" }],
                visibility: [],
                reach: [{ title: "$:/reach/everywhere", arg: "" }],
                meta: [{ title: "$:/meta/name", arg: "" }],
                field: [{ title: "$:/field/text", arg: "" }],
                context: ["Carol"]
            }));
            w._applyPreset("$:/p/test");
            expect(w.filters.map(function (s) { return s.constraintTiddler; })).toEqual(["$:/f/b"]);
            expect(w.reachPills.map(function (s) { return s.constraintTiddler; })).toEqual(["$:/reach/everywhere"]);
            expect(w.metaPills.map(function (s) { return s.constraintTiddler; })).toEqual(["$:/meta/name"]);
            expect(w.fieldPills.map(function (s) { return s.constraintTiddler; })).toEqual(["$:/field/text"]);
            expect(w._ctx).toEqual(["Carol"]);
            expect(w.activeView).toBe("$:/v/two");
        });

        it("clears the new subsystems from a v1 preset (no v / no reach-meta-field-context)", function () {
            var w = makeWidget({
                reachPills: [{ constraintTiddler: "$:/reach/here" }],
                metaPills: [{ constraintTiddler: "$:/meta/name" }],
                fieldPills: [{ constraintTiddler: "$:/field/text" }],
                context: ["Stale"]
            });
            w.wiki.addTiddler(presetTiddler({
                filters: [{ title: "$:/f/a", arg: "" }],
                visibility: []
            }));
            w._applyPreset("$:/p/test");
            expect(w.reachPills).toEqual([]);
            expect(w.metaPills).toEqual([]);
            expect(w.fieldPills).toEqual([]);
            expect(w._ctx).toEqual([]);
        });

        it("skips a missing constraint tiddler (warn-and-continue)", function () {
            var w = makeWidget({});
            w.wiki.addTiddler(presetTiddler({
                v: 2, filters: [], visibility: [],
                reach: [{ title: "$:/reach/GONE", arg: "" }],
                meta: [], field: [], context: []
            }));
            w._applyPreset("$:/p/test");
            expect(w.reachPills).toEqual([]); // missing → skipped, no throw
        });
    });

    describe("_isActivePresetDirty", function () {
        it("flags a reach / meta / field / context divergence from baseline", function () {
            var w = makeWidget({});
            w.activePresetTitle = "$:/p/test";
            w.activePresetBaseline = w._presetBaselineSnapshot(); // empty everything

            expect(w._isActivePresetDirty()).toBe(false);
            w.reachPills = [{ constraintTiddler: "$:/reach/here" }];
            expect(w._isActivePresetDirty()).toBe(true);
            w.reachPills = [];
            w._ctx = ["Anna"];
            expect(w._isActivePresetDirty()).toBe(true);
        });
    });
});
