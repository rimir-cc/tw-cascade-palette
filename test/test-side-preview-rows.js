/*\
title: $:/plugins/rimir/cascade-palette/test/test-side-preview-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Side preview: a stage's CURRENTLY-SELECTED row that carries its own
`previewTemplate` (item.previewTemplate, e.g. a synthetic Overview row)
surfaces in the preview pane on mere selection — not only on drill. Synthetic
rows have an empty title, so the auto-open fallback must anchor on the template
when the title is empty.
\*/
"use strict";

describe("cascade-palette: selected-row side preview", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-side-preview");

    function makeWidget(stage, viewAllows) {
        var proto = {};
        setup(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        w.stack = [stage];
        // _stageAllowsAutoOpenSidePreview walks to _getViewByTitle — stub it.
        w._getViewByTitle = function () {
            return { showSidePreview: viewAllows !== false };
        };
        return w;
    }
    function rootStage(row) {
        return {
            kind: "root", viewTitle: "$:/v/x",
            results: [row], selectedIndex: 0
        };
    }

    it("surfaces a selected row's own previewTemplate as candidate 0", function () {
        var w = makeWidget(rootStage(
            { title: "", previewTemplate: "MyTpl", previewName: "Overview" }
        ));
        var resolved = w._resolvePreviewCandidates();
        expect(resolved.candidates.length).toBe(1);
        expect(resolved.candidates[0].template).toBe("MyTpl");
        expect(resolved.candidates[0].name).toBe("Overview");
    });

    it("qualifies the stage for auto-open even when the row title is empty", function () {
        var w = makeWidget(rootStage(
            { title: "", previewTemplate: "MyTpl" }
        ));
        var active = w._activePreviewContext();
        expect(active.depth).toBe(0);
        expect(active.stage).toBe(w.stack[0]);
    });

    it("derives a pill name from the template when none is authored", function () {
        var w = makeWidget(rootStage(
            { title: "", previewTemplate: "$:/plugins/x/preview-instance-view" }
        ));
        var resolved = w._resolvePreviewCandidates();
        expect(resolved.candidates[0].name).toBe("instance-view");
    });

    it("does NOT qualify an empty-title row with no previewTemplate", function () {
        var w = makeWidget(rootStage({ title: "", previewTemplate: "" }));
        var active = w._activePreviewContext();
        expect(active.depth).toBe(-1);
    });

    it("respects ca-view-show-side-preview: no (no candidates even with a template)", function () {
        var w = makeWidget(rootStage(
            { title: "", previewTemplate: "MyTpl" }
        ), /* viewAllows */ false);
        var resolved = w._resolvePreviewCandidates();
        expect(resolved.candidates.length).toBe(0);
    });
});
