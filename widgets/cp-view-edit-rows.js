/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-view-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-view-edit-rows[<view-title>]
    Emit one JSON cascade-item string per facet row of a view's LONG-TAIL field
    editor — the exhaustive surface the live Structure strip doesn't cover. The
    operand is the view tiddler title; with NO operand it targets the active
    view (ACTIVE_VIEW_STATE, self-healing to the default view when unset — the
    initial open, before any view switch). Reached via Manage views → "Edit all
    fields…". Mirrors cp-axis-edit-rows / cp-lens-edit-rows.

    The Structure strip already edits the core STRUCTURE (roots / children /
    leaf / label / axes) and the enum facets (sort / include-entries /
    grouping) with live preview — so those are deliberately NOT repeated here.
    This editor covers the genuinely view-scoped long tail:
      - identity   : name / hint / icon / order            (text)
      - display    : count-format (text); show-count, containers-first,
                     show-action-preview, show-side-preview, context-aware
                     (toggle yes/no)
      - sort detail: sort-field / sort-key                 (text)
      - picking    : pick-mode (text); pick-emits-filter (toggle); after-fire
      - row default: row-hint / row-icon / row-order / row-next-scope /
                     row-items-from                        (text — the per-row
                     overrides not surfaced as Structure-strip pills)
      - Fork / Delete leaves.

    For a USER view the rows bind-edit IN PLACE via the engine's standard
    `ca-bind-*` mechanism. For a SHIPPED (shadow-only) view, editing in place
    would write an override, so the drill offers a single "📋 Fork to a custom
    view to edit" leaf (FORK_VIEW_MESSAGE — switches to the editable copy) plus
    a read-only summary.

    Note: `ca-position-<view-slug>` (per-entry placement within this view) is
    NOT editable here — it lives on each ENTRY, not the view. Authors set it on
    the entry tiddler (see doc/reference.tid §"Entry positioning").
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var VIEW_TAG = C.VIEW_TAG;
var MANAGE_VIEWS_ENTRY = "$:/plugins/rimir/cascade-palette/entries/manage-views";
var BUILTIN_ENTRIES_LAYER = "$:/plugins/rimir/cascade-palette/structure-layers/entries";

function esc(s) { return String(s == null ? "" : s); }

// Resolve the target view: explicit operand → active-view state → default
// view (ca-view-default) → first view. Self-healing so the drill works on the
// very first open, before any _setActiveView has run.
function resolveViewTitle(wiki, operand) {
    if (operand) return operand;
    var active = wiki.getTiddlerText(C.ACTIVE_VIEW_STATE, "");
    if (active && (wiki.tiddlerExists(active) || wiki.isShadowTiddler(active))) return active;
    var views = wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + VIEW_TAG + "]]");
    var def = views.filter(function (t) {
        return ((wiki.getTiddler(t).fields["ca-view-default"]) || "").toLowerCase() === "yes";
    })[0];
    return def || views[0] || "";
}

