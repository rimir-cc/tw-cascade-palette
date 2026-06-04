/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-action-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-action-edit-rows[<action-title>]
    Emit one JSON cascade-item string per facet row of an ACTION's field editor
    (the drill behind each row of "Manage actions"). The operand is the action
    tiddler title. Mirrors cp-entry-edit-rows.

    For a USER action the rows bind-edit it IN PLACE via `ca-bind-*`, grouped:
      - identity  : name / icon / hint / order            (text)
      - discovery : ca-entity-type / ca-applies / ca-action-when — the three
                    ways an action is matched to a row (catalogue / filter /
                    narrowing); see doc/dev-workflow §"Debugging action discovery"
      - behaviour : ca-actions (the wikitext) / after-fire / confirm (toggle) /
                    confirm-consequence
      - 🗑 Delete this action (confirm → DELETE_ACTION_MESSAGE)

    For a SHIPPED (shadow-only) action, editing in place would write an override,
    so the drill offers "📋 Clone to a custom action to edit"
    (CLONE_ACTION_MESSAGE) plus a read-only summary.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var B = require("$:/plugins/rimir/cascade-palette/widgets/cp-row-builders");
var MANAGE = "$:/plugins/rimir/cascade-palette/entries/manage-actions";

function esc(s) { return String(s == null ? "" : s); }

exports["cp-action-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var title = operator.operand || "";
    if (!title) return [];
    var t = wiki.getTiddler(title);
    var f = (t && t.fields) || {};
    var name = f["ca-name"] || title.split("/").pop();
    var shipped = wiki.isShadowTiddler(title) && !wiki.tiddlerExists(title);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "📋 Clone to a custom action to edit",
            "ca-icon": "📋",
            "ca-hint": "Shipped actions can't be edited in place (they'd reappear " +
                "from the plugin). Clone “" + esc(name) + "” to an editable copy, then edit that.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10",
            "ca-actions": '<$action-sendmessage $message="' + C.CLONE_ACTION_MESSAGE +
                '" title="' + title + '"/>' +
                '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
                '" entry="' + MANAGE + '"/>'
        }));
        rows.push(JSON.stringify({
            "ca-name": "(shipped — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "for: " + (esc(f["ca-entity-type"] || f["ca-applies"]) || "(any row)"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // identity
    rows.push(B.textRow(title, "ca-name", "name", "🏷", 10, "identity",
        "Display name shown in the action menu."));
    rows.push(B.textRow(title, "ca-icon", "icon", "🎴", 12, "identity",
        "Optional leading glyph."));
    rows.push(B.textRow(title, "ca-hint", "hint", "💬", 14, "identity",
        "One-line description shown when the action is focused."));
    rows.push(B.textRow(title, "ca-order", "order", "🔢", 16, "identity",
        "Sort order among an entity's actions (default 100)."));

    // discovery (the three matching paths)
    rows.push(B.textRow(title, "ca-entity-type", "entity-type", "🏛", 30, "discovery",
        "Catalogue match: surface on rows whose bound entityType equals this."));
    rows.push(B.textRow(title, "ca-applies", "applies", "🔎", 32, "discovery",
        "Filter match: returns non-empty for <currentTiddler> = the row title."));
    rows.push(B.textRow(title, "ca-action-when", "action-when", "🚦", 34, "discovery",
        "Narrowing: even when discovered, only show if this filter is non-empty for the row."));

    // behaviour
    rows.push(B.textRow(title, "ca-actions", "actions", "⚡", 50, "behaviour",
        "Wikitext fired when the action is activated."));
    rows.push(B.textRow(title, "ca-after-fire", "after-fire", "🔂", 52, "behaviour",
        "Post-fire behaviour: close (default) | keep | pop."));
    rows.push(B.toggleRow(title, "ca-confirm", "confirm", "⚠", 54, "behaviour",
        "Wrap the action in a confirm drill before firing. Default: off."));
    rows.push(B.textRow(title, "ca-confirm-consequence", "confirm-consequence", "📋", 56, "behaviour",
        "Consequence text shown in the confirm drill (when confirm is on)."));

    // delete
    rows.push(JSON.stringify({
        "ca-name": "🗑 Delete this action",
        "ca-order": "95",
        "ca-group": "danger",
        "ca-kind": "leaf",
        "ca-confirm": "yes",
        "ca-confirm-consequence": "Permanently delete the action “" + name +
            "”. This cannot be undone.",
        "ca-actions": '<$action-sendmessage $message="' + C.DELETE_ACTION_MESSAGE +
            '" title="' + title + '"/>' +
            '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
            '" entry="' + MANAGE + '"/>'
    }));

    return rows;
};
