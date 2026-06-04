/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-layer-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-layer-edit-rows[<layer-title>]
    Emit one JSON cascade-item string per facet row of a structure-layer's
    LONG-TAIL field editor — the drill behind each layer listed inside a view's
    "Edit all fields…" editor (cp-view-edit-rows). The operand is the layer
    tiddler title. Mirrors cp-view-edit-rows / cp-axis-edit-rows.

    The Structure strip already edits a layer's core STRUCTURE (roots /
    children / leaf / label) and its filter facets (entity-type / row-name /
    row-group / row-kind / row-actions) with live preview, and its axis chain
    via the chain picker — so those are NOT repeated here. This editor covers
    the genuinely layer-scoped long tail:
      - identity   : name                                   (text)
      - producer   : source (filter | entries); include-position (toggle)
      - row default: row-hint / row-icon / row-order / row-next-scope /
                     row-items-from                         (text)

    For a USER layer the rows bind-edit IN PLACE via `ca-bind-*`. For a SHIPPED
    (shadow-only) layer, editing in place would write an override, so the drill
    is read-only: a summary + a hint pointing at the Structure strip (which
    clones the layer to a scratchpad on first edit) or forking the whole view.

    Deleting a layer is intentionally NOT offered here — layers are shared
    parts composed by reference; removing one from a view is a Structure-strip
    gesture, distinct from deleting the (possibly shared) definition.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

function esc(s) { return String(s == null ? "" : s); }

exports["cp-layer-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var layerTitle = operator.operand || "";
    if (!layerTitle) return [];
    var t = wiki.getTiddler(layerTitle);
    var f = (t && t.fields) || {};
    var name = f["ca-layer-name"] || layerTitle.split("/").pop();
    var shipped = wiki.isShadowTiddler(layerTitle) && !wiki.tiddlerExists(layerTitle);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "(shipped layer — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "roots: " + (esc(f["ca-layer-roots"]) || "(none)") +
                "  ·  source: " + (esc(f["ca-layer-source"]) || "filter"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10"
        }));
        rows.push(JSON.stringify({
            "ca-name": "Edit via the Structure strip",
            "ca-icon": "🧱",
            "ca-hint": "Shipped layers can't be edited in place (they'd reappear " +
                "from the plugin). Tab to the Structure strip and edit this layer " +
                "there — it clones to a scratchpad on first edit — or fork the whole view.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // ---- USER layer — editable facet rows ------------------------------

    function textRow(field, caption, icon, order, group, hint) {
        var r = {
            "ca-name": caption,
            "ca-icon": icon,
            "ca-order": String(order),
            "ca-kind": "text",
            "ca-bind-tiddler": layerTitle,
            "ca-bind-field": field,
            "ca-bind-type": "text/plain"
        };
        if (group) r["ca-group"] = group;
        if (hint) r["ca-hint"] = hint;
        return JSON.stringify(r);
    }

    rows.push(textRow("ca-layer-name", "name", "🏷", 10, "identity",
        "Display name shown on the Structure strip and in the view's layer list."));

    rows.push(textRow("ca-layer-source", "source", "🛢", 30, "producer",
        "Producer: filter (default — ca-layer-roots drives the rows) | entries " +
        "(the JS-backed command-entries producer)."));
    rows.push(JSON.stringify({
        "ca-name": "include-position",
        "ca-icon": "📌",
        "ca-order": "32",
        "ca-kind": "toggle",
        "ca-bind-tiddler": layerTitle,
        "ca-bind-field": "ca-layer-include-position",
        "ca-true-value": "yes",
        "ca-false-value": "no",
        "ca-group": "producer",
        "ca-hint": "Honour per-entry ca-position-<view> placement for this layer's rows. Default: off."
    }));

    rows.push(textRow("ca-layer-row-hint", "row-hint", "💬", 70, "row defaults",
        "Filter producing a per-row hint (<currentTiddler> = the row)."));
    rows.push(textRow("ca-layer-row-icon", "row-icon", "🖼", 72, "row defaults",
        "Filter producing a per-row leading icon/glyph."));
    rows.push(textRow("ca-layer-row-order", "row-order", "🔢", 74, "row defaults",
        "Filter producing a per-row sort key for this layer's rows."));
    rows.push(textRow("ca-layer-row-next-scope", "row-next-scope", "⤵", 76, "row defaults",
        "Filter producing each row's drill children (makes data rows drillable)."));
    rows.push(textRow("ca-layer-row-items-from", "row-items-from", "🧩", 78, "row defaults",
        "Filter emitting synthetic child items (JSON cascade-items) per row."));

    return rows;
};
