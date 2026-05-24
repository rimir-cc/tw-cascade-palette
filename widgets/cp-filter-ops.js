/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-filter-ops.js
type: application/javascript
module-type: filteroperator

Custom filter operators for cascade-palette views.

cp-child-of[<parent-title>]
    Direct path-segment children of <parent-title>. With an empty operand,
    returns titles that have no `/` (the root level of the namespace tree).
    With a non-empty operand, returns titles whose prefix is `<parent>/`
    AND whose remainder contains no further `/` — i.e. immediate children
    only.

    Used by the shipped `by-namespace` view to declaratively express the
    path-segment tree without bespoke JS in cp-views.

\*/
"use strict";

exports["cp-child-of"] = function (source, operator) {
    var parent = operator.operand || "";
    var sep = "/";
    var results = [];
    source(function (tiddler, title) {
        if (parent === "") {
            if (title.indexOf(sep) === -1) results.push(title);
            return;
        }
        var prefix = parent + sep;
        if (title.indexOf(prefix) !== 0) return;
        var rest = title.slice(prefix.length);
        if (rest.length === 0) return;
        if (rest.indexOf(sep) !== -1) return;
        results.push(title);
    });
    return results;
};
