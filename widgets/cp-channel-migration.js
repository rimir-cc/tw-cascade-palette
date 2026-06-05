/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-channel-migration.js
type: application/javascript
module-type: startup

One-time, version-guarded, idempotent migration of the VIEW→CHANNEL rename
(0.0.9x). Rewrites USER tiddlers in place (shadows are never touched — shipped
tiddlers already ship the new vocabulary):

  - channels  (tagged STRUCTURE_LAYER_TAG): retag → CHANNEL_TAG and rename
               every `ca-layer-*` field → `ca-channel-*`.
  - views     (tagged VIEW_TAG): rename `ca-view-layers` → `ca-view-channels`
               and `ca-view-layer-name` → `ca-view-channel-name`, and rewrite
               any reference to a SHIPPED channel that moved from the
               `structure-layers/` namespace to `channels/`.

Write-only-on-change: a tiddler with nothing to migrate is left byte-identical.
A guard tiddler records the migration version so subsequent boots skip the
scan. The parser (cp-views.js) dual-reads the legacy fields regardless, so any
tiddler imported AFTER the guard is set still renders correctly; the editor
normalizes legacy fields onto the new namespace whenever it clones one.

Browser-only: a Node server never runs browser startup modules, so the guard
+ rewritten user tiddlers sync back to disk from the client.
\*/
(function () {
    "use strict";

    var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

    exports.name = "rimir-cascade-palette-channel-migration";
    exports.platforms = ["browser"];
    exports.after = ["startup"];
    exports.synchronous = true;

    var GUARD = "$:/config/rimir/cascade-palette/channel-migration";
    var MIGRATION_VERSION = "1";

    // Shipped channels that moved namespaces in this release. Only these
    // KNOWN titles are rewritten in view references — user channels created
    // under the old structure-layers/ namespace keep their titles (their
    // fields are migrated in place, not their location).
    var SHIPPED_MOVES = {
        "$:/plugins/rimir/cascade-palette/structure-layers/entries":
            "$:/plugins/rimir/cascade-palette/channels/entries",
        "$:/plugins/rimir/cascade-palette/structure-layers/path-tree":
            "$:/plugins/rimir/cascade-palette/channels/path-tree",
        "$:/plugins/rimir/cascade-palette/structure-layers/tag-tree":
            "$:/plugins/rimir/cascade-palette/channels/tag-tree"
    };

    var LAYER_PREFIX = "ca-layer-";
    var CHANNEL_PREFIX = "ca-channel-";

    function moveRef(title) {
        return SHIPPED_MOVES[title] || title;
    }

    // Compute the field/tag mods needed to migrate one tiddler's fields, or
    // null if nothing needs changing. Pure function of `fields` — exported so
    // the migration is unit-testable without a live wiki.
    function computeMods(fields) {
        var f = fields || {};
        var tags = $tw.utils.parseStringArray(f.tags || "") || [];
        var isChannel = tags.indexOf(C.STRUCTURE_LAYER_TAG) >= 0;
        var isView = tags.indexOf(C.VIEW_TAG) >= 0;
        var mods = {};
        var dirty = false;

        // --- channel field rename + retag -------------------------------
        var hasLayerFields = false;
        Object.keys(f).forEach(function (k) {
            if (k.indexOf(LAYER_PREFIX) === 0) hasLayerFields = true;
        });
        if (isChannel || hasLayerFields) {
            Object.keys(f).forEach(function (k) {
                if (k.indexOf(LAYER_PREFIX) !== 0) return;
                var nk = CHANNEL_PREFIX + k.slice(LAYER_PREFIX.length);
                if (f[nk] === undefined) mods[nk] = f[k]; // don't clobber a set new field
                mods[k] = undefined;                      // drop the legacy field
                dirty = true;
            });
            if (tags.indexOf(C.STRUCTURE_LAYER_TAG) >= 0) {
                var newTags = tags.map(function (t) {
                    return t === C.STRUCTURE_LAYER_TAG ? C.CHANNEL_TAG : t;
                });
                // De-dup if both tags already present.
                mods.tags = newTags.filter(function (t, i) {
                    return newTags.indexOf(t) === i;
                });
                dirty = true;
            }
        }

        // --- view composed-channels + per-channel-name rename -----------
        if (isView) {
            if (f["ca-view-layers"] !== undefined && f["ca-view-channels"] === undefined) {
                var refs = String(f["ca-view-layers"]).trim();
                refs = refs ? refs.split(/\s+/).map(moveRef).join(" ") : "";
                mods["ca-view-channels"] = refs;
                mods["ca-view-layers"] = undefined;
                dirty = true;
            }
            if (f["ca-view-layer-name"] !== undefined && f["ca-view-channel-name"] === undefined) {
                mods["ca-view-channel-name"] = f["ca-view-layer-name"];
                mods["ca-view-layer-name"] = undefined;
                dirty = true;
            }
        }

        return dirty ? mods : null;
    }

    // Run the migration over a wiki's USER tiddlers. Returns the count of
    // tiddlers rewritten. Exported for tests.
    function migrate(wiki) {
        var changed = 0;
        var titles = [];
        wiki.each(function (tiddler, title) { titles.push(title); });
        titles.forEach(function (title) {
            if (wiki.isShadowTiddler(title) && !wiki.tiddlerExists(title)) return;
            var tiddler = wiki.getTiddler(title);
            if (!tiddler) return;
            var mods = computeMods(tiddler.fields);
            if (!mods) return;
            wiki.addTiddler(new $tw.Tiddler(tiddler.fields, mods));
            changed++;
        });
        return changed;
    }

    exports.computeMods = computeMods;
    exports.migrate = migrate;

    exports.startup = function () {
        var wiki = $tw.wiki;
        if (wiki.getTiddlerText(GUARD, "") === MIGRATION_VERSION) return;
        var changed = migrate(wiki);
        wiki.addTiddler(new $tw.Tiddler({
            title: GUARD,
            text: MIGRATION_VERSION
        }));
        if (changed && console && console.log) {
            console.log(
                "[cascade-palette] channel migration: rewrote " + changed +
                " user tiddler" + (changed === 1 ? "" : "s") +
                " (ca-layer-* → ca-channel-*)"
            );
        }
    };
})();
