/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-views
type: application/javascript
module-type: library

View subsystem — declarative root-stage strategies.

A view is a tiddler tagged `$:/tags/rimir/cascade-palette/view` that
produces root-stage rows by:
  - flat:  evaluate `ca-view-source`, then run each `ca-view-row-*`
           filter per source item; assemble cascade items
  - tree:  evaluate `ca-view-source`, build a tree via the chosen
           `ca-view-tree-strategy`, render the active branch

Views are loaded once per palette instance (cached); switching the
active view always pops the stage stack to root and rebuilds.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var VIEW_TAG = C.VIEW_TAG;
var ENTRY_TAG = C.ENTRY_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Discover all view tiddlers, parse fields, sort by ca-order. Cached.
    // Picks the active view (ca-view-default: yes wins; first by order
    // otherwise). Idempotent — calling twice is a no-op after first load.
    proto._loadViews = function () {
        if (this._viewsLoaded) return;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + VIEW_TAG + "]]"
        );
        var defaultTitle = null;
        var views = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var orderRaw = f["ca-order"];
            var order = orderRaw !== undefined && orderRaw !== ""
                ? parseFloat(orderRaw) : DEFAULT_ORDER;
            if (isNaN(order)) order = DEFAULT_ORDER;
            var view = {
                title: title,
                name: f["ca-view-name"] || title.split("/").pop(),
                hint: f["ca-view-hint"] || "",
                isDefault: (f["ca-view-default"] || "").toLowerCase() === "yes",
                source: f["ca-view-source"] || "",
                treeStrategy: (f["ca-view-tree-strategy"] || "").toLowerCase(),
                treeKey: f["ca-view-tree-key"] || "",
                rootTag: f["ca-view-root-tag"] || "",
                sort: (f["ca-view-sort"] || "alphabetical").toLowerCase(),
                sortField: f["ca-view-sort-field"] || "",
                sortKey: f["ca-view-sort-key"] || "",
                containersFirst:
                    (f["ca-view-containers-first"] || "yes").toLowerCase() !== "no",
                showCount:
                    (f["ca-view-show-count"] || "no").toLowerCase() === "yes",
                countFormat: f["ca-view-count-format"] || " (<<count>>)",
                rowName: f["ca-view-row-name"] || "",
                rowHint: f["ca-view-row-hint"] || "",
                rowIcon: f["ca-view-row-icon"] || "",
                rowKind: f["ca-view-row-kind"] || "",
                rowGroup: f["ca-view-row-group"] || "",
                rowOrder: f["ca-view-row-order"] || "",
                rowActions: f["ca-view-row-actions"] || "",
                rowNextScope: f["ca-view-row-next-scope"] || "",
                rowItemsFrom: f["ca-view-row-items-from"] || "",
                // Pick-mode: when `yes`, firing a leaf row pushes the
                // configured filter with the row's effective tree-path as
                // arg, then returns to the prior view. Used by the `>`
                // leader (see views/by-namespace-pick.tid).
                pickMode: (f["ca-view-pick-mode"] || "").toLowerCase() === "yes",
                pickEmitsFilter: f["ca-view-pick-emits-filter"] || "",
                // View-wide after-fire policy. Sets ca-after-fire on every
                // row built from this view (unless the row's source already
                // declares one). Lets a view say "all my rows keep the
                // palette open" without authors stamping each source tiddler.
                afterFire: (f["ca-view-after-fire"] || "").toLowerCase(),
                order: order
            };
            if (view.isDefault && !defaultTitle) defaultTitle = title;
            return view;
        });
        views.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this.views = views;
        this.activeView = defaultTitle ||
            (views.length ? views[0].title : null);
        this._viewsLoaded = true;
    };

    proto._getViewByTitle = function (title) {
        if (!title) return null;
        for (var i = 0; i < this.views.length; i++) {
            if (this.views[i].title === title) return this.views[i];
        }
        return null;
    };

    // Extract the basename of a view tiddler for ca-position-<slug>
    // resolution. e.g. `$:/plugins/.../views/by-namespace` → `by-namespace`.
    proto._slugForView = function (viewTitle) {
        if (!viewTitle) return "";
        return String(viewTitle).split("/").pop();
    };

    // Central row builder. Dispatches flat vs tree based on `treeStrategy`.
    // parentContext carries either `{kind: "root"}` (root stage) or
    // `{kind: "tree", parentPath}` (drilled tree stage).
    proto._buildRowsForView = function (view, parentContext) {
        if (!view) return [];
        if (view.treeStrategy) {
            return this._buildTreeRowsForView(view, parentContext || {});
        }
        return this._buildFlatRowsForView(view, parentContext || {});
    };

    // Flat view: evaluate ca-view-source, layer row-* filter results on
    // top of each source tiddler's fields, hand off to _buildCascadeItem.
    // The "start from source fields" approach means row-* are OVERRIDES —
    // fields not mentioned by the view fall through to the source's own
    // values (bind-tiddler, ca-confirm, etc.).
    //
    // Position fields (ca-position-<slug> on the source) apply too:
    //   `none`        → entry excluded from this view
    //   `at-root`     → no remap (sits in the default group bucket)
    //   anything else → ca-group reassigned to the first position string
    //                    (flat views don't support multi-placement; the
    //                    first position wins).
    proto._buildFlatRowsForView = function (view, parentContext) {
        if (!view.source) return [];
        var self = this;
        var slug = this._slugForView(view.title);
        var sources;
        try {
            sources = this.wiki.filterTiddlers(
                view.source + this._composeFilterSuffix()
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] view source filter error",
                    view.title, "—", err && err.message
                );
            }
            return [];
        }
        var rows = [];
        sources.forEach(function (sourceTitle) {
            if (!self.isEntryVisible(sourceTitle)) return;
            var sourceTid = self.wiki.getTiddler(sourceTitle);
            var srcFields = (sourceTid && sourceTid.fields) || {};
            var posRaw = srcFields["ca-position-" + slug] || srcFields["ca-position"];
            if (posRaw === "none") return;
            var fieldsObj = $tw.utils.extend({}, srcFields);
            self._applyRowFiltersToFields(view, sourceTitle, fieldsObj);
            if (posRaw && posRaw !== "at-root") {
                var firstPos = String(posRaw).split(/[:\n]/)[0].trim();
                if (firstPos && firstPos !== "at-root") {
                    fieldsObj["ca-group"] = firstPos;
                }
            }
            rows.push(self._buildCascadeItem(fieldsObj, sourceTitle));
        });
        return rows;
    };

    // Run each ca-view-row-* filter with <currentTiddler> bound to the
    // source item and overlay the result onto fieldsObj. ca-view-row-actions
    // is dual-mode: try filter eval first; if it throws or returns empty,
    // fall back to the raw value as a wikitext template (lets authors
    // declare a literal `<$action-navigate $to=<<currentTiddler>>/>` etc.
    // without `[[…]]` wrapping).
    proto._applyRowFiltersToFields = function (view, sourceTitle, fieldsObj) {
        var self = this;
        var filterMap = {
            "ca-name": view.rowName,
            "ca-hint": view.rowHint,
            "ca-icon": view.rowIcon,
            "ca-kind": view.rowKind,
            "ca-group": view.rowGroup,
            "ca-order": view.rowOrder,
            "ca-next-scope": view.rowNextScope,
            "ca-items-from": view.rowItemsFrom
        };
        Object.keys(filterMap).forEach(function (key) {
            var f = filterMap[key];
            if (!f) return;
            var r = [];
            try {
                r = self.wiki.filterTiddlers(
                    f, self.makeFakeWidget({ currentTiddler: sourceTitle })
                );
            } catch (err) { r = []; }
            if (r.length) fieldsObj[key] = r.join(" ");
        });
        if (view.rowActions) {
            var raw;
            try {
                var rr = self.wiki.filterTiddlers(
                    view.rowActions,
                    self.makeFakeWidget({ currentTiddler: sourceTitle })
                );
                if (rr.length) raw = rr.join(" ");
            } catch (err) { /* fall through to template */ }
            if (raw === undefined || raw === "") raw = view.rowActions;
            fieldsObj["ca-actions"] = raw;
        }
        // View-wide afterFire policy fills in where the row's source tiddler
        // didn't declare one. Source-tiddler value still wins.
        if (view.afterFire && !fieldsObj["ca-after-fire"]) {
            fieldsObj["ca-after-fire"] = view.afterFire;
        }
    };

    // Build the in-memory tree for a tree view. Each node is
    // `{ children: { seg → node }, leaves: [sourceTitle, …] }`. A source
    // tiddler lands at the child node named after its last path segment.
    // `path-segments` splits the title on `/`; `parent-tag` walks the
    // `tags[0]` ancestor chain; `custom-key` evaluates the view's
    // `ca-view-tree-key` filter per source.
    proto._buildTree = function (view) {
        var self = this;
        var sources;
        try {
            sources = this.wiki.filterTiddlers(
                view.source + this._composeFilterSuffix()
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] tree source filter error",
                    view.title, "—", err && err.message
                );
            }
            return { children: {}, leaves: [] };
        }
        var root = { children: {}, leaves: [], entries: [] };
        sources.forEach(function (title) {
            if (!self.isEntryVisible(title)) return;
            var path = self._pathForTreeSource(view, title);
            if (!path || !path.length) return;
            var node = root;
            for (var i = 0; i < path.length - 1; i++) {
                var seg = path[i];
                if (!seg) continue;
                if (!node.children[seg]) {
                    node.children[seg] = { children: {}, leaves: [], entries: [] };
                }
                node = node.children[seg];
            }
            var last = path[path.length - 1];
            if (!last) return;
            if (!node.children[last]) {
                node.children[last] = { children: {}, leaves: [], entries: [] };
            }
            node.children[last].leaves.push(title);
        });
        this._resolveEntryPositionsForView(view, root);
        return root;
    };

    // Walk every entry tiddler and attach it to the tree at the position
    // declared by `ca-position-<slug>` (view-specific) / `ca-position`
    // (fallback) / `at-root` (default). Multi-position values are split
    // on `:` and newlines. Missing intermediate path segments are
    // auto-created as synthetic container nodes — they drill normally but
    // have no source backing.
    //
    // Pick-mode views skip entry positioning entirely: entries don't
    // produce meaningful path segments for `pickEmitsFilter` (e.g. a
    // `prefix:$:/plugins/.../entries/save-wiki` filter is nonsense), and
    // their presence at-root would clutter the namespace tree the user
    // is trying to browse.
    proto._resolveEntryPositionsForView = function (view, tree) {
        if (view && view.pickMode) return;
        var slug = this._slugForView(view.title);
        var self = this;
        var entryTitles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ENTRY_TAG + "]]"
        );
        entryTitles.forEach(function (entryTitle) {
            if (!self.isEntryVisible(entryTitle)) return;
            var t = self.wiki.getTiddler(entryTitle);
            var f = (t && t.fields) || {};
            var posRaw = f["ca-position-" + slug];
            if (posRaw === undefined) posRaw = f["ca-position"];
            if (posRaw === undefined) posRaw = "at-root";
            if (posRaw === "none") return;
            var positions = String(posRaw).split(/[:\n]/).map(function (s) {
                return s.trim();
            }).filter(function (s) { return s; });
            if (!positions.length) positions = ["at-root"];
            positions.forEach(function (pos) {
                var node;
                if (pos === "at-root") {
                    node = tree;
                } else {
                    var segs = pos.split("/").filter(function (s) {
                        return s && s.length;
                    });
                    node = tree;
                    for (var i = 0; i < segs.length; i++) {
                        if (!node.children[segs[i]]) {
                            node.children[segs[i]] = {
                                children: {}, leaves: [], entries: [],
                                _synthetic: true
                            };
                        }
                        node = node.children[segs[i]];
                    }
                }
                if (!node.entries) node.entries = [];
                node.entries.push(entryTitle);
            });
        });
    };

    // Compute the path-segments list for one source tiddler under a view's
    // tree strategy. Returns [] for empty / cyclic walks; callers skip.
    proto._pathForTreeSource = function (view, sourceTitle) {
        if (view.treeStrategy === "path-segments") {
            return String(sourceTitle).split("/").filter(function (s) {
                return s && s.length;
            });
        }
        if (view.treeStrategy === "parent-tag") {
            return this._walkParentTagChain(sourceTitle, view.rootTag);
        }
        if (view.treeStrategy === "custom-key") {
            if (!view.treeKey) return [sourceTitle];
            try {
                var r = this.wiki.filterTiddlers(
                    view.treeKey,
                    this.makeFakeWidget({ currentTiddler: sourceTitle })
                );
                return r.filter(function (s) { return s && s.length; });
            } catch (err) { return [sourceTitle]; }
        }
        return [sourceTitle];
    };

    // Walk the tags[0] ancestor chain from a tiddler outward. Stops at the
    // rootTag (without including it) or on a tagless / cycled ancestor.
    // Returns the path root → leaf so callers can use last-segment as the
    // leaf display name.
    proto._walkParentTagChain = function (title, rootTag) {
        var path = [];
        var seen = Object.create(null);
        var current = title;
        while (current && !seen[current]) {
            seen[current] = true;
            path.unshift(current);
            var t = this.wiki.getTiddler(current);
            var tags = (t && t.fields && t.fields.tags) || [];
            if (!tags.length) break;
            var parent = tags[0];
            if (rootTag && parent === rootTag) break;
            current = parent;
        }
        return path;
    };

    // Build the result rows for the tree-stage at parentContext.parentPath.
    // Walks the tree to that depth, then for each child:
    //   - terminal (no grandchildren, one leaf) → leaf row using the source
    //   - container (has grandchildren or multiple leaves) → drill row
    //     with `_treeContainer: true` marker for drillSelected.
    // Self-leaves (sources landing on this exact path) appear above
    // children to keep the "files before folders" mental model.
    proto._buildTreeRowsForView = function (view, parentContext) {
        var tree = this._buildTree(view);
        var parentPath = (parentContext && parentContext.parentPath) || [];
        var node = tree;
        for (var i = 0; i < parentPath.length; i++) {
            node = node.children && node.children[parentPath[i]];
            if (!node) return [];
        }
        var self = this;
        var rows = [];
        // Positioned entries at this node — rendered with their full
        // entry-tiddler identity (kind / actions / bind / confirm etc.).
        (node.entries || []).forEach(function (entryTitle) {
            rows.push(self.readCascadeFields(entryTitle));
        });
        (node.leaves || []).forEach(function (sourceTitle) {
            var lastSeg = parentPath.length
                ? parentPath[parentPath.length - 1] : sourceTitle;
            rows.push(self._buildTreeLeafRow(view, sourceTitle, lastSeg));
        });
        Object.keys(node.children || {}).forEach(function (seg) {
            var child = node.children[seg];
            var childTreePath = parentPath.concat([seg]);
            var hasGrand = child.children && Object.keys(child.children).length > 0;
            var leafCount = (child.leaves || []).length;
            var entryCount = (child.entries || []).length;
            // Terminal-collapse only when the single thing is a NATURAL
            // leaf (source tiddler at this path). Positioned entries
            // never collapse — the user named that path explicitly, so
            // the structural intent overrides the "single thing inside"
            // heuristic. Same for synthetic intermediates with no real
            // content (defensive).
            if (!hasGrand && leafCount === 1 && entryCount === 0 && !child._synthetic) {
                rows.push(self._buildTreeLeafRow(view, child.leaves[0], seg));
            } else if (!hasGrand && leafCount + entryCount === 0) {
                // Empty container — drill into it anyway (rare; happens
                // when a tree-key returns a path that doesn't resolve).
                rows.push(self._buildTreeLeafRow(view, "", seg));
            } else {
                rows.push(self._buildTreeContainerRow(view, seg, childTreePath, child));
            }
        });
        return rows;
    };

    // Construct a leaf row for a tree view. The source tiddler's fields
    // feed the standard cascade-item building (so bind/confirm etc. work);
    // row-* filters layer on top; finally, the displayName overrides
    // ca-name when no row-name filter is set so containers display their
    // segment, not the full source title.
    proto._buildTreeLeafRow = function (view, sourceTitle, displayName) {
        var fieldsObj;
        if (sourceTitle) {
            var sourceTid = this.wiki.getTiddler(sourceTitle);
            fieldsObj = $tw.utils.extend({}, (sourceTid && sourceTid.fields) || {});
            this._applyRowFiltersToFields(view, sourceTitle, fieldsObj);
        } else {
            fieldsObj = {};
        }
        if (!view.rowName) fieldsObj["ca-name"] = displayName;
        if (!fieldsObj["ca-kind"]) fieldsObj["ca-kind"] = "leaf";
        return this._buildCascadeItem(fieldsObj, sourceTitle || "");
    };

    // Construct a container row — synthetic drill that pushes a tree-stage
    // when fired. Carries `_treeContainer` / `_treePath` / `_childCount`
    // so drillSelected and the count-badge renderer can find them.
    proto._buildTreeContainerRow = function (view, segment, treePath, node) {
        var childCount = Object.keys(node.children || {}).length +
            (node.leaves ? node.leaves.length : 0) +
            (node.entries ? node.entries.length : 0);
        var item = this._buildCascadeItem(
            { "ca-name": segment, "ca-kind": "drill" }, ""
        );
        item.isSynthetic = true;
        item._treeContainer = true;
        item._treePath = treePath;
        item._childCount = childCount;
        return item;
    };

    // Sort rows according to a view's declared sort policy. Supports
    // `alphabetical` (default), `natural` (numeric-aware), `by-field`
    // (reads `ca-view-sort-field` value off each row), and `custom`
    // (per-row filter from `ca-view-sort-key`). Containers-first is
    // layered as a stable post-sort when `ca-view-containers-first: yes`
    // on a tree view (default) — containers float above leaves at each
    // level without disturbing intra-class order.
    proto._sortRowsForView = function (rows, view) {
        if (!view || !rows || !rows.length) return rows;
        var self = this;
        var sortFn;
        if (view.sort === "by-field" && view.sortField) {
            var field = view.sortField;
            sortFn = function (a, b) {
                var av = self._sortFieldValueFor(a, field);
                var bv = self._sortFieldValueFor(b, field);
                var an = parseFloat(av), bn = parseFloat(bv);
                if (!isNaN(an) && !isNaN(bn) && av !== "" && bv !== "") {
                    return an - bn;
                }
                return String(av || "").localeCompare(String(bv || ""));
            };
        } else if (view.sort === "natural") {
            sortFn = function (a, b) {
                return String(a.name || "").localeCompare(
                    String(b.name || ""), undefined,
                    { numeric: true, sensitivity: "base" }
                );
            };
        } else if (view.sort === "custom" && view.sortKey) {
            sortFn = function (a, b) {
                var ak = self._evalSortKey(view.sortKey, a);
                var bk = self._evalSortKey(view.sortKey, b);
                return String(ak).localeCompare(String(bk));
            };
        } else {
            sortFn = function (a, b) {
                return String(a.name || "").localeCompare(String(b.name || ""));
            };
        }
        var sorted = rows.slice().sort(sortFn);
        if (view.treeStrategy && view.containersFirst) {
            // Tag each item with its pre-sort index so JS engines without
            // strictly-stable sort still preserve intra-class order.
            sorted.forEach(function (r, i) { r._sortIdx = i; });
            sorted.sort(function (a, b) {
                var ac = a._treeContainer ? 0 : 1;
                var bc = b._treeContainer ? 0 : 1;
                if (ac !== bc) return ac - bc;
                return a._sortIdx - b._sortIdx;
            });
        }
        return sorted;
    };

    // Read a row's value for a named field. Tries the item's backing
    // tiddler fields first (for view-built rows where the source carries
    // the field), then falls back to canonical item-record keys (ca-order
    // → .order, ca-name → .name) so by-field sort works on synthetic
    // tree containers too.
    proto._sortFieldValueFor = function (item, field) {
        if (item.title) {
            var t = this.wiki.getTiddler(item.title);
            var f = (t && t.fields) || {};
            if (f[field] !== undefined) return f[field];
        }
        if (field === "ca-order") return item.order;
        if (field === "ca-name") return item.name;
        return "";
    };

    proto._evalSortKey = function (filter, item) {
        try {
            var r = this.wiki.filterTiddlers(
                filter,
                this.makeFakeWidget({ currentTiddler: item.title || item.name || "" })
            );
            return r.length ? r[0] : "";
        } catch (err) { return ""; }
    };

    // Index of the currently-active view in the VISIBLE view list (or
    // -1 if not present — happens when the active view is a hidden
    // pick-mode view). Used by view-strip focus initialisation.
    proto._indexOfActiveView = function () {
        if (!this.activeView) return -1;
        var visible = this._visibleViews();
        for (var i = 0; i < visible.length; i++) {
            if (visible[i].title === this.activeView) return i;
        }
        return -1;
    };

    // Visible views = all views EXCEPT pick-mode ones (those are only
    // activated via leader actions; surfacing them as clickable pills
    // would let the user enter a half-modal state without a return target).
    proto._visibleViews = function () {
        return (this.views || []).filter(function (v) { return !v.pickMode; });
    };

    // (Re)render the view-strip pill row. Hidden via `rcp-has-views` on
    // the popup when fewer than two views are declared. The active view
    // is marked with `rcp-view-pill-active`; the keyboard-focused pill
    // (only meaningful while focus === "view") is marked with
    // `rcp-view-pill-focused`.
    proto._renderViewStrip = function () {
        if (!this.viewStripEl) return;
        while (this.viewStripEl.firstChild) {
            this.viewStripEl.removeChild(this.viewStripEl.firstChild);
        }
        var visible = this._visibleViews();
        var hasMultiple = visible.length >= 2;
        if (this.popupEl) {
            this.popupEl.classList.toggle("rcp-has-views", hasMultiple);
        }
        if (!hasMultiple) return;
        var self = this;
        visible.forEach(function (view, i) {
            var pillEl = self.document.createElement("span");
            var cls = "rcp-view-pill";
            if (view.title === self.activeView) cls += " rcp-view-pill-active";
            if (self.focus === "view" && i === self.viewFocusIdx) {
                cls += " rcp-view-pill-focused";
            }
            pillEl.className = cls;
            pillEl.textContent = view.name;
            if (view.hint) pillEl.title = view.hint;
            pillEl.dataset.viewIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.viewFocusIdx = i;
                self._setActiveView(view.title);
            });
            self.viewStripEl.appendChild(pillEl);
        });
    };

    // Render the focused view's hint into the details pane. Mirrors
    // _maybeRenderFilterHelp / _maybeRenderVisibilityHelp.
    proto._maybeRenderViewHelp = function () {
        if (this.focus !== "view") return;
        if (!this.views.length) return;
        var view = this.views[this.viewFocusIdx];
        if (!view) return;
        while (this.previewEl.firstChild) {
            this.previewEl.removeChild(this.previewEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-preview-title";
        titleEl.textContent = view.name +
            (view.title === this.activeView ? " (active)" : "");
        this.previewEl.appendChild(titleEl);
        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = view.hint || view.name;
        this.previewEl.appendChild(helpEl);
        // Surface the view's source filter and strategy for author debug.
        var rows = [];
        if (view.source) rows.push(["Source", view.source]);
        if (view.treeStrategy) rows.push(["Tree strategy", view.treeStrategy]);
        if (view.rootTag) rows.push(["Root tag", view.rootTag]);
        rows.push(["View tiddler", view.title]);
        if (rows.length) {
            var dl = this.document.createElement("dl");
            dl.className = "rcp-preview-fields";
            rows.forEach(function (row) {
                var dt = this.document.createElement("dt");
                dt.textContent = row[0];
                var dd = this.document.createElement("dd");
                dd.textContent = row[1];
                dl.appendChild(dt);
                dl.appendChild(dd);
            }, this);
            this.previewEl.appendChild(dl);
        }
        this.popupEl.classList.add("rcp-previewing");
    };

    // Activate the named view. Pops the stage stack to root and rebuilds.
    // Cleared selection state lands the user back at top-of-menu. Focus
    // returns to the input (the user's expected next interaction).
    //
    // Pick-mode awareness: when activating a pick-mode view, the prior
    // view is remembered in `_pickModeReturnTo` so a row pick can return.
    // When activating a non-pick view, that memory is cleared.
    proto._setActiveView = function (viewTitle) {
        var view = this._getViewByTitle(viewTitle);
        if (!view) return;
        var prev = this.activeView;
        var prevView = this._getViewByTitle(prev);
        if (view.pickMode) {
            // Only set return-target when entering pick-mode from a
            // non-pick view; chained pick-modes are rare and confusing.
            if (!prevView || !prevView.pickMode) {
                this._pickModeReturnTo = prev || null;
            }
        } else {
            this._pickModeReturnTo = null;
        }
        this.activeView = viewTitle;
        this.stack = [this.buildRootStage()];
        this.recomputeStage(this.topStage());
        this._renderViewStrip();
        this.renderStage();
        // Flash the newly-active pill when the switch was leader-triggered.
        if (this._leaderFiring) this._flashActiveViewPill();
        this.setFocus("input");
    };

};
