/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-views
type: application/javascript
module-type: library

View subsystem — composable structure layers.

A view is a tiddler tagged `$:/tags/rimir/cascade-palette/view`. Its
structure is a composition of one or more ''layers'' that each emit
rows at each descent node. Two authoring shapes:

  Implicit single layer (back-compat)
    The view declares structure fields directly: `ca-view-roots`,
    `ca-view-children`, `ca-view-leaf`, `ca-view-label`,
    `ca-view-row-*`. The engine wraps these into one layer.

  Explicit multi-layer
    The view declares `ca-view-layers` — a space-separated list of
    layer tiddler titles. Each layer tiddler tagged
    `$:/tags/rimir/cascade-palette/structure-layer` carries its own
    `ca-layer-roots`, `ca-layer-children`, `ca-layer-row-*`,
    `ca-layer-row-entity-type`, etc.

A layer is the unit of "(roots, children) + row decorations". When
descending into a node, the engine evaluates each layer in order and
concatenates the rows. Each row carries `_layerIdx` so subsequent
tree-stage drills walk the same layer's children.

The plugin also auto-appends a built-in synthetic ''entries'' layer
to tree views (positioned-entry placement via `ca-position`). The
view can opt out via `ca-view-include-entries: no`.

Entity-type drilling: a layer can declare `ca-layer-row-entity-type`
(filter evaluated per row). Right-arrow on a leaf row whose layer
yields a non-empty entity type opens the action-menu stage for that
type.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var cpAxes = require("$:/plugins/rimir/cascade-palette/widgets/cp-axes");
var VIEW_TAG = C.VIEW_TAG;
var STRUCTURE_LAYER_TAG = C.STRUCTURE_LAYER_TAG;
var ENTRY_TAG = C.ENTRY_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

// Title for the synthetic entries layer surfaced in the Structure pill
// row. Pseudo-title — no backing tiddler is required; the JS impl lives
// in this module. A read-only descriptor tiddler with the same title is
// shipped so authors can click through and see what the layer does.
var BUILTIN_ENTRIES_LAYER_TITLE =
    "$:/plugins/rimir/cascade-palette/structure-layers/entries";

