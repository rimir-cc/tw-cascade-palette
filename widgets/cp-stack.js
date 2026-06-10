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
var ACTION_PROVIDER_TAG = C.ACTION_PROVIDER_TAG;
var ENTRY_TAG = C.ENTRY_TAG;
var SOFT_DEPTH_CONFIG = C.SOFT_DEPTH_CONFIG;
var DEFAULT_SOFT_DEPTH = C.DEFAULT_SOFT_DEPTH;
var LARGE_ROOT_SET_CONFIG = C.LARGE_ROOT_SET_CONFIG;
var DEFAULT_LARGE_ROOT_SET = C.DEFAULT_LARGE_ROOT_SET;
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
        // Seed any fresh daterange rows from their defaults before the first
        // paint, so the row opens pre-filled (e.g. today+2w → today+4w).
        if (this._seedDateRanges) this._seedDateRanges(stage);
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
            // Show group headers even with a single group (cp-rendering).
            forceHeaders: !!entry.nextForceHeaders,
            // Prominent above-input heading for this stage (cp-rendering
            // renderHeading). May be refreshed per recompute from a row's
            // ca-stage-heading (_applyDynamicStageMeta).
            heading: entry.nextHeading || "",
            // Carried from the drill's `ca-sort-rows`: when truthy, the
            // synthetic items-from rows of this stage are alphabetised by
            // displayed (lensed) name with selected rows floated to the top
            // (see refreshStage / _sortDataRowItems).
            sortRows: entry.sortRows || "",
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
        this._applyDynamicStageMeta(stage);
        this._lastPerf = this._lastPerf || {};
        this._lastPerf.recomputeMs = perfNow.now() - t0;
        this._lastPerf.stageKind = stage ? stage.kind : "";
        this._lastPerf.itemCount = stage && stage.items ? stage.items.length : 0;
        this._lastPerf.resultCount = stage && stage.results ? stage.results.length : 0;
        this._maybeWarnLargeRootSet(stage);
    };

    // After results are computed, let a row relabel its own stage's
    // above-input heading via `ca-stage-heading` (item.stageHeading). Used by
    // step flows (kind's wizard) where one stage represents different steps
    // over its lifetime — the first row carrying a value wins; none → the
    // stage keeps its push-time heading.
    proto._applyDynamicStageMeta = function (stage) {
        if (!stage || !stage.results) return;
        for (var i = 0; i < stage.results.length; i++) {
            var h = stage.results[i] && stage.results[i].stageHeading;
            if (h) { stage.heading = h; return; }
        }
    };

    // Configured large-root-set threshold (0 / invalid ⇒ disabled, except a
    // missing config falls back to the default). Mirrors getSoftDepthWarning.
    proto.getLargeRootSetWarning = function () {
        var raw = this.wiki.getTiddlerText(LARGE_ROOT_SET_CONFIG, String(DEFAULT_LARGE_ROOT_SET));
        var n = parseInt(raw, 10);
        if (isNaN(n) || n < 0) return DEFAULT_LARGE_ROOT_SET;
        return n; // 0 ⇒ explicitly disabled
    };

    // Warn (once per view+stage-kind, NOT per keystroke) when a root/tree
    // stage's full item set — which is rebuilt and re-decorated on every
    // keystroke — exceeds the threshold. Recovering below it re-arms the
    // warning, so a later regrowth warns again.
    proto._maybeWarnLargeRootSet = function (stage) {
        if (!stage || (stage.kind !== "root" && stage.kind !== "tree")) return;
        var threshold = this.getLargeRootSetWarning();
        if (threshold <= 0) return;
        var n = (stage.items && stage.items.length) || 0;
        var key = (stage.viewTitle || this.activeView || "") + "/" + stage.kind;
        this._largeRootWarned = this._largeRootWarned || {};
        if (n > threshold) {
            if (!this._largeRootWarned[key]) {
                this._largeRootWarned[key] = true;
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] view root set", n, "rows exceeds threshold",
                        threshold + " — the palette rebuilds + decorates this set on " +
                        "every keystroke. Consider a narrower ca-view-roots, a filter " +
                        "pill, or raising " + LARGE_ROOT_SET_CONFIG + " (0 disables)."
                    );
                }
            }
        } else {
            delete this._largeRootWarned[key];
        }
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
            var filterItems = this.evaluateFilterStage(stage);
            // Data-row sorting: alphabetise by displayed (lensed) name,
            // selected rows first. Plain-filter (tiddler-title) stages are
            // always pure data lists → sort unconditionally. Synthetic
            // items-from stages opt in via the parent drill's ca-sort-rows
            // so structured menus (field editors etc.) keep their layout.
            var sortData = stage.itemsFromFilter ? !!stage.sortRows : true;
            stage.items = sortData
                ? this._sortDataRowItems(filterItems, stage)
                : filterItems;
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

    // Discover actions applicable to a row. Four parallel mechanisms,
    // unioned and deduplicated (each action matches at most once):
    //   - Catalogue path: `ca-entity-type` matches the row's bound type
    //     (set by `ca-layer-row-entity-type` on the emitting layer);
    //     globals (`ca-entity-type: *`) match any row. Implemented via
    //     the [cp-actions-for[<entity-type>]] filter operator
    //     (widgets/cp-actions-for.js) so the catalogue rule is also
    //     reachable from wikitext for badges / diagnostics.
    //   - Filter path: `ca-applies` is a filter; non-empty result for
    //     `<currentTiddler> = contextTitle` means the action surfaces
    //     for that row. Explicit, per-action; works in any view. Stays
    //     in JS — per-row filter eval with per-action variables.
    //   - Configured-field path: when the wiki has set
    //     `$:/config/rimir/cascade-palette/entity-type-field` to a field
    //     name (typically by `rimir/kind` presetting it to `kind.type`),
    //     an action's `ca-entity-type: <X>` ALSO matches any row whose
    //     tiddler carries `<configured-field>: <X>`. Lets catalogue
    //     plugins surface their actions in tree / flat views without
    //     adding per-action `ca-applies` filters.
    //   - Lens path (H4): an actions-active lens (`ca-lens-actions` is a
    //     filter + `ca-lens-when` passes) contributes the action titles its
    //     filter returns for `<currentTiddler> = contextTitle`. Always-on,
    //     gated only by ca-lens-when — NEVER by slot selection (see
    //     cp-lenses#_lensContributedActionTitles). The `via-entity-type`
    //     marker contributes nothing here (served by the paths above).
    // `ca-action-when` further narrows whichever path matched.
    // Passing entityType=null skips the row-bound catalogue check;
    // configured-field + ca-applies + globals still apply.
    proto.loadActionsForType = function (entityType, contextTitle) {
        var self = this;
        // Catalogue + globals via filter operator. Empty / null
        // entityType still surfaces globals (operator semantics).
        var catalogueTitles = this.wiki.filterTiddlers(
            "[cp-actions-for[" + (entityType || "") + "]]"
        );
        var seen = Object.create(null);
        var matched = [];
        catalogueTitles.forEach(function (title) {
            if (!seen[title]) { seen[title] = true; matched.push(title); }
        });
        // Configured-field + ca-applies paths still need contextTitle.
        var allTitles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]] +[!is[draft]]"
        );
        allTitles.forEach(function (title) {
            if (seen[title]) return;
            var t = self.getActionEntityType(title);
            if (self.actionMatchesByConfiguredField(t, contextTitle)
                || self.actionAppliesViaFilter(title, contextTitle)) {
                seen[title] = true;
                matched.push(title);
            }
        });
        // Lens path (H4 slice 3): actions-active lenses (ca-lens-actions set
        // + ca-lens-when passes) may surface extra action tiddlers on a row
        // via a filter, INDEPENDENT of slot selection. The via-entity-type
        // marker contributes nothing here — those actions already flow
        // through the always-on catalogue / configured-field paths above.
        if (this._lensContributedActionTitles) {
            this._lensContributedActionTitles(contextTitle).forEach(function (title) {
                if (seen[title]) return;
                var lt = self.wiki.getTiddler(title);
                if (!lt || !lt.hasTag(ACTION_TAG)) return;
                seen[title] = true;
                matched.push(title);
            });
        }
        var staticItems = matched
            .filter(function (title) {
                return self.isActionApplicable(title, contextTitle);
            })
            .map(function (title) { return self.readCascadeFields(title); });
        // Provider path (5th mechanism): tiddlers tagged ACTION_PROVIDER_TAG
        // emit DYNAMICALLY-COMPUTED action specs for the focused row. Each
        // result is a JSON object of ca-* props (same shape as ca-items-from
        // rows) → readCascadeFromObject builds a synthetic (title-less) item.
        return staticItems.concat(this.loadProviderActions(contextTitle));
    };

    // Evaluate action-provider tiddlers for the focused row. Returns an array
    // of synthetic cascade items (no backing tiddler). A provider applies when
    // its `ca-applies` filter is non-empty for the row; its `ca-provider-items`
    // filter then yields one JSON action spec per result.
    proto.loadProviderActions = function (contextTitle) {
        var self = this;
        var out = [];
        var providers = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ACTION_PROVIDER_TAG + "]] +[!is[draft]]"
        );
        providers.forEach(function (title) {
            // Reuse the ca-applies gate semantics from the static path.
            if (!self.actionAppliesViaFilter(title, contextTitle)) return;
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var itemsFilter = f["ca-provider-items"];
            if (!itemsFilter || !String(itemsFilter).trim()) return;
            var specs;
            try {
                specs = self._filterInScope(
                    String(itemsFilter),
                    { currentTiddler: contextTitle || "" }
                );
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-provider-items filter error on",
                        title, "—", err && err.message
                    );
                }
                return;
            }
            (specs || []).forEach(function (raw) {
                var obj;
                try { obj = JSON.parse(raw); }
                catch (err) {
                    if (console && console.warn) {
                        console.warn(
                            "[cascade-palette] action-provider spec JSON parse error on",
                            title, "—", err && err.message, "—", raw
                        );
                    }
                    return;
                }
                out.push(self.readCascadeFromObject(obj));
            });
        });
        return out;
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
            var result = this._filterInScope(
                String(applies),
                { currentTiddler: contextTitle || "" }
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
            var result = this._filterInScope(
                String(when),
                { currentTiddler: contextTitle || "" }
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
        // Reach pills active → deep walk via cp-deep-search.js. Meta /
        // Field pills (cp-search-meta-pills.js, cp-search-field-pills.js)
        // widen the matcher's slot/field set but don't affect mode.
        var mode = this._activeReachMode
            ? this._activeReachMode()
            : "local";
        var filtered;
        if ((mode === "deep-here" || mode === "deep-root") && stage.query) {
            filtered = this.deepWalk({ mode: mode, query: stage.query });
            // Deep results are always rendered flat — the breadcrumb IS
            // the group cue. Skip the regroup pass entirely.
            stage.results = this._applyResultWindow(stage, filtered);
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
            stage.results = this._applyResultWindow(stage, ordered);
        }
        if (stage.selectedIndex >= stage.results.length) {
            stage.selectedIndex = Math.max(0, stage.results.length - 1);
        }
    };

    // Apply the visible-row window to an ordered/filtered result list and,
    // when more rows exist than the window shows, append two synthetic
    // sentinel rows ("Show N more" + "Show all N") at the bottom. The window
    // resets to one page (getMaxResults) whenever the query text changes, so
    // an expansion is scoped to the current query, not sticky. fireSelected
    // (cp-firing.js) grows `stage.windowSize` when a sentinel is activated.
    proto._applyResultWindow = function (stage, ordered) {
        var max = this.getMaxResults();
        // New query → reset the window. (Stage re-entry keeps _windowQuery
        // undefined on a fresh stage object, so this also resets there.)
        if (stage._windowQuery !== stage.query) {
            stage._windowQuery = stage.query;
            stage.windowSize = max;
        }
        if (!stage.windowSize) stage.windowSize = max;
        var total = ordered.length;
        var shown = stage.windowSize === Infinity
            ? ordered.slice()
            : ordered.slice(0, stage.windowSize);
        var remaining = total - shown.length;
        if (remaining > 0) {
            var step = Math.min(this.getMaxResultsStep(), remaining);
            shown.push(this._windowSentinelRow(
                "page", "Show " + step + " more",
                remaining + " more below — Enter to show " + step
            ));
            shown.push(this._windowSentinelRow(
                "all", "Show all " + total,
                "Show all " + total + " matches — Enter to load every row"
            ));
        }
        return shown;
    };

    // Build one window sentinel row. No `title` (so the row-decoration gate
    // in cp-row-decorations.js no-ops) and no `group` (so it never gets a
    // section header — always appended last). `_windowGrow` is "page" or
    // "all"; cp-firing.js reads it to grow the window.
    proto._windowSentinelRow = function (grow, name, hint) {
        return {
            name: name, hint: hint, kind: "leaf",
            dataRow: false, isSynthetic: true,
            _windowSentinel: true, _windowGrow: grow
        };
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

    // Sort tier for data-row lists: 0 = currently selected (floats to top),
    // 1 = everything else. A toggle row is "selected" when its bound field
    // currently holds its true-value (isToggleOn); a leaf/other row opts in
    // via `ca-selected: yes` (item.selected), which single-select pickers set
    // on the row matching the current value.
    proto._selectedTier = function (item) {
        if (item.kind === "toggle" && this.isToggleOn(item)) return 0;
        if (item.selected) return 0;
        return 1;
    };

    // Identity key for a data row, stable across recomputes. Toggle rows are
    // keyed by their true-value (the candidate), synthetic leaves by name,
    // tiddler rows by title.
    proto._dataRowKey = function (item) {
        return item.title || item.trueValue || item.name || "";
    };

    // Order data-row stage items by (ca-order, selected-tier, displayed name).
    // ca-order stays primary so any curated layout is preserved; within one
    // order group selected rows float up, then the rest are alphabetised by
    // the lensed display name (numeric-aware, case-insensitive). Display name
    // is resolved once per item, not per comparison.
    //
    // The order is frozen per stage VISIT (cached on stage._dataRowOrder): a
    // keepOpen recompute — e.g. Space-toggling a member on/off — must not make
    // the just-toggled row jump, which would strand the index-based selection
    // highlight. Re-entering the stage builds a fresh stage object, so the
    // selected-on-top ordering re-applies then. New rows that appear mid-visit
    // are sorted in and appended after the known rows.
    proto._sortDataRowItems = function (items, stage) {
        var self = this;
        var decorated = items.map(function (it) {
            return {
                it: it,
                key: self._dataRowKey(it),
                tier: self._selectedTier(it),
                dn: self._displayNameForItem(it)
            };
        });
        var canonical = function (a, b) {
            if (a.it.order !== b.it.order) return a.it.order - b.it.order;
            if (a.tier !== b.tier) return a.tier - b.tier;
            return a.dn.localeCompare(b.dn, undefined,
                { numeric: true, sensitivity: "base" });
        };
        var frozen = stage && stage._dataRowOrder;
        if (frozen) {
            decorated.sort(function (a, b) {
                var ai = frozen[a.key], bi = frozen[b.key];
                var aKnown = ai !== undefined, bKnown = bi !== undefined;
                if (aKnown && bKnown) return ai - bi;
                if (aKnown !== bKnown) return aKnown ? -1 : 1;
                return canonical(a, b);
            });
        } else {
            decorated.sort(canonical);
        }
        var ordered = decorated.map(function (d) { return d.it; });
        if (stage) {
            var pos = {};
            ordered.forEach(function (it, i) { pos[self._dataRowKey(it)] = i; });
            stage._dataRowOrder = pos;
        }
        return ordered;
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
            // Route through _filterInScope so the filter gets a real widget
            // (prefix/`:filter`/`:map`-safe), the entry bound as
            // <currentTiddler>, and the ambient sticky-context vars.
            var results = this._filterInScope(visFilter, { currentTiddler: title });
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
