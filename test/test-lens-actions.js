/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-actions.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 slice 3 — actions via lens.

A lens with a non-empty `ca-lens-actions` is ACTIONS-ACTIVE whenever it
applies (`ca-lens-when`) — INDEPENDENT of any decoration-slot selection.
Two forms:
  via-entity-type  declarative marker; the lens owns the always-on
                   entity-type bridge and contributes no extra titles here.
  <filter>         returns ACTION tiddler titles, run with
                   <currentTiddler> = the row, surfacing lens-specific
                   actions (e.g. a Vacation lens adding "Clear vacation").

Part A unit-tests cp-lenses#_lensContributedActionTitles in isolation
(stubbed `_filterInScope`). Part B exercises the union into cp-stack#
loadActionsForType over a real wiki — the lens-contributed title must be a
real action tiddler, survive the `ca-action-when` narrowing, and dedupe
against the other paths.
\*/
"use strict";

describe("cascade-palette: actions via lens (H4 slice 3)", function () {

    var lensSetup = require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses");
    var stackSetup = require("$:/plugins/rimir/cascade-palette/widgets/cp-stack");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;
    var ACTION_TAG = C.ACTION_TAG;

    // Build a widget with the lens subsystem (and, when `withStack`, the
    // stage stack) wired onto one prototype. `_filterInScope` is a
    // deterministic registry; keys are filter strings, values are
    // function(currentTiddler) -> array.
    function makeWidget(tiddlers, opts) {
        opts = opts || {};
        var proto = {};
        lensSetup(proto);
        if (opts.withStack) stackSetup(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        w._parseNumOrDefault = function (raw, fb) {
            var n = parseInt(raw, 10);
            return isNaN(n) ? fb : n;
        };
        w._filterResults = opts.filters || {};
        w._filterCalls = [];
        w._filterInScope = function (filter, vars) {
            w._filterCalls.push({ filter: filter, ct: vars && vars.currentTiddler });
            var fn = w._filterResults[filter];
            return fn ? (fn((vars || {}).currentTiddler) || []) : [];
        };
        // Identity cascade-field reader so loadActionsForType results are
        // easy to assert by title.
        w.readCascadeFields = function (title) { return { title: title }; };
        return w;
    }

    function lensFields(extra) {
        var f = { tags: [LENS_TAG] };
        for (var k in extra) f[k] = extra[k];
        return f;
    }
    function actionFields(extra) {
        var f = { tags: [ACTION_TAG] };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    /* ---------- Part A: _lensContributedActionTitles ---------- */

    describe("_lensContributedActionTitles", function () {

        it("returns nothing when no lens declares ca-lens-actions", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/title", "ca-lens-name": "Title",
                "ca-lens-name-filter": "F_TITLE"
            })]);
            expect(w._lensContributedActionTitles("Anna")).toEqual([]);
        });

        it("skips the via-entity-type marker (served by the always-on bridge)", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/kind", "ca-lens-name": "Kind",
                "ca-lens-icon-filter": "F_ICON",
                "ca-lens-actions": "via-entity-type"
            })]);
            expect(w._lensContributedActionTitles("Anna")).toEqual([]);
            // The marker is never evaluated as a filter.
            expect(w._filterCalls.some(function (c) {
                return c.filter === "via-entity-type";
            })).toBe(false);
        });

        it("returns filter titles run with <currentTiddler> = the row, deduped", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/vac", "ca-lens-name": "Vacation",
                "ca-lens-annotation-template": "<<x>>",
                "ca-lens-actions": "F_VAC_ACTIONS"
            })], {
                filters: {
                    F_VAC_ACTIONS: function (ct) {
                        return ["$:/act/clear-vac", "$:/act/clear-vac", "for-" + ct];
                    }
                }
            });
            expect(w._lensContributedActionTitles("Anna"))
                .toEqual(["$:/act/clear-vac", "for-Anna"]);
        });

        it("skips a lens whose ca-lens-when yields nothing (not applicable)", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/vac", "ca-lens-name": "Vacation",
                "ca-lens-when": "F_WHEN",
                "ca-lens-actions": "F_VAC_ACTIONS"
            })], {
                filters: {
                    F_WHEN: function () { return []; },
                    F_VAC_ACTIONS: function () { return ["$:/act/x"]; }
                }
            });
            expect(w._lensContributedActionTitles("Anna")).toEqual([]);
        });

        it("is always-on — never reads the per-slot lens state", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/vac", "ca-lens-name": "Vacation",
                "ca-lens-actions": "F_VAC_ACTIONS"
            })], {
                filters: { F_VAC_ACTIONS: function () { return ["$:/act/x"]; } }
            });
            var seenStateRead = false;
            var realGet = w.wiki.getTiddlerText.bind(w.wiki);
            w.wiki.getTiddlerText = function (title, fb) {
                if (title.indexOf(C.LENS_STATE_PREFIX) === 0) seenStateRead = true;
                return realGet(title, fb);
            };
            expect(w._lensContributedActionTitles("Anna")).toEqual(["$:/act/x"]);
            expect(seenStateRead).toBe(false);
        });
    });

    /* ---------- Part B: union into loadActionsForType ---------- */

    describe("loadActionsForType integration", function () {

        it("unions a lens-contributed action tiddler into the result", function () {
            var w = makeWidget([
                actionFields({ title: "$:/act/clear-vac", "ca-name": "Clear vacation" }),
                lensFields({
                    title: "$:/lens/vac", "ca-lens-name": "Vacation",
                    "ca-lens-actions": "F_VAC_ACTIONS"
                })
            ], {
                withStack: true,
                filters: { F_VAC_ACTIONS: function () { return ["$:/act/clear-vac"]; } }
            });
            var titles = w.loadActionsForType(null, "Anna")
                .map(function (a) { return a.title; });
            expect(titles).toEqual(["$:/act/clear-vac"]);
        });

        it("drops a contributed title that is not an action tiddler", function () {
            var w = makeWidget([
                { title: "Plain note" },
                lensFields({
                    title: "$:/lens/vac", "ca-lens-name": "Vacation",
                    "ca-lens-actions": "F_VAC_ACTIONS"
                })
            ], {
                withStack: true,
                filters: { F_VAC_ACTIONS: function () { return ["Plain note"]; } }
            });
            expect(w.loadActionsForType(null, "Anna")).toEqual([]);
        });

        it("applies ca-action-when narrowing to a contributed action", function () {
            var defs = [
                actionFields({
                    title: "$:/act/clear-vac", "ca-name": "Clear vacation",
                    "ca-action-when": "F_WHEN"
                }),
                lensFields({
                    title: "$:/lens/vac", "ca-lens-name": "Vacation",
                    "ca-lens-actions": "F_VAC_ACTIONS"
                })
            ];
            // ca-action-when false → narrowed out.
            var off = makeWidget(defs, {
                withStack: true,
                filters: {
                    F_VAC_ACTIONS: function () { return ["$:/act/clear-vac"]; },
                    F_WHEN: function () { return []; }
                }
            });
            expect(off.loadActionsForType(null, "Anna")).toEqual([]);
            // ca-action-when true → kept.
            var on = makeWidget(defs, {
                withStack: true,
                filters: {
                    F_VAC_ACTIONS: function () { return ["$:/act/clear-vac"]; },
                    F_WHEN: function () { return ["yes"]; }
                }
            });
            expect(on.loadActionsForType(null, "Anna")
                .map(function (a) { return a.title; })).toEqual(["$:/act/clear-vac"]);
        });

        it("dedupes a title already matched by the ca-applies path", function () {
            var w = makeWidget([
                actionFields({
                    title: "$:/act/clear-vac", "ca-name": "Clear vacation",
                    "ca-applies": "F_APPLIES"
                }),
                lensFields({
                    title: "$:/lens/vac", "ca-lens-name": "Vacation",
                    "ca-lens-actions": "F_VAC_ACTIONS"
                })
            ], {
                withStack: true,
                filters: {
                    F_APPLIES: function () { return ["Anna"]; },
                    F_VAC_ACTIONS: function () { return ["$:/act/clear-vac"]; }
                }
            });
            var titles = w.loadActionsForType(null, "Anna")
                .map(function (a) { return a.title; });
            expect(titles).toEqual(["$:/act/clear-vac"]);
        });

        it("unions the catalogue path AND the lens path, deduped across both", function () {
            // Full 4-path entry point: one action surfaces only via the
            // catalogue (global ca-entity-type "*"), one only via the lens
            // filter, and the lens redundantly re-contributes the global —
            // the result is the union with the duplicate collapsed.
            var w = makeWidget([
                actionFields({ title: "$:/act/global", "ca-name": "Global", "ca-entity-type": "*" }),
                actionFields({ title: "$:/act/clear-vac", "ca-name": "Clear vacation" }),
                lensFields({
                    title: "$:/lens/vac", "ca-lens-name": "Vacation",
                    "ca-lens-actions": "F_VAC_ACTIONS"
                })
            ], {
                withStack: true,
                filters: {
                    F_VAC_ACTIONS: function () {
                        return ["$:/act/clear-vac", "$:/act/global"];
                    }
                }
            });
            var titles = w.loadActionsForType("person", "Anna")
                .map(function (a) { return a.title; }).sort();
            expect(titles).toEqual(["$:/act/clear-vac", "$:/act/global"]);
        });
    });
});
