/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-stack
type: application/javascript
module-type: library

Stage stack — push/pop, stage factories, recompute pipeline, grouping.

Stages live in `this.stack`. Each stage carries:
  kind      "root" | "tree" | "filter" | "actions" | "confirm"
  query     current input filter (per-stage)
  selectedIndex
  items     unfiltered candidates (populated by recomputeStage)
  results   filtered+sorted slice rendered to the menu
  viewTitle (root/tree) — which view this stage was built from
  parentPath (tree) — array of segment strings naming the tree branch
  ...kind-specific extras

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var ACTION_TAG = C.ACTION_TAG;
var ENTRY_TAG = C.ENTRY_TAG;
var SOFT_DEPTH_CONFIG = C.SOFT_DEPTH_CONFIG;
var GROUPING_CONFIG = C.GROUPING_CONFIG;
var DEFAULT_SOFT_DEPTH = C.DEFAULT_SOFT_DEPTH;
var DEFAULT_TRUE_VALUE = C.DEFAULT_TRUE_VALUE;

module.exports = function (proto) {

    /* ---------- stack ops ---------- */

    proto.topStage = function () {
        return this.stack.length ? this.stack[this.stack.length - 1] : null;
    };

    proto.pushStage = function (stage) {
        this.stack.push(stage);
        var softDepth = this.getSoftDepthWarning();
        if (this.stack.length > softDepth && console && console.warn) {
            console.warn(
                "[cascade-palette] stack depth", this.stack.length,
                "exceeds soft warning", softDepth, "— possible cascade loop?"
            );
        }
        this.recomputeStage(stage);
        this.renderStage();
    };

    proto.getSoftDepthWarning = function () {
        var raw = this.wiki.getTiddlerText(SOFT_DEPTH_CONFIG, String(DEFAULT_SOFT_DEPTH));
        var n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? DEFAULT_SOFT_DEPTH : n;
    };

    proto.popStage = function () {
        if (this.stack.length <= 1) {
            this.close();
            return;
        }
        this.stack.pop();
        // Recompute the now-top stage so it reflects any state that changed
        // while we were in the deeper stage (e.g. visibility filters can
        // turn entries on/off after Switch Apps changes active-app).
        var top = this.topStage();
        if (top) this.recomputeStage(top);
        this.renderStage();
    };

    proto.popToDepth = function (depth) {
        // Truncate to keep stages [0..depth].
        if (depth < 0) depth = 0;
        if (depth >= this.stack.length) return;
        this.stack.length = depth + 1;
        // Same refresh logic as popStage — the target stage may have been
        // computed when state was different.
        var top = this.topStage();
        if (top) this.recomputeStage(top);
        this.renderStage();
    };

    /* ---------- stage construction ---------- */

    proto.buildRootStage = function () {
        var view = this._getViewByTitle(this.activeView);
        return {
            kind: "root",
            // Use the active view's display name as the root breadcrumb
            // segment so the user knows which view they're navigating.
            // Falls back to "Root" when no view is loaded (legacy path).
            title: (view && view.name) || "Root",
            query: "",
            selectedIndex: 0,
            // Records which view this stage was built from, so subsequent
            // recomputeStage calls (triggered by wiki-change hook) keep
            // emitting rows from the same view even if this.activeView
            // changes mid-render. Null when no views are declared.
            viewTitle: this.activeView,
            items: [],            // all entries, unfiltered
            results: [],          // entries after query filter
            parentPicked: null,
            entityType: null
        };
    };

    // Tree-view stages carry a viewTitle and a parentPath (array of
    // segment strings naming the tree branch). Reuses the filter-stage
    // result-list machinery; differentiated by stage.kind.
    proto.buildTreeStage = function (viewTitle, parentPath, title) {
        return {
            kind: "tree",
            title: title || "",
            query: "",
            selectedIndex: 0,
            viewTitle: viewTitle,
            parentPath: parentPath || [],
            items: [],
            results: [],
            parentPicked: null,
            entityType: null
        };
    };

    proto.buildFilterStage = function (entry, parentPicked) {
        var entityType = entry.nextEntityType || null;
        // ca-items-from takes precedence over ca-next-scope. Warn once
        // when both are present to flag authoring mistakes — the engine
        // picks items-from but the author probably means one or the other.
        if (entry.itemsFrom && entry.nextScope && console && console.warn) {
            console.warn(
                "[cascade-palette] both ca-items-from and ca-next-scope on",
                entry.title, "— ca-items-from wins"
            );
        }
        var stage = {
            kind: "filter",
            title: entry.nextTitle || entry.name || "Stage",
            query: "",
            selectedIndex: 0,
            // Either-or — `itemsFromFilter` produces synthetic items, plain
            // `filter` produces items from tiddler titles. evaluateFilterStage
            // dispatches.
            filter: entry.itemsFrom ? "" : entry.nextScope,
            itemsFromFilter: entry.itemsFrom || "",
            // `nextDefaultAction` on a drill entry fires when the user hits
            // Enter on an item in this stage AND no entity-type default action
            // is discoverable (typical for enum-picker stages: items are bare
            // strings, no action menu).
            stageDefaultAction: entry.nextDefaultAction || "",
            // Discovered entity-type default action — fired by Enter on a
            // dynamic item when no stageDefaultAction.
            entityDefaultActions: this.lookupEntityDefaultActions(entityType),
            // When the parent drill set `ca-next-as-link`, this stage's
            // results are forced into plain-item rendering — cascade-aware
            // detection in evaluateFilterStage is suppressed.
            asLink: !!entry.nextAsLink,
            items: [],
            results: [],
            parentPicked: parentPicked || null,
            entityType: entityType
        };
        return stage;
    };

    proto.buildActionMenuStage = function (parentPicked, entityType, title) {
        return {
            kind: "actions",
            title: title || parentPicked || "Actions",
            query: "",
            selectedIndex: 0,
            items: [],
            results: [],
            parentPicked: parentPicked,
            entityType: entityType
        };
    };

    // Synthetic confirmation stage. Spec:
    //   title: breadcrumb title (e.g. "Restore default for Grouping")
    //   consequence: human text shown in the details drawer pre-confirm
    //   actions: wikitext fired when the user picks Confirm
    //   vars (optional): variable map to inject when the Confirm leaf fires
    //                    its actions. Lets ca-confirm leaves preserve their
    //                    parent-picked / picked context across the confirm
    //                    stage (which otherwise has no parent context).
    // The stage pops on either choice (handled in fireSelected). Selection
    // defaults to Cancel so accidental Enter does nothing.
    proto.buildConfirmStage = function (spec) {
        var confirmItem = {
            title: "",
            name: "Confirm",
            hint: "",
            icon: "",
            kind: "leaf",
            order: 10,
            group: "",
            actions: spec.actions || "",
            isItem: false
        };
        var cancelItem = {
            title: "",
            name: "Cancel",
            hint: "",
            icon: "",
            kind: "leaf",
            order: 20,
            group: "",
            actions: "",
            isItem: false
        };
        return {
            kind: "confirm",
            title: spec.title || "Confirm",
            query: "",
            selectedIndex: 1,  // default to Cancel — safer for accidental Enter
            items: [confirmItem, cancelItem],
            results: [confirmItem, cancelItem],
            actionVars: spec.vars || null,
            parentPicked: null,
            entityType: null,
            consequenceText: spec.consequence || ""
        };
    };

    /* ---------- result computation ---------- */

    proto.recomputeStage = function (stage) {
        if (stage.kind === "root") {
            var view = this._getViewByTitle(stage.viewTitle || this.activeView);
            if (view) {
                stage.items = this._sortRowsForView(
                    this._buildRowsForView(view, { kind: "root" }), view
                );
            } else {
                // No views shipped (or active view missing) — fall back to
                // the legacy entries-tag enumeration so the palette still
                // works on a wiki without view tiddlers.
                stage.items = this.sortEntries(this.loadEntries());
            }
        } else if (stage.kind === "tree") {
            var treeView = this._getViewByTitle(stage.viewTitle || this.activeView);
            stage.items = this._sortRowsForView(
                this._buildRowsForView(
                    treeView, { kind: "tree", parentPath: stage.parentPath || [] }
                ),
                treeView
            );
        } else if (stage.kind === "filter") {
            stage.items = this.evaluateFilterStage(stage);
        } else if (stage.kind === "actions") {
            stage.items = this.sortEntries(this.loadActionsForType(stage.entityType));
        } else if (stage.kind === "confirm") {
            // Items are pre-built by buildConfirmStage; nothing to recompute.
            stage.results = stage.items.slice();
            return;
        }
        this.applyQueryToStage(stage);
    };

    proto.loadActionsForType = function (entityType) {
        var self = this;
        // Actions matching the entity type OR globals (ca-entity-type: *).
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]] +[!is[draft]]"
        );
        return titles
            .map(function (title) {
                return self.readCascadeFields(title);
            })
            .filter(function (a) {
                var t = self.getActionEntityType(a.title);
                return t === entityType || t === "*";
            });
    };

    proto.getActionEntityType = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        return f["ca-entity-type"] || "";
    };

    proto.lookupEntityDefaultActions = function (entityType) {
        if (!entityType) return null;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]]"
        );
        for (var i = 0; i < titles.length; i++) {
            var t = self.wiki.getTiddler(titles[i]);
            var f = (t && t.fields) || {};
            var fType = f["ca-entity-type"];
            var fDefault = f["ca-default"];
            if (fType === entityType && fDefault === "yes") {
                return {
                    title: titles[i],
                    actions: f["ca-actions"] || "",
                    kind: f["ca-kind"] || "leaf"
                };
            }
        }
        return null;
    };

    proto.applyQueryToStage = function (stage) {
        var filtered = this.filterByQuery(stage.items, stage.query);
        var maxResults = this.getMaxResults();
        // Reorder into visual (grouped) sequence when grouping is enabled,
        // so keyboard nav's linear `selectedIndex` matches the rendered row
        // order. With grouping off, keep the items' natural sort. Tree
        // views always disable grouping — the tree IS the structure;
        // overlaying plugin-source group headers is visual noise.
        var ordered = this._isGroupingEnabledForStage(stage)
            ? this.reorderByGroup(filtered)
            : filtered;
        stage.results = ordered.slice(0, maxResults);
        if (stage.selectedIndex >= stage.results.length) {
            stage.selectedIndex = Math.max(0, stage.results.length - 1);
        }
    };

    proto.isGroupingEnabled = function () {
        var raw = this.wiki.getTiddlerText(GROUPING_CONFIG, DEFAULT_TRUE_VALUE);
        var s = String(raw || "").toLowerCase().trim();
        return s !== "no" && s !== "false" && s !== "off" && s !== "0";
    };

    // Per-stage grouping override: global config + tree-view veto.
    proto._isGroupingEnabledForStage = function (stage) {
        if (!this.isGroupingEnabled()) return false;
        if (!stage) return true;
        var view = this._getViewByTitle(stage.viewTitle || this.activeView);
        if (view && view.treeStrategy) return false;
        return true;
    };

    proto.reorderByGroup = function (items) {
        var groupOrder = [];
        var buckets = Object.create(null);
        items.forEach(function (item) {
            var g = item.group || "";
            if (!(g in buckets)) {
                buckets[g] = [];
                groupOrder.push(g);
            }
            buckets[g].push(item);
        });
        var out = [];
        groupOrder.forEach(function (g) {
            for (var i = 0; i < buckets[g].length; i++) out.push(buckets[g][i]);
        });
        return out;
    };

    proto.loadEntries = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ENTRY_TAG + "]]"
        );
        return titles
            .map(function (title) {
                return self.readCascadeFields(title);
            })
            .filter(function (entry) {
                return self.isEntryVisible(entry.title);
            });
    };

    // Honour `ca-visibility-filter`. If the field is present and the filter
    // returns no results, the entry is hidden. Used by catalogues to gate
    // entries on global state (e.g. "Current App" visible only when an
    // appify-app is active).
    proto.isEntryVisible = function (title) {
        // Visibility-pill check runs first: if any active visibility rule
        // claims this entry, hide it regardless of the entry's own
        // `ca-visibility-filter` (the user explicitly asked for it gone).
        // Note: `ca-visibility-filter` is an UNRELATED per-entry predicate
        // that authors set on their entry tiddlers — predates the
        // visibility-pill subsystem; not migrated by this refactor.
        if (this._visibilityHidesEntry(title)) return false;
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var visFilter = f["ca-visibility-filter"];
        if (!visFilter) return true;
        try {
            var results = this.wiki.filterTiddlers(visFilter);
            return results.length > 0;
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-visibility-filter error on",
                    title, "—", err && err.message
                );
            }
            return true; // keep visible on filter error
        }
    };

};
