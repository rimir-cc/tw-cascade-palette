/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-deep-search
type: application/javascript
module-type: library

Deep-tree search — BFS walker that materialises the cascade subtree
under the current stage (mode="deep-here") or the active view's root
(mode="deep-root") and runs the query matcher across every reachable
item. Results carry a transient `_path` array of `{name, item}` records
naming the drill chain from root to the result, used by:
  - cp-rendering to prefix each row with a breadcrumb
  - cp-firing's replayPath to push the stages needed to reach the
    picked result's natural location in the cascade

Activation is via the Reach pill strip (cp-reach-pills.js): "Here"
and "Everywhere" pills carry `ca-reach-mode`; the matcher branch in
cp-stack.js:applyQueryToStage reads `_activeReachMode()` and routes
into deepWalk when it returns non-"local". Field pills
(cp-field-pills.js) shape `_activeFieldNames()` which the matcher
inside the walk consumes to widen the searchable field set.

Caps (config tiddlers):
  $:/config/rimir/cascade-palette/deep-search-max-depth   (default 4)
  $:/config/rimir/cascade-palette/deep-search-max-nodes   (default 800)
  $:/config/rimir/cascade-palette/deep-search-max-ms      (default 80)

Caps are hard — when any is hit the walk aborts and a truncation
sentinel row is appended so the user knows to refine the query.

\*/
"use strict";

