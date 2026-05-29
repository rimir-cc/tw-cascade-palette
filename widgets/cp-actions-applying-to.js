/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-actions-applying-to.js
type: application/javascript
module-type: filteroperator

cp-actions-applying-to[<title>]
    Emit the titles of action tiddlers (tagged
    $:/tags/rimir/cascade-palette/action, drafts excluded) whose
    `ca-applies` filter evaluates non-empty when `currentTiddler` is
    bound to the operand.

    Mirrors cp-stack.js:actionAppliesViaFilter — pure declarative
    replacement. Actions WITHOUT `ca-applies` (or with a blank
    value) never surface through this operator; use
    `cp-actions-for[<entity-type>]` for the catalogue path.

    Empty operand → no results (no `currentTiddler` to bind against).

    Filter evaluation uses `options.widget.makeFakeWidgetWithVariables`
    so nested filter prefixes (`:filter`, `:map`, `:reduce`) and
    `$:/tags/Macro`-imported `\function` defs resolve correctly. See
    [[tw-gotchas-widget-context#Custom fake widgets...]].

    Source feed is ignored; the operator emits its own scan from
    `[all[shadows+tiddlers]tag[<action-tag>]has[ca-applies]] +[!is[draft]]`.

\*/
"use strict";

var ACTION_TAG = "$:/tags/rimir/cascade-palette/action";

exports["cp-actions-applying-to"] = function (source, operator, options) {
    var wiki = options.wiki;
    var widget = options.widget;
    var target = operator.operand || "";
    if (!target) return [];
    var titles = wiki.filterTiddlers(
        "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]has[ca-applies]] +[!is[draft]]"
    );
    var results = [];
    for (var i = 0; i < titles.length; i++) {
        var t = wiki.getTiddler(titles[i]);
        var fields = (t && t.fields) || {};
        var applies = fields["ca-applies"];
        if (!applies || !String(applies).trim()) continue;
        var fakeWidget = widget && widget.makeFakeWidgetWithVariables
            ? widget.makeFakeWidgetWithVariables({ currentTiddler: target })
            : null;
        try {
            var hit = wiki.filterTiddlers(String(applies), fakeWidget);
            if (hit && hit.length > 0) {
                results.push(titles[i]);
            }
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] cp-actions-applying-to: ca-applies filter error on",
                    titles[i], "—", err && err.message
                );
            }
        }
    }
    return results;
};
