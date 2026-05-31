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
var STICKY_CONTEXT_TITLE = C.STICKY_CONTEXT_TITLE;

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
        // Active filter pills are applied via the shared helper so virtual
        // menu entries are exempted from narrowing. When no pills are
        // active the helper falls through to a plain `_filterInScope`.
        var titles;
        try {
            titles = this._applyFilterSuffix(stage.filter, variables);
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
            jsonStrings = this._filterInScope(stage.itemsFromFilter, variables);
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
    //
    // Base vars:
    //   query                 current stage's input text
    //   picked                the just-picked item (null/"" for filter eval, set for actions)
    //   parent-picked         pick from the stage one back
    //   stage-N-picked        pick from stage index N (0 = root). For root entries
    //                         we don't have a picked title, so `stage-0-picked` is "".
    //   context-tiddler       tiddler the user was looking at when the palette opened.
    //                         Empty when no context was captured.
    //   currentTiddler        bound to the picked title (when picked is non-empty).
    //                         View-emitted row-actions reach for this name by convention.
    //   stage-preview-context value from `ca-preview-context` on whatever entry/action
    //                         drilled the user into the current subtree. Topmost stage
    //                         with a non-empty `_previewContext` wins.
    //
    // Defensive when stage is null/undefined — returns a base map with empty
    // values (used by edit-mode commit + row-icon fire paths where the stage
    // pointer may have been popped by the time the action fires).
    //
    // `extras`: optional plain object; keys MERGE OVER the base vars (so the
    // caller can override `currentTiddler` to the row tiddler, inject
    // `payload` / `row-icon-key` / `row-icon-mode` / `keep-open` / etc.
    // without monkey-patching the returned object).
    proto.buildStageVariables = function (stage, picked, extras) {
        // Sticky context — session-persistent list of pinned tiddler titles
        // exposed to every filter/action site. Raw title-list string
        // (TW parseStringArray format) so authors can pipe straight into
        // `[enlist<sticky-context-list>]`. Count exposed separately for
        // badge/conditional UI. Empty string when nothing is pinned —
        // filters using `enlist<sticky-context-list>` then iterate zero
        // titles, which is the natural "no narrowing" behaviour.
        var stickyList = "";
        var stickyCount = "0";
        var stickyTid = this.wiki.getTiddler(STICKY_CONTEXT_TITLE);
        if (stickyTid && stickyTid.fields && stickyTid.fields.list) {
            var listField = stickyTid.fields.list;
            var titles = Array.isArray(listField)
                ? listField
                : $tw.utils.parseStringArray(String(listField));
            if (titles && titles.length) {
                stickyList = $tw.utils.stringifyList(titles);
                stickyCount = String(titles.length);
            }
        }
        var vars = {
            "query": (stage && stage.query) || "",
            "picked": picked || "",
            "parent-picked": (stage && stage.parentPicked) || "",
            "context-tiddler": this.contextTiddler || "",
            "sticky-context-list": stickyList,
            "sticky-context-count": stickyCount
        };
        if (picked) vars["currentTiddler"] = picked;
        for (var i = 0; i < this.stack.length; i++) {
            var s = this.stack[i];
            vars["stage-" + i + "-picked"] = s.parentPicked || "";
        }
        vars["stage-preview-context"] = "";
        for (var k = this.stack.length - 1; k >= 0; k--) {
            var sp = this.stack[k];
            if (sp && sp._previewContext) {
                vars["stage-preview-context"] = sp._previewContext;
                break;
            }
        }
        if (extras) {
            for (var key in extras) {
                if (Object.prototype.hasOwnProperty.call(extras, key)) {
                    vars[key] = extras[key];
                }
            }
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

    // Canonical wrapper around wiki.filterTiddlers + makeFakeWidget.
    // Centralises the makeFakeWidgetWithVariables invariant (see
    // [[tw-gotchas-widget-context#Custom fake widgets...]]) — every site
    // that injects variables into a filter eval MUST route through here
    // so future schema changes / debugging hooks land in one place.
    //
    // vars     null / falsy → widget = null (matches the historical
    //                          "no variable injection, wiki.each default"
    //                          path used at root-level roots-filter sites)
    //          truthy        → makeFakeWidget(vars)
    // source   optional 3rd argument to wiki.filterTiddlers — undefined =
    //                          default (wiki.each); pass [seedTitle] to
    //                          anchor a per-row filter to that one title
    //                          (axis key/label eval, etc.)
    proto._filterInScope = function (filterStr, vars, source) {
        // Always make sticky-context-list / -count ambient in every filter
        // eval routed through here. They're cp-owned global state (not
        // stage-local), so per-row template filters (ca-view-row-icon,
        // ca-view-sort-key, etc.), inner `:filter` predicates, and even
        // view-level roots filters that pass null vars can reference
        // `<<sticky-context-list>>` without each call site threading the
        // values through. Cheap: one `wiki.getTiddler` + `parseStringArray`
        // per filter eval, negligible vs the filter eval itself.
        var augmented = vars ? {} : {};
        if (vars) {
            for (var k in vars) augmented[k] = vars[k];
        }
        if (augmented["sticky-context-list"] === undefined) {
            var stickyTid = this.wiki.getTiddler(STICKY_CONTEXT_TITLE);
            var stickyList = "";
            var stickyCount = "0";
            if (stickyTid && stickyTid.fields && stickyTid.fields.list) {
                var listField = stickyTid.fields.list;
                var titles = Array.isArray(listField)
                    ? listField
                    : $tw.utils.parseStringArray(String(listField));
                if (titles && titles.length) {
                    stickyList = $tw.utils.stringifyList(titles);
                    stickyCount = String(titles.length);
                }
            }
            augmented["sticky-context-list"] = stickyList;
            augmented["sticky-context-count"] = stickyCount;
        }
        var fakeWidget = this.makeFakeWidget(augmented);
        return this.wiki.filterTiddlers(filterStr, fakeWidget, source);
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

    // Per-item search walker. Two independent layers:
    //   Meta layer:    cascade-item author meta (item[key]).
    //                  Keys come from (in priority): active meta pills via
    //                  `_activeMetaKeys()` → per-item `ca-search-fields`
    //                  (stored as `searchFields` on the item) → global
    //                  default at `$:/config/rimir/cascade-palette/
    //                  search-fields-default` (ships "name hint").
    //   Field layer:   literal tiddler fields on the row's backing
    //                  tiddler. Fields come from active field pills via
    //                  `_activeTiddlerFields()`. No default — when no
    //                  field pills are pushed, the layer is skipped.
    // Matches lowercased substring; collects ALL matches across both
    // layers into `item._matches` — consumed by cp-rendering to surface
    // a snippet line per matched field so the user sees WHY every
    // result is in the list. `_match` is kept as a back-compat pointer
    // to the first match for the inline name/hint highlight.
    // Plumbed identically for the local-stage and deep-search paths.
    proto.filterByQuery = function (items, query) {
        if (!query) {
            for (var i = 0; i < items.length; i++) {
                items[i]._match = null;
                items[i]._matches = null;
            }
            return items.slice();
        }
        var metaOverride = this._activeMetaPills ? this._activeMetaPills() : null;
        var fieldOverride = this._activeFieldPills ? this._activeFieldPills() : null;
        var globalDefault = this._defaultSearchFields();
        var kept = [];
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            var matches = this._highlightMatches(item, query, metaOverride, fieldOverride, globalDefault);
            if (matches.length) {
                item._matches = matches;
                item._match = matches[0];
                kept.push(item);
            } else {
                item._match = null;
                item._matches = null;
            }
        }
        return kept;
    };

    // Per-item match computation. Pure (apart from one read of the
    // active pill lists / default when caller doesn't pre-supply them).
    // Walks the meta layer then the field layer; emits one match per
    // hit. NO mutation of `item` — that's filterByQuery's job. Returns
    // [] when no matches OR when query is empty.
    //
    // `metaOverride` is an array of meta-pill instances (each carrying
    // `metaKey` + `chip`), or null when no meta pills are pushed (the
    // matcher then falls back to per-row `ca-search-fields` /
    // `globalDefault` as plain meta-keys).
    //
    // `fieldOverride` is an array of field-pill instances (each
    // carrying `tiddlerField` + `chip`), or null when no field pills
    // are pushed (the tiddler-field layer is skipped).
    //
    // `globalDefault` is the meta-key-array fallback (used only when
    // metaOverride is null and the row has no `searchFields`).
    //
    // Each match: {field, label, value, start, len}.
    //   `field` is the resolution slot name (meta key or tiddler field
    //           name) — used for stable diffing / tests.
    //   `label` is the display chip (when sourced from a pushed pill)
    //           or the slot name as fallback — consumed by cp-rendering
    //           for snippet captions ("🏷 Name" not "name").
    //   `value` is the resolved text (array-flatten applied) so the
    //           renderer doesn't re-read it.
    proto._highlightMatches = function (item, query, metaOverride, fieldOverride, globalDefault) {
        if (!query) return [];
        var q = String(query).toLowerCase();
        if (metaOverride === undefined) {
            metaOverride = this._activeMetaPills ? this._activeMetaPills() : null;
        }
        if (fieldOverride === undefined) {
            fieldOverride = this._activeFieldPills ? this._activeFieldPills() : null;
        }
        if (globalDefault === undefined) {
            globalDefault = this._defaultSearchFields();
        }
        var matches = [];

        // Meta layer. Active meta pills override per-row / global
        // default. Each entry is a pill instance with `metaKey` +
        // `chip` (for snippet labels). The fallback path constructs
        // synthetic specs with `metaKey` only (label = key).
        var metaSpecs;
        if (metaOverride) {
            metaSpecs = metaOverride;
        } else {
            var fallbackKeys = (item.searchFields && item.searchFields.length)
                ? item.searchFields
                : globalDefault;
            metaSpecs = [];
            for (var fi = 0; fi < fallbackKeys.length; fi++) {
                metaSpecs.push({metaKey: fallbackKeys[fi], chip: fallbackKeys[fi]});
            }
        }
        for (var mi = 0; mi < metaSpecs.length; mi++) {
            var mspec = metaSpecs[mi];
            var mk = mspec.metaKey;
            if (!mk) continue;
            var mv = this._resolveMetaField(item, mk);
            if (!mv) continue;
            var midx = mv.toLowerCase().indexOf(q);
            if (midx !== -1) {
                matches.push({
                    field: mk,
                    label: mspec.chip || mk,
                    value: mv,
                    start: midx,
                    len: q.length
                });
            }
        }

        // Tiddler-field layer. Active only when field pills are pushed.
        // Synthetic rows (no backing tiddler) silently skip.
        if (fieldOverride && item.title) {
            for (var ti = 0; ti < fieldOverride.length; ti++) {
                var fspec = fieldOverride[ti];
                var tf = fspec.tiddlerField;
                if (!tf) continue;
                var tv = this._resolveTiddlerField(item, tf);
                if (!tv) continue;
                var tidx = tv.toLowerCase().indexOf(q);
                if (tidx !== -1) {
                    matches.push({
                        field: tf,
                        label: fspec.chip || tf,
                        value: tv,
                        start: tidx,
                        len: q.length
                    });
                }
            }
        }
        return matches;
    };

    proto._defaultSearchFields = function () {
        var raw = this.wiki.getTiddlerText(
            "$:/config/rimir/cascade-palette/search-fields-default",
            "name hint"
        );
        return (raw && raw.match(/\S+/g)) || ["name", "hint"];
    };

    // Resolve a cascade-item meta value for matching. Reads item[key]
    // ONLY — no tiddler-field fallback. Synthetic rows AND tiddler-
    // backed rows both go through here for meta pills. Used by the
    // meta layer of `_highlightMatches`.
    proto._resolveMetaField = function (item, key) {
        var v = item[key];
        if (v === undefined || v === null) return "";
        if (Array.isArray(v)) return v.join(" ");
        return String(v);
    };

    // Resolve a literal tiddler-field value for matching. Reads
    // `wiki.getTiddler(item.title).fields[fieldName]` ONLY. Returns ""
    // when the row has no backing tiddler or the field is unset. List-
    // typed fields (tags etc.) flatten to space-separated strings.
    // Used by the field layer of `_highlightMatches`.
    proto._resolveTiddlerField = function (item, fieldName) {
        if (!item.title) return "";
        var t = this.wiki.getTiddler(item.title);
        if (!t) return "";
        var fv = t.fields && t.fields[fieldName];
        if (fv === undefined || fv === null) return "";
        if (Array.isArray(fv)) return fv.join(" ");
        return String(fv);
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
