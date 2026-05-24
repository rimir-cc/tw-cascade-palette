/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-views
type: application/javascript
module-type: library

View subsystem — declarative root-stage strategies via composable
filter primitives.

A view is a tiddler tagged `$:/tags/rimir/cascade-palette/view`. Its
structure is expressed declaratively through two filters:

    ca-view-roots     filter (no current-binding) — produces root rows
    ca-view-children  filter with <currentTiddler> = parent
                       — produces children of a node (empty = flat view)

Optional refinements:

    ca-view-leaf      filter with <currentTiddler> = candidate
                       — truthy when the candidate is a terminal node;
                         default is "leaf iff children() returns empty".
    ca-view-label     filter with <currentTiddler> = node
                       — display name override; default is last `/`
                         segment, then caption, then title.

Back-compat: `ca-view-source` is accepted as an alias for `ca-view-roots`
on flat views (the four shipped views and many existing authored views
predate the rename).

The descent is a single recursive evaluation: at every node (root or
nested), the engine runs the appropriate filter, layers `ca-view-row-*`
overrides on each candidate, decides leaf-vs-container, and emits rows.
Tree containers carry `_treeContainer` + `_treeParent` so drillSelected
(cp-firing) can push a tree-stage; the pick-mode commit (cp-pick-presets)
reads `_treeParent` to derive the path arg.

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
            // `roots` falls back to legacy `ca-view-source` so the four
            // shipped flat views (and any user-authored views from before
            // the rename) continue to work without edits.
            var rootsFilter = f["ca-view-roots"] || f["ca-view-source"] || "";
            var view = {
                title: title,
                name: f["ca-view-name"] || title.split("/").pop(),
                hint: f["ca-view-hint"] || "",
                isDefault: (f["ca-view-default"] || "").toLowerCase() === "yes",
                roots: rootsFilter,
                children: f["ca-view-children"] || "",
                leaf: f["ca-view-leaf"] || "",
                label: f["ca-view-label"] || "",
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
                // configured filter with the row's title as arg, then
                // returns to the prior view. Used by the `>` leader.
                pickMode: (f["ca-view-pick-mode"] || "").toLowerCase() === "yes",
                pickEmitsFilter: f["ca-view-pick-emits-filter"] || "",
                // View-wide after-fire policy. Sets ca-after-fire on every
                // row built from this view (unless the row's source already
                // declares one).
                afterFire: (f["ca-view-after-fire"] || "").toLowerCase(),
                order: order
            };
            // Convenience flag: a view is "tree-like" iff it declares a
            // children filter. Read by grouping / sort / strip-rendering.
            view.isTree = !!view.children;
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

    // ---- node descent -----------------------------------------------------

    // Single entry point. parentContext shapes:
    //   { kind: "root" }                       — descending from root
    //   { kind: "tree", parentPath: [...] }    — descending into a sub-node;
    //     parentPath is the chain of parent tiddler titles from root onward;
    //     the last entry is the immediate parent for the children filter.
    proto._buildRowsForView = function (view, parentContext) {
        if (!view) return [];
        var parentTitle = "";
        if (parentContext && parentContext.parentPath &&
            parentContext.parentPath.length) {
            parentTitle = parentContext.parentPath[
                parentContext.parentPath.length - 1
            ];
        }
        return this._buildNodeForView(view, parentTitle);
    };

    // Evaluate the appropriate filter for this node, layer row overrides,
    // tag containers vs leaves, return the row list (plus positioned entries
    // merged in).
    proto._buildNodeForView = function (view, parentTitle) {
        var self = this;
        var filterExpr = parentTitle ? view.children : view.roots;
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
                        "[cascade-palette] view filter error",
                        view.title,
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
            // Immediate self-loop guard. Full ancestor-cycle detection lives
            // in the stage stack's soft-depth warning (cp-stack).
            if (title === parentTitle) return;
            var srcTid = self.wiki.getTiddler(title);
            var srcFields = (srcTid && srcTid.fields) || {};
            // Position-field exclusion. At root: `ca-position: none` hides
            // the source entirely (it might still appear via a positioned-
            // entries pass elsewhere). At inner nodes: same rule applies so
            // the user has one knob that works at every depth.
            var posRaw = srcFields["ca-position-" + slug];
            if (posRaw === undefined) posRaw = srcFields["ca-position"];
            if (posRaw === "none") return;
            var fieldsObj = $tw.utils.extend({}, srcFields);
            self._applyRowFiltersToFields(view, title, fieldsObj);
            if (!fieldsObj["ca-name"]) {
                var label = self._labelForNode(view, title);
                if (label) fieldsObj["ca-name"] = label;
            }
            var isLeaf = self._isLeafInView(view, title);
            if (!fieldsObj["ca-kind"]) {
                fieldsObj["ca-kind"] = isLeaf ? "leaf" : "drill";
            }
            var item = self._buildCascadeItem(fieldsObj, title);
            // Pure tree container: drillSelected pushes a tree-stage rather
            // than a filter-stage. Authors who set ca-next-scope or
            // ca-items-from explicitly opt out of tree-drill semantics.
            if (!isLeaf && item.kind === "drill" &&
                !item.nextScope && !item.itemsFrom) {
                item._treeContainer = true;
                item._treeParent = title;
                item._childCount = self._childCountForNode(view, title);
            }
            rows.push(item);
        });
        // Positioned entries land at this node when their ca-position field
        // names this parent (or "at-root" matches the root level). Skipped
        // on flat views — those views surface entries via their `roots`
        // filter (e.g. the Entries view's `[…tag[…/entry]]`). Re-injecting
        // would duplicate entries already matched by `roots` and would
        // pollute unrelated flat views (All tiddlers etc.) with entries
        // they didn't ask for.
        if (view.isTree) {
            var positioned = this._resolveEntryPositionsForView(view, parentTitle);
            return rows.concat(positioned);
        }
        return rows;
    };

    // Decide if a candidate node is a leaf in this view.
    //   - With `ca-view-leaf` declared: filter returns truthy ⇒ leaf.
    //   - Otherwise: leaf iff the view's children filter returns empty
    //     for this candidate. A view without a children filter (flat)
    //     treats every candidate as a leaf.
    proto._isLeafInView = function (view, candidateTitle) {
        if (view.leaf) {
            try {
                var r = this.wiki.filterTiddlers(
                    view.leaf,
                    this.makeFakeWidget({ currentTiddler: candidateTitle })
                );
                return r.length > 0;
            } catch (err) { return true; }
        }
        if (!view.children) return true;
        try {
            var children = this.wiki.filterTiddlers(
                view.children,
                this.makeFakeWidget({ currentTiddler: candidateTitle })
            );
            // Don't count invisible children towards the "is leaf" decision
            // — a node whose only children are hidden by visibility should
            // still drill so the user can find their way back.
            var self = this;
            return children.filter(function (t) {
                return self.isEntryVisible(t);
            }).length === 0;
        } catch (err) { return true; }
    };

    // Count visible children of a node — used by the show-count badge.
    proto._childCountForNode = function (view, parentTitle) {
        if (!view.children) return 0;
        try {
            var r = this.wiki.filterTiddlers(
                view.children,
                this.makeFakeWidget({ currentTiddler: parentTitle })
            );
            var self = this;
            return r.filter(function (t) {
                return self.isEntryVisible(t);
            }).length;
        } catch (err) { return 0; }
    };

    // Display name for a node. ca-view-label wins; then caption; then the
    // last `/` segment of the title; then the bare title.
    proto._labelForNode = function (view, title) {
        if (view.label) {
            try {
                var r = this.wiki.filterTiddlers(
                    view.label,
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

    // Walk every entry tiddler and emit a row for each one positioned at
    // `parentTitle`. Pick-mode views skip positioning entirely — the
    // entries would clutter the namespace the user is trying to browse.
    //
    // Positions: ca-position-<slug> (per-view) > ca-position (default).
    // Multi-position is supported via `:` / newline split. Special value
    // `at-root` matches the root level; `none` excludes the entry entirely.
    proto._resolveEntryPositionsForView = function (view, parentTitle) {
        if (view && view.pickMode) return [];
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
            if (matched) rows.push(self.readCascadeFields(entryTitle));
        });
        return rows;
    };

    // ---- row-* field overlay ---------------------------------------------

    // Run each ca-view-row-* filter with <currentTiddler> bound to the
    // source item and overlay the result onto fieldsObj. ca-view-row-actions
    // is dual-mode: try filter eval first; if it throws or returns empty,
    // fall back to the raw value as a wikitext template.
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
        if (view.afterFire && !fieldsObj["ca-after-fire"]) {
            fieldsObj["ca-after-fire"] = view.afterFire;
        }
    };

    // ---- sorting ----------------------------------------------------------

    // Sort rows according to a view's declared sort policy. Supports
    // `alphabetical` (default), `natural` (numeric-aware), `by-field`
    // (reads `ca-view-sort-field` value off each row), and `custom`
    // (per-row filter from `ca-view-sort-key`). Containers-first floats
    // tree containers above leaves at each level when the view declares
    // a children filter.
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

    // ---- view-strip rendering --------------------------------------------

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

    // ---- view-config strip (Track B) -------------------------------------

    // Read-only visualization of the active view's primitives. One pill
    // per declared filter (`roots`, `children`, `leaf`, `label`). Mouse
    // hover surfaces the filter text. The strip is hidden when no view
    // is loaded or the active view declares nothing meaningful.
    proto._renderViewConfigStrip = function () {
        if (!this.viewConfigStripEl) return;
        while (this.viewConfigStripEl.firstChild) {
            this.viewConfigStripEl.removeChild(this.viewConfigStripEl.firstChild);
        }
        var view = this._getViewByTitle(this.activeView);
        var pills = view ? this._viewConfigPillsFor(view) : [];
        var hasPills = pills.length > 0;
        if (this.popupEl) {
            this.popupEl.classList.toggle("rcp-has-view-config", hasPills);
        }
        if (!hasPills) return;
        var self = this;
        pills.forEach(function (pill) {
            var el = self.document.createElement("span");
            el.className = "rcp-view-config-pill rcp-view-config-pill-" + pill.kind;
            var labelEl = self.document.createElement("span");
            labelEl.className = "rcp-view-config-pill-label";
            labelEl.textContent = pill.label;
            el.appendChild(labelEl);
            var valueEl = self.document.createElement("span");
            valueEl.className = "rcp-view-config-pill-value";
            valueEl.textContent = pill.value;
            el.appendChild(valueEl);
            el.title = pill.label + ": " + pill.value;
            self.viewConfigStripEl.appendChild(el);
        });
    };

    proto._viewConfigPillsFor = function (view) {
        var pills = [];
        if (view.roots) {
            pills.push({ kind: "roots", label: "roots", value: view.roots });
        }
        if (view.children) {
            pills.push({ kind: "children", label: "children", value: view.children });
        }
        if (view.leaf) {
            pills.push({ kind: "leaf", label: "leaf", value: view.leaf });
        }
        if (view.label) {
            pills.push({ kind: "label", label: "label", value: view.label });
        }
        if (view.rowActions) {
            pills.push({
                kind: "actions",
                label: "Enter",
                value: this._truncate(view.rowActions, 80)
            });
        }
        if (view.rowName) {
            pills.push({ kind: "row-name", label: "name", value: view.rowName });
        }
        if (view.rowGroup) {
            pills.push({ kind: "row-group", label: "group", value: view.rowGroup });
        }
        if (view.rowKind) {
            pills.push({ kind: "row-kind", label: "kind", value: view.rowKind });
        }
        // Sort policy: surface explicit non-default choices. Alphabetical
        // is the default and isn't worth a pill.
        if (view.sort && view.sort !== "alphabetical") {
            var sortVal = view.sort;
            if (view.sort === "by-field" && view.sortField) {
                sortVal = "by-field: " + view.sortField;
            } else if (view.sort === "custom" && view.sortKey) {
                sortVal = "custom: " + view.sortKey;
            }
            pills.push({ kind: "sort", label: "sort", value: sortVal });
        }
        if (view.pickMode && view.pickEmitsFilter) {
            pills.push({
                kind: "pick",
                label: "pick→",
                value: this._slugForView(view.pickEmitsFilter)
            });
        }
        return pills;
    };

    proto._truncate = function (s, max) {
        if (!s) return "";
        var str = String(s);
        return str.length > max ? str.slice(0, max - 1) + "…" : str;
    };

    // ---- help / activation -----------------------------------------------

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
        if (view.roots) rows.push(["Roots", view.roots]);
        if (view.children) rows.push(["Children", view.children]);
        if (view.leaf) rows.push(["Leaf", view.leaf]);
        if (view.label) rows.push(["Label", view.label]);
        if (view.pickMode) {
            rows.push(["Pick mode", view.pickEmitsFilter || "yes"]);
        }
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