module.exports = function (proto) {

    // ===================================================================
    // Loading
    // ===================================================================

    proto._loadViews = function () {
        if (this._viewsLoaded) return;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + VIEW_TAG + "]]"
        );
        var defaultTitle = null;
        var views = titles.map(function (title) {
            var view = self._loadView(title);
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

    // Build a single view descriptor + its layer list.
    proto._loadView = function (title) {
        var t = this.wiki.getTiddler(title);
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
            sort: (f["ca-view-sort"] || "alphabetical").toLowerCase(),
            sortField: f["ca-view-sort-field"] || "",
            sortKey: f["ca-view-sort-key"] || "",
            containersFirst:
                (f["ca-view-containers-first"] || "yes").toLowerCase() !== "no",
            showCount:
                (f["ca-view-show-count"] || "no").toLowerCase() === "yes",
            countFormat: f["ca-view-count-format"] || " (<<count>>)",
            showActionPreview:
                (f["ca-view-show-action-preview"] || "yes").toLowerCase() !== "no",
            pickMode: (f["ca-view-pick-mode"] || "").toLowerCase() === "yes",
            pickEmitsFilter: f["ca-view-pick-emits-filter"] || "",
            afterFire: (f["ca-view-after-fire"] || "").toLowerCase(),
            includeEntries: (f["ca-view-include-entries"] || "auto").toLowerCase(),
            grouping:
                (f["ca-view-grouping"] || "yes").toLowerCase() !== "no",
            order: order,
            layers: []
        };
        // Layers: explicit via ca-view-layers, or implicit single-layer
        // adapted from the view's own structure fields.
        var explicit = (f["ca-view-layers"] || "").trim();
        if (explicit) {
            var layerTitles = explicit.split(/\s+/).filter(function (s) { return s; });
            for (var i = 0; i < layerTitles.length; i++) {
                var layer = this._loadLayer(layerTitles[i]);
                if (layer) view.layers.push(layer);
            }
        } else {
            view.layers.push(this._layerFromViewFields(view, f));
        }
        // Built-in entries layer: auto-append depending on include-entries
        // policy.
        if (this._shouldIncludeEntriesLayer(view)) {
            view.layers.push(this._builtInEntriesLayer());
        }
        // Convenience flag — any layer declares children ⇒ view is tree-shaped.
        view.isTree = view.layers.some(function (l) { return !!l.children; });
        return view;
    };

    // Wrap a view's own structure fields into a single implicit layer.
    // Keeps every 0.0.37 author shape working without edits. Implicit-
    // layer name defaults to the view name so multi-layer views get a
    // sensible section header for the structural rows (vs the entries
    // layer's rows).
    proto._layerFromViewFields = function (view, f) {
        var rootsFilter = f["ca-view-roots"] || f["ca-view-source"] || "";
        return {
            title: view.title,
            isImplicit: true,
            isBuiltIn: false,
            name: f["ca-view-layer-name"] || view.name || "",
            roots: rootsFilter,
            children: f["ca-view-children"] || "",
            leaf: f["ca-view-leaf"] || "",
            label: f["ca-view-label"] || "",
            axes: f["ca-view-axes"] || "",
            rowName: f["ca-view-row-name"] || "",
            rowHint: f["ca-view-row-hint"] || "",
            rowIcon: f["ca-view-row-icon"] || "",
            rowKind: f["ca-view-row-kind"] || "",
            rowGroup: f["ca-view-row-group"] || "",
            rowOrder: f["ca-view-row-order"] || "",
            rowActions: f["ca-view-row-actions"] || "",
            rowEntityType: f["ca-view-row-entity-type"] || "",
            rowNextScope: f["ca-view-row-next-scope"] || "",
            rowItemsFrom: f["ca-view-row-items-from"] || "",
            includePosition: true
        };
    };

    proto._loadLayer = function (title) {
        var t = this.wiki.getTiddler(title);
        if (!t) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] structure-layer not found:", title
                );
            }
            return null;
        }
        var f = t.fields || {};
        return {
            title: title,
            isImplicit: false,
            isBuiltIn: false,
            name: f["ca-layer-name"] || title.split("/").pop(),
            roots: f["ca-layer-roots"] || "",
            children: f["ca-layer-children"] || "",
            leaf: f["ca-layer-leaf"] || "",
            label: f["ca-layer-label"] || "",
            axes: f["ca-layer-axes"] || "",
            rowName: f["ca-layer-row-name"] || "",
            rowHint: f["ca-layer-row-hint"] || "",
            rowIcon: f["ca-layer-row-icon"] || "",
            rowKind: f["ca-layer-row-kind"] || "",
            rowGroup: f["ca-layer-row-group"] || "",
            rowOrder: f["ca-layer-row-order"] || "",
            rowActions: f["ca-layer-row-actions"] || "",
            rowEntityType: f["ca-layer-row-entity-type"] || "",
            rowNextScope: f["ca-layer-row-next-scope"] || "",
            rowItemsFrom: f["ca-layer-row-items-from"] || "",
            includePosition:
                (f["ca-layer-include-position"] || "yes").toLowerCase() !== "no"
        };
    };

    // Synthetic descriptor for the built-in entries layer. The actual
    // descent for this layer is handled by `_resolveEntryPositionsForView`
    // — for the layer evaluator the `_builtIn: "entries"` marker is the
    // dispatch hint. Filter strings here are illustrative (shown in the
    // Structure pill row); they aren't evaluated directly.
    proto._builtInEntriesLayer = function () {
        return {
            title: BUILTIN_ENTRIES_LAYER_TITLE,
            isImplicit: false,
            isBuiltIn: true,
            builtInKind: "entries",
            name: "Entries",
            roots: "[tag[" + ENTRY_TAG + "]] :filter[get[ca-position]match[at-root]]",
            children: "[tag[" + ENTRY_TAG + "]] :filter[get[ca-position]match<currentTiddler>]",
            leaf: "",
            label: "",
            rowName: "",
            rowHint: "",
            rowIcon: "",
            rowKind: "",
            rowGroup: "",
            rowOrder: "",
            rowActions: "",
            rowEntityType: "",
            rowNextScope: "",
            rowItemsFrom: "",
            includePosition: false
        };
    };

    // include-entries policy:
    //   "yes"  — always include
    //   "no"   — never include
    //   "auto" — include for tree views (≥1 layer has `children`), skip flat
    proto._shouldIncludeEntriesLayer = function (view) {
        var mode = view.includeEntries;
        if (mode === "yes") return true;
        if (mode === "no") return false;
        // auto: only when at least one declared layer is tree-shaped.
        return view.layers.some(function (l) { return !!l.children; });
    };

    proto._getViewByTitle = function (title) {
        if (!title) return null;
        for (var i = 0; i < this.views.length; i++) {
            if (this.views[i].title === title) return this.views[i];
        }
        return null;
    };

    proto._slugForView = function (viewTitle) {
        if (!viewTitle) return "";
        return String(viewTitle).split("/").pop();
    };

    // ===================================================================
    // Descent
    // ===================================================================

    // Single entry point.
    //   { kind: "root" }                       — descending from root
    //   { kind: "tree", parentPath: [...] }    — descending into a sub-node
    proto._buildRowsForView = function (view, parentContext) {
        if (!view) return [];
        var parentPath = (parentContext && parentContext.parentPath) || [];
        var parentTitle = parentPath.length
            ? parentPath[parentPath.length - 1] : "";
        // Tree-stage may pin to a specific layer (the one whose container
        // we drilled into) — only that layer contributes children. Root
        // stage evaluates every layer.
        var layerIdx = (parentContext && parentContext.layerIdx !== undefined)
            ? parentContext.layerIdx : null;
        return this._buildNodeForView(view, parentTitle, layerIdx, parentPath);
    };

    proto._buildNodeForView = function (view, parentTitle, pinnedLayerIdx, parentPath) {
        var rows = [];
        for (var i = 0; i < view.layers.length; i++) {
            if (pinnedLayerIdx !== null && pinnedLayerIdx !== undefined &&
                pinnedLayerIdx !== i) {
                continue;
            }
            var layerRows = this._evaluateLayer(
                view, view.layers[i], i, parentTitle, parentPath || []
            );
            rows = rows.concat(layerRows);
        }
        return rows;
    };

    // Evaluate a single layer at a given node, returning its rows.
    // Dispatches built-in layers (entries) to their dedicated path.
    proto._evaluateLayer = function (view, layer, layerIdx, parentTitle, parentPath) {
        if (layer.isBuiltIn && layer.builtInKind === "entries") {
            return this._evaluateEntriesLayer(view, layerIdx, parentTitle);
        }
        var self = this;
        parentPath = parentPath || [];
        var candidates = null;
        // Axis chain: when the layer declares axes and we're still within
        // the chain, emit synthetic bucket rows. When the chain is exactly
        // exhausted (depth === chain.length), enumerate the narrowed
        // source set so the layer's roots/children logic takes over at the
        // next drill. Past that depth, parentTitle is a real tiddler and
        // we fall through to the standard recursive path.
        if (layer.axes) {
            var chain = cpAxes.activeChain(this.wiki, layer);
            if (chain.length) {
                var axisDepth = cpAxes.depthIntoChain(parentPath, chain.length);
                if (axisDepth < chain.length) {
                    var buckets = cpAxes.evaluateAxisChainAtDepth(
                        this, layer, parentPath
                    );
                    return this._buildAxisBucketRows(
                        view, layer, layerIdx, buckets || [], chain[axisDepth]
                    );
                }
                if (axisDepth === chain.length) {
                    candidates = cpAxes.sourceAfterAxes(this, layer, parentPath);
                }
            }
        }
        if (candidates === null) {
            var filterExpr = parentTitle ? layer.children : layer.roots;
            var widget = parentTitle
                ? this.makeFakeWidget({ currentTiddler: parentTitle })
                : null;
            candidates = [];
            if (filterExpr) {
                try {
                    candidates = this.wiki.filterTiddlers(
                        filterExpr + this._composeFilterSuffix(),
                        widget
                    );
                } catch (err) {
                    if (console && console.error) {
                        console.error(
                            "[cascade-palette] layer filter error",
                            view.title, "/", layer.title || ("layer#" + layerIdx),
                            parentTitle ? ("children of " + parentTitle) : "roots",
                            "—", err && err.message
                        );
                    }
                }
            }
        }
        var slug = this._slugForView(view.title);
        var rows = [];
        candidates.forEach(function (title) {
            if (!self.isEntryVisible(title)) return;
            if (title === parentTitle) return;
            var srcTid = self.wiki.getTiddler(title);
            var srcFields = (srcTid && srcTid.fields) || {};
            // Position-field exclusion applies to layers that opt in
            // (default yes). Skips when the layer itself is the positioned-
            // entry layer (which has includePosition=false to avoid double-
            // filtering its own entries).
            if (layer.includePosition) {
                var posRaw = srcFields["ca-position-" + slug];
                if (posRaw === undefined) posRaw = srcFields["ca-position"];
                if (posRaw === "none") return;
            }
            var fieldsObj = $tw.utils.extend({}, srcFields);
            self._applyLayerRowFilters(layer, title, fieldsObj);
            if (!fieldsObj["ca-name"]) {
                var label = self._labelForNode(layer, title);
                if (label) fieldsObj["ca-name"] = label;
            }
            // Default ca-group to the layer name so result-list grouping
            // naturally clusters per layer (unless the row overrode it).
            // For implicit layers (single-layer back-compat views): kick
            // in only when the view has ≥2 layers, otherwise we'd clobber
            // plugin-source grouping in views like Entries.
            if (!fieldsObj["ca-group"] && layer.name) {
                var setLayerGroup =
                    !layer.isImplicit || view.layers.length >= 2;
                if (setLayerGroup) {
                    fieldsObj["ca-group"] = layer.name;
                }
            }
            var isLeaf = self._isLeafInLayer(layer, title);
            if (!fieldsObj["ca-kind"]) {
                fieldsObj["ca-kind"] = isLeaf ? "leaf" : "drill";
            }
            var item = self._buildCascadeItem(fieldsObj, title);
            item._layerIdx = layerIdx;
            // When `ca-actions` was synthesised from this layer's
            // `ca-(view|layer)-row-actions` template (rather than from
            // the row's own tiddler), mark it as "fire on Enter only".
            // drillSelected reads this flag to skip its drill-preflight
            // action-fire — Right-arrow on a tree container should be
            // purely structural (descend into children), not fire the
            // template's $action-navigate as a side-effect.
            if (layer.rowActions) {
                item._actionsFromRowTemplate = true;
            }
            // Entity-type per layer — used by drillSelected to push an
            // action-menu stage on Right-arrow.
            if (layer.rowEntityType) {
                var et = self._evalRowEntityType(layer, title);
                if (et) item.entityType = et;
            }
            // Pure tree container: drill descends into children via this
            // same layer. Author opt-out via ca-next-scope / ca-items-from.
            if (!isLeaf && item.kind === "drill" &&
                !item.nextScope && !item.itemsFrom) {
                item._treeContainer = true;
                item._treeParent = title;
                item._childCount = self._childCountForLayer(layer, title);
            }
            rows.push(item);
        });
        return rows;
    };

    // Built-in entries layer evaluator. Implements positioned-entry
    // placement (ca-position-<slug> / ca-position / default at-root) but
    // packaged as a layer so it's visible in the Structure pill row.
    proto._evaluateEntriesLayer = function (view, layerIdx, parentTitle) {
        if (view.pickMode) return [];
        var slug = this._slugForView(view.title);
        var self = this;
        var entryTitles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + ENTRY_TAG + "]]"
        );
        var rows = [];
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
            var matched = false;
            positions.forEach(function (pos) {
                if (matched) return;
                if (pos === "at-root" && parentTitle === "") matched = true;
                else if (pos === parentTitle) matched = true;
            });
            if (matched) {
                var item = self.readCascadeFields(entryTitle);
                item._layerIdx = layerIdx;
                // The entries layer's section header in multi-layer
                // grouping. readCascadeFields already resolved the row's
                // ca-group from the entry tiddler's fields / plugin source
                // — only override when the entry itself didn't specify one.
                if (!item.group) item.group = "Entries";
                rows.push(item);
            }
        });
        return rows;
    };

    // Build cascade-item rows for axis buckets emitted by cp-axes. Each
    // bucket is a synthetic drill container: drilling appends the bucket
    // key to parentPath via _treeParent, and the next stage re-enters the
    // axis logic at depth+1 (or transitions to layer.roots/children once
    // the chain is exhausted).
    proto._buildAxisBucketRows = function (view, layer, layerIdx, buckets, axis) {
        var self = this;
        var setLayerGroup = !layer.isImplicit || view.layers.length >= 2;
        return buckets.map(function (b) {
            var hintParts = [];
            if (axis) hintParts.push(axis.name);
            if (b.count !== undefined) {
                hintParts.push(b.count + (b.count === 1 ? " entry" : " entries"));
            }
            var fieldsObj = {
                "ca-name": b._bucketLabel,
                "ca-kind": "drill",
                "ca-icon": b._bucketIcon || "",
                "ca-hint": hintParts.join(" · ")
            };
            if (setLayerGroup && layer.name) fieldsObj["ca-group"] = layer.name;
            var item = self._buildCascadeItem(fieldsObj, "");
            item._layerIdx = layerIdx;
            item._treeContainer = true;
            item._treeParent = b._bucketKey;
            item._childCount = b.count;
            item._isAxisBucket = true;
            item._axisTitle = b._axisTitle;
            item._axisDepth = b._axisDepth;
            item._bucketKey = b._bucketKey;
            item._bucketLabel = b._bucketLabel;
            item.isSynthetic = true;
            return item;
        });
    };

    // ---- per-row computations -------------------------------------------

    proto._isLeafInLayer = function (layer, candidateTitle) {
        if (layer.leaf) {
            try {
                var r = this.wiki.filterTiddlers(
                    layer.leaf,
                    this.makeFakeWidget({ currentTiddler: candidateTitle })
                );
                return r.length > 0;
            } catch (err) { return true; }
        }
        if (!layer.children) return true;
        try {
            var children = this.wiki.filterTiddlers(
                layer.children,
                this.makeFakeWidget({ currentTiddler: candidateTitle })
            );
            var self = this;
            return children.filter(function (t) {
                return self.isEntryVisible(t);
            }).length === 0;
        } catch (err) { return true; }
    };

    proto._childCountForLayer = function (layer, parentTitle) {
        if (!layer.children) return 0;
        try {
            var r = this.wiki.filterTiddlers(
                layer.children,
                this.makeFakeWidget({ currentTiddler: parentTitle })
            );
            var self = this;
            return r.filter(function (t) {
                return self.isEntryVisible(t);
            }).length;
        } catch (err) { return 0; }
    };

    proto._labelForNode = function (layer, title) {
        if (layer.label) {
            try {
                var r = this.wiki.filterTiddlers(
                    layer.label,
                    this.makeFakeWidget({ currentTiddler: title })
                );
                if (r.length && r[0]) return r[0];
            } catch (err) { /* fall through */ }
        }
        var t = this.wiki.getTiddler(title);
        var caption = t && t.fields && t.fields.caption;
        if (caption) return String(caption);
        if (title.indexOf("/") >= 0) {
            var seg = title.split("/").pop();
            if (seg) return seg;
        }
        return title;
    };

    proto._evalRowEntityType = function (layer, title) {
        try {
            var r = this.wiki.filterTiddlers(
                layer.rowEntityType,
                this.makeFakeWidget({ currentTiddler: title })
            );
            return r.length ? r[0] : "";
        } catch (err) { return ""; }
    };

    // Per-row field overrides (ca-layer-row-* / ca-view-row-*). Same
    // dual-mode handling for row-actions as the 0.0.37 implementation.
    proto._applyLayerRowFilters = function (layer, sourceTitle, fieldsObj) {
        var self = this;
        var filterMap = {
            "ca-name": layer.rowName,
            "ca-hint": layer.rowHint,
            "ca-icon": layer.rowIcon,
            "ca-kind": layer.rowKind,
            "ca-group": layer.rowGroup,
            "ca-order": layer.rowOrder,
            "ca-next-scope": layer.rowNextScope,
            "ca-items-from": layer.rowItemsFrom
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
        if (layer.rowActions) {
            var raw;
            try {
                var rr = self.wiki.filterTiddlers(
                    layer.rowActions,
                    self.makeFakeWidget({ currentTiddler: sourceTitle })
                );
                if (rr.length) raw = rr.join(" ");
            } catch (err) { /* fall through */ }
            if (raw === undefined || raw === "") raw = layer.rowActions;
            fieldsObj["ca-actions"] = raw;
        }
    };

    // ===================================================================
    // Sorting (view-scoped — uniform across layers)
    // ===================================================================

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
        if (view.isTree && view.containersFirst) {
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

    // ===================================================================
    // View-strip rendering
    // ===================================================================

    proto._indexOfActiveView = function () {
        if (!this.activeView) return -1;
        var visible = this._visibleViews();
        for (var i = 0; i < visible.length; i++) {
            if (visible[i].title === this.activeView) return i;
        }
        return -1;
    };

    proto._visibleViews = function () {
        return (this.views || []).filter(function (v) { return !v.pickMode; });
    };

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
        if (!hasMultiple) {
            this._renderViewConfigStrip();
            return;
        }
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
        this._renderViewConfigStrip();
    };

    // ===================================================================
    // View-config strip — stacked, one mini-row per layer
    // ===================================================================

    proto._hasViewConfigToShow = function () {
        var view = this._getViewByTitle(this.activeView);
        if (!view || !view.layers || !view.layers.length) return false;
        // At minimum the strip shows the view header (with layer count
        // and any view-scoped pills) so anything with layers qualifies.
        return true;
    };

    proto._renderViewConfigStrip = function () {
        if (!this.viewConfigStripEl) return;
        while (this.viewConfigStripEl.firstChild) {
            this.viewConfigStripEl.removeChild(this.viewConfigStripEl.firstChild);
        }
        // Reset the flat pill list — rebuilt by whichever branch renders.
        this._viewConfigPillList = [];
        var view = this._getViewByTitle(this.activeView);
        if (!view || !view.layers || !view.layers.length) {
            if (this.popupEl) {
                this.popupEl.classList.remove("rcp-has-view-config");
            }
            return;
        }
        var focused = this.focus === "viewconfig";
        var expanded = focused && this.viewConfigExpanded;
        this.viewConfigStripEl.classList.toggle(
            "rcp-view-config-strip-focused", focused
        );
        this.viewConfigStripEl.classList.toggle(
            "rcp-view-config-strip-compact", !expanded
        );
        if (expanded) {
            this._renderViewConfigExpanded(view);
        } else {
            this._renderViewConfigCompact(view);
        }
        if (this.popupEl) {
            this.popupEl.classList.toggle(
                "rcp-has-view-config",
                this.viewConfigStripEl.firstChild !== null
            );
        }
    };

    // Compact mode: single summary row with view name, layer count, and
    // any view-scoped pills (sort, entries, grouping). Pills here are
    // informational only — not individually focusable.
    proto._renderViewConfigCompact = function (view) {
        var rowEl = this.document.createElement("div");
        rowEl.className = "rcp-view-config-row rcp-view-config-row-compact";
        // No row label: the CSS ::before "Structure" header on the strip
        // already names the section, and a second "structure" tag would
        // be redundant noise.
        var pills = [];
        pills.push({
            kind: "summary",
            label: "view",
            value: view.name,
            help: "Active view: " + view.name +
                (view.hint ? "\n\n" + view.hint : "")
        });
        var layerNames = view.layers.map(function (l, i) {
            return l.name || (l.isImplicit ? "(implicit)" : ("layer " + (i + 1)));
        }).join(" + ");
        pills.push({
            kind: "summary-layers",
            label: view.layers.length + " layer" +
                (view.layers.length === 1 ? "" : "s"),
            value: layerNames,
            help: "View composition: " + layerNames +
                "\n\nPress ↵ / Space / → to expand and inspect each layer."
        });
        this._viewScopedPills(view).forEach(function (p) {
            pills.push(p);
        });
        var self = this;
        pills.forEach(function (p) {
            rowEl.appendChild(self._buildConfigPill(p));
        });
        this.viewConfigStripEl.appendChild(rowEl);
        // Compact mode has no individually-focused pill — the whole strip
        // is the focus target. Pill list is left empty.
    };

    // Expanded mode: view-scoped header row + one mini-row per layer,
    // each pill individually focusable for help rendering.
    proto._renderViewConfigExpanded = function (view) {
        var self = this;
        var pillList = [];
        var headerPills = this._viewScopedPills(view);
        if (headerPills.length) {
            var headerRow = this.document.createElement("div");
            headerRow.className = "rcp-view-config-row rcp-view-config-row-view";
            this._appendConfigRowLabel(headerRow, "view");
            headerPills.forEach(function (p) {
                var el = self._buildConfigPill(p);
                pillList.push({ pill: p, el: el });
                headerRow.appendChild(el);
            });
            this.viewConfigStripEl.appendChild(headerRow);
        }
        view.layers.forEach(function (layer, i) {
            var pills = self._layerPills(layer);
            if (!pills.length) return;
            var rowEl = self.document.createElement("div");
            var cls = "rcp-view-config-row rcp-view-config-row-layer";
            if (layer.isBuiltIn) cls += " rcp-view-config-row-builtin";
            if (layer.isImplicit) cls += " rcp-view-config-row-implicit";
            rowEl.className = cls;
            self._appendConfigRowLabel(rowEl, layer.name || ("layer " + (i + 1)));
            pills.forEach(function (p) {
                // Annotate with the owning layer so help can name it.
                p._layerName = layer.name || ("layer " + (i + 1));
                var el = self._buildConfigPill(p);
                pillList.push({ pill: p, el: el });
                rowEl.appendChild(el);
            });
            self.viewConfigStripEl.appendChild(rowEl);
        });
        // Clamp focus index into the rebuilt list and highlight.
        if (this.viewConfigFocusIdx >= pillList.length) {
            this.viewConfigFocusIdx = Math.max(0, pillList.length - 1);
        }
        var focusedPillEl = null;
        for (var i = 0; i < pillList.length; i++) {
            if (i === this.viewConfigFocusIdx) {
                pillList[i].el.classList.add("rcp-view-config-pill-focused");
                focusedPillEl = pillList[i].el;
            }
        }
        // Each per-layer row scrolls horizontally on overflow (long
        // filter expressions can blow past the popup width). Scroll the
        // focused pill into view in its own row — defer one frame so
        // the just-appended DOM has layout.
        if (focusedPillEl && this.focus === "viewconfig") {
            var target = focusedPillEl;
            setTimeout(function () {
                try {
                    target.scrollIntoView({ inline: "nearest", block: "nearest" });
                } catch (err) { /* older browsers */ }
            }, 0);
        }
        // Make pill clicks focus that pill (mirrors other strips).
        pillList.forEach(function (entry, idx) {
            entry.el.addEventListener("mousedown", function (e) {
                if (self.focus !== "viewconfig") return;
                e.preventDefault();
                self.viewConfigFocusIdx = idx;
                self._renderViewConfigStrip();
                self._maybeRenderViewConfigHelp();
            });
        });
        this._viewConfigPillList = pillList;
    };

    // The pill spec currently under focus (or null when the strip is
    // unfocused / empty). Used by keyboard handlers to dispatch on pill
    // kind (axis pills get Backspace / Shift-←→ / Enter, etc.).
    proto._currentViewConfigPill = function () {
        var list = this._viewConfigPillList || [];
        var idx = this.viewConfigFocusIdx;
        if (idx < 0 || idx >= list.length) return null;
        return list[idx] && list[idx].pill;
    };

    // 2D pill navigation: build a row-by-row index of the flat pill list
    // so left/right walks within a row and up/down walks across rows.
    proto._viewConfigGrid = function () {
        var list = this._viewConfigPillList || [];
        var rows = [];
        var current = [];
        var lastParent = null;
        list.forEach(function (entry, idx) {
            var parent = entry.el && entry.el.parentNode;
            if (parent !== lastParent && current.length) {
                rows.push(current);
                current = [];
            }
            current.push(idx);
            lastParent = parent;
        });
        if (current.length) rows.push(current);
        return rows;
    };

    proto._viewConfigAtTopRow = function () {
        var rows = this._viewConfigGrid();
        if (!rows.length) return true;
        return rows[0].indexOf(this.viewConfigFocusIdx) >= 0;
    };

    proto._viewConfigAtBottomRow = function () {
        var rows = this._viewConfigGrid();
        if (!rows.length) return true;
        return rows[rows.length - 1].indexOf(this.viewConfigFocusIdx) >= 0;
    };

    proto._viewConfigMove = function (direction) {
        var list = this._viewConfigPillList || [];
        if (!list.length) return;
        var rows = this._viewConfigGrid();
        if (!rows.length) return;
        var idx = this.viewConfigFocusIdx;
        var rowIdx = 0, colIdx = 0;
        for (var r = 0; r < rows.length; r++) {
            var c = rows[r].indexOf(idx);
            if (c >= 0) { rowIdx = r; colIdx = c; break; }
        }
        if (direction === "left") {
            colIdx = Math.max(0, colIdx - 1);
        } else if (direction === "right") {
            colIdx = Math.min(rows[rowIdx].length - 1, colIdx + 1);
        } else if (direction === "up") {
            rowIdx = Math.max(0, rowIdx - 1);
            colIdx = Math.min(colIdx, rows[rowIdx].length - 1);
        } else if (direction === "down") {
            rowIdx = Math.min(rows.length - 1, rowIdx + 1);
            colIdx = Math.min(colIdx, rows[rowIdx].length - 1);
        }
        this.viewConfigFocusIdx = rows[rowIdx][colIdx];
        this._renderViewConfigStrip();
        this._maybeRenderViewConfigHelp();
    };

    proto._maybeRenderViewConfigHelp = function () {
        if (this.focus !== "viewconfig") return;
        if (!this.detailEl) return;
        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }
        var view = this._getViewByTitle(this.activeView);
        if (!view) return;
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-detail-title";
        var helpText, fields = [];
        if (!this.viewConfigExpanded) {
            titleEl.textContent = "Structure — " + view.name;
            helpText = "Structure of the active view. Press ↵, Space, or → " +
                "to expand and inspect each layer's filters individually. " +
                "Each layer contributes rows to the menu via its own " +
                "roots/children filters; the built-in entries layer (when " +
                "active) places `ca-position`-tagged entries into the tree.";
            fields.push(["View", view.name]);
            fields.push(["Layers", String(view.layers.length)]);
            fields.push(["Sort", view.sort || "alphabetical"]);
            fields.push(["Grouping", view.grouping ? "on" : "off"]);
            fields.push(["Entries", view.includeEntries || "auto"]);
        } else {
            var entry = (this._viewConfigPillList || [])[this.viewConfigFocusIdx];
            if (!entry) return;
            var pill = entry.pill;
            titleEl.textContent = (pill._layerName ? pill._layerName + " · " : "") +
                pill.label;
            helpText = this._viewConfigPillHelp(pill);
            fields.push(["Kind", pill.kind]);
            if (pill.value) fields.push(["Value", pill.value]);
            if (pill._layerName) fields.push(["Layer", pill._layerName]);
        }
        this.detailEl.appendChild(titleEl);
        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = helpText;
        this.detailEl.appendChild(helpEl);
        var dl = this.document.createElement("dl");
        dl.className = "rcp-detail-fields";
        var doc = this.document;
        fields.forEach(function (row) {
            var dt = doc.createElement("dt");
            dt.textContent = row[0];
            var dd = doc.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        });
        this.detailEl.appendChild(dl);
        if (this.popupEl) this.popupEl.classList.add("rcp-showing-detail");
    };

    // Per-pill-kind help text. Pills carrying a pre-baked `help` field
    // (compact-mode summary pills) use that directly; structural pills
    // describe the field they represent.
    proto._viewConfigPillHelp = function (pill) {
        if (pill && pill.help) return pill.help;
        var k = pill.kind;
        var H = {
            "roots": "Filter producing the root rows for this layer. " +
                "Evaluated with no <currentTiddler> binding.",
            "children": "Filter producing child rows under a parent. " +
                "<currentTiddler> is the parent's title.",
            "leaf": "Leaf-test filter. Returning a non-empty result on a " +
                "candidate marks it as a leaf (no further drill).",
            "label": "Display-name override. Evaluated per row; " +
                "<currentTiddler> is the row title.",
            "actions": "Wikitext fired on Enter for leaf rows. Receives " +
                "<<picked>> / <<parent-picked>> / <<currentTiddler>>.",
            "entity-type": "Per-row entity-type filter. A non-empty result " +
                "on a leaf row makes Right-arrow open the action-menu stage " +
                "of that type. Space opens the same menu on any typed row.",
            "row-name": "Per-row name override filter.",
            "row-group": "Per-row group override filter.",
            "row-kind": "Per-row kind override filter.",
            "sort": "Row sort policy for this view.",
            "pick": "Pick-mode emits the picked row's path/title into the " +
                "named filter pill and returns to the prior view.",
            "entries-mode": "Whether the built-in entries layer is appended " +
                "(yes / no / auto). Auto = append when any declared layer " +
                "is tree-shaped.",
            "grouping": "Section-header grouping policy. `off` means rows " +
                "render without group separators.",
            "axis": "Group-by axis applied to this layer. Position in the " +
                "chain is the tree depth — first axis buckets the source, " +
                "each subsequent axis re-groups within the parent bucket. " +
                "Backspace/Delete removes this axis from the chain; Enter " +
                "swaps it for a different axis.",
            "axis-add": "Add a new axis to this layer's chain. Enter opens " +
                "an axis picker; the picked axis is appended at the end of " +
                "the chain. Parametric axes (e.g. By field) prompt for " +
                "their parameter."
        };
        if (k === "axis" && pill.axisTitle) {
            var t = this.wiki.getTiddler(pill.axisTitle);
            var axisHint = t && t.fields && t.fields["ca-axis-hint"];
            if (axisHint) return axisHint + "\n\n" + H[k];
        }
        return H[k] || "(no description)";
    };


    proto._appendConfigRowLabel = function (rowEl, text) {
        var labelEl = this.document.createElement("span");
        labelEl.className = "rcp-view-config-row-label";
        labelEl.textContent = text;
        rowEl.appendChild(labelEl);
    };

    proto._buildConfigPill = function (pill) {
        var el = this.document.createElement("span");
        el.className = "rcp-view-config-pill rcp-view-config-pill-" + pill.kind;
        var labelEl = this.document.createElement("span");
        labelEl.className = "rcp-view-config-pill-label";
        labelEl.textContent = pill.label;
        el.appendChild(labelEl);
        var valueEl = this.document.createElement("span");
        valueEl.className = "rcp-view-config-pill-value";
        valueEl.textContent = pill.value;
        el.appendChild(valueEl);
        el.title = pill.label + ": " + pill.value;
        return el;
    };

    // View-scoped header pills: things that apply across all layers.
    proto._viewScopedPills = function (view) {
        var pills = [];
        // Sort policy when non-default.
        if (view.sort && view.sort !== "alphabetical") {
            var sortVal = view.sort;
            if (view.sort === "by-field" && view.sortField) {
                sortVal = "by-field: " + view.sortField;
            } else if (view.sort === "custom" && view.sortKey) {
                sortVal = "custom: " + view.sortKey;
            }
            pills.push({ kind: "sort", label: "sort", value: sortVal });
        }
        // Pick-mode indicator.
        if (view.pickMode && view.pickEmitsFilter) {
            pills.push({
                kind: "pick",
                label: "pick→",
                value: this._slugForView(view.pickEmitsFilter)
            });
        }
        // Entries-layer inclusion mode — explicit so user can see why an
        // entries layer does or doesn't appear below.
        var hasEntries = view.layers.some(function (l) {
            return l.isBuiltIn && l.builtInKind === "entries";
        });
        var indicator = view.includeEntries;
        if (indicator === "auto") indicator += hasEntries ? ": yes" : ": no";
        pills.push({
            kind: "entries-mode",
            label: "entries",
            value: indicator
        });
        // Grouping policy — only surfaced when the view explicitly opted
        // out (the common-case `yes` is the default and not worth a pill).
        if (!view.grouping) {
            pills.push({
                kind: "grouping",
                label: "grouping",
                value: "off"
            });
        }
        return pills;
    };

    proto._layerPills = function (layer) {
        var pills = [];
        if (layer.roots)         pills.push({ kind: "roots",        label: "roots",    value: layer.roots });
        if (layer.children)      pills.push({ kind: "children",     label: "children", value: layer.children });
        if (layer.leaf)          pills.push({ kind: "leaf",         label: "leaf",     value: layer.leaf });
        if (layer.label)         pills.push({ kind: "label",        label: "label",    value: layer.label });
        if (layer.rowActions)    pills.push({ kind: "actions",      label: "Enter",    value: layer.rowActions });
        if (layer.rowEntityType) pills.push({ kind: "entity-type",  label: "→actions", value: layer.rowEntityType });
        if (layer.rowName)       pills.push({ kind: "row-name",     label: "name",     value: layer.rowName });
        if (layer.rowGroup)      pills.push({ kind: "row-group",    label: "group",    value: layer.rowGroup });
        if (layer.rowKind)       pills.push({ kind: "row-kind",     label: "kind",     value: layer.rowKind });
        // Axis chain (post-edit-by-user OR declared default). Each axis
        // gets its own pill; the trailing "+" pill lets the user append.
        if (!layer.isBuiltIn) {
            var chainSpec = cpAxes.activeChainSpec(this.wiki, layer);
            var self = this;
            chainSpec.forEach(function (entry, idx) {
                var axis = cpAxes.loadAxisByTitle(self.wiki, entry.title, entry.params);
                var displayName = axis ? axis.name : entry.title.split("/").pop();
                if (entry.params) {
                    var paramParts = [];
                    Object.keys(entry.params).forEach(function (k) {
                        paramParts.push(k + "=" + entry.params[k]);
                    });
                    if (paramParts.length) displayName += " (" + paramParts.join(", ") + ")";
                }
                pills.push({
                    kind: "axis",
                    label: idx === 0 ? "by" : "→",
                    value: displayName,
                    axisIdx: idx,
                    axisTitle: entry.title,
                    axisParams: entry.params || null,
                    layerTitle: layer.title || "",
                    layerName: layer.name || ""
                });
            });
            pills.push({
                kind: "axis-add",
                label: "+",
                value: "axis",
                layerTitle: layer.title || "",
                layerName: layer.name || ""
            });
        }
        return pills;
    };

    // ===================================================================
    // Axis-chain editing (from Structure strip pills)
    // ===================================================================

    // Find a layer descriptor by tiddler title across all loaded views.
    // Implicit layers have view-title as their layer.title — so this
    // also works for `ca-view-axes` (per-view chains).
    proto._findLayerByTitle = function (layerTitle) {
        if (!layerTitle) return null;
        for (var i = 0; i < this.views.length; i++) {
            var layers = this.views[i].layers || [];
            for (var j = 0; j < layers.length; j++) {
                if (layers[j].title === layerTitle) return layers[j];
            }
        }
        return null;
    };

    // Open the axis picker for a given layer. `mode` is "add", "replace",
    // or "insert" (replaceIdx required for the last two).
    proto._openAxisPicker = function (layerTitle, mode, replaceIdx) {
        var self = this;
        var AXIS_TAG = C.AXIS_TAG;
        var axisTitles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + AXIS_TAG + "]]"
        );
        if (!axisTitles.length) {
            if (console && console.warn) {
                console.warn("[cascade-palette] no axes registered (tag " + AXIS_TAG + ")");
            }
            return;
        }
        var items = axisTitles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var item = self._buildCascadeItem({
                "ca-name": f["ca-axis-name"] || title.split("/").pop(),
                "ca-hint": f["ca-axis-hint"] || "",
                "ca-icon": f["ca-axis-icon"] || "",
                "ca-kind": "leaf"
            }, title);
            item.isItem = true;
            return item;
        });
        var titlePrefix = (mode === "replace") ? "Replace axis at #" + (replaceIdx + 1)
            : (mode === "insert") ? "Insert axis at #" + (replaceIdx + 1)
            : "Add axis";
        var layer = this._findLayerByTitle(layerTitle);
        var layerName = (layer && layer.name) || layerTitle.split("/").pop();
        var stage = {
            kind: "filter",
            title: titlePrefix + " to " + layerName,
            query: "",
            selectedIndex: 0,
            filter: "",
            itemsFromFilter: "",
            stageDefaultAction: "",
            entityDefaultActions: [],
            asLink: false,
            items: items,
            results: items.slice(),
            parentPicked: null,
            entityType: null,
            _freezeItems: true,
            _isAxisPicker: true,
            _axisPickerMode: mode,
            _axisPickerLayerTitle: layerTitle,
            _axisPickerReplaceIdx: (replaceIdx === undefined) ? null : replaceIdx
        };
        this.pushStage(stage);
        this.setFocus && this.setFocus("input");
    };

    // Commit the user's pick into the chain spec, persist state, reset to
    // root. The stack reset is necessary because parentPath entries that
    // were bucket keys under the OLD chain may not match keys produced by
    // the NEW chain (different axis at the same depth). Cleanest is to
    // re-drill from root under the new structure.
    //
    // For parametric axes (axes whose key-filter references
    // <axis-param-*> variables), default the params to placeholder values
    // — the user can edit the state tiddler to refine. A future iteration
    // can prompt for params via a follow-up stage.
    proto._applyAxisPick = function (stage, picked) {
        if (!stage || !picked || !picked.title) return;
        var layerTitle = stage._axisPickerLayerTitle;
        var layer = this._findLayerByTitle(layerTitle);
        if (!layer) {
            this.popStage();
            return;
        }
        var mode = stage._axisPickerMode || "add";
        var replaceIdx = stage._axisPickerReplaceIdx;
        var current = cpAxes.readChainSpec(this.wiki, layer);
        var params = this._defaultParamsForAxis(picked.title);
        var entry = params ? { title: picked.title, params: params }
                           : { title: picked.title };
        var next = current.slice();
        if (mode === "replace" && replaceIdx !== null && replaceIdx >= 0 &&
            replaceIdx < next.length) {
            next[replaceIdx] = entry;
        } else if (mode === "insert" && replaceIdx !== null && replaceIdx >= 0 &&
                   replaceIdx <= next.length) {
            next.splice(replaceIdx, 0, entry);
        } else {
            next.push(entry);
        }
        cpAxes.writeChainState(this.wiki, layer, next);
        this._resetStackAfterChainEdit();
    };

    // Look up the axis tiddler and find any <axis-param-*> references in
    // its key-filter — return a default params map (placeholder values
    // ready for user editing). Empty result means the axis is not
    // parametric.
    proto._defaultParamsForAxis = function (axisTitle) {
        var t = this.wiki.getTiddler(axisTitle);
        if (!t) return null;
        var key = (t.fields && t.fields["ca-axis-key"]) || "";
        var re = /<axis-param-([\w-]+)>/g;
        var params = null;
        var m;
        while ((m = re.exec(key)) !== null) {
            if (!params) params = {};
            // Sensible default: empty string. User edits the state tiddler
            // (or a future param-prompt UI) to set a real value.
            params[m[1]] = params[m[1]] !== undefined ? params[m[1]] : "";
        }
        return params;
    };

    // Remove the axis at chainIdx from a layer's chain; persist; reset.
    proto._removeAxisAt = function (layerTitle, chainIdx) {
        var layer = this._findLayerByTitle(layerTitle);
        if (!layer) return;
        var current = cpAxes.readChainSpec(this.wiki, layer);
        if (chainIdx < 0 || chainIdx >= current.length) return;
        current.splice(chainIdx, 1);
        cpAxes.writeChainState(this.wiki, layer, current);
        this._resetStackAfterChainEdit();
    };

    // Reorder: swap axis at chainIdx with its left (-1) or right (+1)
    // neighbour. Reorder changes which axis runs at each depth, so the
    // saved parentPath becomes meaningless — same reset-to-root treatment
    // as add/replace/remove.
    proto._moveAxisAt = function (layerTitle, chainIdx, direction) {
        var layer = this._findLayerByTitle(layerTitle);
        if (!layer) return;
        var current = cpAxes.readChainSpec(this.wiki, layer);
        var target = chainIdx + direction;
        if (chainIdx < 0 || chainIdx >= current.length) return;
        if (target < 0 || target >= current.length) return;
        var tmp = current[chainIdx];
        current[chainIdx] = current[target];
        current[target] = tmp;
        cpAxes.writeChainState(this.wiki, layer, current);
        this._resetStackAfterChainEdit();
    };

    // Any chain edit invalidates the current parentPath (entries at axis
    // depths are bucket keys produced by the old chain). Drop the stack
    // back to root, recompute, re-render the Structure strip, and restore
    // focus there so the user can keep editing without re-Tab'ing.
    proto._resetStackAfterChainEdit = function () {
        this.stack = [this.buildRootStage()];
        this.recomputeStage(this.topStage());
        this.renderStage();
        if (this._renderViewConfigStrip) this._renderViewConfigStrip();
        if (this.setFocus) this.setFocus("viewconfig");
    };

    // ===================================================================
    // Help pane / activation
    // ===================================================================

    proto._maybeRenderViewHelp = function () {
        if (this.focus !== "view") return;
        if (!this.views.length) return;
        var visible = this._visibleViews();
        var view = visible[this.viewFocusIdx];
        if (!view) return;
        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-detail-title";
        titleEl.textContent = view.name +
            (view.title === this.activeView ? " (active)" : "");
        this.detailEl.appendChild(titleEl);
        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = view.hint || view.name;
        this.detailEl.appendChild(helpEl);
        var rows = [];
        rows.push(["Layers", view.layers.map(function (l) {
            return l.name || (l.isImplicit ? "(implicit)" : l.title);
        }).join(", ")]);
        if (view.sort && view.sort !== "alphabetical") {
            rows.push(["Sort", view.sort]);
        }
        if (view.pickMode) {
            rows.push(["Pick mode", view.pickEmitsFilter || "yes"]);
        }
        rows.push(["Include entries", view.includeEntries]);
        rows.push(["View tiddler", view.title]);
        var dl = this.document.createElement("dl");
        dl.className = "rcp-detail-fields";
        rows.forEach(function (row) {
            var dt = this.document.createElement("dt");
            dt.textContent = row[0];
            var dd = this.document.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        }, this);
        this.detailEl.appendChild(dl);
        this.popupEl.classList.add("rcp-showing-detail");
    };

    proto._setActiveView = function (viewTitle) {
        var view = this._getViewByTitle(viewTitle);
        if (!view) return;
        var prev = this.activeView;
        var prevView = this._getViewByTitle(prev);
        if (view.pickMode) {
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
        // Leader visibility is per-view (ca-leader-views) — re-render
        // the strip so leaders scoped to the previous view drop out and
        // leaders scoped to the new view appear.
        if (this._renderLeaderStrip) this._renderLeaderStrip();
        this._refreshPresetActiveCue();
        this.renderStage();
        if (this._leaderFiring) this._flashActiveViewPill();
        this.setFocus("input");
    };

};
