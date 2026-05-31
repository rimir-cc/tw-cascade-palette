/*\
title: $:/plugins/rimir/cascade-palette/test/test-stage-variables.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for buildStageVariables — the canonical variable-map builder
exposed to filter and action wikitext.

The method lives on the widget prototype but uses only `this.stack` and
`this.contextTiddler` — no widget-tree state. So we apply the cp-actions
prototype-patch onto a plain object and exercise the method directly.
This sidesteps widget construction (IIFE-wrapped constructor not directly
reachable) while testing the exact code path the widget runs.
\*/
"use strict";

describe("cascade-palette: buildStageVariables", function () {

    var applyCpActions = require("$:/plugins/rimir/cascade-palette/widgets/cp-actions");

    // Build a stub widget-like object with buildStageVariables installed.
    function stub() {
        var s = { stack: [], contextTiddler: "", wiki: $tw.wiki };
        applyCpActions(s);
        return s;
    }

    it("returns base shape with empty stage", function () {
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars.query).toBe("");
        expect(vars.picked).toBe("");
        expect(vars["parent-picked"]).toBe("");
        expect(vars["context-tiddler"]).toBe("");
        expect(vars["stage-preview-context"]).toBe("");
        // currentTiddler not injected when picked is empty
        expect("currentTiddler" in vars).toBe(false);
    });

    it("injects currentTiddler when picked is non-empty", function () {
        var w = stub();
        var vars = w.buildStageVariables({ query: "q", parentPicked: "p" }, "P");
        expect(vars.picked).toBe("P");
        expect(vars.currentTiddler).toBe("P");
    });

    it("walks stack for stage-N-picked", function () {
        var w = stub();
        w.stack = [
            { parentPicked: "" },           // root
            { parentPicked: "Alice" },      // stage 1
            { parentPicked: "TeamA" }       // stage 2 (current)
        ];
        var vars = w.buildStageVariables(w.stack[2], "Decision");
        expect(vars["stage-0-picked"]).toBe("");
        expect(vars["stage-1-picked"]).toBe("Alice");
        expect(vars["stage-2-picked"]).toBe("TeamA");
        expect(vars["parent-picked"]).toBe("TeamA");
        expect(vars.picked).toBe("Decision");
    });

    it("exposes context-tiddler from this.contextTiddler", function () {
        var w = stub();
        w.contextTiddler = "$:/captured";
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars["context-tiddler"]).toBe("$:/captured");
    });

    it("stage-preview-context: topmost stage with _previewContext wins", function () {
        var w = stub();
        w.stack = [
            { parentPicked: "", _previewContext: "OUTER" },
            { parentPicked: "x" },                       // no _previewContext
            { parentPicked: "y", _previewContext: "INNER" }
        ];
        var vars = w.buildStageVariables(w.stack[2], null);
        expect(vars["stage-preview-context"]).toBe("INNER");
    });

    it("stage-preview-context falls through to outer stage", function () {
        var w = stub();
        w.stack = [
            { parentPicked: "", _previewContext: "OUTER" },
            { parentPicked: "x" }                        // no _previewContext
        ];
        var vars = w.buildStageVariables(w.stack[1], null);
        expect(vars["stage-preview-context"]).toBe("OUTER");
    });

    it("stage-preview-context defaults to empty string", function () {
        var w = stub();
        w.stack = [{ parentPicked: "" }];
        var vars = w.buildStageVariables(w.stack[0], null);
        expect(vars["stage-preview-context"]).toBe("");
    });

    it("tolerates null stage (returns base vars with empties)", function () {
        var w = stub();
        var vars = w.buildStageVariables(null, "P");
        expect(vars.query).toBe("");
        expect(vars["parent-picked"]).toBe("");
        expect(vars.picked).toBe("P");
        expect(vars.currentTiddler).toBe("P");
    });

    it("merges extras over base vars", function () {
        var w = stub();
        var vars = w.buildStageVariables(
            { query: "q", parentPicked: "" },
            "P",
            { "payload": "https://x", "row-icon-key": "url", "row-icon-mode": "primary" }
        );
        expect(vars.payload).toBe("https://x");
        expect(vars["row-icon-key"]).toBe("url");
        expect(vars["row-icon-mode"]).toBe("primary");
        // Base vars still present
        expect(vars.picked).toBe("P");
        expect(vars.query).toBe("q");
    });

    it("extras override base vars (currentTiddler in particular)", function () {
        var w = stub();
        var vars = w.buildStageVariables(
            { query: "", parentPicked: "" },
            "Picked",
            { "currentTiddler": "Override" }
        );
        expect(vars.currentTiddler).toBe("Override"); // extras wins
        expect(vars.picked).toBe("Picked");
    });

    it("ignores inherited properties on extras (uses hasOwnProperty)", function () {
        var w = stub();
        var Proto = function () {};
        Proto.prototype.shouldNotAppear = "x";
        var extras = new Proto();
        extras.real = "y";
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null, extras);
        expect(vars.real).toBe("y");
        expect("shouldNotAppear" in vars).toBe(false);
    });

    // ---- sticky-context-list / sticky-context-count ----
    //
    // The sticky-context vars are read from a single state tiddler
    // (STICKY_CONTEXT_TITLE) on every call. We mutate $tw.wiki in each
    // test and clean up afterwards so the rest of the suite stays stable.

    var STICKY_TITLE = "$:/temp/rimir/cascade-palette/sticky-context";

    afterEach(function () {
        $tw.wiki.deleteTiddler(STICKY_TITLE);
    });

    it("sticky-context vars: empty when state tiddler is absent", function () {
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars["sticky-context-list"]).toBe("");
        expect(vars["sticky-context-count"]).toBe("0");
    });

    it("sticky-context vars: empty when list field is empty string", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "" }));
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars["sticky-context-list"]).toBe("");
        expect(vars["sticky-context-count"]).toBe("0");
    });

    it("sticky-context vars: single title", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({ title: STICKY_TITLE, list: "Alice" }));
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars["sticky-context-list"]).toBe("Alice");
        expect(vars["sticky-context-count"]).toBe("1");
    });

    it("sticky-context vars: multiple titles, brackets preserved for spaces", function () {
        $tw.wiki.addTiddler(new $tw.Tiddler({
            title: STICKY_TITLE,
            list: "Alice [[Bob Jones]] Carol"
        }));
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        // stringifyList wraps space-containing titles in [[..]]
        expect(vars["sticky-context-list"]).toBe("Alice [[Bob Jones]] Carol");
        expect(vars["sticky-context-count"]).toBe("3");
    });

    it("sticky-context vars: array-typed list field handled", function () {
        // TW core may store `list` as a native array depending on the source.
        // Build a tiddler whose list field is array-shaped via parseStringArray.
        $tw.wiki.addTiddler(new $tw.Tiddler({
            title: STICKY_TITLE,
            list: $tw.utils.parseStringArray("X Y Z")
        }));
        var w = stub();
        var vars = w.buildStageVariables({ query: "", parentPicked: "" }, null);
        expect(vars["sticky-context-list"]).toBe("X Y Z");
        expect(vars["sticky-context-count"]).toBe("3");
    });
});
