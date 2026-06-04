/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-lens-rows.js
type: application/javascript
module-type: filteroperator

cp-lens-rows[]
    Emit one JSON cascade-item string per row of the "Manage lenses" list
    (consumed by entries/manage-lenses.tid via `ca-items-from:
    [cp-lens-rows[]]`). readCascadeFromObject turns each parsed object into a
    cascade item, so the rows are ordinary leaf entries:

      - three "+ New … lens…" creator rows — one per slot, firing
        NEW_LENS_MESSAGE with the slot (the live-preview author flow).
      - one row per existing lens (tagged LENS_TAG): ↵ edits it
        (EDIT_LENS_MESSAGE → _editLensFromList); for a USER lens, DEL deletes
        it (DELETE_LENS_MESSAGE behind the engine's ca-on-delete confirm).
        Shipped (shadow-only) lenses omit ca-on-delete — they can't be
        deleted (clone & edit instead), so the row only offers ↵ edit.

    Building the JSON in JS (vs the addprefix/addsuffix wikitext used
    elsewhere) keeps the quoting in one place and lets the row set be unit-
    tested; the engine already hosts its cascade operators in JS
    (cp-actions-for, cp-actions-applying-to, …). Source feed + operand are
    ignored.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LENS_TAG = C.LENS_TAG;
var LENS_SLOTS = C.LENS_SLOTS;

// Leading glyph for each creator row.
var SLOT_NEW_ICON = { name: "🔤", icon: "🖼", annotation: "🏷" };

exports["cp-lens-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var rows = [];

    // Creator rows — one per slot, ordered by LENS_SLOTS.
    LENS_SLOTS.forEach(function (slot, i) {
        rows.push(JSON.stringify({
            "ca-name": "+ New " + slot + " lens…",
            "ca-icon": SLOT_NEW_ICON[slot] || "➕",
            "ca-hint": "Create a lens projecting the " + slot +
                " slot — type its projection filter with live preview.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-group": "Create",
            "ca-order": String(10 + i),
            "ca-actions": '<$action-sendmessage $message="' + C.NEW_LENS_MESSAGE +
                '" slot="' + slot + '"/>'
        }));
    });

    // One row per existing lens.
    var titles = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + LENS_TAG + "]]");
    titles.forEach(function (title) {
        var t = wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        var name = f["ca-lens-name"] || title.split("/").pop();
        var chip = f["ca-lens-chip"] || "";
        var projects = LENS_SLOTS.filter(function (s) {
            return f["ca-lens-" + s + "-filter"] || f["ca-lens-" + s + "-template"];
        });
        // Shadow-only (no overriding real tiddler) = shipped, undeletable.
        var shipped = wiki.isShadowTiddler(title) && !wiki.tiddlerExists(title);
        var origin = shipped ? "shipped" : "custom";
        var summary = (projects.length ? projects.join(" + ") : "—") + "  ·  " + origin;
        var row = {
            "title": title,
            "ca-name": name,
            "ca-icon": chip ? chip.split(" ")[0] : "🔎",
            "ca-hint": summary + "  ·  ↵ edit" + (shipped ? "" : " · DEL delete"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-group": shipped ? "Shipped lenses" : "Your lenses",
            "ca-order": f["ca-order"] || "100",
            "ca-actions": '<$action-sendmessage $message="' + C.EDIT_LENS_MESSAGE +
                '" lens="' + title + '"/>'
        };
        if (!shipped) {
            row["ca-on-delete"] = '<$action-sendmessage $message="' +
                C.DELETE_LENS_MESSAGE + '" lens="' + title + '"/>';
            row["ca-on-delete-consequence"] = "Permanently delete the lens “" +
                name + "”. Any slot currently using it falls back to its " +
                "default / off. This cannot be undone.";
        }
        rows.push(JSON.stringify(row));
    });

    return rows;
};
