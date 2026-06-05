/*\
title: $:/plugins/rimir/cascade-palette/test/test-view-fork.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the DEEP view fork (Phase 2 tail): `_forkView` makes a fully
independent persisted copy of a view — its ca-view-* fields PLUS a private
copy of every explicit structure-layer and grouping axis it references, with
all titles rewritten so nothing the fork references is shared with the source.

The fork helpers are pure store mutations (no DOM), so they unit-test
directly. We build a stub widget over a fresh $tw.Wiki(), apply the real
cp-view-editor + cp-axis-editor methods (the fork reuses cp-axis-editor's
_copyAxisFields), and no-op the render/view-lookup collaborators.
\*/
"use strict";

describe("cascade-palette: cp-view-editor deep fork", function () {

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var VIEW_TAG = C.VIEW_TAG;
    var LAYER_TAG = C.STRUCTURE_LAYER_TAG; // legacy source channels (dual-read)
    var CHANNEL_TAG = C.CHANNEL_TAG;
    var AXIS_TAG = C.AXIS_TAG;
    var VIEWS_NS = C.VIEWS_NS;
    var LAYERS_NS = C.LAYERS_NS;     // legacy source-channel namespace
    var CHANNELS_NS = C.CHANNELS_NS; // forked channels land here
    var AXES_NS = C.AXES_NS;
    var BUILTIN_ENTRIES =
        "$:/plugins/rimir/cascade-palette/channels/entries";

    function makeWidget(tiddlers) {
        var proto = {};
        require("$:/plugins/rimir/cascade-palette/widgets/cp-view-editor")(proto);
        require("$:/plugins/rimir/cascade-palette/widgets/cp-axis-editor")(proto);
        var self = Object.create(proto);
        self.wiki = new $tw.Wiki();
        (tiddlers || []).forEach(function (fields) {
            self.wiki.addTiddler(new $tw.Tiddler(fields));
        });
        self.views = [];
        self.activeView = null;
        self._getViewByTitle = function (title) {
            if (!title) return null;
            var t = this.wiki.getTiddler(title);
            if (!t) return null;
            var tags = (t.fields && t.fields.tags) || [];
            return tags.indexOf(VIEW_TAG) >= 0
                ? { title: title, name: t.fields["ca-view-name"] } : null;
        };
        self._loadViews = function () {
            var w = this;
            this.views = this.wiki.filterTiddlers(
                "[all[tiddlers]tag[" + VIEW_TAG + "]]"
            ).map(function (title) {
                var f = (w.wiki.getTiddler(title).fields) || {};
                return { title: title, name: f["ca-view-name"] || title };
            });
        };
        self._setActiveView = function (title) { this.activeView = title; };
        self._renderViewConfigStrip = function () {};
        self._renderViewStrip = function () {};
        self._renderHint = function () {};
        self.setFocus = function () {};
        return self;
    }

    // ---- implicit view (structure on the view tiddler) --------------------

    it("forks an implicit view's ca-view-* fields under VIEWS_NS, named (copy), never default", function () {
        var w = makeWidget([{
            title: VIEWS_NS + "mine", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
            "ca-view-name": "Mine", "ca-view-roots": "[tag[x]]",
            "ca-view-sort": "alphabetical", "ca-view-default": "yes", "ca-icon": "★"
        }]);
        var t = w._forkView(VIEWS_NS + "mine");
        expect(t.indexOf(VIEWS_NS)).toBe(0);
        var f = w.wiki.getTiddler(t).fields;
        expect(f["ca-view-name"]).toBe("Mine (copy)");
        expect(f["ca-view-roots"]).toBe("[tag[x]]");
        expect(f["ca-view-sort"]).toBe("alphabetical");
        expect(f["ca-icon"]).toBe("★");
        expect(f["ca-view-default"]).toBeUndefined();      // a fork is never default
        expect((f.tags || []).indexOf(VIEW_TAG)).toBeGreaterThan(-1);
        expect(f.type).toBe("text/vnd.tiddlywiki");
    });

    it("returns null for an unknown source", function () {
        var w = makeWidget([]);
        expect(w._forkView("$:/nope")).toBeNull();
    });

    // ---- explicit-layer view: layers + axes deep-copied -------------------

    it("deep-copies referenced explicit channels into private CHANNELS_NS copies, rewriting ca-view-channels", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-layers": LAYERS_NS + "a " + LAYERS_NS + "b" },
            { title: LAYERS_NS + "a", tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
              "ca-layer-name": "Alpha", "ca-layer-roots": "[tag[A]]" },
            { title: LAYERS_NS + "b", tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
              "ca-layer-name": "Beta", "ca-layer-roots": "[tag[B]]" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        var refs = w.wiki.getTiddler(t).fields["ca-view-channels"].split(" ");
        expect(refs.length).toBe(2);
        // New channel titles, distinct from the originals, under CHANNELS_NS.
        refs.forEach(function (r) {
            expect(r.indexOf(CHANNELS_NS)).toBe(0);
            expect(r).not.toBe(LAYERS_NS + "a");
            expect(r).not.toBe(LAYERS_NS + "b");
        });
        // Field contents carried over (normalized to ca-channel-*); names suffixed.
        var fa = w.wiki.getTiddler(refs[0]).fields;
        expect(fa["ca-channel-roots"]).toBe("[tag[A]]");
        expect(fa["ca-channel-name"]).toBe("Alpha (copy)");
        expect((fa.tags || []).indexOf(CHANNEL_TAG)).toBeGreaterThan(-1);
    });

    it("deep-copies a channel's axis chain (ca-channel-axes) into private AXES_NS copies", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-layers": LAYERS_NS + "tree" },
            { title: LAYERS_NS + "tree", tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
              "ca-layer-name": "Tree", "ca-layer-roots": "[!is[system]]",
              "ca-layer-axes": AXES_NS + "year" },
            { title: AXES_NS + "year", tags: [AXIS_TAG], type: "text/vnd.tiddlywiki",
              "ca-axis-name": "Year", "ca-axis-key": "[get[created]format:date[YYYY]]",
              "ca-axis-sort": "desc" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        var layerRef = w.wiki.getTiddler(t).fields["ca-view-channels"];
        var axisRef = w.wiki.getTiddler(layerRef).fields["ca-channel-axes"];
        expect(axisRef.indexOf(AXES_NS)).toBe(0);
        expect(axisRef).not.toBe(AXES_NS + "year");
        var af = w.wiki.getTiddler(axisRef).fields;
        expect(af["ca-axis-key"]).toBe("[get[created]format:date[YYYY]]");
        expect(af["ca-axis-sort"]).toBe("desc");
        expect(af["ca-axis-name"]).toBe("Year (copy)");
        expect((af.tags || []).indexOf(AXIS_TAG)).toBeGreaterThan(-1);
    });

    it("deep-copies a view-level axis chain (ca-view-axes on an implicit view)", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-roots": "[!is[system]]",
              "ca-view-axes": AXES_NS + "y " + AXES_NS + "m" },
            { title: AXES_NS + "y", tags: [AXIS_TAG], type: "text/vnd.tiddlywiki",
              "ca-axis-name": "Y", "ca-axis-key": "[get[created]format:date[YYYY]]" },
            { title: AXES_NS + "m", tags: [AXIS_TAG], type: "text/vnd.tiddlywiki",
              "ca-axis-name": "M", "ca-axis-key": "[get[created]format:date[MM]]" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        var chain = w.wiki.getTiddler(t).fields["ca-view-axes"].split(" ");
        expect(chain.length).toBe(2);
        chain.forEach(function (r) {
            expect(r.indexOf(AXES_NS)).toBe(0);
            expect(r).not.toBe(AXES_NS + "y");
            expect(r).not.toBe(AXES_NS + "m");
        });
    });

    it("preserves per-axis params when the chain is a JSON [{title,params}] spec", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-roots": "[!is[system]]",
              "ca-view-axes": JSON.stringify([{ title: AXES_NS + "field", params: { "axis-param-1": "color" } }]) },
            { title: AXES_NS + "field", tags: [AXIS_TAG], type: "text/vnd.tiddlywiki",
              "ca-axis-name": "By field", "ca-axis-key": "[get<axis-param-1>]" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        var raw = w.wiki.getTiddler(t).fields["ca-view-axes"];
        var parsed = JSON.parse(raw); // params present → re-serialised as JSON
        expect(parsed.length).toBe(1);
        expect(parsed[0].params).toEqual({ "axis-param-1": "color" });
        expect(parsed[0].title.indexOf(AXES_NS)).toBe(0);
        expect(parsed[0].title).not.toBe(AXES_NS + "field");
    });

    it("references the built-in entries channel verbatim — never copies it", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-layers": BUILTIN_ENTRIES + " " + LAYERS_NS + "real" },
            { title: LAYERS_NS + "real", tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
              "ca-layer-name": "Real", "ca-layer-roots": "[tag[R]]" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        var refs = w.wiki.getTiddler(t).fields["ca-view-channels"].split(" ");
        expect(refs[0]).toBe(BUILTIN_ENTRIES);          // kept verbatim
        expect(refs[1]).not.toBe(LAYERS_NS + "real");    // real channel copied
    });

    it("keeps an unresolvable channel reference verbatim", function () {
        var w = makeWidget([
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-layers": LAYERS_NS + "ghost" }
        ]);
        var t = w._forkView(VIEWS_NS + "v");
        expect(w.wiki.getTiddler(t).fields["ca-view-channels"]).toBe(LAYERS_NS + "ghost");
    });

    // ---- isolation + collision --------------------------------------------

    it("leaves the source view, layers and axes byte-identical (isolation)", function () {
        var seed = [
            { title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
              "ca-view-name": "V", "ca-view-layers": LAYERS_NS + "L" },
            { title: LAYERS_NS + "L", tags: [LAYER_TAG], type: "text/vnd.tiddlywiki",
              "ca-layer-name": "L", "ca-layer-roots": "[tag[X]]", "ca-layer-axes": AXES_NS + "A" },
            { title: AXES_NS + "A", tags: [AXIS_TAG], type: "text/vnd.tiddlywiki",
              "ca-axis-name": "A", "ca-axis-key": "[get[k]]" }
        ];
        var w = makeWidget(seed);
        var before = {};
        [VIEWS_NS + "v", LAYERS_NS + "L", AXES_NS + "A"].forEach(function (ti) {
            before[ti] = JSON.stringify(w.wiki.getTiddler(ti).fields);
        });
        w._forkView(VIEWS_NS + "v");
        Object.keys(before).forEach(function (ti) {
            expect(JSON.stringify(w.wiki.getTiddler(ti).fields)).toBe(before[ti]);
        });
    });

    it("produces distinct collision-safe titles on repeated forks", function () {
        var w = makeWidget([{
            title: VIEWS_NS + "v", tags: [VIEW_TAG], type: "text/vnd.tiddlywiki",
            "ca-view-name": "V", "ca-view-roots": "[tag[x]]"
        }]);
        var t1 = w._forkView(VIEWS_NS + "v");
        var t2 = w._forkView(VIEWS_NS + "v");
        expect(t1).not.toBe(t2);
        expect(w.wiki.tiddlerExists(t1)).toBe(true);
        expect(w.wiki.tiddlerExists(t2)).toBe(true);
    });
});
