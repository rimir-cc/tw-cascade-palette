/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-actions-for.js
type: application/javascript
module-type: filteroperator

cp-actions-for[<entity-type>]
    Emit the titles of all action tiddlers (tagged
    $:/tags/rimir/cascade-palette/action, drafts excluded) whose
    `ca-entity-type` field matches the operand, plus globals
    (`ca-entity-type: *`).

    Matching rules (mirror cp-stack.js:loadActionsForType catalogue +
    globals branches):
      - action.ca-entity-type === operand  → match
      - action.ca-entity-type === "*"      → always match
      - operand === "*"                    → match only globals
      - operand === "" (empty)             → match only globals

    Does NOT apply `ca-action-when` narrowing — caller composes that
    via additional filter steps. Does NOT evaluate `ca-applies` —
    use `cp-actions-applying-to[<title>]` for that path.

    Source feed is ignored; the operator emits its own catalogue
    listing from `[all[shadows+tiddlers]tag[$:/tags/rimir/cascade-palette/action]] +[!is[draft]]`.

\*/
"use strict";

var ACTION_TAG = "$:/tags/rimir/cascade-palette/action";

exports["cp-actions-for"] = function (source, operator, options) {
    var wiki = options.wiki;
    var operand = operator.operand || "";
    var titles = wiki.filterTiddlers(
        "[all[shadows+tiddlers]tag[" + ACTION_TAG + "]] +[!is[draft]]"
    );
    var results = [];
    for (var i = 0; i < titles.length; i++) {
        var t = wiki.getTiddler(titles[i]);
        var fields = (t && t.fields) || {};
        var et = fields["ca-entity-type"] || "";
        if (et === "*") {
            results.push(titles[i]);
        } else if (operand && et === operand) {
            results.push(titles[i]);
        }
    }
    return results;
};
