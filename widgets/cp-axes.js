/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-axes
type: application/javascript
module-type: library

Axis engine for cascade-palette structure-layers.

An ''axis'' is a tiddler tagged `$:/tags/rimir/cascade-palette/axis` that
declares a derive-key filter (`ca-axis-key`) used to group rows of a
layer's source set into hierarchical buckets. A structure-layer may chain
several axes (year → month → day, status → year, …) via `ca-layer-axes`
(or `ca-view-axes` on an implicit-layer view) — descending into a bucket
narrows the source to rows whose axis key matches the bucket and re-
enters at the next axis. After the chain is exhausted, the layer's own
`roots`/`children` filters take over (so axes compose with recursive
trees: year → month → "By parent" subtree).

Performance: per-axis key results are memoised in a closure cache keyed
on `wiki.getChangeCount()` — first touch fills it, subsequent re-renders
are O(rows visited at this depth). The mindmap plugin already ships the
`groupBy`/`sortGroups` primitive (`$:/plugins/rimir/mindmap/lib/grouped-
tree.js`); we `require()` it when available and fall back to a tiny
inline version otherwise, so cascade-palette stays standalone.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LAYER_AXES_STATE_PREFIX = C.LAYER_AXES_STATE_PREFIX;

// Optional dependency — mindmap's grouped-tree lib. Inline a minimal
// equivalent if it isn't installed so axes work in a cascade-palette-
// only deployment.
var lib = null;
try { lib = require("$:/plugins/rimir/mindmap/lib/grouped-tree.js"); }
catch (e) { lib = null; }

var UNSET_KEY = (lib && lib.UNSET_KEY) || "__unset__";

function groupBy(items, keyFn) {
    if (lib && lib.groupBy) return lib.groupBy(items, keyFn);
    var groups = [];
    var byKey = Object.create(null);
    for (var i = 0; i < items.length; i++) {
        var raw = keyFn(items[i]);
        var key = (raw === null || raw === undefined || raw === "") ? UNSET_KEY : raw;
        if (!byKey[key]) { byKey[key] = { key: key, items: [] }; groups.push(byKey[key]); }
        byKey[key].items.push(items[i]);
    }
    return groups;
}

function sortGroups(entries, axis) {
    if (lib && lib.sortGroups) return lib.sortGroups(entries, axis);
    var mode = axis && axis.sort;
    if (!mode || mode === "first-seen") return entries;
    if (mode === "asc") {
        entries.sort(function (a, b) { return a.key.localeCompare(b.key); });
        return entries;
    }
    if (mode === "desc") {
        entries.sort(function (a, b) { return b.key.localeCompare(a.key); });
        return entries;
    }
    if (mode === "enum") {
        var order = Object.create(null);
        var keys = (axis && axis.sortKeys) || [];
        for (var i = 0; i < keys.length; i++) order[keys[i]] = i;
        entries.sort(function (a, b) {
            var ai = (a.key in order) ? order[a.key] : Infinity;
            var bi = (b.key in order) ? order[b.key] : Infinity;
            if (ai !== bi) return ai - bi;
            return a.key.localeCompare(b.key);
        });
    }
    return entries;
}

// --- key cache -------------------------------------------------------------
//
// Module-level cache keyed by axisCacheKey() = axisTitle + "\x00" + paramsHash.
// Invalidated when wiki.getChangeCount() advances (any tiddler write bumps
// it, including the source rows whose fields we derive keys from).
var axisKeyCache = Object.create(null);
var cacheChangeCount = -1;

function maybeInvalidateCache(wiki) {
    var cc = wiki.getChangeCount();
    if (cc !== cacheChangeCount) {
        axisKeyCache = Object.create(null);
        cacheChangeCount = cc;
    }
}

function axisCacheKey(axis) {
    return axis.title + "\x00" + (axis.params ? JSON.stringify(axis.params) : "");
}

// --- chain parsing ---------------------------------------------------------

// Two on-disk shapes:
//   1. Space-separated axis tiddler titles (simple — bare axes, no params)
//   2. JSON array of {title, params?} entries (supports parametric axes)
function parseChainSpec(raw) {
    if (!raw) return [];
    var trimmed = String(raw).trim();
    if (!trimmed) return [];
    if (trimmed.charAt(0) === "[") {
        try {
            var parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map(function (e) {
                    if (typeof e === "string") return { title: e, params: null };
                    return { title: e.title, params: e.params || null };
                }).filter(function (e) { return !!e.title; });
            }
        } catch (err) { /* fall through */ }
    }
    return trimmed.split(/\s+/).filter(function (s) { return s; })
        .map(function (t) { return { title: t, params: null }; });
}