module.exports = function (proto) {

    proto._deepSearchConfig = function (key, fallback) {
        var raw = this.wiki.getTiddlerText(
            "$:/config/rimir/cascade-palette/deep-search-" + key,
            String(fallback)
        );
        var n = parseInt(raw, 10);
        return (isNaN(n) || n < 1) ? fallback : n;
    };

    // Public entry. Called from cp-stack.js:applyQueryToStage when the
    // active mode is "deep-here" or "deep-root". Returns an array of
    // items annotated with `_path` and `_match`. Empty query returns [].
    proto.deepWalk = function (opts) {
        var query = String((opts && opts.query) || "");
        var mode = (opts && opts.mode) || "deep-here";
        if (!query) return [];

        var maxDepth = this._deepSearchConfig("max-depth", 4);
        var maxNodes = this._deepSearchConfig("max-nodes", 800);
        var maxMs    = this._deepSearchConfig("max-ms", 80);
        var perfNow = (typeof performance !== "undefined" && performance.now)
            ? performance : Date;
        var t0 = perfNow.now();

        var frontier = this._deepInitialFrontier(mode);
        var matches = [];
        var nodes = 0;
        var truncated = false;

        // Pre-resolve the active search fields ONCE per walk — same
        // override semantics as filterByQuery; rebuilding per-item would
        // re-read config N times.
        var fieldOverride = this._activeFieldNames
            ? this._activeFieldNames()
            : null;
        var defaultFields = this._defaultSearchFields();
        var q = query.toLowerCase();

        outer: while (frontier.length) {
            var batch = frontier;
            frontier = [];
            for (var i = 0; i < batch.length; i++) {
                if (nodes >= maxNodes) { truncated = true; break outer; }
                if ((perfNow.now() - t0) > maxMs) { truncated = true; break outer; }

                var entry = batch[i];
                var item = entry.item;
                nodes++;

                // ca-search-skip: yes — exclude from results AND don't
                // descend. Default auto-skip for items whose only purpose
                // is to capture input or confirm: text / number / date /
                // toggle / confirm-stage rows aren't meaningful matches and
                // their "children" are never real cascade rows.
                var autoSkipKind = (item.kind === "text" || item.kind === "number" ||
                    item.kind === "date" || item.kind === "toggle" ||
                    item.kind === "confirm");
                if (item.searchSkip || autoSkipKind) continue;

                // Match check — same predicate as filterByQuery so local-
                // and deep-search behaviour is identical on the matching
                // axis. Collects ALL matches across the field set into
                // _matches (cp-rendering uses it to draw one snippet per
                // matched field). _match retained as back-compat pointer
                // to the first match for inline highlight.
                var allMatches = this._matchItemAll(item, q, query.length, fieldOverride, defaultFields);
                if (allMatches && allMatches.length) {
                    item._matches = allMatches;
                    item._match = allMatches[0];
                    item._path = entry.path.slice();   // freeze path snapshot
                    matches.push(item);
                } else {
                    item._match = null;
                    item._matches = null;
                }

                // Depth guard — don't descend further once we've consumed
                // maxDepth levels of drill. The path length is the depth at
                // which the current item lives, so children would be at
                // path.length + 1.
                if (entry.path.length >= maxDepth) continue;

                var children = this._deepComputeChildren(item, entry);
                if (!children || !children.length) continue;

                var childPath = entry.path.concat([{ name: item.name, item: item }]);
                var childEntry = this._deepChildContext(item, entry);
                for (var k = 0; k < children.length; k++) {
                    frontier.push({
                        item: children[k],
                        path: childPath,
                        viewTitle: childEntry.viewTitle,
                        parentPath: childEntry.parentPath,
                        layerIdx: childEntry.layerIdx,
                        parentPicked: childEntry.parentPicked
                    });
                }
            }
        }

        this._lastPerf = this._lastPerf || {};
        this._lastPerf.deepSearchMs = perfNow.now() - t0;
        this._lastPerf.deepSearchNodes = nodes;
        this._lastPerf.deepSearchTruncated = truncated;

        if (truncated) {
            // Sentinel row — purely for user feedback. _path is empty so
            // the renderer doesn't try to draw a breadcrumb; kind="leaf"
            // and no actions means Enter does nothing. The renderer can
            // style this row via the `_deepTruncated` flag.
            matches.push({
                title: "",
                name: "… deep search truncated at " + nodes + " nodes — refine the query",
                hint: "",
                icon: "",
                kind: "leaf",
                order: 999999,
                group: "",
                actions: "",
                isItem: false,
                _deepTruncated: true,
                _path: [],
                _match: null
            });
        }

        return matches;
    };

    // Per-item match collector — returns ALL matches across the
    // item's searchable fields. Same lookup chain as filterByQuery
    // (override → per-item ca-search-fields → global default). Empty
    // array when no field matches; caller treats that as "skip".
    // Mutating the shared item with _matches / _match / _path is
    // acceptable because items are rebuilt on every recomputeStage —
    // the annotation doesn't outlive the keystroke.
    proto._matchItemAll = function (item, qLower, qLen, override, defaultFields) {
        var fields = override
            || (item.searchFields && item.searchFields.length
                ? item.searchFields
                : defaultFields);
        var matches = [];
        for (var i = 0; i < fields.length; i++) {
            var fname = fields[i];
            // _resolveMatchableField (cp-actions.js) walks: cascade-item
            // property → tiddler-field fallback. Single source of truth
            // shared with filterByQuery's local path.
            var sv = this._resolveMatchableField(item, fname);
            if (!sv) continue;
            var idx = sv.toLowerCase().indexOf(qLower);
            if (idx !== -1) {
                matches.push({
                    field: fname,
                    value: sv,
                    start: idx,
                    len: qLen
                });
            }
        }
        return matches;
    };

    // Seed the BFS frontier. For "deep-here" the user is anchored at the
    // currently-visible stage and wants results from its subtree; we
    // borrow that stage's already-materialised items. For "deep-root"
    // the walk is global from the active view's roots; we rebuild the
    // root items without touching this.stack (so the user's open drills
    // are preserved — the walk widens the search frontier, it doesn't
    // pop stages).
    proto._deepInitialFrontier = function (mode) {
        if (mode === "deep-here") {
            var top = this.topStage();
            if (!top || !top.items || !top.items.length) return [];
            var seed = [];
            for (var i = 0; i < top.items.length; i++) {
                seed.push({
                    item: top.items[i],
                    path: [],
                    viewTitle: top.viewTitle || this.activeView,
                    parentPath: (top.parentPath || []).slice(),
                    layerIdx: (top.layerIdx === undefined) ? 0 : top.layerIdx,
                    parentPicked: top.parentPicked || null
                });
            }
            return seed;
        }
        // deep-root: rebuild the root items from scratch.
        var view = this._getViewByTitle(this.activeView);
        var rootItems = [];
        if (view) {
            try {
                rootItems = this._sortRowsForView(
                    this._buildRowsForView(view, { kind: "root" }),
                    view
                );
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] deep-root frontier build failed:",
                        err && err.message
                    );
                }
                return [];
            }
        } else {
            // Legacy entries-tag fallback (matches _recomputeStageBody).
            rootItems = this.sortEntries(this.loadEntries());
        }
        var rootSeed = [];
        for (var j = 0; j < rootItems.length; j++) {
            rootSeed.push({
                item: rootItems[j],
                path: [],
                viewTitle: this.activeView,
                parentPath: [],
                layerIdx: 0,
                parentPicked: null
            });
        }
        return rootSeed;
    };

    // Materialise an item's children using the same primitives the real
    // drill paths use (buildFilterStage + evaluateFilterStage for drills
    // with ca-next-scope / ca-items-from; _buildRowsForView for tree
    // containers). We DO NOT push onto this.stack — children are computed
    // into a throwaway shape and returned. parentPicked is the picked
    // item's title (so <<parent-picked>> resolves correctly when the
    // filter / items-from expression depends on the row being drilled).
    proto._deepComputeChildren = function (item, entry) {
        // Tree-container row → descend tree view at extended parentPath
        if (item._treeContainer && item._treeParent) {
            var view = this._getViewByTitle(entry.viewTitle || this.activeView);
            if (!view) return [];
            var basePath = (entry.parentPath || []).slice();
            basePath.push(item._treeParent);
            var layerIdx = (item._layerIdx !== undefined)
                ? item._layerIdx
                : entry.layerIdx;
            try {
                return this._sortRowsForView(
                    this._buildRowsForView(view, {
                        kind: "tree",
                        parentPath: basePath,
                        layerIdx: layerIdx
                    }),
                    view
                );
            } catch (err) {
                return [];
            }
        }
        // Filter-stage drill — ca-next-scope OR ca-items-from
        if (item.kind === "drill" && (item.nextScope || item.itemsFrom)) {
            try {
                var stage = this.buildFilterStage(item, entry.parentPicked || null);
                return this.evaluateFilterStage(stage);
            } catch (err) {
                return [];
            }
        }
        // Entity-type drills (action menus) and dynamic-item drills are
        // not walked in MVP — actions live in a separate cascade plane
        // and exposing every action of every entity in deep search would
        // overwhelm the result list. Author can mark a specific entry's
        // actions as searchable via ca-items-from / ca-next-scope wiring
        // if they want them in the walk.
        return [];
    };

    // Compute the context-shape a child will inherit. Mirrors the real
    // cascade's drillSelected → buildFilterStage chain:
    //  - tree-container drill: viewTitle + parentPath + layerIdx extend;
    //    parentPicked is null (tree stages don't carry it).
    //  - filter-stage drill: parentPicked propagates STICKY from the
    //    parent entry (NOT set to parentItem.title — the real cascade
    //    keeps parent-picked sticky across drill chains; only action-
    //    menu descents change it). viewTitle / parentPath / layerIdx
    //    clear (we've left the tree-view domain).
    // The deep walker doesn't descend into action menus in MVP, so the
    // parentPicked-rebinding-on-action-drill branch is unused here.
    proto._deepChildContext = function (parentItem, parentEntry) {
        if (parentItem._treeContainer && parentItem._treeParent) {
            var basePath = (parentEntry.parentPath || []).slice();
            basePath.push(parentItem._treeParent);
            return {
                viewTitle: parentEntry.viewTitle,
                parentPath: basePath,
                layerIdx: (parentItem._layerIdx !== undefined)
                    ? parentItem._layerIdx : parentEntry.layerIdx,
                parentPicked: parentEntry.parentPicked || null
            };
        }
        return {
            viewTitle: parentEntry.viewTitle,
            parentPath: [],
            layerIdx: 0,
            parentPicked: parentEntry.parentPicked || null
        };
    };

};
