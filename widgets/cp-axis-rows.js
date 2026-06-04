/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-axis-rows.js
type: application/javascript
module-type: filteroperator

cp-axis-rows[]
    Emit one JSON cascade-item string per row of the "Manage axes" list
    (consumed by entries/manage-axes.tid via `ca-items-from: [cp-axis-rows[]]`),
    mirroring cp-lens-rows:

      - a "+ New axis…" creator row firing NEW_AXIS_MESSAGE (the live-preview
        author flow: seed → edit ca-axis-key with live count → name → save).
      - one row per existing axis (tagged AXIS_TAG): a DRILL into the axis's
        per-facet field editor (`[cp-axis-edit-rows[<title>]]`). A USER axis
        row carries ca-on-delete (DELETE_AXIS_MESSAGE behind the engine's
        confirm); a SHIPPED (shadow-only) row omits it (clone to edit).

    Source feed + operand are ignored. Building the JSON in JS keeps the
    quoting in one place and lets the row set be unit-tested.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var AXIS_TAG = C.AXIS_TAG;

exports["cp-axis-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var rows = [];

    // Creator row.
    rows.push(JSON.stringify({
        "ca-name": "+ New axis…",
        "ca-icon": "🧭",
        "ca-hint": "Create a group-by axis — type its grouping key filter " +
            "with live match-count, then name it.",
        "ca-kind": "leaf",
        "ca-after-fire": "keep",
        "ca-group": "Create",
        "ca-order": "10",
        "ca-actions": '<$action-sendmessage $message="' + C.NEW_AXIS_MESSAGE + '"/>'
    }));

    // One row per existing axis.
    var titles = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + AXIS_TAG + "]]");
    titles.forEach(function (title) {
        var t = wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var name = f["ca-axis-name"] || title.split("/").pop();
        // Shadow-only (no overriding real tiddler) = shipped, undeletable.
        var shipped = wiki.isShadowTiddler(title) && !wiki.tiddlerExists(title);
        var origin = shipped ? "shipped" : "custom";
        var sort = f["ca-axis-sort"] || "first-seen";
        var summary = "sort: " + sort + "  ·  " + origin;
        var row = {
            "title": title,
            "ca-name": name,
            "ca-icon": f["ca-axis-icon"] || "🧭",
            "ca-hint": summary + "  ·  → edit facets" + (shipped ? "" : " · DEL delete"),
            "ca-kind": "drill",
            "ca-next-title": name,
            "ca-items-from": "[cp-axis-edit-rows[" + title + "]]",
            "ca-group": shipped ? "Shipped axes" : "Your axes",
            "ca-order": f["ca-order"] || "100"
        };
        if (!shipped) {
            row["ca-on-delete"] = '<$action-sendmessage $message="' +
                C.DELETE_AXIS_MESSAGE + '" axis="' + title + '"/>';
            row["ca-on-delete-consequence"] = "Permanently delete the axis “" +
                name + "”. Any layer chain using it falls back to a plain " +
                "label. This cannot be undone.";
        }
        rows.push(JSON.stringify(row));
    });

    return rows;
};
