/*\
title: $:/plugins/rimir/cascade-palette/test/test-lens-templates.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 slice 4 — template projections (the resolution half).

A lens slot can project via `ca-lens-<slot>-template` (rich wikitext)
instead of `ca-lens-<slot>-filter` (cheap string). cp-lenses#
_activeSlotTemplate returns the active lens's template wikitext for a slot,
or null. Filter takes precedence (the cheap path wins) so a slot never
renders both. The per-row DOM render lives in cp-rendering and is exercised
in the browser (it needs a live makeWidget environment); these specs cover
the data-model decision of WHICH template (if any) applies.
\*/
"use strict";

describe("cascade-palette: lens template projections (H4 slice 4)", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;

    function makeWidget(tiddlers, opts) {
        opts = opts || {};
        var proto = {};
        setup(proto);
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
        w._filterInScope = function (filter, vars) {
            var fn = w._filterResults[filter];
            return fn ? (fn((vars || {}).currentTiddler) || []) : [];
        };
        return w;
    }
    function lensFields(extra) {
        var f = { tags: [LENS_TAG] };
        for (var k in extra) f[k] = extra[k];
        return f;
    }

    var TPL_ANNO = lensFields({
        title: "$:/lens/tags", "ca-lens-name": "Tags",
        "ca-lens-annotation-template": "<$list filter='[<currentTiddler>tags[]]'/>",
        "ca-lens-default": "annotation"
    });

    it("returns the active lens's template for a data row", function () {
        var w = makeWidget([TPL_ANNO]);
        // Seeded default makes Tags active for the annotation slot.
        expect(w._activeSlotTemplate("annotation", { dataRow: true, title: "Anna" }))
            .toBe("<$list filter='[<currentTiddler>tags[]]'/>");
    });

    it("returns null for a non-data row (no projection attempted)", function () {
        var w = makeWidget([TPL_ANNO]);
        expect(w._activeSlotTemplate("annotation", { title: "Anna" })).toBe(null);
    });

    it("returns null when no lens is active for the slot", function () {
        // A template lens with NO ca-lens-default and no stored pick → the
        // annotation slot stays off (a default-seeded lens would instead
        // revert to its default when the head "(off)" pill is chosen).
        var w = makeWidget([lensFields({
            title: "$:/lens/tags", "ca-lens-name": "Tags",
            "ca-lens-annotation-template": "<<x>>"
        })]);
        expect(w._readActiveLensTitle("annotation")).toBe("");
        expect(w._activeSlotTemplate("annotation", { dataRow: true, title: "Anna" })).toBe(null);
    });

    it("returns null for a filter-based projection (string path, not template)", function () {
        var w = makeWidget([lensFields({
            title: "$:/lens/caption", "ca-lens-name": "Caption",
            "ca-lens-name-filter": "F_CAP", "ca-lens-default": "name"
        })]);
        expect(w._activeSlotTemplate("name", { dataRow: true, title: "Anna" })).toBe(null);
    });

    it("filter takes precedence — a slot with BOTH filter and template yields no template", function () {
        var w = makeWidget([lensFields({
            title: "$:/lens/both", "ca-lens-name": "Both",
            "ca-lens-annotation-filter": "F_ANN",
            "ca-lens-annotation-template": "<<x>>",
            "ca-lens-default": "annotation"
        })], { filters: { F_ANN: function () { return ["str"]; } } });
        var row = { dataRow: true, title: "Anna" };
        // _resolveSlot uses the filter; _activeSlotTemplate stays null so the
        // slot never renders both.
        expect(w._resolveSlot("annotation", row)).toBe("str");
        expect(w._activeSlotTemplate("annotation", row)).toBe(null);
    });
});
