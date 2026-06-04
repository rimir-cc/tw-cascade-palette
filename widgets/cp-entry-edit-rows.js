/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-entry-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-entry-edit-rows[<entry-title>]
    Emit one JSON cascade-item string per facet row of an ENTRY's field editor
    (the drill behind each row of "Manage entries"). The operand is the entry
    tiddler title. Mirrors cp-axis-edit-rows.

    For a USER entry the rows bind-edit it IN PLACE via `ca-bind-*`, grouped:
      - identity : name / icon / hint / order            (text)
      - kind     : ca-kind (leaf | drill)                (text)
      - leaf     : ca-actions (the action wikitext) / after-fire / confirm
                   (toggle) / confirm-consequence
      - drill    : next-scope / items-from / next-title / next-entity-type
      - 🗑 Delete this entry (confirm → DELETE_ENTRY_MESSAGE)
    A read-only note points at `ca-position-<view-slug>` for per-view placement
    (set by hand on the entry — it varies per view, so there's no fixed row).

    For a SHIPPED (shadow-only) entry, editing in place would write an override,
    so the drill offers "📋 Clone to a custom entry to edit" (CLONE_ENTRY_MESSAGE)
    plus a read-only summary.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var B = require("$:/plugins/rimir/cascade-palette/widgets/cp-row-builders");
var MANAGE = "$:/plugins/rimir/cascade-palette/entries/manage-entries";

function esc(s) { return String(s == null ? "" : s); }

exports["cp-entry-edit-rows"] = function (source, operator, options) {
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
            "ca-name": "📋 Clone to a custom entry to edit",
            "ca-icon": "📋",
            "ca-hint": "Shipped entries can't be edited in place (they'd reappear " +
                "from the plugin). Clone “" + esc(name) + "” to an editable copy, then edit that.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10",
            "ca-actions": '<$action-sendmessage $message="' + C.CLONE_ENTRY_MESSAGE +
                '" title="' + title + '"/>' +
                '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
                '" entry="' + MANAGE + '"/>'
        }));
        rows.push(JSON.stringify({
            "ca-name": "(shipped — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "kind: " + (esc(f["ca-kind"]) || "leaf"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // identity
    rows.push(B.textRow(title, "ca-name", "name", "🏷", 10, "identity",
        "Display name shown in the menu and search."));
    rows.push(B.textRow(title, "ca-icon", "icon", "🎴", 12, "identity",
        "Optional leading glyph."));
    rows.push(B.textRow(title, "ca-hint", "hint", "💬", 14, "identity",
        "One-line description shown when the row is focused."));
    rows.push(B.textRow(title, "ca-order", "order", "🔢", 16, "identity",
        "Sort order among entries (default 100)."));

    // kind
    rows.push(B.textRow(title, "ca-kind", "kind", "🔀", 20, "kind",
        "leaf (fires ca-actions on Enter) | drill (descends into ca-next-scope / ca-items-from)."));

    // leaf behaviour
    rows.push(B.textRow(title, "ca-actions", "actions", "⚡", 30, "leaf",
        "Wikitext fired when a leaf entry is activated (e.g. <$action-navigate …/>)."));
    rows.push(B.textRow(title, "ca-after-fire", "after-fire", "🔂", 32, "leaf",
        "Post-fire behaviour: close (default) | keep | pop."));
    rows.push(B.toggleRow(title, "ca-confirm", "confirm", "⚠", 34, "leaf",
        "Wrap the action in a confirm drill before firing. Default: off."));
    rows.push(B.textRow(title, "ca-confirm-consequence", "confirm-consequence", "📋", 36, "leaf",
        "Consequence text shown in the confirm drill (when confirm is on)."));

    // drill target
    rows.push(B.textRow(title, "ca-next-scope", "next-scope", "⤵", 50, "drill",
        "Filter producing the child rows when kind = drill."));
    rows.push(B.textRow(title, "ca-items-from", "items-from", "🧩", 52, "drill",
        "Filter emitting synthetic child items (JSON cascade-items); wins over next-scope."));
    rows.push(B.textRow(title, "ca-next-title", "next-title", "🪧", 54, "drill",
        "Heading shown on the child stage."));
    rows.push(B.textRow(title, "ca-next-entity-type", "next-entity-type", "🔖", 56, "drill",
        "Entity type bound onto the child rows (drives action discovery there)."));

    // placement note (per-view, hand-set)
    rows.push(JSON.stringify({
        "ca-name": "placement: ca-position-<view>",
        "ca-icon": "📍",
        "ca-hint": "Per-view placement is set with ca-position-<view-slug> fields " +
            "on this entry (they vary per view, so there's no fixed row). See the reference.",
        "ca-kind": "leaf",
        "ca-after-fire": "keep",
        "ca-group": "placement",
        "ca-order": "70"
    }));

    // delete
    rows.push(JSON.stringify({
        "ca-name": "🗑 Delete this entry",
        "ca-order": "95",
        "ca-group": "danger",
        "ca-kind": "leaf",
        "ca-confirm": "yes",
        "ca-confirm-consequence": "Permanently delete the entry “" + name +
            "”. This cannot be undone.",
        "ca-actions": '<$action-sendmessage $message="' + C.DELETE_ENTRY_MESSAGE +
            '" title="' + title + '"/>' +
            '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
            '" entry="' + MANAGE + '"/>'
    }));

    return rows;
};
