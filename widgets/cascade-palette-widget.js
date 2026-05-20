/*\
title: $:/plugins/rimir/cascade-palette/widgets/cascade-palette-widget.js
type: application/javascript
module-type: widget

Cascade Palette widget — keyboard-driven cascading command palette.

Stage stack model. Root stage shows tiddlers tagged
`$:/tags/rimir/cascade-palette/entry`. Tab on a drill entry pushes a new
stage scoped by the entry's `ca-next-scope` filter. Esc pops a stage
(closes the palette at root). Enter fires `ca-actions` on a leaf or drills
on a drill item.

Action menu stages (driven by `$:/tags/rimir/cascade-palette/action` tiddlers
filtered by `ca-entity-type`) land in task 6.

\*/
(function () {
    "use strict";

    var Widget = require("$:/core/modules/widgets/widget.js").widget;

    var OPEN_MESSAGE = "rimir-cascade-palette-open";
    var ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";
    var ACTION_TAG = "$:/tags/rimir/cascade-palette/action";
    var SETTING_TAG = "$:/tags/rimir/cascade-palette/setting";
    var GROUPING_CONFIG = "$:/config/rimir/cascade-palette/grouping-enabled";
    var DEFAULT_ORDER = 100;
    var DEFAULT_MAX_RESULTS = 30;
    var SOFT_DEPTH_WARNING = 10;
    var DEFAULT_TRUE_VALUE = "yes";
    var DEFAULT_FALSE_VALUE = "no";
    var DEFAULT_STEP = 1;
    var DEFAULT_STEP_MEDIUM = 5;
    var DEFAULT_STEP_LARGE = 20;

    var CascadePaletteWidget = function (parseTreeNode, options) {
        this.initialise(parseTreeNode, options);
        this.open = false;
        this.stack = [];
    };

    CascadePaletteWidget.prototype = Object.create(Widget.prototype);

    /* ---------- lifecycle ---------- */

    CascadePaletteWidget.prototype.render = function (parent, nextSibling) {
        this.parentDomNode = parent;
        this.computeAttributes();
        this.execute();

        var self = this;
        if (console && console.log) {
            console.log("[cascade-palette] widget render() — mounting");
        }

        this.backdropEl = this.document.createElement("div");
        this.backdropEl.className = "rcp-backdrop";
        this.backdropEl.style.display = "none";

        var popup = this.document.createElement("div");
        popup.className = "rcp-popup";

        this.breadcrumbEl = this.document.createElement("div");
        this.breadcrumbEl.className = "rcp-breadcrumb";

        this.inputEl = this.document.createElement("input");
        this.inputEl.className = "rcp-input";
        this.inputEl.type = "text";
        this.inputEl.placeholder = "Type to filter…";
        this.inputEl.setAttribute("autocomplete", "off");
        this.inputEl.setAttribute("spellcheck", "false");

        this.resultsEl = this.document.createElement("ul");
        this.resultsEl.className = "rcp-results";

        this.hintEl = this.document.createElement("div");
        this.hintEl.className = "rcp-hint";
        this.hintEl.textContent = "↑↓ select · Tab drill · Esc back · ↵ fire · Shift-↵ fire+stay · Space toggle · +/- adjust";

        popup.appendChild(this.breadcrumbEl);
        popup.appendChild(this.inputEl);
        popup.appendChild(this.resultsEl);
        popup.appendChild(this.hintEl);
        this.backdropEl.appendChild(popup);

        parent.insertBefore(this.backdropEl, nextSibling);
        this.domNodes.push(this.backdropEl);

        this.inputEl.addEventListener("input", function () {
            var stage = self.topStage();
            if (!stage) return;
            stage.query = self.inputEl.value;
            stage.selectedIndex = 0;
            self.recomputeStage(stage);
            self.renderStage();
        });

        this.inputEl.addEventListener("keydown", function (e) {
            self.handleKeydown(e);
        });

        this.backdropEl.addEventListener("mousedown", function (e) {
            if (e.target === self.backdropEl) self.close();
        });

        // Register global hotkey handler.
        if ($tw.rootWidget) {
            if (self._openHandler) {
                $tw.rootWidget.removeEventListener(OPEN_MESSAGE, self._openHandler);
            }
            self._openHandler = function () {
                if (console && console.log) {
                    console.log("[cascade-palette] open message received");
                }
                self.openPalette();
                return false;
            };
            $tw.rootWidget.addEventListener(OPEN_MESSAGE, self._openHandler);
            if (console && console.log) {
                console.log("[cascade-palette] hotkey listener registered on rootWidget");
            }
        } else if (console && console.warn) {
            console.warn("[cascade-palette] $tw.rootWidget unavailable at render time");
        }
    };

    CascadePaletteWidget.prototype.execute = function () {
        // No attributes yet.
    };

    CascadePaletteWidget.prototype.refresh = function () {
        return false;
    };

    /* ---------- open / close / stack ---------- */

    CascadePaletteWidget.prototype.openPalette = function () {
        this.open = true;
        this.stack = [this.buildRootStage()];
        this.recomputeStage(this.topStage());
        this.backdropEl.style.display = "flex";
        this.renderStage();
        var self = this;
        setTimeout(function () {
            self.inputEl.focus();
        }, 0);
    };

    CascadePaletteWidget.prototype.close = function () {
        this.open = false;
        this.stack = [];
        this.backdropEl.style.display = "none";
    };

    CascadePaletteWidget.prototype.topStage = function () {
        return this.stack.length ? this.stack[this.stack.length - 1] : null;
    };

    CascadePaletteWidget.prototype.pushStage = function (stage) {
        this.stack.push(stage);
        if (this.stack.length > SOFT_DEPTH_WARNING && console && console.warn) {
            console.warn(
                "[cascade-palette] stack depth", this.stack.length,
                "— possible cascade loop?"
            );
        }
        this.recomputeStage(stage);
        this.renderStage();
    };

    CascadePaletteWidget.prototype.popStage = function () {
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

    CascadePaletteWidget.prototype.popToDepth = function (depth) {
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

    CascadePaletteWidget.prototype.buildRootStage = function () {
        return {
            kind: "root",
            title: "Root",
            query: "",
            selectedIndex: 0,
            items: [],            // all entries, unfiltered
            results: [],          // entries after query filter
            parentPicked: null,
            entityType: null
        };
    };

    CascadePaletteWidget.prototype.buildFilterStage = function (entry, parentPicked) {
        var entityType = entry.nextEntityType || null;
        var stage = {
            kind: "filter",
            title: entry.nextTitle || entry.name || "Stage",
            query: "",
            selectedIndex: 0,
            filter: entry.nextScope,
            // `nextDefaultAction` on a drill entry fires when the user hits
            // Enter on an item in this stage AND no entity-type default action
            // is discoverable (typical for enum-picker stages: items are bare
            // strings, no action menu).
            stageDefaultAction: entry.nextDefaultAction || "",
            // Discovered entity-type default action — fired by Enter on a
            // dynamic item when no stageDefaultAction.
            entityDefaultActions: this.lookupEntityDefaultActions(entityType),
            items: [],
            results: [],
            parentPicked: parentPicked || null,
            entityType: entityType
        };
        return stage;
    };

    CascadePaletteWidget.prototype.buildActionMenuStage = function (parentPicked, entityType, title) {
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

    /* ---------- result computation ---------- */

    CascadePaletteWidget.prototype.recomputeStage = function (stage) {
        if (stage.kind === "root") {
            stage.items = this.sortEntries(this.loadEntries());
        } else if (stage.kind === "filter") {
            stage.items = this.evaluateFilterStage(stage);
        } else if (stage.kind === "actions") {
            stage.items = this.sortEntries(this.loadActionsForType(stage.entityType));
        }
        this.applyQueryToStage(stage);
    };

    CascadePaletteWidget.prototype.loadActionsForType = function (entityType) {
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

    CascadePaletteWidget.prototype.getActionEntityType = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        return f["ca-entity-type"] || "";
    };

    CascadePaletteWidget.prototype.lookupEntityDefaultActions = function (entityType) {
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

    CascadePaletteWidget.prototype.applyQueryToStage = function (stage) {
        var filtered = this.filterByQuery(stage.items, stage.query);
        var maxResults = this.getMaxResults();
        // Reorder into visual (grouped) sequence when grouping is enabled,
        // so keyboard nav's linear `selectedIndex` matches the rendered row
        // order. With grouping off, keep the items' natural sort.
        var ordered = this.isGroupingEnabled() ? this.reorderByGroup(filtered) : filtered;
        stage.results = ordered.slice(0, maxResults);
        if (stage.selectedIndex >= stage.results.length) {
            stage.selectedIndex = Math.max(0, stage.results.length - 1);
        }
    };

    CascadePaletteWidget.prototype.isGroupingEnabled = function () {
        var raw = this.wiki.getTiddlerText(GROUPING_CONFIG, DEFAULT_TRUE_VALUE);
        var s = String(raw || "").toLowerCase().trim();
        return s !== "no" && s !== "false" && s !== "off" && s !== "0";
    };

    CascadePaletteWidget.prototype.reorderByGroup = function (items) {
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

    CascadePaletteWidget.prototype.loadEntries = function () {
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
    CascadePaletteWidget.prototype.isEntryVisible = function (title) {
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

    CascadePaletteWidget.prototype.readCascadeFields = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var orderRaw = f["ca-order"];
        var order = orderRaw !== undefined && orderRaw !== ""
            ? parseFloat(orderRaw)
            : DEFAULT_ORDER;
        if (isNaN(order)) order = DEFAULT_ORDER;
        return {
            title: title,
            name: f["ca-name"] || title,
            hint: f["ca-hint"] || "",
            icon: f["ca-icon"] || "",
            kind: f["ca-kind"] || "leaf",
            order: order,
            group: this.resolveGroup(title, f),
            actions: f["ca-actions"] || "",
            nextScope: f["ca-next-scope"] || "",
            nextTitle: f["ca-next-title"] || "",
            nextEntityType: f["ca-next-entity-type"] || "",
            nextDefaultAction: f["ca-next-default-action"] || "",
            // Scribe-style binding used by `ca-kind: toggle` (and future
            // edit kinds). `bindPath` is a comma-separated walk into the
            // field text when it's JSON.
            bindTiddler: f["ca-bind-tiddler"] || "",
            bindField: f["ca-bind-field"] || "text",
            bindPath: f["ca-bind-path"] || "",
            trueValue: f["ca-true-value"] || DEFAULT_TRUE_VALUE,
            falseValue: f["ca-false-value"] || DEFAULT_FALSE_VALUE,
            // Numeric edit-kind config. `min`/`max` are nullable so callers
            // can opt into the slider rendering by setting both. Step
            // magnitudes are layered by modifier: bare key = step, Shift =
            // stepMedium, Ctrl = stepLarge.
            minValue: this._parseNumOrNull(f["ca-min"]),
            maxValue: this._parseNumOrNull(f["ca-max"]),
            step: this._parseNumOrDefault(f["ca-step"], DEFAULT_STEP),
            stepMedium: this._parseNumOrDefault(f["ca-step-medium"], DEFAULT_STEP_MEDIUM),
            stepLarge: this._parseNumOrDefault(f["ca-step-large"], DEFAULT_STEP_LARGE),
            defaultValue: this._parseNumOrNull(f["ca-default-value"]),
            isItem: false       // entries / actions vs dynamic items
        };
    };

    CascadePaletteWidget.prototype._parseNumOrNull = function (raw) {
        if (raw === undefined || raw === null || raw === "") return null;
        var n = parseFloat(raw);
        return isNaN(n) ? null : n;
    };

    CascadePaletteWidget.prototype._parseNumOrDefault = function (raw, fallback) {
        var n = this._parseNumOrNull(raw);
        return n === null ? fallback : n;
    };

    /* ---------- bound-value read/write ----------

    The toggle kind (and future text/number/enum-write kinds) reads and
    writes a single value via a scribe-style binding:
        ca-bind-tiddler   target tiddler title
        ca-bind-field     target field (default "text")
        ca-bind-path      optional comma-separated walk inside the JSON
                          value of the field (e.g. "prefs,layout")

    No path: the value is the field text (a string). With path: the value
    is the JSON-decoded value at that path.

    \-------------------------------------------- */

    CascadePaletteWidget.prototype.readBoundValue = function (item) {
        if (!item.bindTiddler) return undefined;
        var t = this.wiki.getTiddler(item.bindTiddler);
        if (!t) return undefined;
        var fieldText = t.fields[item.bindField];
        if (fieldText === undefined) return undefined;
        if (!item.bindPath) return fieldText;
        try {
            var node = JSON.parse(fieldText);
            var parts = item.bindPath.split(",");
            for (var i = 0; i < parts.length; i++) {
                if (node === null || node === undefined) return undefined;
                node = node[parts[i]];
            }
            return node;
        } catch (err) {
            return undefined;
        }
    };

    CascadePaletteWidget.prototype.writeBoundValue = function (item, value) {
        if (!item.bindTiddler) return;
        if (!item.bindPath) {
            // Whole-field write. Stringify when the bind target is the
            // body of a config tiddler (i.e. a string we want stored
            // verbatim, not JSON-quoted).
            var existing = this.wiki.getTiddler(item.bindTiddler);
            var fields = { title: item.bindTiddler };
            fields[item.bindField] = String(value);
            this.wiki.addTiddler(new $tw.Tiddler(
                (existing && existing.fields) || {},
                fields
            ));
            return;
        }
        // Sub-path write — read JSON, mutate, serialize back.
        var t = this.wiki.getTiddler(item.bindTiddler);
        var fieldText = t && t.fields[item.bindField];
        var root;
        try {
            root = fieldText ? JSON.parse(fieldText) : {};
        } catch (err) {
            root = {};
        }
        var parts = item.bindPath.split(",");
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var key = parts[i];
            if (node[key] === undefined || node[key] === null || typeof node[key] !== "object") {
                node[key] = {};
            }
            node = node[key];
        }
        node[parts[parts.length - 1]] = value;
        var newFields = { title: item.bindTiddler };
        newFields[item.bindField] = JSON.stringify(root, null, 4);
        this.wiki.addTiddler(new $tw.Tiddler(
            (t && t.fields) || {},
            newFields
        ));
    };

    // Boolean coercion: a stored value matches "true" if it equals the
    // item's trueValue OR a common truthy literal. Defensive against
    // legacy values like `true` vs `yes`.
    CascadePaletteWidget.prototype.readNumberValue = function (item) {
        var raw = this.readBoundValue(item);
        if (raw === undefined || raw === null || raw === "") {
            return item.defaultValue !== null ? item.defaultValue : 0;
        }
        var n = parseFloat(raw);
        if (isNaN(n)) return item.defaultValue !== null ? item.defaultValue : 0;
        return n;
    };

    CascadePaletteWidget.prototype.clampNumber = function (item, n) {
        if (item.minValue !== null && n < item.minValue) n = item.minValue;
        if (item.maxValue !== null && n > item.maxValue) n = item.maxValue;
        return n;
    };

    CascadePaletteWidget.prototype.stepMagnitudeFor = function (item, e) {
        if (e.ctrlKey) return item.stepLarge;
        if (e.shiftKey) return item.stepMedium;
        return item.step;
    };

    CascadePaletteWidget.prototype.isToggleOn = function (item) {
        var v = this.readBoundValue(item);
        if (v === undefined || v === null || v === "") {
            // Fall back: treat unset as off by default.
            return false;
        }
        if (typeof v === "boolean") return v;
        var s = String(v).toLowerCase();
        return s === String(item.trueValue).toLowerCase() ||
            s === "yes" || s === "true" || s === "on" || s === "1";
    };

    // Resolve the cluster label for an item. Explicit `ca-group` wins.
    // Otherwise derive from the shadow source: look up the owning plugin
    // tiddler and use its `name` field (the lowercase short name from
    // plugin.info). Falls back to the plugin title with the `$:/plugins/`
    // prefix stripped if the plugin has no `name`. Non-shadow (user-
    // authored) tiddlers get "" — they share an unnamed cluster which
    // renders as "Other" when mixed with named groups.
    CascadePaletteWidget.prototype.resolveGroup = function (title, fields) {
        if (fields && fields["ca-group"]) return fields["ca-group"];
        var src = this.wiki.getShadowSource ? this.wiki.getShadowSource(title) : null;
        if (!src) return "";
        var pluginTid = this.wiki.getTiddler(src);
        if (pluginTid && pluginTid.fields && pluginTid.fields.name) {
            return pluginTid.fields.name;
        }
        return src.replace(/^\$:\/plugins\//, "");
    };

    CascadePaletteWidget.prototype.evaluateFilterStage = function (stage) {
        if (!stage.filter) return [];
        var variables = this.buildStageVariables(stage, null);
        var titles;
        try {
            titles = this.wiki.filterTiddlers(
                stage.filter,
                this.makeFakeWidget(variables)
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] filter error in stage", stage.title,
                    err && err.message
                );
            }
            return [];
        }
        var self = this;
        return titles.map(function (title) {
            // If the tiddler has a `ca-kind` field, it's a cascade-aware
            // entry-style item — treat it as such (drill or leaf). Lets users
            // nest entries inside other stages by tagging them differently.
            var t = self.wiki.getTiddler(title);
            var fields = (t && t.fields) || {};
            if (fields["ca-kind"]) {
                return self.readCascadeFields(title);
            }
            // Plain dynamic item — prefer `caption` field for the displayed
            // name, but keep the raw title for the right-aligned column.
            var caption = fields.caption || "";
            return {
                title: title,
                name: caption || title,
                rawTitle: title,
                hint: "",
                kind: "item",
                order: DEFAULT_ORDER,
                group: self.resolveGroup(title, fields),
                isItem: true
            };
        });
    };

    // Build the full variable map exposed to filter and action contexts.
    // - `query` — current stage's input text
    // - `picked` — the just-picked item (null for filter eval, set for actions)
    // - `parent-picked` — pick from the stage one back
    // - `stage-N-picked` — pick from stage index N (0 = root). For root entries
    //   we don't have a picked title, so `stage-0-picked` is "".
    CascadePaletteWidget.prototype.buildStageVariables = function (stage, picked) {
        var vars = {
            "query": stage.query || "",
            "picked": picked || "",
            "parent-picked": stage.parentPicked || ""
        };
        // Walk the stack to expose stage-N-picked. The current stage's
        // own pick is captured via `picked` above; we record parent picks
        // from the actual stack history.
        for (var i = 0; i < this.stack.length; i++) {
            var s = this.stack[i];
            vars["stage-" + i + "-picked"] = s.parentPicked || "";
        }
        return vars;
    };

    CascadePaletteWidget.prototype.makeFakeWidget = function (variables) {
        // Minimal widget shim accepted by wiki.filterTiddlers for variable
        // resolution. We layer our injected variables on top of this widget's
        // own variable scope so callers can still see anything we inherit.
        var self = this;
        return {
            wiki: this.wiki,
            getVariable: function (name, options) {
                if (Object.prototype.hasOwnProperty.call(variables, name)) {
                    return variables[name];
                }
                if (self.getVariable) {
                    return self.getVariable(name, options);
                }
                return "";
            }
        };
    };

    /* ---------- navigator routing ----------

    Our widget mounts via a startup module into document.body, OUTSIDE the
    page's main widget tree. So actions invoked from this widget bubble up
    via our (rootWidget) parent and NEVER reach the navigator widget that
    lives inside the page tree. That breaks `<$action-navigate>`, `tm-edit-
    tiddler`, `tm-close-tiddler` and friends — all the navigator-routed
    messages — even though `tm-save-wiki` etc. still work because they have
    handlers at rootWidget level.

    Fix: find the navigator widget in `$tw.pageWidgetNode`'s subtree at
    action-fire time, and invoke the action wikitext with the navigator as
    parentWidget. Events then bubble naturally into the navigator and its
    handlers fire.

    Falls back to `$tw.rootWidget` if no navigator is found (so messages with
    global handlers like `tm-save-wiki` still work).

    \--------------------------------------- */

    // Walk the page widget tree to find a suitable action-parent. We prefer
    // the deepest `statewrap` widget (where `statewrapContext` lives — required
    // by `$action-statewrap-navigate` to resolve channels). The statewrap
    // sits INSIDE the appify-app, so picking it gives both statewrap context
    // and any ancestor navigators (events bubble UP through appify-app and
    // beyond). Falls back to navigator, then rootWidget.
    //
    // Why we don't use appify-app: `getStatewrapContext` (in rimir/statewrap
    // utils.js) walks `parentWidget` UP looking for `w.statewrapContext`.
    // The context property is set on the `statewrap` widget itself, not on
    // its ancestor appify-app. Parenting an action to appify-app means walking
    // up from appify-app — which never visits statewrap (it's a descendant).
    CascadePaletteWidget.prototype.findActionParent = function () {
        if (!$tw.pageWidgetNode) return $tw.rootWidget || null;
        var statewrap = null;
        var navigator = null;
        var visited = new Set();
        function walk(w) {
            if (!w || visited.has(w)) return;
            visited.add(w);
            if (w.parseTreeNode) {
                if (w.parseTreeNode.type === "statewrap") {
                    statewrap = w;  // capture deepest
                } else if (w.parseTreeNode.type === "navigator" && !navigator) {
                    navigator = w;
                }
            }
            if (w.children) {
                for (var i = 0; i < w.children.length; i++) {
                    walk(w.children[i]);
                }
            }
        }
        walk($tw.pageWidgetNode);
        return statewrap || navigator || $tw.rootWidget || null;
    };

    CascadePaletteWidget.prototype.invokeViaNavigator = function (actionString, variables) {
        if (!actionString) return;
        var parent = this.findActionParent() || this;
        try {
            var parser = this.wiki.parseText(
                "text/vnd.tiddlywiki",
                actionString,
                { parentWidget: parent }
            );
            var widgetNode = this.wiki.makeWidget(parser, {
                parentWidget: parent,
                document: $tw.fakeDocument,
                variables: variables || {}
            });
            var container = $tw.fakeDocument.createElement("div");
            widgetNode.render(container, null);
            widgetNode.invokeActions(this, null);
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] action invocation failed:",
                    err && err.message,
                    err
                );
            }
        }
    };

    CascadePaletteWidget.prototype.filterByQuery = function (items, query) {
        if (!query) return items.slice();
        var q = query.toLowerCase();
        return items.filter(function (item) {
            return item.name.toLowerCase().indexOf(q) !== -1
                || (item.hint && item.hint.toLowerCase().indexOf(q) !== -1);
        });
    };

    CascadePaletteWidget.prototype.sortEntries = function (items) {
        return items.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
    };

    CascadePaletteWidget.prototype.getMaxResults = function () {
        var raw = this.wiki.getTiddlerText(
            "$:/config/rimir/cascade-palette/max-results",
            String(DEFAULT_MAX_RESULTS)
        );
        var n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? DEFAULT_MAX_RESULTS : n;
    };

    /* ---------- rendering ---------- */

    CascadePaletteWidget.prototype.renderStage = function () {
        this.renderBreadcrumb();
        this.renderInput();
        this.renderResults();
    };

    CascadePaletteWidget.prototype.renderBreadcrumb = function () {
        while (this.breadcrumbEl.firstChild) {
            this.breadcrumbEl.removeChild(this.breadcrumbEl.firstChild);
        }
        var self = this;
        this.stack.forEach(function (stage, i) {
            if (i > 0) {
                var sep = self.document.createElement("span");
                sep.className = "rcp-breadcrumb-sep";
                sep.textContent = " › ";
                self.breadcrumbEl.appendChild(sep);
            }
            var seg = self.document.createElement("span");
            seg.className = "rcp-breadcrumb-seg";
            if (i < self.stack.length - 1) {
                seg.classList.add("rcp-breadcrumb-clickable");
                seg.addEventListener("mousedown", function (e) {
                    e.preventDefault();
                    self.popToDepth(i);
                    self.inputEl.focus();
                });
            }
            seg.textContent = stage.title;
            self.breadcrumbEl.appendChild(seg);
        });
    };

    CascadePaletteWidget.prototype.renderInput = function () {
        var stage = this.topStage();
        if (!stage) return;
        this.inputEl.value = stage.query || "";
    };

    CascadePaletteWidget.prototype.renderResults = function () {
        while (this.resultsEl.firstChild) {
            this.resultsEl.removeChild(this.resultsEl.firstChild);
        }
        var stage = this.topStage();
        if (!stage) return;
        if (stage.results.length === 0) {
            var emptyEl = this.document.createElement("li");
            emptyEl.className = "rcp-empty";
            emptyEl.textContent = "No results";
            this.resultsEl.appendChild(emptyEl);
            return;
        }
        var self = this;
        this._selectedRowEl = null;

        // Headers suppressed when all results belong to a single group
        // (matches breadcrumb-hide-on-root behaviour). `stage.results` is
        // already reordered into visual-group sequence by `applyQueryToStage`,
        // so a single pass with prev-group tracking is enough.
        var groupingOn = this.isGroupingEnabled();
        var distinct = {};
        var distinctCount = 0;
        stage.results.forEach(function (item) {
            var g = item.group || "";
            if (!(g in distinct)) { distinct[g] = true; distinctCount++; }
        });
        var showHeaders = groupingOn && distinctCount > 1;
        var prevGroup = null;

        stage.results.forEach(function (item, i) {
            var g = item.group || "";
            if (showHeaders && g !== prevGroup) {
                var headerEl = self.document.createElement("li");
                headerEl.className = "rcp-group-header";
                headerEl.textContent = g || "Other";
                self.resultsEl.appendChild(headerEl);
                prevGroup = g;
            }
            self._appendResultRow(item, i, stage);
        });

        if (self._selectedRowEl && self._selectedRowEl.scrollIntoView) {
            self._selectedRowEl.scrollIntoView({ block: "nearest" });
        }
    };

    CascadePaletteWidget.prototype._appendResultRow = function (item, i, stage) {
        var self = this;
        var rowEl = self.document.createElement("li");
        rowEl.className =
            "rcp-row" + (i === stage.selectedIndex ? " rcp-row-selected" : "");
        if (item.kind === "drill") rowEl.classList.add("rcp-row-drill");
        if (item.kind === "toggle") rowEl.classList.add("rcp-row-toggle");

        // For toggles, the checkbox glyph replaces the icon slot (so the
        // checkbox sits in the same column as plugin icons elsewhere).
        if (item.kind === "toggle") {
            var on = this.isToggleOn(item);
            var cbEl = self.document.createElement("span");
            cbEl.className = "rcp-row-checkbox" + (on ? " rcp-row-checkbox-on" : "");
            cbEl.textContent = on ? "☑" : "☐";
            rowEl.appendChild(cbEl);
        } else if (item.icon) {
            var iconEl = self.document.createElement("span");
            iconEl.className = "rcp-row-icon";
            iconEl.textContent = item.icon;
            rowEl.appendChild(iconEl);
        }

        var nameEl = self.document.createElement("span");
        nameEl.className = "rcp-row-name";
        nameEl.textContent = item.name;
        rowEl.appendChild(nameEl);

        // Right-aligned slot: for toggles, the current bound value; for
        // numbers, an optional slider bar + the value; for dynamic items,
        // the raw title; otherwise the hint text.
        if (item.kind === "toggle") {
            var raw = this.readBoundValue(item);
            var displayed = raw === undefined || raw === null || raw === ""
                ? "(unset)"
                : (this.isToggleOn(item) ? item.trueValue : item.falseValue);
            var valueEl = self.document.createElement("span");
            valueEl.className = "rcp-row-value";
            valueEl.textContent = displayed;
            rowEl.appendChild(valueEl);
        } else if (item.kind === "number") {
            var nVal = this.readNumberValue(item);
            var hasRange = item.minValue !== null && item.maxValue !== null
                && item.maxValue > item.minValue;
            if (hasRange) {
                var barWrap = self.document.createElement("span");
                barWrap.className = "rcp-row-slider";
                var fillEl = self.document.createElement("span");
                fillEl.className = "rcp-row-slider-fill";
                var frac = (nVal - item.minValue) / (item.maxValue - item.minValue);
                if (frac < 0) frac = 0;
                if (frac > 1) frac = 1;
                fillEl.style.width = (frac * 100) + "%";
                barWrap.appendChild(fillEl);
                rowEl.appendChild(barWrap);
            }
            var numEl = self.document.createElement("span");
            numEl.className = "rcp-row-value";
            numEl.textContent = String(nVal);
            rowEl.appendChild(numEl);
        } else if (item.isItem && item.rawTitle && item.rawTitle !== item.name) {
            var titleEl = self.document.createElement("span");
            titleEl.className = "rcp-row-title";
            titleEl.textContent = item.rawTitle;
            titleEl.title = item.rawTitle;
            rowEl.appendChild(titleEl);
        } else if (item.hint) {
            var hintEl = self.document.createElement("span");
            hintEl.className = "rcp-row-hint";
            hintEl.textContent = item.hint;
            rowEl.appendChild(hintEl);
        }

        if (item.kind === "drill") {
            var chevronEl = self.document.createElement("span");
            chevronEl.className = "rcp-row-chevron";
            chevronEl.textContent = "›";
            rowEl.appendChild(chevronEl);
        }

        rowEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            stage.selectedIndex = i;
            self.fireSelected(e.shiftKey);
        });

        if (i === stage.selectedIndex) {
            self._selectedRowEl = rowEl;
        }
        self.resultsEl.appendChild(rowEl);
    };

    /* ---------- keyboard ---------- */

    CascadePaletteWidget.prototype.handleKeydown = function (e) {
        var stage = this.topStage();
        if (!stage) return;
        if (e.key === "Escape") {
            e.preventDefault();
            this.popStage();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (stage.selectedIndex < stage.results.length - 1) {
                stage.selectedIndex += 1;
                this.renderResults();
            }
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (stage.selectedIndex > 0) {
                stage.selectedIndex -= 1;
                this.renderResults();
            }
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            if (e.shiftKey) {
                this.popStage();
            } else {
                this.drillSelected();
            }
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            this.fireSelected(e.shiftKey);  // shift-enter → keep palette open
            return;
        }
        // Space on a toggle row → flip the value WITHOUT closing the palette.
        // On any other kind, Space falls through to the input field (where
        // it inserts a literal space into the query).
        if (e.key === " " || e.code === "Space") {
            var picked = stage.results[stage.selectedIndex];
            if (picked && picked.kind === "toggle") {
                e.preventDefault();
                this.fireToggle(stage, picked, true);  // keepOpen
                return;
            }
        }
        // +/- on a number row — adjust by step (Shift = mid, Ctrl = large).
        // Match on `e.code` so it works regardless of US/DE/etc. keyboard
        // layout: pressing the physical "=/+" or "-/_" key (or numpad
        // ±) always triggers. The "shift to get +" on US layouts is
        // absorbed naturally — what matters is the physical key, not the
        // produced character.
        var isPlusKey = e.code === "Equal" || e.code === "NumpadAdd";
        var isMinusKey = e.code === "Minus" || e.code === "NumpadSubtract";
        if (isPlusKey || isMinusKey) {
            var pickedN = stage.results[stage.selectedIndex];
            if (pickedN && pickedN.kind === "number") {
                e.preventDefault();
                var mag = this.stepMagnitudeFor(pickedN, e);
                this.fireNumber(stage, pickedN, isPlusKey ? mag : -mag);
                return;
            }
        }
    };

    /* ---------- selection handling ---------- */

    // `keepOpen` (set via Shift-Enter / Shift-Click) fires the action but
    // leaves the palette visible so the user can chain more picks. The
    // current stage gets recomputed afterwards in case the action mutated
    // anything visible (e.g. Mark Done changes a task's status field).
    CascadePaletteWidget.prototype.fireSelected = function (keepOpen) {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // 1. Leaf entry/action item — fire ca-actions.
        if (picked.kind === "leaf" && picked.actions) {
            this.fireLeafAction(stage, picked, keepOpen);
            return;
        }
        // 2. Drill entry/action item — push the next stage.
        //    (Shift modifier has no effect — drilling doesn't close anyway.)
        if (picked.kind === "drill") {
            this.drillSelected();
            return;
        }
        // 2b. Toggle — flip the bound boolean. Enter closes (unless
        //     keepOpen), Space always keeps open (handled in handleKeydown).
        if (picked.kind === "toggle") {
            this.fireToggle(stage, picked, keepOpen);
            return;
        }
        // 3. Dynamic filter-stage item (an entity result OR enum value).
        if (picked.isItem) {
            var vars = this.buildStageVariables(stage, picked.title);
            // 3a. Stage has a default action declared by the parent drill.
            if (stage.stageDefaultAction) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(stage.stageDefaultAction, vars);
                });
                return;
            }
            // 3b. Stage's entity type has a default action (ca-default:yes).
            if (stage.entityDefaultActions && stage.entityDefaultActions.actions) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(
                        stage.entityDefaultActions.actions, vars
                    );
                });
                return;
            }
            // 3c. No default — fall back to navigate.
            this.afterAction(stage, keepOpen, function () {
                this.invokeViaNavigator(
                    '<$action-navigate $to=<<picked>>/>',
                    { picked: picked.title }
                );
            });
            return;
        }
        // 4. Anything else — just close (Shift modifier ignored).
        if (!keepOpen) this.close();
    };

    CascadePaletteWidget.prototype.fireToggle = function (stage, item, keepOpen) {
        var self = this;
        var current = this.isToggleOn(item);
        var next = current ? item.falseValue : item.trueValue;
        // afterAction expects a doAction callback. We close-or-stay via the
        // same shared helper so behaviour stays uniform with leaf/item paths.
        this.afterAction(stage, keepOpen, function () {
            self.writeBoundValue(item, next);
        });
    };

    // Number editing — +/- adjust by step; Shift = stepMedium; Ctrl = stepLarge.
    // Always keeps the palette open: numbers are rarely a one-shot commit
    // (you usually want to nudge a few times), and there's no "fire and
    // close" semantic that would feel right.
    CascadePaletteWidget.prototype.fireNumber = function (stage, item, delta) {
        var current = this.readNumberValue(item);
        var next = this.clampNumber(item, current + delta);
        if (next === current) return;  // already at clamp
        this.writeBoundValue(item, String(next));
        // Value read live in _appendResultRow; just re-render.
        this.renderResults();
    };

    CascadePaletteWidget.prototype.fireLeafAction = function (stage, action, keepOpen) {
        // In an action-menu stage, leaf-action `<<picked>>` is the entity
        // the menu acts on (the parent-picked). Otherwise (root entry leaf),
        // `<<picked>>` is the action's own title — only meaningful if the
        // action references itself, which is unusual.
        var pickedTitle = stage.kind === "actions"
            ? (stage.parentPicked || "")
            : action.title;
        var vars = this.buildStageVariables(stage, pickedTitle);
        this.afterAction(stage, keepOpen, function () {
            this.invokeViaNavigator(action.actions, vars);
        });
    };

    // Shared post-action helper: invoke the action, then either close the
    // palette (default) OR recompute + re-render the current stage to
    // reflect any state the action may have mutated (keepOpen=true).
    CascadePaletteWidget.prototype.afterAction = function (stage, keepOpen, doAction) {
        if (!keepOpen) {
            this.close();
            doAction.call(this);
            return;
        }
        // Run the action first; then refresh current stage so any state
        // changes the action triggered are reflected immediately.
        doAction.call(this);
        var self = this;
        // Defer recompute slightly — most TW actions are synchronous, but
        // statewrap/listops widgets schedule writes that take effect on the
        // next microtask. A 0ms timeout lets pending writes land first.
        setTimeout(function () {
            if (!self.open) return;
            self.recomputeStage(stage);
            self.renderStage();
        }, 0);
    };

    CascadePaletteWidget.prototype.drillSelected = function () {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // Drill entry/action → push filter stage. parent-picked propagation:
        //   - From root: no parent-picked (entries don't have one).
        //   - From action menu: keep the menu's parent-picked (the entity).
        //   - From filter (e.g. nested cascade entry): keep current parent.
        if (picked.kind === "drill" && picked.nextScope) {
            var parentPicked = stage.kind === "actions"
                ? (stage.parentPicked || null)
                : (stage.parentPicked || null);
            this.pushStage(this.buildFilterStage(picked, parentPicked));
            return;
        }

        // Tab on a dynamic entity result → push action menu stage.
        if (picked.isItem) {
            if (!stage.entityType) {
                if (console && console.info) {
                    console.info(
                        "[cascade-palette] no entity-type on stage; can't open action menu for",
                        picked.title
                    );
                }
                return;
            }
            this.pushStage(this.buildActionMenuStage(
                picked.title,
                stage.entityType,
                picked.title
            ));
            return;
        }
        // Tab on a leaf is a no-op.
    };

    exports["cascade-palette"] = CascadePaletteWidget;
})();
