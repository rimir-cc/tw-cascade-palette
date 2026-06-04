/*\
title: $:/plugins/rimir/cascade-palette/test/test-large-root-set.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase 6 — the large-root-set perf warning (cp-stack getLargeRootSetWarning /
_maybeWarnLargeRootSet): a view whose full item set exceeds the configured
threshold warns ONCE (per view + stage-kind, not per keystroke), re-arming
when the set recovers below the threshold. Pure logic over a stub widget.
\*/
"use strict";

describe("cascade-palette: large-root-set warning (Phase 6)", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var CONFIG = C.LARGE_ROOT_SET_CONFIG;
    var DEFAULT = C.DEFAULT_LARGE_ROOT_SET;

    function widget(configValue) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-stack")(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        if (configValue != null) {
            w.wiki.addTiddler(new $tw.Tiddler({ title: CONFIG, text: String(configValue) }));
        }
        w.activeView = "V";
        return w;
    }
    function rootStage(n) {
        return { kind: "root", viewTitle: "V", items: new Array(n) };
    }

    describe("getLargeRootSetWarning", function () {
        it("defaults when the config is missing", function () {
            expect(widget(null).getLargeRootSetWarning()).toBe(DEFAULT);
        });
        it("honours an explicit threshold", function () {
            expect(widget("500").getLargeRootSetWarning()).toBe(500);
        });
        it("treats 0 as explicitly disabled", function () {
            expect(widget("0").getLargeRootSetWarning()).toBe(0);
        });
        it("falls back to the default on garbage / negatives", function () {
            expect(widget("abc").getLargeRootSetWarning()).toBe(DEFAULT);
            expect(widget("-5").getLargeRootSetWarning()).toBe(DEFAULT);
        });
    });

    describe("_maybeWarnLargeRootSet", function () {
        it("warns once when the item set exceeds the threshold, then dedups", function () {
            var w = widget("100");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet(rootStage(101));
            w._maybeWarnLargeRootSet(rootStage(101));
            w._maybeWarnLargeRootSet(rootStage(150));
            expect(console.warn.calls.count()).toBe(1);
        });

        it("does not warn at or below the threshold", function () {
            var w = widget("100");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet(rootStage(100));
            w._maybeWarnLargeRootSet(rootStage(10));
            expect(console.warn).not.toHaveBeenCalled();
        });

        it("re-arms: recovering below the threshold lets a later regrowth warn again", function () {
            var w = widget("100");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet(rootStage(200)); // warn
            w._maybeWarnLargeRootSet(rootStage(50));  // recover (re-arm)
            w._maybeWarnLargeRootSet(rootStage(200)); // warn again
            expect(console.warn.calls.count()).toBe(2);
        });

        it("is disabled when the threshold is 0", function () {
            var w = widget("0");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet(rootStage(99999));
            expect(console.warn).not.toHaveBeenCalled();
        });

        it("only applies to root / tree stages, not filter / actions", function () {
            var w = widget("100");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet({ kind: "filter", viewTitle: "V", items: new Array(500) });
            w._maybeWarnLargeRootSet({ kind: "actions", viewTitle: "V", items: new Array(500) });
            expect(console.warn).not.toHaveBeenCalled();
        });

        it("tracks root and tree independently (per view + kind)", function () {
            var w = widget("100");
            spyOn(console, "warn");
            w._maybeWarnLargeRootSet({ kind: "root", viewTitle: "V", items: new Array(200) });
            w._maybeWarnLargeRootSet({ kind: "tree", viewTitle: "V", items: new Array(200) });
            expect(console.warn.calls.count()).toBe(2);
        });
    });
});
