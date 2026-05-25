/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-actions
type: application/javascript
module-type: library

Filter evaluation + action invocation.

Splits into three concerns:
  1. Group resolution — derive cluster label from shadow source.
  2. Filter-stage evaluation — turn `ca-next-scope` / `ca-items-from`
     into the stage's items list. Handles both static-tiddler-titles
     and synthetic-JSON paths.
  3. Action invocation — locate the right action-parent in the page
     widget tree (statewrap → navigator → rootWidget) and run wikitext
     so navigator-routed messages (tm-edit-tiddler etc.) reach their
     handlers.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var DEFAULT_ORDER = C.DEFAULT_ORDER;
var MAX_RESULTS_CONFIG = C.MAX_RESULTS_CONFIG;
var DEFAULT_MAX_RESULTS = C.DEFAULT_MAX_RESULTS;

module.exports = function (proto) {

    // Resolve the cluster label for an item. Explicit `ca-group` wins.
    // Otherwise derive from the shadow source: look up the owning plugin
    // tiddler and use its `name` field (the lowercase short name from
    // plugin.info). Falls back to the plugin title with the `$:/plugins/`
    // prefix stripped if the plugin has no `name`. Non-shadow (user-
    // authored) tiddlers get "" — they share an unnamed cluster which
    // renders as "Other" when mixed with named groups.
    proto.resolveGroup = function (title, fields) {
        if (fields && fields["ca-group"]) return fields["ca-group"];
        var src = this.wiki.getShadowSource ? this.wiki.getShadowSource(title) : null;
        if (!src) return "";
        var pluginTid = this.wiki.getTiddler(src);
        if (pluginTid && pluginTid.fields && pluginTid.fields.name) {
            return pluginTid.fields.name;
        }
        return src.replace(/^\$:\/plugins\//, "");
    };

    proto.evaluateFilterStage = function (stage) {
        // ca-items-from path: filter returns one JSON-string per synthetic
        // item. Each parsed object is treated as a fully-formed cascade-item
        // spec (the same shape readCascadeFields normally extracts from a
        // tiddler's fields).
        if (stage.itemsFromFilter) {
            return this._evaluateItemsFromStage(stage);
        }
        if (!stage.filter) return [];
        var variables = this.buildStageVariables(stage, null);
        // Active filter pills contribute additional filter runs that
        // intersect with the stage's own filter. Concatenating
        // `+[...]+[...]` after the base filter narrows results without
        // disturbing the stage's own logic; empty suffix means no filters
        // active.
        var fullFilter = stage.filter + this._composeFilterSuffix();
        var titles;
        try {
            titles = this.wiki.filterTiddlers(
                fullFilter,
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
        var asLink = stage.asLink;
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var fields = (t && t.fields) || {};
            // Cascade-aware detection: if the result tiddler carries
            // `ca-kind`, treat it as a real entry/action (drill or leaf).
            // The parent drill can opt out via `ca-next-as-link: yes` —
            // useful for diagnostic lists where the user wants to OPEN
            // each tiddler, not drill into it.
            if (!asLink && fields["ca-kind"]) {
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

    // ca-items-from: evaluate the filter, parse each result as JSON, build
    // a cascade item per parsed object. Parse errors are logged once per
    // result and the item is skipped — partial results survive bad JSON.
    proto._evaluateItemsFromStage = function (stage) {
        var variables = this.buildStageVariables(stage, null);
        var jsonStrings;
        try {
            jsonStrings = this.wiki.filterTiddlers(
                stage.itemsFromFilter,
                this.makeFakeWidget(variables)
            );
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] ca-items-from filter error in stage",
                    stage.title, "—", err && err.message
                );
            }
            return [];
        }
        var self = this;
        var items = [];
        jsonStrings.forEach(function (str) {
            if (!str || !str.trim()) return;
            var obj;
            try {
                obj = JSON.parse(str);
            } catch (parseErr) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-items-from JSON parse error in stage",
                        stage.title, "—", parseErr && parseErr.message,
                        "input:", str.length > 80 ? str.slice(0, 80) + "..." : str
                    );
                }
                return;
            }
            if (!obj || typeof obj !== "object") return;
            items.push(self.readCascadeFromObject(obj));
        });
        return items;
    };

    // Build the full variable map exposed to filter and action contexts.
    // - `query` — current stage's input text
    // - `picked` — the just-picked item (null for filter eval, set for actions)
    // - `parent-picked` — pick from the stage one back
    // - `stage-N-picked` — pick from stage index N (0 = root). For root entries
    //   we don't have a picked title, so `stage-0-picked` is "".
    proto.buildStageVariables = function (stage, picked) {
        var vars = {
            "query": stage.query || "",
            "picked": picked || "",
            "parent-picked": stage.parentPicked || "",
            // The tiddler the user was looking at when the palette opened.
            // Empty when no context was captured. Scope filters and actions
            // can use this to do context-aware work (e.g. show backlinks,
            // sibling tiddlers, etc.).
            "context-tiddler": this.contextTiddler || ""
        };
        // Also expose `currentTiddler` bound to the picked title — view-
        // emitted row-actions (and authors more broadly) reach for this
        // name by convention. Distinct from the widget-tree's natural
        // currentTiddler, which the action parent already provides if
        // we don't override.
        if (picked) vars["currentTiddler"] = picked;
        // Walk the stack to expose stage-N-picked. The current stage's
        // own pick is captured via `picked` above; we record parent picks
        // from the actual stack history.
        for (var i = 0; i < this.stack.length; i++) {
            var s = this.stack[i];
            vars["stage-" + i + "-picked"] = s.parentPicked || "";
        }
        // Expose `stage-preview-context` — the context value computed by
        // `ca-preview-context` on whatever entry/action drilled the user
        // into the current subtree. Topmost stage with a non-empty
        // `_previewContext` wins, so deeper stages can still reference
        // "what we're talking about" via this variable.
        for (var k = this.stack.length - 1; k >= 0; k--) {
            var sp = this.stack[k];
            if (sp && sp._previewContext) {
                vars["stage-preview-context"] = sp._previewContext;
                break;
            }
        }
        if (!("stage-preview-context" in vars)) {
            vars["stage-preview-context"] = "";
        }
        return vars;
    };

    proto.makeFakeWidget = function (variables) {
        // Delegate to TW core's Widget.prototype.makeFakeWidgetWithVariables:
        // it layers `variables` on top of this widget's parent chain (so
        // both injected literals AND $:/tags/Macro-tagged \function defs
        // imported by the startup `\import` pragma resolve correctly), and
        // — crucially — propagates `makeFakeWidgetWithVariables` onto the
        // returned fake widget. Filter prefixes `:filter`, `:map`, `:reduce`,
        // `:sortsub` all call back into this method to spawn per-iteration
        // child widgets. A plain object stub would throw "is not a function".
        return this.makeFakeWidgetWithVariables(variables);
    };

    /* ---------- navigator routing ---------- */

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
    proto.findActionParent = function () {
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

    proto.invokeViaNavigator = function (actionString, variables) {
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

    proto.filterByQuery = function (items, query) {
        if (!query) return items.slice();
        var q = query.toLowerCase();
        return items.filter(function (item) {
            return item.name.toLowerCase().indexOf(q) !== -1
                || (item.hint && item.hint.toLowerCase().indexOf(q) !== -1);
        });
    };

    proto.sortEntries = function (items) {
        return items.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
    };

    proto.getMaxResults = function () {
        var raw = this.wiki.getTiddlerText(MAX_RESULTS_CONFIG, String(DEFAULT_MAX_RESULTS));
        var n = parseInt(raw, 10);
        return isNaN(n) || n < 1 ? DEFAULT_MAX_RESULTS : n;
    };

};
