/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-lens-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-lens-edit-rows[<lens-title>]
    Emit one JSON cascade-item string per facet row of a lens's field editor
    (the drill behind each row of the "Manage lenses" list). The operand is
    the lens tiddler title.

    For a USER lens (a real, editable tiddler) the rows bind-edit the lens IN
    PLACE via the engine's standard `ca-bind-*` mechanism (Enter → edit-mode
    → writeBoundValue) — no scratchpad needed because this is an explicit
    "manage this lens" context:
      - name / chip / when / order   (text)
      - default-slot toggles         (one per slot; string-array membership)
      - per slot: filter + template  (text — the cheap and rich projections)
      - actions                      (drill → cp-lens-actions-rows)
      - 🗑 Delete lens               (confirm → DELETE_LENS_MESSAGE)

    For a SHIPPED (shadow-only) lens the facets are NOT editable in place
    (that would mutate the shadow), so the drill offers a single
    "📋 Clone to a custom lens to edit" leaf (CLONE_LENS_MESSAGE) that copies
    it to LENS_NS and reopens the list, where the editable copy now appears.

    Note: the cheap filter editor's live "✓ N matches" feedback is JS-only
    (see cp-firing enterEditMode editKind "filter") and not reachable from a
    declarative bind row — so filters here edit as plain text. The per-slot
    pill `e` gesture still gives the live-count experience for the name/icon
    filter slots.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LENS_TAG = C.LENS_TAG;
var LENS_SLOTS = C.LENS_SLOTS;

// Per-slot human labels + group captions for the projection rows.
var SLOT_LABEL = { name: "Name", icon: "Icon", annotation: "Note" };

function esc(s) { return String(s == null ? "" : s); }