function layerSlug(layer) {
    if (!layer) return "";
    if (layer.title) {
        var t = String(layer.title);
        return t.split("/").pop() || t;
    }
    if (layer.name) return layer.name.replace(/[^\w-]+/g, "_");
    return "";
}

// Session override first, declared default second.
function activeChainSpec(wiki, layer) {
    var slug = layerSlug(layer);
    if (slug) {
        var stateTitle = LAYER_AXES_STATE_PREFIX + slug;
        var text = wiki.getTiddlerText(stateTitle, "");
        if (text && text.trim()) {
            try {
                var parsed = JSON.parse(text);
                if (parsed && Array.isArray(parsed.axes)) {
                    return parsed.axes.map(function (e) {
                        if (typeof e === "string") return { title: e, params: null };
                        return { title: e.title, params: e.params || null };
                    }).filter(function (e) { return !!e.title; });
                }
            } catch (err) { /* malformed — fall through to default */ }
        }
    }
    return parseChainSpec(layer && layer.axes);
}

// --- axis loading + evaluation --------------------------------------------

function loadAxisByTitle(wiki, title, params) {
    var t = wiki.getTiddler(title);
    if (!t) return null;
    var f = t.fields || {};
    var sortKeysRaw = f["ca-axis-sort-keys"] || "";
    var sortKeys = sortKeysRaw.split(/\s+/).filter(function (s) { return s; });
    return {
        title: title,
        name: f["ca-axis-name"] || title.split("/").pop(),
        hint: f["ca-axis-hint"] || "",
        keyFilter: f["ca-axis-key"] || "",
        labelFilter: f["ca-axis-label"] || "",
        sort: (f["ca-axis-sort"] || "first-seen").toLowerCase(),
        sortKeys: sortKeys,
        emptyLabel: f["ca-axis-empty-label"] || "—",
        icon: f["ca-axis-icon"] || "",
        params: params || null
    };
}

function resolveChain(wiki, chainSpec) {
    var resolved = [];
    for (var i = 0; i < chainSpec.length; i++) {
        var entry = chainSpec[i];
        var axis = loadAxisByTitle(wiki, entry.title, entry.params);
        if (axis) resolved.push(axis);
    }
    return resolved;
}

function paramsAsVars(params) {
    var out = {};
    if (!params) return out;
    Object.keys(params).forEach(function (k) {
        out["axis-param-" + k] = String(params[k]);
    });
    return out;
}

function evalKey(widget, axis, tiddlerTitle) {
    maybeInvalidateCache(widget.wiki);
    var ck = axisCacheKey(axis);
    var bucket = axisKeyCache[ck];
    if (!bucket) { bucket = Object.create(null); axisKeyCache[ck] = bucket; }
    if (tiddlerTitle in bucket) return bucket[tiddlerTitle];
    var val = "";
    if (axis.keyFilter) {
        var vars = paramsAsVars(axis.params);
        vars.currentTiddler = tiddlerTitle;
        try {
            // Source = [tiddlerTitle] so bare filters like
            // `[get[created]format:date[YYYY]]` operate on this row's tiddler.
            // Without an explicit source, wiki.filterTiddlers falls back to
            // `wiki.each` (all non-system tiddlers) and the filter returns a
            // result per-tiddler instead of per-row — `r[0]` then resolves to
            // the first iteration order tiddler's value, bucketing every row
            // under the same wrong key. Filters that explicitly reference
            // `<currentTiddler>` still work — the variable remains bound.
            var r = widget.wiki.filterTiddlers(
                axis.keyFilter,
                widget.makeFakeWidget(vars),
                [tiddlerTitle]
            );
            val = (r.length && r[0]) ? r[0] : "";
        } catch (err) {
            if (console && console.error) {
                console.error("[cp-axes] key filter failed for",
                    axis.title, "on", tiddlerTitle, "—", err && err.message);
            }
        }
    }
    bucket[tiddlerTitle] = val;
    return val;
}

function evalLabel(widget, axis, key) {
    if (key === UNSET_KEY) return axis.emptyLabel || "—";
    if (!axis.labelFilter) return key;
    var vars = paramsAsVars(axis.params);
    vars.currentTiddler = key;
    try {
        // Source = [key] so the label filter operates on the bucket key
        // (matches the key-filter convention in `evalKey` above). The
        // `<currentTiddler>` variable is bound to the key too — filters
        // can reference either form.
        var r = widget.wiki.filterTiddlers(
            axis.labelFilter,
            widget.makeFakeWidget(vars),
            [key]
        );
        return (r.length && r[0]) ? r[0] : key;
    } catch (err) {
        return key;
    }
}

