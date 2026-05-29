/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-position-of.js
type: application/javascript
module-type: filteroperator

cp-position-of[<view-slug>]
    For each input entry title, emit its effective tree-position
    parents in the named view. Resolution chain:
      1. `ca-position-<slug>` (per-view override)
      2. `ca-position`        (default)
      3. "at-root"             (no field present)

    Three accepted shapes (per cp-views.js:parsePositionField):
      a) JSON array — `ca-position: ["A","B"]` → ["A","B"]. Detected by
         leading `[`. Invalid JSON falls back to (b).
      b) Legacy string — colon (`:`) or newline split, trim each
         token, drop empties. `ca-position: ParentA:ParentB` emits
         two parents.
      c) "none" — entry emits NO positions for that view (excluded
         from view rendering). Applies at whichever level matched;
         e.g. a `ca-position-by-namespace: none` excludes only from
         the by-namespace view but leaves the base `ca-position`
         untouched.

    A blank slug field (`ca-position-by-namespace:` with empty value)
    falls back to the base `ca-position`, matching the JS
    `resolveEntryPositions` semantics (cp-views.js).

    Empty operand → resolves base `ca-position` with no slug override
    (`<slug>` becomes `""` → field name is `ca-position-` which is
    never present, so falls through to `ca-position`).

\*/
"use strict";

function parsePositionField(posRaw) {
    if (posRaw === "none") return null;
    if (posRaw === undefined || posRaw === null || posRaw === "") {
        return ["at-root"];
    }
    var str = String(posRaw);
    if (str.length > 0 && str.charAt(0) === "[") {
        try {
            var arr = JSON.parse(str);
            if (Array.isArray(arr)) {
                var out = [];
                for (var i = 0; i < arr.length; i++) {
                    var v = arr[i];
                    if (v === undefined || v === null) continue;
                    var sv = String(v).trim();
                    if (sv) out.push(sv);
                }
                return out.length ? out : ["at-root"];
            }
        } catch (err) { /* fall through to legacy parser */ }
    }
    var positions = str.split(/[:\n]/).map(function (s) {
        return s.trim();
    }).filter(function (s) { return s; });
    if (!positions.length) positions = ["at-root"];
    return positions;
}

exports["cp-position-of"] = function (source, operator, options) {
    var wiki = options.wiki;
    var slug = operator.operand || "";
    var results = [];
    source(function (tiddler, title) {
        var t = tiddler || wiki.getTiddler(title);
        var fields = (t && t.fields) || {};
        var slugRaw = slug ? fields["ca-position-" + slug] : undefined;
        var positions;
        if (slugRaw === undefined || slugRaw === "") {
            positions = parsePositionField(fields["ca-position"]);
        } else {
            positions = parsePositionField(slugRaw);
        }
        if (positions === null) return;
        for (var i = 0; i < positions.length; i++) {
            results.push(positions[i]);
        }
    });
    return results;
};
