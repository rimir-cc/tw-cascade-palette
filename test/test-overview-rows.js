/*\
title: $:/plugins/rimir/cascade-palette/test/test-overview-rows.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Channel/View "Overview" rows. A channel (`ca-channel-preview`) or view
(`ca-view-preview`) that names a summary template makes the root stage emit a
synthetic Overview row: a non-drill no-op leaf, excluded from deep search,
pinned to the top of its group, carrying the preview template so focusing it
renders the summary in the side preview. Overview rows appear ONLY at the root
stage, never in drilled sub-stages.
\*/
"use strict";

describe("cascade-palette: Overview rows", function () {

    var setupViews = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");
    var setupItems = require("$:/plugins/rimir/cascade-palette/widgets/cp-items");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LAYER_TAG = C.STRUCTURE_LAYER_TAG;
    var VIEW_TAG = C.VIEW_TAG;

    function makeWidget(tiddlers) {
        var proto = {};
        setupViews(proto);
        setupItems(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        return w;
    }

    describe("field parsing", function () {

        it("_loadLayer reads ca-channel-preview / -name / -title", function () {
            var w = makeWidget([{
                title: "$:/c/withpreview",
                tags: [LAYER_TAG],
                "ca-channel-name": "Agenda",
                "ca-channel-roots": "[tag[x]]",
                "ca-channel-preview": "Agenda",
                "ca-channel-preview-name": "⏰ overview",
                "ca-channel-preview-title": "Upcoming"
            }]);
            var layer = w._loadLayer("$:/c/withpreview");
            expect(layer.preview).toBe("Agenda");
            expect(layer.previewName).toBe("⏰ overview");
            expect(layer.previewTitle).toBe("Upcoming");
        });

        it("_loadLayer defaults preview empty + name 'Overview'", function () {
            var w = makeWidget([{
                title: "$:/c/plain", tags: [LAYER_TAG],
                "ca-channel-name": "Plain", "ca-channel-roots": "[tag[x]]"
            }]);
            var layer = w._loadLayer("$:/c/plain");
            expect(layer.preview).toBe("");
            expect(layer.previewName).toBe("Overview");
        });

        it("_loadView reads ca-view-preview / -name / -title", function () {
            var w = makeWidget([{
                title: "$:/v/withpreview", tags: [VIEW_TAG],
                "ca-view-name": "V", "ca-view-preview": "Summary",
                "ca-view-preview-name": "Recap", "ca-view-preview-title": "At a glance"
            }]);
            var view = w._loadView("$:/v/withpreview");
            expect(view.preview).toBe("Summary");
            expect(view.previewName).toBe("Recap");
            expect(view.previewTitle).toBe("At a glance");
        });

        it("_loadView defaults preview empty + name 'Overview'", function () {
            var w = makeWidget([{
                title: "$:/v/plain", tags: [VIEW_TAG], "ca-view-name": "V"
            }]);
            var view = w._loadView("$:/v/plain");
            expect(view.preview).toBe("");
            expect(view.previewName).toBe("Overview");
        });
    });

    describe("_buildOverviewRows", function () {

        var w = makeWidget([]);

        it("emits one row per channel that declares a preview, grouped by channel name", function () {
            var view = {
                name: "V", preview: "",
                layers: [
                    { name: "Agenda", preview: "Agenda", previewName: "⏰ Agenda", previewTitle: "Soon" },
                    { name: "Other",  preview: "" }
                ]
            };
            var rows = w._buildOverviewRows(view);
            expect(rows.length).toBe(1);
            var r = rows[0];
            expect(r.previewTemplate).toBe("Agenda");
            expect(r.name).toBe("⏰ Agenda");
            expect(r.previewTitle).toBe("Soon");
            expect(r.group).toBe("Agenda");
            expect(r.kind).toBe("leaf");
            expect(r.afterFire).toBe("keep");
            expect(r.searchSkip).toBe(true);
            expect(r._pinTop).toBe(true);
            expect(r._overviewRow).toBe(true);
            expect(r.isSynthetic).toBe(true);
            expect(r._layerIdx).toBe(0);
        });

        it("emits a view-level row grouped under the view name with no _layerIdx", function () {
            var view = {
                name: "Agenda View", preview: "Summary",
                previewName: "Overview", previewTitle: "",
                layers: []
            };
            var rows = w._buildOverviewRows(view);
            expect(rows.length).toBe(1);
            expect(rows[0].previewTemplate).toBe("Summary");
            expect(rows[0].group).toBe("Agenda View");
            expect(rows[0]._layerIdx).toBeUndefined();
        });

        it("emits nothing when no preview is declared", function () {
            var view = { name: "V", preview: "", layers: [{ name: "C", preview: "" }] };
            expect(w._buildOverviewRows(view).length).toBe(0);
        });
    });

    describe("root-stage gating", function () {

        function gateWidget() {
            var w = makeWidget([]);
            w._buildNodeForView = function () { return []; }; // isolate the gate
            return w;
        }
        var view = { name: "V", preview: "Summary", previewName: "Overview",
                     previewTitle: "", layers: [] };

        it("prepends Overview rows at the root stage", function () {
            var rows = gateWidget()._buildRowsForView(view, { kind: "root" });
            expect(rows.length).toBe(1);
            expect(rows[0]._overviewRow).toBe(true);
        });

        it("emits NO Overview rows in a tree (drilled) sub-stage", function () {
            var rows = gateWidget()._buildRowsForView(view, { kind: "tree", parentPath: ["x"] });
            expect(rows.length).toBe(0);
        });
    });

    describe("_sortRowsForView pin pass", function () {

        it("floats _pinTop rows ahead of the rest, stable within each group", function () {
            var w = makeWidget([]);
            var rows = [
                { name: "Bravo" },
                { name: "Alpha", _pinTop: true },
                { name: "Charlie" }
            ];
            var sorted = w._sortRowsForView(rows, { sort: "alphabetical" });
            expect(sorted[0].name).toBe("Alpha");      // pinned first
            expect(sorted[1].name).toBe("Bravo");      // remaining alpha-sorted
            expect(sorted[2].name).toBe("Charlie");
        });
    });
});