// Narrow `source` (tiddler titles) by parentPath[i] === keyFor(axis[i], row),
// up to min(parentPath.length, chain.length).
function narrowByParents(widget, source, chain, parentPath) {
    var cap = Math.min((parentPath || []).length, chain.length);
    if (cap === 0) return source;
    var current = source;
    for (var i = 0; i < cap; i++) {
        var axis = chain[i];
        var want = parentPath[i];
        var next = [];
        for (var j = 0; j < current.length; j++) {
            var k = evalKey(widget, axis, current[j]);
            var normalized = (k === null || k === undefined || k === "") ? UNSET_KEY : k;
            if (normalized === want) next.push(current[j]);
        }
        current = next;
    }
    return current;
}

// --- public surface --------------------------------------------------------

// Returns the resolved chain (axis descriptors) for a layer.
function activeChain(wiki, layer) {
    return resolveChain(wiki, activeChainSpec(wiki, layer));
}

// Where are we in the chain? Bucket entries occupy parentPath[0..len-1].
function depthIntoChain(parentPath, chainLength) {
    if (!parentPath || !parentPath.length) return 0;
    return Math.min(parentPath.length, chainLength);
}

// Evaluate the current axis depth → array of synthetic bucket rows. Returns
// null when parentPath has exhausted the chain (caller falls through to the
// layer's normal roots/children logic with the narrowed source).
//
// Row shape (consumed by cp-views.js):
//   {
//     _isAxisBucket: true,
//     _axisTitle, _axisDepth,
//     _bucketKey, _bucketLabel, _bucketIcon,
//     _treeParent: <bucketKey>,   // reuses tree-drill plumbing
//     count: <items in bucket>,
//     _layerName, _layerTitle
//   }
function evaluateAxisChainAtDepth(widget, layer, parentPath) {
    var chain = activeChain(widget.wiki, layer);
    if (!chain.length) return null;
    var depth = depthIntoChain(parentPath, chain.length);
    if (depth >= chain.length) return null;
    if (!layer.roots) return [];
    var source = [];
    try { source = widget.wiki.filterTiddlers(layer.roots, null); }
    catch (err) { return []; }
    var narrowed = narrowByParents(widget, source, chain, parentPath);
    var currentAxis = chain[depth];
    var groups = groupBy(narrowed, function (t) { return evalKey(widget, currentAxis, t); });
    var entries = groups.map(function (g) {
        return {
            key: g.key,
            label: evalLabel(widget, currentAxis, g.key),
            count: g.items.length
        };
    });
    sortGroups(entries, currentAxis);
    return entries.map(function (e) {
        return {
            _isAxisBucket: true,
            _axisTitle: currentAxis.title,
            _axisDepth: depth,
            _bucketKey: e.key,
            _bucketLabel: e.label,
            _bucketIcon: currentAxis.icon || "",
            _treeParent: e.key,
            count: e.count,
            _layerTitle: layer.title || "",
            _layerName: layer.name || ""
        };
    });
}

// Source after axes are fully consumed — used at the transition from axis
// layer to the layer's recursive children OR for leaf emission when no
// children filter is set. Returns tiddler titles.
function sourceAfterAxes(widget, layer, parentPath) {
    var chain = activeChain(widget.wiki, layer);
    if (!chain.length) return [];
    if (!layer.roots) return [];
    var source = [];
    try { source = widget.wiki.filterTiddlers(layer.roots, null); }
    catch (err) { return []; }
    return narrowByParents(widget, source, chain, parentPath);
}

// State writes --------------------------------------------------------------

function writeChainState(wiki, layer, chainSpec) {
    var slug = layerSlug(layer);
    if (!slug) return;
    var stateTitle = LAYER_AXES_STATE_PREFIX + slug;
    if (!chainSpec || !chainSpec.length) {
        wiki.deleteTiddler(stateTitle);
        return;
    }
    var serialised = chainSpec.map(function (e) {
        if (!e.params) return { title: e.title };
        return { title: e.title, params: e.params };
    });
    wiki.addTiddler({
        title: stateTitle,
        type: "application/json",
        text: JSON.stringify({ axes: serialised })
    });
}

// Read the current active chain spec (state OR declared default) and return
// it as a plain array of {title, params?} entries — useful for mutating
// before writing back.
function readChainSpec(wiki, layer) {
    return activeChainSpec(wiki, layer);
}

exports.UNSET_KEY = UNSET_KEY;
exports.parseChainSpec = parseChainSpec;
exports.activeChainSpec = activeChainSpec;
exports.activeChain = activeChain;
exports.loadAxisByTitle = loadAxisByTitle;
exports.evaluateAxisChainAtDepth = evaluateAxisChainAtDepth;
exports.sourceAfterAxes = sourceAfterAxes;
exports.depthIntoChain = depthIntoChain;
exports.evalKey = evalKey;
exports.evalLabel = evalLabel;
exports.layerSlug = layerSlug;
exports.writeChainState = writeChainState;
exports.readChainSpec = readChainSpec;
