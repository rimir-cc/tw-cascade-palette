/*\
title: $:/plugins/rimir/cascade-palette/test/test-lenses.js
type: application/javascript
tags: [[$:/tags/test-spec]]

H4 slice 2 — the lens data model (cp-lenses.js).

A lens is a tiddler tagged LENS_TAG that projects row-decoration slots
(name / icon / annotation) via `ca-lens-<slot>-filter` (cheap) or
`-template` (rich, deferred). Per-slot single-select: the active lens per
slot persists under LENS_STATE_PREFIX + <slot>; `ca-lens-default` (slot
list) seeds a slot on first load. `ca-lens-when` (global existence test)
gates applicability. Projecting-lens sets are cached per change-count.

`_filterInScope` is stubbed with a deterministic registry so these specs
exercise lens logic only — TW filter semantics are covered elsewhere.
\*/
"use strict";

describe("cascade-palette: lens data model (H4 slice 2)", function () {

    var setup = require("$:/plugins/rimir/cascade-palette/widgets/cp-lenses");
    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
    var LENS_TAG = C.LENS_TAG;
    var STATE = C.LENS_STATE_PREFIX;

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
        // Deterministic filter registry. Key = filter string; value =
        // function(currentTiddler) -> result array. Records each call.
        w._filterResults = opts.filters || {};
        w._filterCalls = [];
        w._filterInScope = function (filter, vars) {
            w._filterCalls.push({ filter: filter, ct: vars && vars.currentTiddler });
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

    var TITLE_LENS = lensFields({
        title: "$:/lens/title",
        "ca-lens-name": "Title",
        "ca-lens-name-filter": "F_TITLE",
        "ca-order": "100"
    });
    var CAPTION_LENS = lensFields({
        title: "$:/lens/caption-then-title",
        "ca-lens-name": "Caption → Title",
        "ca-lens-name-filter": "F_CAPTION",
        "ca-lens-default": "name",
        "ca-order": "50"
    });
    var KIND_LENS = lensFields({
        title: "$:/lens/kind",
        "ca-lens-name": "Kind",
        "ca-lens-when": "F_KIND_WHEN",
        "ca-lens-icon-filter": "F_KIND_ICON",
        "ca-order": "50"
    });

    describe("_loadLenses", function () {

        it("parses slots, defaults, when and order; sorts by order then name", function () {
            var w = makeWidget([TITLE_LENS, CAPTION_LENS, KIND_LENS]);
            var lenses = w._loadLenses();
            expect(lenses.map(function (l) { return l.title; })).toEqual([
                "$:/lens/caption-then-title", // order 50, name "Caption → Title"
                "$:/lens/kind",               // order 50, name "Kind"
                "$:/lens/title"               // order 100
            ]);
            var title = lenses[2];
            expect(title.slots.name).toEqual({ filter: "F_TITLE", template: "" });
            expect(title.slots.icon).toBeUndefined();
            var caption = lenses[0];
            expect(caption.defaultSlots).toEqual(["name"]);
            var kind = lenses[1];
            expect(kind.slots.icon).toEqual({ filter: "F_KIND_ICON", template: "" });
            expect(kind.when).toBe("F_KIND_WHEN");
        });

        it("records a template-only slot as projecting (filter empty)", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/vac",
                "ca-lens-name": "Vacation",
                "ca-lens-annotation-template": "<<x>>"
            })]);
            var lens = w._loadLenses()[0];
            expect(lens.slots.annotation).toEqual({ filter: "", template: "<<x>>" });
        });
    });

    describe("_projectingLenses + applicability", function () {

        it("returns only lenses that project the slot and currently apply", function () {
            var w = makeWidget([TITLE_LENS, CAPTION_LENS, KIND_LENS], {
                filters: { F_KIND_WHEN: function () { return ["yes"]; } }
            });
            var names = w._projectingLenses("name").map(function (l) { return l.title; });
            expect(names).toEqual(["$:/lens/caption-then-title", "$:/lens/title"]);
            var icons = w._projectingLenses("icon").map(function (l) { return l.title; });
            expect(icons).toEqual(["$:/lens/kind"]);
        });

        it("hides a lens whose ca-lens-when yields nothing", function () {
            var w = makeWidget([KIND_LENS], {
                filters: { F_KIND_WHEN: function () { return []; } }
            });
            expect(w._projectingLenses("icon")).toEqual([]);
        });

        it("caches the projecting set per change-count (when-filter not re-run)", function () {
            var w = makeWidget([KIND_LENS], {
                filters: { F_KIND_WHEN: function () { return ["yes"]; } }
            });
            w._projectingLenses("icon");
            w._projectingLenses("icon");
            var whenCalls = w._filterCalls.filter(function (c) {
                return c.filter === "F_KIND_WHEN";
            }).length;
            expect(whenCalls).toBe(1);
            // A tiddler write bumps the change-count → re-evaluate.
            w.wiki.addTiddler(new $tw.Tiddler({ title: "bump" }));
            w._invalidateLenses();
            w._projectingLenses("icon");
            whenCalls = w._filterCalls.filter(function (c) {
                return c.filter === "F_KIND_WHEN";
            }).length;
            expect(whenCalls).toBe(2);
        });
    });

    describe("active lens per slot", function () {

        it("seeds the slot default when no state is stored", function () {
            var w = makeWidget([TITLE_LENS, CAPTION_LENS]);
            expect(w._readActiveLensTitle("name")).toBe("$:/lens/caption-then-title");
        });

        it("returns the stored pick over the default", function () {
            var w = makeWidget([TITLE_LENS, CAPTION_LENS]);
            w.wiki.addTiddler(new $tw.Tiddler({ title: STATE + "name", text: "$:/lens/title" }));
            expect(w._readActiveLensTitle("name")).toBe("$:/lens/title");
            expect(w._activeLensForSlot("name").title).toBe("$:/lens/title");
        });

        it("treats a stale stored title (no longer projecting) as off", function () {
            var w = makeWidget([TITLE_LENS]);
            w.wiki.addTiddler(new $tw.Tiddler({ title: STATE + "name", text: "$:/lens/gone" }));
            expect(w._activeLensForSlot("name")).toBe(null);
        });

        it("an icon slot with no default stays off (null)", function () {
            var w = makeWidget([KIND_LENS], {
                filters: { F_KIND_WHEN: function () { return ["yes"]; } }
            });
            expect(w._readActiveLensTitle("icon")).toBe("");
            expect(w._activeLensForSlot("icon")).toBe(null);
        });
    });

    describe("_resolveSlot", function () {

        it("runs the active lens's slot filter with <currentTiddler> = row title", function () {
            var w = makeWidget([CAPTION_LENS], {
                filters: { F_CAPTION: function (ct) { return ["cap-of-" + ct]; } }
            });
            var out = w._resolveSlot("name", { dataRow: true, title: "Anna" });
            expect(out).toBe("cap-of-Anna");
        });

        it("returns null for non-data rows without evaluating", function () {
            var w = makeWidget([CAPTION_LENS], {
                filters: { F_CAPTION: function () { return ["x"]; } }
            });
            expect(w._resolveSlot("name", { title: "Anna" })).toBe(null);
            expect(w._filterCalls.length).toBe(0);
        });

        it("returns null when the active lens's filter yields empty", function () {
            var w = makeWidget([CAPTION_LENS], {
                filters: { F_CAPTION: function () { return []; } }
            });
            expect(w._resolveSlot("name", { dataRow: true, title: "Anna" })).toBe(null);
        });

        it("returns null for a template-only slot (no filter; deferred to slice 4)", function () {
            var w = makeWidget([lensFields({
                title: "$:/lens/vac",
                "ca-lens-name": "Vacation",
                "ca-lens-annotation-template": "<<x>>",
                "ca-lens-default": "annotation"
            })]);
            expect(w._resolveSlot("annotation", { dataRow: true, title: "Anna" })).toBe(null);
        });
    });

    describe("_setSlotLens", function () {

        it("persists a matching pick and clears on an unmatched title", function () {
            var w = makeWidget([TITLE_LENS, CAPTION_LENS]);
            w.topStage = function () { return null; };
            w._setSlotLens("name", "$:/lens/title");
            expect(w.wiki.getTiddlerText(STATE + "name", "")).toBe("$:/lens/title");
            // A title that doesn't project this slot clears (off).
            w._setSlotLens("name", "$:/lens/nope");
            expect(w.wiki.getTiddlerText(STATE + "name", "")).toBe("");
        });
    });
});
