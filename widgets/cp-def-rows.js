/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-def-rows.js
type: application/javascript
module-type: filteroperator

cp-entry-rows[]  /  cp-action-rows[]
    Emit one JSON cascade-item string per row of the "Manage entries" /
    "Manage actions" list (consumed via `ca-items-from`), mirroring
    cp-axis-rows / cp-lens-rows. One generic builder, two thin operator
    exports — entries and actions list identically, differing only in tag,
    summary line and the lifecycle messages they fire:

      - a "+ New …" creator row firing NEW_ENTRY_MESSAGE / NEW_ACTION_MESSAGE
        (prompt a name → save → reopen here).
      - one row per existing definition: a DRILL into its per-facet field
        editor. A USER row carries ca-on-delete (behind the engine's confirm);
        a SHIPPED (shadow-only) row omits it (clone to edit).
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

var ENTRY_SPEC = {
    label: "entry",
    plural: "entries",
    tag: C.ENTRY_TAG,
    iconDefault: "▸",
    newMessage: C.NEW_ENTRY_MESSAGE,
    deleteMessage: C.DELETE_ENTRY_MESSAGE,
    editRowsOp: "cp-entry-edit-rows",
    creatorHint: "Create a command entry — name it, then fill in its action " +
        "or drill target in the field editor.",
    summary: function (f) {
        return "kind: " + (f["ca-kind"] || "leaf");
    }
};
var ACTION_SPEC = {
    label: "action",
    plural: "actions",
    tag: C.ACTION_TAG,
    iconDefault: "⚡",
    newMessage: C.NEW_ACTION_MESSAGE,
    deleteMessage: C.DELETE_ACTION_MESSAGE,
    editRowsOp: "cp-action-edit-rows",
    creatorHint: "Create an action — name it, then set its entity-type / " +
        "applies filter and action wikitext in the field editor.",
    summary: function (f) {
        var who = f["ca-entity-type"] || f["ca-applies"] || "(any row)";
        return "for: " + who;
    }
};

function buildRows(wiki, spec) {
    var rows = [];

    rows.push(JSON.stringify({
        "ca-name": "+ New " + spec.label + "…",
        "ca-icon": "➕",
        "ca-hint": spec.creatorHint,
        "ca-kind": "leaf",
        "ca-after-fire": "keep",
        "ca-group": "Create",
        "ca-order": "10",
        "ca-actions": '<$action-sendmessage $message="' + spec.newMessage + '"/>'
    }));

    var titles = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + spec.tag + "]]");
    titles.forEach(function (title) {
        var t = wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var name = f["ca-name"] || title.split("/").pop();
        var shipped = wiki.isShadowTiddler(title) && !wiki.tiddlerExists(title);
        var origin = shipped ? "shipped" : "custom";
        var row = {
            "title": title,
            "ca-name": name,
            "ca-icon": f["ca-icon"] || spec.iconDefault,
            "ca-hint": spec.summary(f) + "  ·  " + origin + "  ·  → edit fields" +
                (shipped ? "" : " · DEL delete"),
            "ca-kind": "drill",
            "ca-next-title": name,
            "ca-items-from": "[" + spec.editRowsOp + "[" + title + "]]",
            "ca-group": shipped ? "Shipped " + spec.plural : "Your " + spec.plural,
            "ca-order": f["ca-order"] || "100"
        };
        if (!shipped) {
            row["ca-on-delete"] = '<$action-sendmessage $message="' +
                spec.deleteMessage + '" title="' + title + '"/>';
            row["ca-on-delete-consequence"] = "Permanently delete the " + spec.label +
                " “" + name + "”. This cannot be undone.";
        }
        rows.push(JSON.stringify(row));
    });

    return rows;
}

exports["cp-entry-rows"] = function (source, operator, options) {
    return buildRows(options.wiki, ENTRY_SPEC);
};
exports["cp-action-rows"] = function (source, operator, options) {
    return buildRows(options.wiki, ACTION_SPEC);
};