exports["cp-lens-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var lensTitle = operator.operand || "";
    if (!lensTitle) return [];
    var t = wiki.getTiddler(lensTitle);
    var f = (t && t.fields) || {};
    var name = f["ca-lens-name"] || lensTitle.split("/").pop();
    var shipped = wiki.isShadowTiddler(lensTitle) && !wiki.tiddlerExists(lensTitle);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "📋 Clone to a custom lens to edit",
            "ca-icon": "📋",
            "ca-hint": "Shipped lenses can't be edited in place (they'd reappear " +
                "from the plugin). Clone “" + esc(name) + "” to an editable copy " +
                "under your lens namespace, then edit that.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10",
            "ca-actions": '<$action-sendmessage $message="' + C.CLONE_LENS_MESSAGE +
                '" lens="' + lensTitle + '"/>' +
                '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
                '" entry="$:/plugins/rimir/cascade-palette/entries/manage-lenses"/>'
        }));
        // Read-only facet summary so the user can see what they'd be cloning.
        rows.push(JSON.stringify({
            "ca-name": "(shipped — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "when: " + (esc(f["ca-lens-when"]) || "(always)") +
                "  ·  actions: " + (esc(f["ca-lens-actions"]) || "(none)"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // ---- USER lens — editable facet rows -------------------------------

    function textRow(field, caption, icon, order, group, hint, onCommit) {
        var r = {
            "ca-name": caption,
            "ca-icon": icon,
            "ca-order": String(order),
            "ca-kind": "text",
            "ca-bind-tiddler": lensTitle,
            "ca-bind-field": field,
            "ca-bind-type": "text/plain"
        };
        if (group) r["ca-group"] = group;
        if (hint) r["ca-hint"] = hint;
        if (onCommit) r["ca-on-commit"] = onCommit;
        return JSON.stringify(r);
    }

    rows.push(textRow("ca-lens-name", "name", "🏷", 10, "lens",
        "Display name shown in the slot chooser strips and this list."));
    rows.push(textRow("ca-lens-chip", "chip", "🔖", 12, "lens",
        "Pill label (with a leading glyph, e.g. “💬 Caption”); falls back to the name."));
    rows.push(textRow("ca-lens-when", "when", "❓", 14, "lens",
        "Applicability — a global existence filter (no row context). Empty result hides the lens; blank = always applies."));
    rows.push(textRow("ca-order", "order", "🔢", 16, "lens",
        "Sort order among lenses in each chooser (default 100)."));

    // Default-slot toggles — which slots this lens seeds on first load.
    LENS_SLOTS.forEach(function (slot, i) {
        rows.push(JSON.stringify({
            "ca-name": SLOT_LABEL[slot],
            "ca-icon": "⭐",
            "ca-order": String(20 + i),
            "ca-group": "default slots (seeded on first load)",
            "ca-kind": "toggle",
            "ca-bind-tiddler": lensTitle,
            "ca-bind-field": "ca-lens-default",
            "ca-bind-type": "application/x-string-array",
            "ca-true-value": slot,
            "ca-hint": "When on, this lens is the default for the " + slot + " slot."
        }));
    });

    // Per-slot projections — filter (cheap) + template (rich). A slot renders
    // its filter OR its template, and the filter WINS (see
    // _activeSlotTemplate). To avoid the silent-override footgun (a template
    // that's set but ignored because a filter is also set), each row's
    // ca-on-commit clears its sibling on a NON-blank commit, so committing a
    // projection makes it the live one ("last-edited wins") and the data never
    // holds an ignored value. The guard on `[<picked>!is[blank]]` means
    // *clearing* a field (committing empty) does NOT wipe the other — so
    // emptying the filter promotes an existing template, as expected. A marker
    // flags any pre-existing conflict (e.g. a hand-authored lens with both).
    LENS_SLOTS.forEach(function (slot, i) {
        var group = SLOT_LABEL[slot] + " slot";
        var filterField = "ca-lens-" + slot + "-filter";
        var templateField = "ca-lens-" + slot + "-template";
        var hasFilter = !!(f[filterField] && String(f[filterField]).trim());
        var hasTemplate = !!(f[templateField] && String(f[templateField]).trim());
        var conflict = hasFilter && hasTemplate;
        var clearSibling = function (siblingField) {
            return '<$list filter="[<picked>!is[blank]]">' +
                '<$action-setfield $tiddler="' + lensTitle + '" ' + siblingField + '=""/></$list>';
        };
        rows.push(textRow(filterField, "filter" + (conflict ? " ● active" : ""), "⚙",
            40 + i * 2, group,
            "Cheap projection — a filter run per row with <currentTiddler> = the row; first non-empty result fills the " + slot + " slot. Committing here clears this slot's template (filter wins). DEL clears it.",
            clearSibling(templateField)));
        rows.push(textRow(templateField, "template" + (conflict ? " ⚠ ignored" : ""), "🧩",
            41 + i * 2, group,
            (conflict ? "IGNORED — this slot's filter is set and wins; clear the filter row to use this template. " : "") +
            "Rich projection — wikitext rendered per row (markup), used only when this slot has no filter. Committing here clears this slot's filter. DEL clears it.",
            clearSibling(filterField)));
    });

    // Actions — drill into the actions chooser.
    rows.push(JSON.stringify({
        "ca-name": "actions",
        "ca-icon": "⚡",
        "ca-order": "80",
        "ca-group": "actions",
        "ca-kind": "drill",
        "ca-next-title": "Lens actions",
        "ca-hint": "What actions this lens contributes: none, the entity-type bridge, or a custom filter. Current: " +
            (esc(f["ca-lens-actions"]) || "(none)"),
        "ca-items-from": "[cp-lens-actions-rows[" + lensTitle + "]]"
    }));

    // Delete.
    rows.push(JSON.stringify({
        "ca-name": "🗑 Delete this lens",
        "ca-order": "95",
        "ca-group": "danger",
        "ca-kind": "leaf",
        "ca-confirm": "yes",
        "ca-confirm-consequence": "Permanently delete the lens “" + name +
            "”. Any slot currently using it falls back to its default / off. This cannot be undone.",
        "ca-actions": '<$action-sendmessage $message="' + C.DELETE_LENS_MESSAGE +
            '" lens="' + lensTitle + '"/>' +
            '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
            '" entry="$:/plugins/rimir/cascade-palette/entries/manage-lenses"/>'
    }));

    return rows;
};
