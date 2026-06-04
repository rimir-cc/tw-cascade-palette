/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-lens-actions-rows.js
type: application/javascript
module-type: filteroperator

cp-lens-actions-rows[<lens-title>]
    Emit the JSON rows of a lens's "actions" sub-drill (the `ca-lens-actions`
    chooser, reached from cp-lens-edit-rows). The operand is the lens title.
    Three choices, the current one marked ✓:

      - (none)            clear ca-lens-actions (the lens contributes none)
      - via-entity-type   own the standard always-on entity-type bridge
                          (what the Kind lens does)
      - Custom filter…    a text row binding ca-lens-actions — type a filter
                          returning action tiddler titles to surface on a row

    The two preset choices are leaves that `$action-setfield` the value
    (ca-after-fire: keep, so the sub-drill stays open and re-marks ✓ after
    the wiki change recomputes the stage). The custom choice bind-edits the
    field in place. Only meaningful for USER lenses; shipped lenses reach
    their facets via the clone leaf in cp-lens-edit-rows.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var VIA = C.LENS_ACTIONS_VIA_ENTITY_TYPE;

exports["cp-lens-actions-rows"] = function (source, operator, options) {
    var wiki = options.wiki;
    var lensTitle = operator.operand || "";
    if (!lensTitle) return [];
    var t = wiki.getTiddler(lensTitle);
    var current = (t && t.fields && t.fields["ca-lens-actions"]) || "";
    var isNone = !current;
    var isVia = current === VIA;
    var isCustom = !!current && !isVia;
    function tick(on, label) { return (on ? "✓ " : "") + label; }

    return [
        JSON.stringify({
            "ca-name": tick(isNone, "(none)"),
            "ca-icon": "∅",
            "ca-order": "10",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-hint": "This lens contributes no actions.",
            "ca-actions": '<$action-setfield $tiddler="' + lensTitle + '" ca-lens-actions=""/>'
        }),
        JSON.stringify({
            "ca-name": tick(isVia, "via-entity-type"),
            "ca-icon": "🔗",
            "ca-order": "20",
            "ca-kind": "leaf",
            "ca-after-fire": "keep",
            "ca-hint": "Own the standard always-on entity-type action bridge (catalogue + configured-field). What the Kind lens declares.",
            "ca-actions": '<$action-setfield $tiddler="' + lensTitle + '" ca-lens-actions="' + VIA + '"/>'
        }),
        JSON.stringify({
            "ca-name": tick(isCustom, "Custom filter…") + (isCustom ? "  (" + current + ")" : ""),
            "ca-icon": "⚙",
            "ca-order": "30",
            "ca-kind": "text",
            "ca-bind-tiddler": lensTitle,
            "ca-bind-field": "ca-lens-actions",
            "ca-bind-type": "text/plain",
            "ca-hint": "A filter returning action tiddler titles to surface on a row (run with <currentTiddler> = the row). Always-on, gated only by ca-lens-when."
        })
    ];
};
