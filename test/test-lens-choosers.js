/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-choosers.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase C — the relocated lens choosers in the VIEW → CHANNEL tree.

The three per-slot lens strips no longer stand alone (they were removed in
0.0.118); instead each view/channel row carries lens-slot pills.
_lensChooserPills builds them (view
default vs channel override, with inherit/lock cues) and _pillEditDescriptor
maps them to ca-view-lens-* / ca-channel-lens-* enum edits.
\*/
"use strict";

describe("cascade-palette: lens choosers in the view→channel tree (Phase C)", function () {

    var setupViews = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");
    var setupLenses = require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses");
    var setupEditor = require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var VIEW_TAG = C.VIEW_TAG;
    var CHANNEL_TAG = C.CHANNEL_TAG;
    var LENS_TAG = C.LENS_TAG;

    var KIND = "$:/lens/kind";
    var OWN = "$:/lens/own";
    var CHA = "$:/plugins/rimir/cascade-palette/channels/a";
    var CHB = "$:/plugins/rimir/cascade-palette/channels/b";
    var VIEW = "$:/plugins/rimir/cascade-palette/views/v";

    function makeWidget(extraView) {
        var proto = {};
        setupViews(proto);
        setupLenses(proto);
        setupEditor(proto);
        var w = Object.create(proto);
        w._parseNumOrDefault = function (raw, fb) {
            var n = parseFloat(raw); return isNaN(n) ? fb : n;
        };
        w.wiki = new $tw.Wiki();
        [
            { title: KIND, tags: [LENS_TAG], "ca-lens-name": "Kind",
              "ca-lens-chip": "Kind", "ca-lens-icon-filter": "[[icon]]" },
            { title: OWN, tags: [LENS_TAG], "ca-lens-name": "Own",
              "ca-lens-chip": "Own", "ca-lens-icon-filter": "[[icon2]]" },
            { title: CHA, tags: [CHANNEL_TAG], type: "text/vnd.tiddlywiki",
              "ca-channel-name": "A", "ca-channel-roots": "[!is[system]]",
              "ca-channel-children": "[tag<currentTiddler>]" },
            { title: CHB, tags: [CHANNEL_TAG], type: "text/vnd.tiddlywiki",
              "ca-channel-name": "B", "ca-channel-roots": "[!is[system]]",
              "ca-channel-children": "[tag<currentTiddler>]" },
            $tw.utils.extend({
                title: VIEW, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
                "ca-view-name": "V", "ca-view-channels": CHA + " " + CHB,
                "ca-view-include-entries": "no"
            }, extraView || {})
        ].forEach(function (f) { w.wiki.addTiddler(new $tw.Tiddler(f)); });
        w.views = [w._loadView(VIEW)];
        w.activeView = VIEW;
        return w;
    }

    function bySlot(pills, slot) {
        return pills.filter(function (p) { return p._slot === slot; })[0];
    }

    it("builds VIEW-default chooser pills showing the view lens chip + lock", function () {
        var w = makeWidget({ "ca-view-lens-icon": KIND, "ca-view-locked": "name" });
        var view = w.views[0];
        var pills = w._lensChooserPills(view, null);
        expect(pills.length).toBe(3);
        expect(bySlot(pills, "icon").value).toContain("Kind");
        expect(bySlot(pills, "icon")._scope).toBe("view");
        // name slot is locked → 🔒 marker + _locked flag.
        expect(bySlot(pills, "name")._locked).toBe(true);
        expect(bySlot(pills, "name").value).toContain("🔒");
    });

    it("builds CHANNEL pills: inherit cue when from view, chip when own", function () {
        var w = makeWidget({ "ca-view-lens-icon": KIND });
        // give channel A its own icon override
        w.wiki.addTiddler(new $tw.Tiddler(
            w.wiki.getTiddler(CHA).fields, { "ca-channel-lens-icon": OWN }));
        var view = w._loadView(VIEW);
        w.views = [view];
        var pillsA = w._lensChooserPills(view, view.layers[0]); // A (own)
        var pillsB = w._lensChooserPills(view, view.layers[1]); // B (inherit)
        expect(bySlot(pillsA, "icon").value).toContain("Own");
        expect(bySlot(pillsA, "icon").value).not.toContain("inherit");
        expect(bySlot(pillsB, "icon").value).toContain("Kind");
        expect(bySlot(pillsB, "icon").value).toContain("inherit view");
    });

    it("_pillEditDescriptor maps a VIEW lens pill to a ca-view-lens-* enum", function () {
        var w = makeWidget({ "ca-view-lens-icon": KIND });
        var ed = w._pillEditDescriptor(
            { kind: "lens-slot", _slot: "icon", _scope: "view" }, null);
        expect(ed.bindField).toBe("ca-view-lens-icon");
        expect(ed.bindTiddler).toBe(VIEW);
        expect(ed.editKind).toBe("enum");
        expect(ed.enumValues).toContain("");      // off / inherit
        expect(ed.enumValues).toContain(KIND);     // a projecting lens
    });

    it("_pillEditDescriptor maps a CHANNEL lens pill to a ca-channel-lens-* enum", function () {
        var w = makeWidget({ "ca-view-lens-icon": KIND });
        var layer = w.views[0].layers[0];
        var ed = w._pillEditDescriptor(
            { kind: "lens-slot", _slot: "icon", _scope: "channel" }, layer);
        expect(ed.bindField).toBe("ca-channel-lens-icon");
        expect(ed.bindTiddler).toBe(layer.title);
        expect(ed.scope).toBe("layer");
    });

    it("_pillEditDescriptor refuses a LOCKED channel lens pill", function () {
        var w = makeWidget({ "ca-view-lens-icon": KIND, "ca-view-locked": "icon" });
        var layer = w.views[0].layers[0];
        var ed = w._pillEditDescriptor(
            { kind: "lens-slot", _slot: "icon", _scope: "channel", _locked: true }, layer);
        expect(ed).toBeNull();
    });
});
