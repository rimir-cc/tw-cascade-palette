/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-axis-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-axis-edit-rows[<axis-title>]
    Emit one JSON cascade-item string per facet row of an axis's field editor
    (the drill behind each row of the "Manage axes" list). The operand is the
    axis tiddler title. Mirrors cp-lens-edit-rows.

    For a USER axis (a real, editable tiddler) the rows bind-edit the axis IN
    PLACE via the engine's standard `ca-bind-*` mechanism (Enter → edit-mode
    → writeBoundValue):
      - name / hint / icon / order        (text)
      - key                               (the per-row grouping filter)
      - label                             (bucket-key → display-label filter)
      - sort / sort-keys / empty-label    (text)
      - 🗑 Delete axis                    (confirm → DELETE_AXIS_MESSAGE)
    If `ca-axis-key` carries `<axis-param-X>` placeholders, a read-only info
    row names them (their VALUES are set per use in the layer's axis chain,
    not on the definition).

    For a SHIPPED (shadow-only) axis the facets are NOT editable in place
    (that would mutate the shadow), so the drill offers a single
    "📋 Clone to a custom axis to edit" leaf (CLONE_AXIS_MESSAGE) that copies
    it to AXES_NS and reopens the list, where the editable copy now appears.

    Note: like the lens field editor, `key`/`label` edit as plain text here —
    the live "✓ N matches" feedback is JS-only (cp-firing editKind "filter")
    and reached via the "+ New axis…" creator flow (cp-axis-editor).
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var AXIS_TAG = C.AXIS_TAG;

function esc(s) { return String(s == null ? "" : s); }

exports["cp-axis-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var axisTitle = operator.operand || "";
    if (!axisTitle) return [];
    var t = wiki.getTiddler(axisTitle);
    var f = (t && t.fields) || {};
    var name = f["ca-axis-name"] || axisTitle.split("/").pop();
    var shipped = wiki.isShadowTiddler(axisTitle) && !wiki.tiddlerExists(axisTitle);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "📋 Clone to a custom axis to edit",
            "ca-icon": "📋",
            "ca-hint": "Shipped axes can't be edited in place (they'd reappear " +
                "from the plugin). Clone “" + esc(name) + "” to an editable copy " +
                "under your axis namespace, then edit that.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10",
            "ca-actions": '<$action-sendmessage $message="' + C.CLONE_AXIS_MESSAGE +
                '" axis="' + axisTitle + '"/>' +
                '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
                '" entry="$:/plugins/rimir/cascade-palette/entries/manage-axes"/>'
        }));
        rows.push(JSON.stringify({
            "ca-name": "(shipped — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "key: " + (esc(f["ca-axis-key"]) || "(none)") +
                "  ·  sort: " + (esc(f["ca-axis-sort"]) || "first-seen"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // ---- USER axis — editable facet rows -------------------------------

    function textRow(field, caption, icon, order, group, hint) {
        var r = {
            "ca-name": caption,
            "ca-icon": icon,
            "ca-order": String(order),
            "ca-kind": "text",
            "ca-bind-tiddler": axisTitle,
            "ca-bind-field": field,
            "ca-bind-type": "text/plain"
        };
        if (group) r["ca-group"] = group;
        if (hint) r["ca-hint"] = hint;
        return JSON.stringify(r);
    }

    rows.push(textRow("ca-axis-name", "name", "🏷", 10, "axis",
        "Display name shown in the chain picker and this list."));
    rows.push(textRow("ca-axis-hint", "hint", "💬", 12, "axis",
        "One-line description shown when the axis is focused."));
    rows.push(textRow("ca-axis-icon", "icon", "🧭", 14, "axis",
        "Optional leading glyph for the axis."));
    rows.push(textRow("ca-order", "order", "🔢", 16, "axis",
        "Sort order among axes in the picker / this list (default 100)."));

    rows.push(textRow("ca-axis-key", "key", "🔑", 30, "grouping",
        "The grouping key — a filter run per row with <currentTiddler> = the " +
        "row; its first result is the bucket key. `<axis-param-X>` placeholders " +
        "become per-use parameters set in the chain."));
    rows.push(textRow("ca-axis-label", "label", "🔖", 32, "grouping",
        "Optional — a filter mapping a bucket key to its display label " +
        "(<currentTiddler> = the key). Empty = show the key itself."));

    rows.push(textRow("ca-axis-sort", "sort", "↕", 50, "ordering",
        "Bucket order: first-seen | asc | desc | enum (enum uses sort-keys)."));
    rows.push(textRow("ca-axis-sort-keys", "sort-keys", "🔢", 52, "ordering",
        "Space-separated key order for sort:enum (e.g. month names)."));
    rows.push(textRow("ca-axis-empty-label", "empty-label", "␀", 54, "ordering",
        "Label for the bucket of rows whose key is empty."));

    // Parametric axes — surface the discovered param names (values are set
    // per use in the layer's chain, not on the definition).
    var key = String(f["ca-axis-key"] || "");
    var re = /<axis-param-([\w-]+)>/g;
    var params = [];
    var m;
    while ((m = re.exec(key)) !== null) {
        if (params.indexOf(m[1]) < 0) params.push(m[1]);
    }
    if (params.length) {
        rows.push(JSON.stringify({
            "ca-name": "params: " + params.join(", "),
            "ca-icon": "🧩",
            "ca-hint": "This axis is parametric. Each `<axis-param-X>` in the " +
                "key is set per use where the axis is added to a layer's chain.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-group": "grouping",
            "ca-order": "40"
        }));
    }

    // Delete.
    rows.push(JSON.stringify({
        "ca-name": "🗑 Delete this axis",
        "ca-order": "95",
        "ca-group": "danger",
        "ca-kind": "leaf",
        "ca-confirm": "yes",
        "ca-confirm-consequence": "Permanently delete the axis “" + name +
            "”. Any layer chain using it falls back to a plain label. This cannot be undone.",
        "ca-actions": '<$action-sendmessage $message="' + C.DELETE_AXIS_MESSAGE +
            '" axis="' + axisTitle + '"/>' +
            '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
            '" entry="$:/plugins/rimir/cascade-palette/entries/manage-axes"/>'
    }));

    return rows;
};
