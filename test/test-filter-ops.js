/*\
title: $:/plugins/rimir/cascade-palette/test/test-filter-ops.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the three new cascade-palette filter operators (Phase C):

  cp-actions-for[<entity-type>]      — catalogue + globals match on ca-entity-type
  cp-actions-applying-to[<title>]    — actions whose ca-applies filter hits <title>
  cp-position-of[<view-slug>]        — view-aware fallback chain over ca-position

The operators mirror branches of cp-stack.js:loadActionsForType (catalogue +
globals) / actionAppliesViaFilter, and cp-views.js:resolveEntryPositions.
These specs lock in the operator semantics against future refactors AND
serve as the parity assertions for the C.R.5 catalogue-path switch.
\*/
"use strict";

describe("cascade-palette: filter operators", function () {

    var ACTION_TAG = "$:/tags/rimir/cascade-palette/action";
    var ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";

    function freshWiki() {
        var wiki = new $tw.Wiki();
        wiki.addIndexersToWiki();
        return wiki;
    }

    function addTiddler(wiki, fields) {
        wiki.addTiddler(new $tw.Tiddler(fields));
    }

    /* ====================== cp-actions-for ====================== */

    describe("cp-actions-for", function () {

        function seedActions(wiki) {
            addTiddler(wiki, { title: "A_PersonEdit", tags: ACTION_TAG, "ca-entity-type": "person", "ca-name": "Edit" });
            addTiddler(wiki, { title: "A_PersonContact", tags: ACTION_TAG, "ca-entity-type": "person", "ca-action-when": "[<currentTiddler>has[email]]" });
            addTiddler(wiki, { title: "A_TaskClose", tags: ACTION_TAG, "ca-entity-type": "task" });
            addTiddler(wiki, { title: "A_GlobalOpen", tags: ACTION_TAG, "ca-entity-type": "*" });
            addTiddler(wiki, { title: "A_Untyped", tags: ACTION_TAG });
            addTiddler(wiki, { title: "Draft of 'A_PersonEdit'", tags: ACTION_TAG, "draft.of": "A_PersonEdit", "draft.title": "A_PersonEdit", "ca-entity-type": "person" });
        }

        it("returns catalogue + globals for an entity-type operand", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[person]sort[title]]");
            expect(results).toEqual(["A_GlobalOpen", "A_PersonContact", "A_PersonEdit"]);
        });

        it("returns globals only for an unknown operand", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[nonexistent]sort[title]]");
            expect(results).toEqual(["A_GlobalOpen"]);
        });

        it("returns globals only for operand '*'", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[*]sort[title]]");
            expect(results).toEqual(["A_GlobalOpen"]);
        });

        it("returns globals only for an empty operand", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[]sort[title]]");
            expect(results).toEqual(["A_GlobalOpen"]);
        });

        it("excludes drafts of action tiddlers", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[person]sort[title]]");
            results.forEach(function (t) {
                expect(t.indexOf("Draft of")).toBe(-1);
            });
        });

        it("excludes actions that are not tagged $:/tags/rimir/cascade-palette/action", function () {
            var wiki = freshWiki();
            addTiddler(wiki, { title: "NotAnAction", "ca-entity-type": "person" });
            addTiddler(wiki, { title: "ProperAction", tags: ACTION_TAG, "ca-entity-type": "person" });
            var results = wiki.filterTiddlers("[cp-actions-for[person]sort[title]]");
            expect(results).toEqual(["ProperAction"]);
        });

        it("treats actions without ca-entity-type as non-matching for catalogue path", function () {
            var wiki = freshWiki();
            addTiddler(wiki, { title: "BareTagged", tags: ACTION_TAG });
            addTiddler(wiki, { title: "TypedPerson", tags: ACTION_TAG, "ca-entity-type": "person" });
            var results = wiki.filterTiddlers("[cp-actions-for[person]sort[title]]");
            expect(results).toEqual(["TypedPerson"]);
        });

        it("is composable with downstream operators (has[ca-action-when])", function () {
            var wiki = freshWiki();
            seedActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-for[person]has[ca-action-when]sort[title]]");
            expect(results).toEqual(["A_PersonContact"]);
        });
    });

    /* ====================== cp-actions-applying-to ====================== */

    describe("cp-actions-applying-to", function () {

        function seedAppliesActions(wiki) {
            addTiddler(wiki, { title: "A_HasEmail", tags: ACTION_TAG, "ca-applies": "[<currentTiddler>has[email]]" });
            addTiddler(wiki, { title: "A_HasTagWork", tags: ACTION_TAG, "ca-applies": "[<currentTiddler>tag[work]]" });
            addTiddler(wiki, { title: "A_HasKindType", tags: ACTION_TAG, "ca-applies": "[<currentTiddler>has[kind.type]]" });
            addTiddler(wiki, { title: "A_TypedOnly", tags: ACTION_TAG, "ca-entity-type": "person" });
            addTiddler(wiki, { title: "A_BlankApplies", tags: ACTION_TAG, "ca-applies": "  " });
            addTiddler(wiki, { title: "RowAlice", email: "a@x.com", tags: "work" });
            addTiddler(wiki, { title: "RowBob", tags: "personal" });
            addTiddler(wiki, { title: "RowKind", "kind.type": "person" });
        }

        it("returns action titles whose ca-applies matches the input", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowAlice]sort[title]]");
            expect(results).toEqual(["A_HasEmail", "A_HasTagWork"]);
        });

        it("returns empty list when no ca-applies match", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowBob]sort[title]]");
            expect(results).toEqual([]);
        });

        it("handles configured-field bridges via ca-applies (kind.type)", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowKind]sort[title]]");
            expect(results).toEqual(["A_HasKindType"]);
        });

        it("returns empty list for a missing target tiddler", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[NoSuchRow]sort[title]]");
            expect(results).toEqual([]);
        });

        it("returns empty list for an empty operand", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[]sort[title]]");
            expect(results).toEqual([]);
        });

        it("skips actions whose ca-applies is blank/whitespace", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowAlice]sort[title]]");
            expect(results.indexOf("A_BlankApplies")).toBe(-1);
        });

        it("skips actions without ca-applies (catalogue-only ones)", function () {
            var wiki = freshWiki();
            seedAppliesActions(wiki);
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowAlice]sort[title]]");
            expect(results.indexOf("A_TypedOnly")).toBe(-1);
        });

        it("skips tiddlers carrying ca-applies but not tagged as actions", function () {
            var wiki = freshWiki();
            addTiddler(wiki, { title: "BareAppliesNotTagged", "ca-applies": "[<currentTiddler>has[email]]" });
            addTiddler(wiki, { title: "RowAlice", email: "a@x.com" });
            var results = wiki.filterTiddlers("[cp-actions-applying-to[RowAlice]sort[title]]");
            expect(results).toEqual([]);
        });
    });

    /* ====================== cp-position-of ====================== */

    describe("cp-position-of", function () {

        function seedEntries(wiki) {
            addTiddler(wiki, { title: "E_NoPos", tags: ENTRY_TAG });
            addTiddler(wiki, { title: "E_Base", tags: ENTRY_TAG, "ca-position": "ParentA" });
            addTiddler(wiki, { title: "E_Slug", tags: ENTRY_TAG, "ca-position": "ParentBase", "ca-position-by-namespace": "NsParent" });
            addTiddler(wiki, { title: "E_Multi", tags: ENTRY_TAG, "ca-position": "ParentA:ParentB" });
            addTiddler(wiki, { title: "E_NewlineMulti", tags: ENTRY_TAG, "ca-position": "ParentA\nParentB" });
            addTiddler(wiki, { title: "E_None", tags: ENTRY_TAG, "ca-position": "none" });
            addTiddler(wiki, { title: "E_NoneSlug", tags: ENTRY_TAG, "ca-position": "ParentX", "ca-position-by-namespace": "none" });
            addTiddler(wiki, { title: "E_BlankSlug", tags: ENTRY_TAG, "ca-position": "ParentP", "ca-position-by-namespace": "" });
        }

        it("returns at-root when no position field is set", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_NoPos]cp-position-of[default]]")).toEqual(["at-root"]);
        });

        it("returns the base ca-position when no slug field is set", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_Base]cp-position-of[default]]")).toEqual(["ParentA"]);
            expect(wiki.filterTiddlers("[[E_Base]cp-position-of[by-namespace]]")).toEqual(["ParentA"]);
        });

        it("uses ca-position-<slug> override when present", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_Slug]cp-position-of[default]]")).toEqual(["ParentBase"]);
            expect(wiki.filterTiddlers("[[E_Slug]cp-position-of[by-namespace]]")).toEqual(["NsParent"]);
        });

        it("splits multi-value positions on colon", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_Multi]cp-position-of[default]]")).toEqual(["ParentA", "ParentB"]);
        });

        it("splits multi-value positions on newline", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_NewlineMulti]cp-position-of[default]]")).toEqual(["ParentA", "ParentB"]);
        });

        it("returns no positions when value is 'none' at base", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_None]cp-position-of[default]]")).toEqual([]);
        });

        it("returns no positions when value is 'none' at slug-override level", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_NoneSlug]cp-position-of[by-namespace]]")).toEqual([]);
            expect(wiki.filterTiddlers("[[E_NoneSlug]cp-position-of[default]]")).toEqual(["ParentX"]);
        });

        it("falls back to base ca-position when slug field is blank/empty", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[E_BlankSlug]cp-position-of[by-namespace]]")).toEqual(["ParentP"]);
        });

        it("returns at-root for a missing tiddler", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            expect(wiki.filterTiddlers("[[NoSuch]cp-position-of[default]]")).toEqual(["at-root"]);
        });

        it("emits positions for each input title in source feed", function () {
            var wiki = freshWiki();
            seedEntries(wiki);
            var results = wiki.filterTiddlers("[tag[" + ENTRY_TAG + "]cp-position-of[default]]");
            expect(results.indexOf("ParentA")).toBeGreaterThan(-1);
            expect(results.indexOf("ParentB")).toBeGreaterThan(-1);
            expect(results.indexOf("ParentX")).toBeGreaterThan(-1);
            expect(results.indexOf("ParentP")).toBeGreaterThan(-1);
            expect(results.indexOf("at-root")).toBeGreaterThan(-1);
        });
    });

});