exports["cp-view-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var viewTitle = resolveViewTitle(wiki, operator.operand);
    if (!viewTitle) return [];
    var t = wiki.getTiddler(viewTitle);
    var f = (t && t.fields) || {};
    var name = f["ca-view-name"] || viewTitle.split("/").pop();
    var shipped = wiki.isShadowTiddler(viewTitle) && !wiki.tiddlerExists(viewTitle);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "📋 Fork to a custom view to edit",
            "ca-icon": "⑂",
            "ca-hint": "Shipped views can't be edited in place (they'd reappear " +
                "from the plugin). Fork “" + esc(name) + "” to an independent copy " +
                "(its layers + axes are deep-copied), then edit that.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10",
            "ca-actions": '<$action-sendmessage $message="' + C.FORK_VIEW_MESSAGE +
                '" view="' + viewTitle + '"/>'
        }));
        rows.push(JSON.stringify({
            "ca-name": "(shipped — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "sort: " + (esc(f["ca-view-sort"]) || "alphabetical") +
                "  ·  roots: " + (esc(f["ca-view-roots"] || f["ca-view-source"]) || "(none)"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // ---- USER view — editable facet rows -------------------------------

    function textRow(field, caption, icon, order, group, hint) {
        var r = {
            "ca-name": caption,
            "ca-icon": icon,
            "ca-order": String(order),
            "ca-kind": "text",
            "ca-bind-tiddler": viewTitle,
            "ca-bind-field": field,
            "ca-bind-type": "text/plain"
        };
        if (group) r["ca-group"] = group;
        if (hint) r["ca-hint"] = hint;
        return JSON.stringify(r);
    }
    function toggleRow(field, caption, icon, order, group, hint) {
        return JSON.stringify({
            "ca-name": caption,
            "ca-icon": icon,
            "ca-order": String(order),
            "ca-kind": "toggle",
            "ca-bind-tiddler": viewTitle,
            "ca-bind-field": field,
            "ca-true-value": "yes",
            "ca-false-value": "no",
            "ca-group": group || "",
            "ca-hint": hint || ""
        });
    }

    // identity
    rows.push(textRow("ca-view-name", "name", "🏷", 10, "identity",
        "Display name shown on the view strip and in this list."));
    rows.push(textRow("ca-view-hint", "hint", "💬", 12, "identity",
        "One-line description shown when the view is focused."));
    rows.push(textRow("ca-icon", "icon", "🎴", 14, "identity",
        "Optional leading glyph for the view pill."));
    rows.push(textRow("ca-order", "order", "🔢", 16, "identity",
        "Sort order among views on the strip (default 100)."));

    // display
    rows.push(textRow("ca-view-count-format", "count-format", "🔢", 30, "display",
        "Template for the per-container count badge, e.g. “(%c)”. %c = the count."));
    rows.push(toggleRow("ca-view-show-count", "show-count", "#️⃣", 32, "display",
        "Show a result count badge on container rows. Default: off."));
    rows.push(toggleRow("ca-view-containers-first", "containers-first", "📂", 34, "display",
        "List container (drillable) rows before leaf rows. Default: on."));
    rows.push(toggleRow("ca-view-show-action-preview", "show-action-preview", "👁", 36, "display",
        "Show the action-menu preview on focused rows. Default: on."));
    rows.push(toggleRow("ca-view-show-side-preview", "show-side-preview", "🪟", 38, "display",
        "Allow side-preview panes to open while drilling in this view. Default: on."));
    rows.push(toggleRow("ca-view-context-aware", "context-aware", "🎯", 40, "display",
        "Bias results toward the captured context tiddler (<<context-tiddler>>). Default: off."));

    // sort detail (the enum `sort` itself is a Structure-strip pill)
    rows.push(textRow("ca-view-sort-field", "sort-field", "🔤", 50, "sort",
        "Field name used when sort = by-field."));
    rows.push(textRow("ca-view-sort-key", "sort-key", "🗝", 52, "sort",
        "Filter producing a per-row sort key when sort = custom (<currentTiddler> = the row)."));

    // picking
    rows.push(textRow("ca-view-pick-mode", "pick-mode", "✅", 60, "picking",
        "Turns this view into a picker: tiddler | field | … — Enter emits the pick instead of firing actions."));
    rows.push(toggleRow("ca-view-pick-emits-filter", "pick-emits-filter", "🧮", 62, "picking",
        "In pick-mode, emit a filter selecting the pick rather than its title. Default: off."));
    rows.push(textRow("ca-view-after-fire", "after-fire", "🔂", 64, "picking",
        "Post-fire behaviour for rows in this view: close (default) | keep | pop."));

    // row defaults (per-row overrides not surfaced as Structure-strip pills)
    rows.push(textRow("ca-view-row-hint", "row-hint", "💬", 70, "row defaults",
        "Filter producing a per-row hint (<currentTiddler> = the row)."));
    rows.push(textRow("ca-view-row-icon", "row-icon", "🖼", 72, "row defaults",
        "Filter producing a per-row leading icon/glyph."));
    rows.push(textRow("ca-view-row-order", "row-order", "🔢", 74, "row defaults",
        "Filter producing a per-row sort key (overrides the view sort for these rows)."));
    rows.push(textRow("ca-view-row-next-scope", "row-next-scope", "⤵", 76, "row defaults",
        "Filter producing each row's drill children (makes data rows drillable)."));
    rows.push(textRow("ca-view-row-items-from", "row-items-from", "🧩", 78, "row defaults",
        "Filter emitting synthetic child items (JSON cascade-items) per row."));

    // layers — drill each explicit (non-built-in) layer into its own field
    // editor (cp-layer-edit-rows). Implicit views carry no ca-view-layers, so
    // this group is empty for them (their row-* defaults live above).
    var layerRefs = String(f["ca-view-layers"] || "").trim();
    (layerRefs ? layerRefs.split(/\s+/) : []).forEach(function (lt, i) {
        if (lt === BUILTIN_ENTRIES_LAYER) return;
        var lf = (wiki.getTiddler(lt) || { fields: {} }).fields;
        var lname = lf["ca-layer-name"] || lt.split("/").pop();
        rows.push(JSON.stringify({
            "ca-name": "layer: " + lname,
            "ca-icon": "🧱",
            "ca-kind": "drill",
            "ca-group": "layers",
            "ca-order": String(80 + i),
            "ca-items-from": "[cp-layer-edit-rows[" + lt + "]]",
            "ca-next-title": "Edit layer: " + lname,
            "ca-hint": "Edit this layer's long-tail fields (source, row defaults)."
        }));
    });

    // lifecycle
    rows.push(JSON.stringify({
        "ca-name": "⑂ Fork this view",
        "ca-icon": "⑂",
        "ca-hint": "Make an independent persisted copy (layers + axes deep-copied) and switch to it.",
        "ca-kind": "leaf",
        "ca-after-fire": "keep",
        "ca-group": "lifecycle",
        "ca-order": "90",
        "ca-actions": '<$action-sendmessage $message="' + C.FORK_VIEW_MESSAGE +
            '" view="' + viewTitle + '"/>'
    }));
    rows.push(JSON.stringify({
        "ca-name": "🗑 Delete this view",
        "ca-order": "95",
        "ca-group": "lifecycle",
        "ca-kind": "leaf",
        "ca-confirm": "yes",
        "ca-confirm-consequence": "Permanently delete the view “" + name +
            "”. This cannot be undone (its private layers/axes are left in place).",
        "ca-actions": '<$action-sendmessage $message="' + C.DELETE_VIEW_MESSAGE +
            '" view="' + viewTitle + '"/>' +
            '<$action-sendmessage $message="' + C.OPEN_ENTRY_MESSAGE +
            '" entry="' + MANAGE_VIEWS_ENTRY + '"/>'
    }));

    return rows;
};
