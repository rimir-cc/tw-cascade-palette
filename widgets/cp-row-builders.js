/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-row-builders.js
type: application/javascript
module-type: library

Shared cascade-item row builders for the in-palette field editors. Each
returns the JSON-encoded item string the engine consumes via `ca-items-from`.
Factored out so the entry / action field editors (cp-entry-edit-rows /
cp-action-edit-rows) don't each re-spell the same `ca-bind-*` row shape.

  textRow(tiddler, field, caption, icon, order, group, hint)
      A free-text field bound in place (Enter → edit-mode → writeBoundValue).
  toggleRow(tiddler, field, caption, icon, order, group, hint)
      A yes/no boolean bound in place (matches the engine's default
      true/false values, so an unset field reads as "no").
\*/
"use strict";

exports.textRow = function (tiddler, field, caption, icon, order, group, hint) {
    var r = {
        "ca-name": caption,
        "ca-icon": icon,
        "ca-order": String(order),
        "ca-kind": "text",
        "ca-bind-tiddler": tiddler,
        "ca-bind-field": field,
        "ca-bind-type": "text/plain"
    };
    if (group) r["ca-group"] = group;
    if (hint) r["ca-hint"] = hint;
    return JSON.stringify(r);
};

exports.toggleRow = function (tiddler, field, caption, icon, order, group, hint) {
    return JSON.stringify({
        "ca-name": caption,
        "ca-icon": icon,
        "ca-order": String(order),
        "ca-kind": "toggle",
        "ca-bind-tiddler": tiddler,
        "ca-bind-field": field,
        "ca-true-value": "yes",
        "ca-false-value": "no",
        "ca-group": group || "",
        "ca-hint": hint || ""
    });
};
