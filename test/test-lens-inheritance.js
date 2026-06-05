/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-inheritance.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Phase B — lens-slot inheritance (view default → channel override + lock).

_loadView bakes `channel.effectiveLens[slot]` + `_lensFrom` provenance via
_applyLensInheritance; cp-lenses#_effectiveLensTitle resolves a slot's lens
channel-aware (the same tiddler in two channels can resolve to two lenses),
falling back to the active view's default lens for channel-less rows and to
the legacy global state strip when the view carries no lens config.
\*/
"use strict";

describe("cascade-palette: lens inheritance (Phase B)", function () {

    var setupViews = require("$:/plugins/rimir/cascade-palette/widgets/cp-views");
    var setupLenses = require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var VIEW_TAG = C.VIEW_TAG;
    var CHANNEL_TAG = C.CHANNEL_TAG;

    var CHA = "$:/plugins/rimir/cascade-palette/channels/a";
    var CHB = "$:/plugins/rimir/cascade-palette/channels/b";
    var VIEW = "$:/plugins/rimir/cascade-palette/views/v";

    function makeWidget(tiddlers) {
        var proto = {};
        setupViews(proto);
        setupLenses(proto);
        var w = Object.create(proto);
        w.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (f) {
            w.wiki.addTiddler(new $tw.Tiddler(f));
        });
        return w;
    }
    function channel(title, extra) {
        var f = {
            title: title, tags: [CHANNEL_TAG], type: "text/vnd.tiddlywiki",
            "ca-channel-name": title.split("/").pop(),
            "ca-channel-roots": "[!is[system]]",
            "ca-channel-children": "[tag<currentTiddler>]"
        };
        for (var k in extra) f[k] = extra[k];
        return f;
    }
    function view(extra) {
        var f = {
            title: VIEW, tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
            "ca-view-name": "V",
            "ca-view-channels": CHA + " " + CHB,
            "ca-view-include-entries": "no"
        };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    describe("_applyLensInheritance (baked effectiveLens + provenance)", function () {

        it("a channel inherits the view default when it has no own lens", function () {
            var w = makeWidget([
                channel(CHA), channel(CHB),
                view({ "ca-view-lens-icon": "$:/lens/kind" })
            ]);
            var v = w._loadView(VIEW);
            v.layers.forEach(function (ch) {
                expect(ch.effectiveLens.icon).toBe("$:/lens/kind");
                expect(ch._lensFrom.icon).toBe("view");
            });
        });

        it("a channel override wins for its own rows", function () {
            var w = makeWidget([
                channel(CHA, { "ca-channel-lens-icon": "$:/lens/own" }),
                channel(CHB),
                view({ "ca-view-lens-icon": "$:/lens/kind" })
            ]);
            var v = w._loadView(VIEW);
            expect(v.layers[0].effectiveLens.icon).toBe("$:/lens/own");
            expect(v.layers[0]._lensFrom.icon).toBe("channel");
            expect(v.layers[1].effectiveLens.icon).toBe("$:/lens/kind");
            expect(v.layers[1]._lensFrom.icon).toBe("view");
        });

        it("a locked slot forces the view lens onto every channel", function () {
            var w = makeWidget([
                channel(CHA, { "ca-channel-lens-icon": "$:/lens/own" }),
                channel(CHB),
                view({ "ca-view-lens-icon": "$:/lens/kind", "ca-view-locked": "icon" })
            ]);
            var v = w._loadView(VIEW);
            expect(v._lockedSlots.icon).toBe(true);
            v.layers.forEach(function (ch) {
                expect(ch.effectiveLens.icon).toBe("$:/lens/kind"); // override ignored
                expect(ch._lensFrom.icon).toBe("view");
            });
        });

        it("an unconfigured slot is off", function () {
            var w = makeWidget([channel(CHA), channel(CHB), view({})]);
            var v = w._loadView(VIEW);
            expect(v.layers[0].effectiveLens.name).toBe("");
            expect(v.layers[0]._lensFrom.name).toBe("off");
        });

        it("the built-in entries channel is exempt (never decorated)", function () {
            var w = makeWidget([
                channel(CHA), channel(CHB),
                view({ "ca-view-lens-icon": "$:/lens/kind",
                       "ca-view-include-entries": "yes" }),
                // ship the entries channel so the auto-append loads it
                { title: "$:/plugins/rimir/cascade-palette/channels/entries",
                  tags: [CHANNEL_TAG], type: "text/vnd.tiddlywiki",
                  "ca-channel-name": "Entries", "ca-channel-source": "entries",
                  "ca-channel-roots": "[tag[x]]", "ca-channel-children": "[tag[x]]" }
            ]);
            var v = w._loadView(VIEW);
            var entries = v.layers.filter(function (l) { return l.source === "entries"; })[0];
            expect(entries).toBeDefined();
            expect(entries.effectiveLens.icon).toBe("");
            expect(entries._lensFrom.icon).toBe("off");
        });
    });

    describe("_effectiveLensTitle (channel-aware resolution)", function () {

        function withView(v) {
            var w = makeWidget([]);
            w.views = [v];
            w.activeView = v.title;
            w._readActiveLensTitle = function (slot) { return "GLOBAL:" + slot; };
            return w;
        }

        it("resolves a row to its own channel's effective lens", function () {
            var w = makeWidget([
                channel(CHA, { "ca-channel-lens-icon": "$:/lens/own" }),
                channel(CHB),
                view({ "ca-view-lens-icon": "$:/lens/kind" })
            ]);
            var v = w._loadView(VIEW);
            w.views = [v]; w.activeView = VIEW;
            w._readActiveLensTitle = function () { return ""; };
            expect(w._effectiveLensTitle("icon", { _layerIdx: 0 })).toBe("$:/lens/own");
            expect(w._effectiveLensTitle("icon", { _layerIdx: 1 })).toBe("$:/lens/kind");
        });

        it("a channel-less row resolves to the view default lens", function () {
            var w = makeWidget([
                channel(CHA), channel(CHB),
                view({ "ca-view-lens-name": "$:/lens/caption" })
            ]);
            var v = w._loadView(VIEW);
            w.views = [v]; w.activeView = VIEW;
            w._readActiveLensTitle = function () { return ""; };
            expect(w._effectiveLensTitle("name", {})).toBe("$:/lens/caption");
        });

        it("falls back to the global state strip when nothing is configured", function () {
            var v = { title: VIEW, layers: [{ effectiveLens: { icon: "" } }],
                      lens: { icon: "" } };
            var w = withView(v);
            expect(w._effectiveLensTitle("icon", { _layerIdx: 0 })).toBe("GLOBAL:icon");
        });
    });
});
