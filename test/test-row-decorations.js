/*\
title: $:/plugins/rimir/cascade-palette/test/test-row-decorations.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 — the merged row-decoration orchestrator + cross-render cache.

_resolveRowDecorations(item) returns one {name, icon, annotation} object,
delegating to cp-lenses#_resolveSlot per slot but caching by title under a
(selection signature, wiki.getChangeCount()) generation. The signature is
the active per-slot lens picks (cp-lenses#_activeLensForSlot). The cache
must PERSIST across calls with the same signature + change-count (so typing
doesn't re-run projections) and rebuild when either changes.
\*/
"use strict";

describe("cascade-palette: row decorations (H4)", function () {

    function makeWidget(opts) {
        opts = opts || {};
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-row-decorations")(proto);
        var w = Object.create(proto);
        w._cc = opts.cc || 1;
        // active lens title per slot ("" = slot off)
        w._active = opts.active || { name: "$:/lens/caption", icon: "$:/lens/kind", annotation: "" };
        w.calls = { name: 0, icon: 0, annotation: 0 };
        w.wiki = { getChangeCount: function () { return w._cc; } };
        w._activeLensForSlot = function (slot) {
            var t = w._active[slot];
            return t ? { title: t } : null;
        };
        w._resolveSlot = function (slot, item) {
            w.calls[slot]++;
            if (!w._active[slot]) return null;
            return slot.toUpperCase() + ":" + item.title;
        };
        return w;
    }

    var ROW = { dataRow: true, title: "Anna" };

    it("returns one merged {name, icon, annotation} object", function () {
        var w = makeWidget();
        expect(w._resolveRowDecorations(ROW)).toEqual({
            name: "NAME:Anna", icon: "ICON:Anna", annotation: null
        });
    });

    it("returns empty (and evaluates nothing) for non-data rows", function () {
        var w = makeWidget();
        var d = w._resolveRowDecorations({ title: "x" }); // no dataRow
        expect(d).toEqual({ name: null, icon: null, annotation: null });
        expect(w.calls.name).toBe(0);
        expect(w.calls.icon).toBe(0);
    });

    it("caches across calls with the same signature + change-count", function () {
        var w = makeWidget();
        w._resolveRowDecorations(ROW);
        w._resolveRowDecorations(ROW);
        w._resolveRowDecorations(ROW);
        expect(w.calls.name).toBe(1); // evaluated once, then served from cache
        expect(w.calls.icon).toBe(1);
    });

    it("rebuilds when the wiki change-count advances", function () {
        var w = makeWidget();
        w._resolveRowDecorations(ROW);
        w._cc++; // a tiddler was written
        w._resolveRowDecorations(ROW);
        expect(w.calls.name).toBe(2);
    });

    it("rebuilds when the active selection signature changes", function () {
        var w = makeWidget();
        w._resolveRowDecorations(ROW);
        w._active.name = "$:/lens/title"; // user picked a different name lens
        w._resolveRowDecorations(ROW);
        expect(w.calls.name).toBe(2);
    });

    it("does not rebuild merely because rows differ (same generation)", function () {
        var w = makeWidget();
        w._resolveRowDecorations({ dataRow: true, title: "Anna" });
        w._resolveRowDecorations({ dataRow: true, title: "Bob" });
        w._resolveRowDecorations({ dataRow: true, title: "Anna" }); // cached
        expect(w.calls.name).toBe(2); // Anna once + Bob once; Anna#2 cached
    });
});
