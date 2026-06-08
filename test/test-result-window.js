/*\
title: $:/plugins/rimir/cascade-palette/test/test-result-window.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Result-window pagination. When a stage's filtered set exceeds the visible
window (max-results, default 30), _applyResultWindow (cp-stack.js) slices to
`stage.windowSize` and appends two synthetic sentinel rows — "Show N more"
(_windowGrow:"page") and "Show all N" (_windowGrow:"all"). fireSelected
(cp-firing.js) grows the window when a sentinel is activated; the window resets
to one page whenever the query text changes.
\*/
"use strict";

describe("cascade-palette: result window", function () {

    var setupStack = require("$:/plugins/rimir/cascade-palette/widgets/cp-stack");
    var setupActions = require("$:/plugins/rimir/cascade-palette/widgets/cp-actions");
    var setupFiring = require("$:/plugins/rimir/cascade-palette/widgets/cp-firing");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

    // Widget carrying the window slice (cp-stack) + max-results getters
    // (cp-actions) + fireSelected (cp-firing). `max` / `step` seed the config
    // tiddlers; omit for defaults.
    function makeWidget(max, step) {
        var proto = {};
        setupStack(proto);
        setupActions(proto);
        setupFiring(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        if (max !== undefined) {
            w.wiki.addTiddler(new $tw.Tiddler({
                title: C.MAX_RESULTS_CONFIG, text: String(max)
            }));
        }
        if (step !== undefined) {
            w.wiki.addTiddler(new $tw.Tiddler({
                title: C.MAX_RESULTS_STEP_CONFIG, text: String(step)
            }));
        }
        return w;
    }

    function rows(n) {
        var out = [];
        for (var i = 0; i < n; i++) {
            out.push({ title: "T" + i, name: "T" + i, dataRow: true });
        }
        return out;
    }
    function sentinels(results) {
        return results.filter(function (r) { return r._windowSentinel; });
    }

    describe("_applyResultWindow", function () {

        it("shows `max` real rows + 2 sentinels when total exceeds the window", function () {
            var w = makeWidget(3);
            var stage = { query: "" };
            var res = w._applyResultWindow(stage, rows(10));
            expect(res.length).toBe(5);                 // 3 real + 2 sentinels
            expect(res[0].title).toBe("T0");
            expect(res[2].title).toBe("T2");
            expect(res[3]._windowSentinel).toBe(true);
            expect(res[3]._windowGrow).toBe("page");
            expect(res[3].name).toBe("Show 3 more");
            expect(res[4]._windowGrow).toBe("all");
            expect(res[4].name).toBe("Show all 10");
        });

        it("appends NO sentinels when total fits the window", function () {
            var w = makeWidget(3);
            var res = w._applyResultWindow({ query: "" }, rows(3));
            expect(res.length).toBe(3);
            expect(sentinels(res).length).toBe(0);
        });

        it("the 'page' sentinel offers min(step, remaining) more", function () {
            var w = makeWidget(3);
            var stage = { query: "", windowSize: 9, _windowQuery: "" };
            var res = w._applyResultWindow(stage, rows(10)); // 9 shown, remaining 1
            expect(res.length).toBe(11);                     // 9 real + 2 sentinels
            expect(sentinels(res).length).toBe(2);
            expect(res[9]._windowGrow).toBe("page");
            expect(res[9].name).toBe("Show 1 more");         // min(step 3, remaining 1)
            expect(res[10]._windowGrow).toBe("all");
        });

        it("a grown window (windowSize >= total) drops the sentinels", function () {
            var w = makeWidget(3);
            var stage = { query: "", windowSize: 10, _windowQuery: "" };
            var res = w._applyResultWindow(stage, rows(10));
            expect(res.length).toBe(10);
            expect(sentinels(res).length).toBe(0);
        });

        it("windowSize Infinity ('load all') shows everything, no sentinels", function () {
            var w = makeWidget(3);
            var stage = { query: "", windowSize: Infinity, _windowQuery: "" };
            var res = w._applyResultWindow(stage, rows(50));
            expect(res.length).toBe(50);
            expect(sentinels(res).length).toBe(0);
        });

        it("resets the window to one page when the query text changes", function () {
            var w = makeWidget(3);
            var stage = { query: "abc", windowSize: 9, _windowQuery: "ab" };
            var res = w._applyResultWindow(stage, rows(10));
            expect(stage.windowSize).toBe(3);            // reset to max
            expect(stage._windowQuery).toBe("abc");
            expect(sentinels(res).length).toBe(2);
        });

        it("keeps an expanded window while the query is unchanged", function () {
            var w = makeWidget(3);
            var stage = { query: "x", windowSize: 6, _windowQuery: "x" };
            w._applyResultWindow(stage, rows(10));
            expect(stage.windowSize).toBe(6);            // untouched
        });
    });

    describe("getMaxResultsStep", function () {
        it("defaults to the page size (getMaxResults) when absent", function () {
            expect(makeWidget(7).getMaxResultsStep()).toBe(7);
        });
        it("uses its own config when set", function () {
            expect(makeWidget(7, 2).getMaxResultsStep()).toBe(2);
        });
    });

    describe("fireSelected on a sentinel", function () {

        // Drive only the sentinel branch: stub topStage / applyQueryToStage /
        // renderResults so no DOM or full filter pipeline is needed.
        function fireWidget(max, allRows, selectedIndex) {
            var w = makeWidget(max);
            var stage = { query: "", kind: "root", windowSize: undefined };
            stage.results = w._applyResultWindow(stage, allRows);
            stage.selectedIndex = selectedIndex;
            w.topStage = function () { return stage; };
            w.applyQueryToStage = function (s) {
                s.results = w._applyResultWindow(s, allRows);
            };
            w.renderResults = function () {};
            return { w: w, stage: stage };
        }

        it("'Show more' grows the window by one page and selects the first new row", function () {
            var f = fireWidget(3, rows(10), 3); // index 3 = the "page" sentinel
            f.w.fireSelected();
            expect(f.stage.windowSize).toBe(6);          // 3 + step(3)
            expect(f.stage.selectedIndex).toBe(3);       // firstNew = old windowSize
            expect(f.stage.results.length).toBe(8);      // 6 real + 2 sentinels
        });

        it("'Show all' expands the window to everything", function () {
            var f = fireWidget(3, rows(10), 4); // index 4 = the "all" sentinel
            f.w.fireSelected();
            expect(f.stage.windowSize).toBe(Infinity);
            expect(f.stage.results.length).toBe(10);
            expect(sentinels(f.stage.results).length).toBe(0);
        });
    });
});
