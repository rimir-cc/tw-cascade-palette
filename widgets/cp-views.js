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
        var parentTitle = "";
        if (parentContext && parentContext.parentPath &&
            parentContext.parentPath.length) {
            parentTitle = parentContext.parentPath[
                parentContext.parentPath.length - 1
            ];
        }
        // Tree-stage may pin to a specific layer (the one whose container
        // we drilled into) — only that layer contributes children. Root
        // stage evaluates every layer.
        var layerIdx = (parentContext && parentContext.layerIdx !== undefined)
            ? parentContext.layerIdx : null;
        return this._buildNodeForView(view, parentTitle, layerIdx);
    };

    proto._buildNodeForView = function (view, parentTitle, pinnedLayerIdx) {
        var rows = [];
        for (var i = 0; i < view.layers.length; i++) {
            if (pinnedLayerIdx !== null && pinnedLayerIdx !== undefined &&
                pinnedLayerIdx !== i) {
                continue;
            }
            var layerRows = this._evaluateLayer(view, view.layers[i], i, parentTitle);
            rows = rows.concat(layerRows);
        }
        return rows;
    };

    // Evaluate a single layer at a given node, returning its rows.
    // Dispatches built-in layers (entries) to their dedicated path.
    proto._evaluateLayer = function (view, layer, layerIdx, parentTitle) {
        if (layer.isBuiltIn && layer.builtInKind === "entries") {
            return this._evaluateEntriesLayer(view, layerIdx, parentTitle);
        }
        var self = this;
        var filterExpr = parentTitle ? layer.children : layer.roots;
        var widget = parentTitle
            ? this.makeFakeWidget({ currentTiddler: parentTitle })
            : null;
        var candidates = [];
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

    proto._renderViewConfigStrip = function () {
        if (!this.viewConfigStripEl) return;
        while (this.viewConfigStripEl.firstChild) {
            this.viewConfigStripEl.removeChild(this.viewConfigStripEl.firstChild);
        }
        var view = this._getViewByTitle(this.activeView);
        if (!view || !view.layers || !view.layers.length) {
            if (this.popupEl) {
                this.popupEl.classList.remove("rcp-has-view-config");
            }
            return;
        }
        var self = this;
        // View-scoped header row: aggregated view-wide pills + entries
        // inclusion indicator. Always present so the user can see what's
        // "above" the per-layer mini-rows. Hidden when the view declares
        // nothing meaningful at this level.
        var headerPills = this._viewScopedPills(view);
        if (headerPills.length) {
            var headerRow = this.document.createElement("div");
            headerRow.className = "rcp-view-config-row rcp-view-config-row-view";
            this._appendConfigRowLabel(headerRow, "view");
            headerPills.forEach(function (p) {
                headerRow.appendChild(self._buildConfigPill(p));
            });
            this.viewConfigStripEl.appendChild(headerRow);
        }
        // Per-layer mini-rows.
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
                rowEl.appendChild(self._buildConfigPill(p));
            });
            self.viewConfigStripEl.appendChild(rowEl);
        });
        if (this.popupEl) {
            this.popupEl.classList.toggle(
                "rcp-has-view-config",
                this.viewConfigStripEl.firstChild !== null
            );
        }
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
                sortVal = "custom: " + this._truncate(view.sortKey, 60);
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
        if (layer.roots) {
            pills.push({ kind: "roots", label: "roots", value: this._truncate(layer.roots, 80) });
        }
        if (layer.children) {
            pills.push({ kind: "children", label: "children", value: this._truncate(layer.children, 80) });
        }
        if (layer.leaf) {
            pills.push({ kind: "leaf", label: "leaf", value: this._truncate(layer.leaf, 60) });
        }
        if (layer.label) {
            pills.push({ kind: "label", label: "label", value: this._truncate(layer.label, 60) });
        }
        if (layer.rowActions) {
            pills.push({
                kind: "actions",
                label: "Enter",
                value: this._truncate(layer.rowActions, 70)
            });
        }
        if (layer.rowEntityType) {
            pills.push({
                kind: "entity-type",
                label: "→actions",
                value: this._truncate(layer.rowEntityType, 50)
            });
        }
        if (layer.rowName) {
            pills.push({ kind: "row-name", label: "name", value: this._truncate(layer.rowName, 50) });
        }
        if (layer.rowGroup) {
            pills.push({ kind: "row-group", label: "group", value: this._truncate(layer.rowGroup, 50) });
        }
        if (layer.rowKind) {
            pills.push({ kind: "row-kind", label: "kind", value: this._truncate(layer.rowKind, 50) });
        }
        return pills;
    };

    proto._truncate = function (s, max) {
        if (!s) return "";
        var str = String(s);
        return str.length > max ? str.slice(0, max - 1) + "…" : str;
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
        this.popupEl.classList.add("rcp-previewing");
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
        this._refreshPresetActiveCue();
        this.renderStage();
        if (this._leaderFiring) this._flashActiveViewPill();
        this.setFocus("input");
    };

};
