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
var DEFAULT_SOFT_DEPTH = C.DEFAULT_SOFT_DEPTH;
var ENTITY_TYPE_FIELD_CONFIG = C.ENTITY_TYPE_FIELD_CONFIG;
var SAVED_STACK_TIDDLER = C.SAVED_STACK_TIDDLER;

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
        var popped = this.stack.pop();
        // Recompute the now-top stage so it reflects any state that changed
        // while we were in the deeper stage (e.g. visibility filters can
        // turn entries on/off after Switch Apps changes active-app).
        var top = this.topStage();
        if (top) this.recomputeStage(top);
        this.renderStage();
        // Axis pickers are opened from the Structure strip — when they're
        // popped (whether by commit, Esc, or backdrop click), bounce focus
        // back to the strip and re-render its pills (the chain just
        // changed). Doing this in popStage keeps the focus restoration
        // central instead of duplicating it across every dismissal path.
        if (popped && popped._isAxisPicker) {
            if (this._renderViewConfigStrip) this._renderViewConfigStrip();
            if (this.setFocus) this.setFocus("viewconfig");
        }
    };

    /* ---------- session-stack persistence ---------- */
    //
    // Close paths that opt into "preserve" (Shift-Esc, action-fire close)
    // call `persistStack()` to dump the current stack to a $:/temp
    // tiddler. The next `openPalette()` calls `restoreSavedStack()` —
    // if a saved stack exists, the user resumes where they left off.
    // Close paths that mean "I'm done" (Esc-at-root, backdrop click,
    // popStage walking past root) call `clearSavedStack()` to forget it.
    //
    // Why $:/temp and not sessionStorage: TW treats $:/temp as
    // non-persistent by convention (filesystem syncers skip it), so the
    // tiddler dies with the page and we get session-only semantics
    // without reaching for browser storage APIs. Same pattern the rest
    // of the workspace already uses.

    proto.serializeStack = function () {
        // Strip items/results (recomputed on next access) and drop stages
        // whose context doesn't survive a close — confirm stages reference
        // closure-captured actions, and action-menu stages reference a
        // parent-picked tiddler that may be gone. Truncate the stack at
        // the first such stage so the restored chain is internally
        // consistent.
        var safe = [];
        for (var i = 0; i < this.stack.length; i++) {
            var s = this.stack[i];
            if (!s) continue;
            if (s.kind === "confirm" || s.kind === "actions") break;
            // Axis picker stages are pre-populated, transient editing UI —
            // dropping them on serialize is correct (the next open should
            // resume at the previous "real" stage, not in the picker).
            if (s._isAxisPicker) break;
            var copy = {};
            for (var k in s) {
                if (s.hasOwnProperty(k) && k !== "items" && k !== "results") {
                    copy[k] = s[k];
                }
            }
            safe.push(copy);
        }
        return safe;
    };

    proto.persistStack = function () {
        var safe = this.serializeStack();
        // Skip persisting a "root only" stack — there's nothing to resume.
        if (!safe || safe.length <= 1) {
            this.clearSavedStack();
            return;
        }
        this.wiki.addTiddler({
            title: SAVED_STACK_TIDDLER,
            type: "application/json",
            text: JSON.stringify(safe)
        });
    };

    proto.clearSavedStack = function () {
        this.wiki.deleteTiddler(SAVED_STACK_TIDDLER);
    };

    proto.restoreSavedStack = function () {
        // Returns true if a saved stack was restored onto this.stack;
        // false if no saved data, parse failure, or empty stack. Caller
        // builds a fresh root on false.
        var text = this.wiki.getTiddlerText(SAVED_STACK_TIDDLER, "");
        if (!text) return false;
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { return false; }
        if (!Array.isArray(parsed) || parsed.length === 0) return false;
        for (var i = 0; i < parsed.length; i++) {
            var s = parsed[i];
            s.items = [];
            s.results = [];
            if (typeof s.selectedIndex !== "number") s.selectedIndex = 0;
            // Re-lookup entity default actions — the wiki's action tags
            // may have changed since save; a stale snapshot would
            // misroute Enter on a dynamic item.
            if (s.kind === "filter" && s.entityType) {
                s.entityDefaultActions =
                    this.lookupEntityDefaultActions(s.entityType);
            }
        }
        this.stack = parsed;
        return true;
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

    // Tree-view stages carry a viewTitle, a parentPath (array of tiddler
    // titles naming the tree branch — each is a real node), and a
    // layerIdx pinning the descent to the structure layer the user drilled
    // into. parentPath[last] is the immediate parent whose `layer.children`
    // filter populates this stage. layerIdx defaults to 0 for back-compat
    // when undefined.
    proto.buildTreeStage = function (viewTitle, parentPath, title, layerIdx) {
        return {
            kind: "tree",
            title: title || "",
            query: "",
            selectedIndex: 0,
            viewTitle: viewTitle,
            parentPath: parentPath || [],
            layerIdx: (layerIdx === undefined || layerIdx === null) ? 0 : layerIdx,
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
        // Consequence text doubles as the Confirm row's hint so it is
        // visible inline in the menu — not only in the detail drawer
        // (which requires Ctrl-hold to surface). The detail drawer still
        // shows the full text via consequenceText on the stage.
        var confirmItem = {
            title: "",
            name: "Confirm",
            hint: spec.consequence || "",
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
        var perfNow = (typeof performance !== "undefined" && performance.now)
            ? performance : Date;
        var t0 = perfNow.now();
        this._recomputeStageBody(stage);
        this._lastPerf = this._lastPerf || {};
        this._lastPerf.recomputeMs = perfNow.now() - t0;
        this._lastPerf.stageKind = stage ? stage.kind : "";
        this._lastPerf.itemCount = stage && stage.items ? stage.items.length : 0;
        this._lastPerf.resultCount = stage && stage.results ? stage.results.length : 0;
    };

    proto._recomputeStageBody = function (stage) {
        // Pre-populated stages (e.g. axis picker) — items are set when the
        // stage is pushed and survive every recompute. Query still filters
        // them in-place via applyQueryToStage.
        if (stage._freezeItems) {
            this.applyQueryToStage(stage);
            return;
        }
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
                    treeView, {
                        kind: "tree",
                        parentPath: stage.parentPath || [],
                        layerIdx: stage.layerIdx
                    }
                ),
                treeView
            );
        } else if (stage.kind === "filter") {
            stage.items = this.evaluateFilterStage(stage);
        } else if (stage.kind === "actions") {
            stage.items = this.sortEntries(
                this.loadActionsForType(stage.entityType, stage.parentPicked)
            );
        } else if (stage.kind === "confirm") {
            // Items are pre-built by buildConfirmStage; nothing to recompute.
            stage.results = stage.items.slice();
            return;
        }
        this.applyQueryToStage(stage);
    };

    // Discover actions applicable to a row. Three parallel mechanisms,
    // unioned and deduplicated (each action matches at most once):
    //   - Catalogue path: `ca-entity-type` matches the row's bound type
    //     (set by `ca-layer-row-entity-type` on the emitting layer);
    //     globals (`ca-entity-type: *`) match any row.
    //   - Filter path: `ca-applies` is a filter; non-empty result for
    //     `<currentTiddler> = contextTitle` means the action surfaces
    //     for that row. Explicit, per-action; works in any view.
    //   - Configured-field path: when the wiki has set
    //     `$:/config/rimir/cascade-palette/entity-type-field` to a field
    //     name (typically by `rimir/kind` presetting it to `kind.type`),
    //     an action's `ca-entity-type: <X>` ALSO matches any row whose
    //     tiddler carries `<configured-field>: <X>`. Lets catalogue
    //     plugins surface their actions in tree / flat views without
    //     adding per-action `ca-applies` filters.
    // `ca-action-when` further narrows whichever path matched.
    // Passing entityType=null skips the row-bound catalogue check;
    // configured-field + ca-applies + globals still apply.
    proto.loadActionsForType = function (entityType, contextTitle) {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]] +[!is[draft]]"
        );
        return titles
            .map(function (title) {
                return self.readCascadeFields(title);
            })
            .filter(function (a) {
                var t = self.getActionEntityType(a.title);
                var matched = false;
                if (t === "*") {
                    matched = true;
                } else if (entityType && t === entityType) {
                    matched = true;
                } else if (self.actionMatchesByConfiguredField(t, contextTitle)) {
                    matched = true;
                } else if (self.actionAppliesViaFilter(a.title, contextTitle)) {
                    matched = true;
                }
                if (!matched) return false;
                return self.isActionApplicable(a.title, contextTitle);
            });
    };

    proto._entityTypeField = function () {
        var raw = this.wiki.getTiddlerText(ENTITY_TYPE_FIELD_CONFIG, "");
        return raw ? raw.trim() : "";
    };

    // Auto-derived ca-applies — when a type-system plugin has set the
    // entity-type-field config, an action's `ca-entity-type: <X>` matches
    // rows whose tiddler carries `<configured-field>: <X>`. Skips globals
    // (`*`) and unset action types — those are handled by the catalogue
    // / explicit ca-applies paths in loadActionsForType.
    proto.actionMatchesByConfiguredField = function (actionEntityType, contextTitle) {
        if (!actionEntityType || actionEntityType === "*") return false;
        if (!contextTitle) return false;
        var field = this._entityTypeField();
        if (!field) return false;
        var tid = this.wiki.getTiddler(contextTitle);
        if (!tid || !tid.fields) return false;
        return tid.fields[field] === actionEntityType;
    };

    // ca-applies — filter evaluated with currentTiddler bound to the
    // row title. Non-empty result = action surfaces. Used for cross-view
    // discovery so actions reach tree-view rows that have no bound
    // entityType.
    proto.actionAppliesViaFilter = function (actionTitle, contextTitle) {
        var t = this.wiki.getTiddler(actionTitle);
        var f = (t && t.fields) || {};
        var applies = f["ca-applies"];
        if (!applies || !String(applies).trim()) return false;
        try {
            var result = this.wiki.filterTiddlers(
                String(applies),
                this.makeFakeWidget({ currentTiddler: contextTitle || "" })
            );
            return result && result.length > 0;
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-applies filter error on",
                    actionTitle, "—", err && err.message
                );
            }
            return false;
        }
    };

    proto.isActionApplicable = function (actionTitle, contextTitle) {
        var t = this.wiki.getTiddler(actionTitle);
        var f = (t && t.fields) || {};
        var when = f["ca-action-when"];
        if (!when || !String(when).trim()) return true;
        try {
            var result = this.wiki.filterTiddlers(
                String(when),
                this.makeFakeWidget({ currentTiddler: contextTitle || "" })
            );
            return result && result.length > 0;
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] ca-action-when filter error on",
                    actionTitle, "—", err && err.message
                );
            }
            return false;
        }
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
        // Search mode is driven by the reach pills (cp-reach-pills.js).
        // No reach pills → local mode (legacy single-stage substring).
        // Reach pills active → deep walk via cp-deep-search.js. Field
        // pills (cp-field-pills.js) widen the matcher's field set but
        // don't affect mode.
        var mode = this._activeReachMode
            ? this._activeReachMode()
            : "local";
        var maxResults = this.getMaxResults();
        var filtered;
        if ((mode === "deep-here" || mode === "deep-root") && stage.query) {
            filtered = this.deepWalk({ mode: mode, query: stage.query });
            // Deep results are always rendered flat — the breadcrumb IS
            // the group cue. Skip the regroup pass entirely.
            stage.results = filtered.slice(0, maxResults);
        } else {
            filtered = this.filterByQuery(stage.items, stage.query);
            // Reorder into visual (grouped) sequence when grouping is
            // enabled, so keyboard nav's linear `selectedIndex` matches
            // the rendered row order. With grouping off, keep the items'
            // natural sort. Tree views always disable grouping — the
            // tree IS the structure; overlaying plugin-source group
            // headers is visual noise.
            var ordered = this._isGroupingEnabledForStage(stage)
                ? this.reorderByGroup(filtered)
                : filtered;
            stage.results = ordered.slice(0, maxResults);
        }
        if (stage.selectedIndex >= stage.results.length) {
            stage.selectedIndex = Math.max(0, stage.results.length - 1);
        }
    };

    // Per-stage grouping is now a view-scoped property — each view
    // declares whether its rows should cluster under section headers via
    // `ca-view-grouping` (default yes). Removed in 0.0.38: the global
    // `$:/config/rimir/cascade-palette/grouping-enabled` toggle. Rationale
    // with the layered model: grouping is structural intent (layer headers
    // distinguish where rows came from), so the view author decides.
    //
    // Stage-kind rules layered on top of the view's setting:
    //   root          → honour view.grouping
    //   tree (deeper) → always off (we're inside one layer's branch; the
    //                   tree IS the structure at that level)
    //   filter        → honour view.grouping (plugin-source clusters)
    //   actions       → honour view.grouping
    //   confirm       → irrelevant (always 2 fixed items)
    proto._isGroupingEnabledForStage = function (stage) {
        if (!stage) return true;
        var view = this._getViewByTitle(stage.viewTitle || this.activeView);
        var viewGrouping = view ? view.grouping : true;
        if (!viewGrouping) return false;
        if (stage.kind === "root") return true;
        if (stage.kind === "tree" && view && view.isTree) return false;
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
