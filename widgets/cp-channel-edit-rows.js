/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-channel-edit-rows.js
type: application/javascript
module-type: filteroperator

cp-channel-edit-rows[<channel-title>]
    Emit one JSON cascade-item string per facet row of a channel's LONG-TAIL
    field editor — the drill behind each channel listed inside a view's
    "Edit all fields…" editor (cp-view-edit-rows). The operand is the channel
    tiddler title. Mirrors cp-view-edit-rows / cp-axis-edit-rows.

    The Structure strip already edits a channel's core STRUCTURE (roots /
    children / leaf / label) and its filter facets (entity-type / row-name /
    row-group / row-kind / row-actions) with live preview, and its axis chain
    via the chain picker — so those are NOT repeated here. This editor covers
    the genuinely channel-scoped long tail:
      - identity   : name                                   (text)
      - producer   : source (filter | entries); include-position (toggle)
      - row default: row-hint / row-icon / row-order / row-next-scope /
                     row-items-from                         (text)

    For a USER channel the rows bind-edit IN PLACE via `ca-bind-*`. For a
    SHIPPED (shadow-only) channel, editing in place would write an override, so
    the drill is read-only: a summary + a hint pointing at the Structure strip
    (which clones the channel to a scratchpad on first edit) or forking the
    whole view.

    Deleting a channel is intentionally NOT offered here — channels are shared
    parts composed by reference; removing one from a view is a Structure-strip
    gesture, distinct from deleting the (possibly shared) definition.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");

function esc(s) { return String(s == null ? "" : s); }

// Dual-read a channel field (cp-utils): prefer ca-channel-<key>, fall back to
// legacy ca-layer-<key> so the drill reads un-migrated channel tiddlers.
// WRITES (bind fields) always use the ca-channel-* namespace.
var channelField = utils.channelField;

exports["cp-channel-edit-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var layerTitle = operator.operand || "";
    if (!layerTitle) return [];
    var t = wiki.getTiddler(layerTitle);
    var f = (t && t.fields) || {};
    var name = channelField(f, "name") || layerTitle.split("/").pop();
    var shipped = wiki.isShadowTiddler(layerTitle) && !wiki.tiddlerExists(layerTitle);
    var rows = [];

    if (shipped) {
        rows.push(JSON.stringify({
            "ca-name": "(shipped channel — " + name + ")",
            "ca-icon": "🔒",
            "ca-hint": "roots: " + (esc(channelField(f, "roots")) || "(none)") +
                "  ·  source: " + (esc(channelField(f, "source")) || "filter"),
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "10"
        }));
        rows.push(JSON.stringify({
            "ca-name": "Edit via the Structure strip",
            "ca-icon": "🧱",
            "ca-hint": "Shipped channels can't be edited in place (they'd reappear " +
                "from the plugin). Tab to the Structure strip and edit this channel " +
                "there — it clones to a scratchpad on first edit — or fork the whole view.",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-order": "20"
        }));
        return rows;
    }

    // ---- USER channel — editable facet rows ----------------------------

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

    rows.push(textRow("ca-channel-name", "name", "🏷", 10, "identity",
        "Display name shown on the Structure strip and in the view's channel list."));

    rows.push(textRow("ca-channel-source", "source", "🛢", 30, "producer",
        "Producer: filter (default — ca-channel-roots drives the rows) | entries " +
        "(the JS-backed command-entries producer)."));
    rows.push(JSON.stringify({
        "ca-name": "include-position",
        "ca-icon": "📌",
        "ca-order": "32",
        "ca-kind": "toggle",
        "ca-bind-tiddler": layerTitle,
        "ca-bind-field": "ca-channel-include-position",
        "ca-true-value": "yes",
        "ca-false-value": "no",
        "ca-group": "producer",
        "ca-hint": "Honour per-entry ca-position-<view> placement for this channel's rows. Default: off."
    }));

    rows.push(textRow("ca-channel-row-hint", "row-hint", "💬", 70, "row defaults",
        "Filter producing a per-row hint (<currentTiddler> = the row)."));
    rows.push(textRow("ca-channel-row-icon", "row-icon", "🖼", 72, "row defaults",
        "Filter producing a per-row leading icon/glyph."));
    rows.push(textRow("ca-channel-row-order", "row-order", "🔢", 74, "row defaults",
        "Filter producing a per-row sort key for this channel's rows."));
    rows.push(textRow("ca-channel-row-next-scope", "row-next-scope", "⤵", 76, "row defaults",
        "Filter producing each row's drill children (makes data rows drillable)."));
    rows.push(textRow("ca-channel-row-items-from", "row-items-from", "🧩", 78, "row defaults",
        "Filter emitting synthetic child items (JSON cascade-items) per row."));

    return rows;
};
