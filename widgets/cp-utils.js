/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-utils.js
type: application/javascript
module-type: library

Shared utility helpers used across cp-* subsystems.

This module exports stateless top-level functions — no dependency on
`this` or any widget instance state. The cp-* prototype patchers
re-export them as instance methods where convenient (e.g. _parseNumOr*),
keeping call sites unchanged while making the helpers testable in
isolation.

Exports:
    parseNumOrNull(raw)                 → number | null
    parseNumOrDefault(raw, fallback)    → number
    sanitizeConstraintArg(arg)          → safe arg string (≤200 chars)
    buildConstraintInstance(meta, arg)  → filter/visibility instance shape
    detectInputPrefix(...)              → prefix-detection match record
    deprecationWarning(key, message)    → once-per-session console.warn + counter
    deprecationCounts()                 → snapshot of {key: count} for diagnostics
    resetDeprecationsForTesting()       → clear in-process state (spec only)

The `buildConstraintInstance` shape is shared by `cp-filters`
(`_buildFilterInstance`) and `cp-visibility` (`_buildVisibilityInstance`)
— both used identical bodies pre-0.0.81; consolidated here so future
schema tweaks land in one place.

\*/
"use strict";

// Parse a string into a finite number; return null for empty / NaN.
function parseNumOrNull(raw) {
    if (raw === undefined || raw === null || raw === "") return null;
    var n = parseFloat(raw);
    return isNaN(n) ? null : n;
}

// Parse a string into a finite number; return fallback for empty / NaN.
function parseNumOrDefault(raw, fallback) {
    var n = parseNumOrNull(raw);
    return n === null ? fallback : n;
}

// Sanitise a user-typed constraint argument (filter / visibility pill):
// strip control chars, drop literal brackets (which would break filter
// operand parsing if interpolated raw), trim, cap at 200 chars.
function sanitizeConstraintArg(arg) {
    return String(arg || "")
        .replace(/[\r\n\t]/g, " ")
        .replace(/[\]\[]/g, "")
        .trim()
        .slice(0, 200);
}

// Build the in-memory instance for one pushed constraint pill (filter
// OR visibility — the shape is symmetric). `meta` comes from the
// loader (one entry per tagged tiddler), `arg` is the user's typed
// argument. The instance is what lives in `this.filters[]` or
// `this.visibilities[]` and what the renderer / re-evaluator reads.
//
// Pre-substitution conventions:
//   `<arg>`   in expr  → `[<safeArg>]` (literal-bracket operand)
//   `<<arg>>` in text  → `<safeArg>`   (raw template substitution)
//
// The expr-side bracket wrap ensures the operand parses correctly even
// when safeArg contains spaces (TW filter operator argument grammar).
function buildConstraintInstance(meta, arg) {
    var safeArg = sanitizeConstraintArg(arg);
    function resolveFilter(template) {
        if (!template) return "";
        return String(template).replace(/<arg>/g, "[" + safeArg + "]");
    }
    function resolveText(template) {
        if (!template) return "";
        return String(template).replace(/<<arg>>/g, safeArg);
    }
    return {
        constraintTiddler: meta.title,
        name: meta.name,
        argType: meta.argType,
        arg: safeArg,
        expr: resolveFilter(meta.expr),
        chip: resolveText(meta.chip) || meta.name,
        hint: resolveText(meta.hint),
        help: resolveText(meta.help)
    };
}

// Dual-read a CHANNEL field from a tiddler's fields: prefer the new
// `ca-channel-<key>`, fall back to the legacy `ca-layer-<key>` so
// un-migrated channel tiddlers keep loading. The presence test is
// `!== undefined` (not truthiness) so an author who explicitly clears a new
// field to "" is honoured over a stale legacy value. Single home for the
// field-key literals shared by the parser (cp-views), the editor
// (cp-view-editor) and the long-tail drills (cp-view-edit-rows /
// cp-channel-edit-rows). WRITES always use the ca-channel-* namespace.
function channelField(f, key) {
    var nv = f && f["ca-channel-" + key];
    return nv !== undefined ? nv : (f && f["ca-layer-" + key]);
}

// Dual-read a view's composed-channels list: prefer `ca-view-channels`,
// fall back to the legacy `ca-view-layers`. Always returns a string.
function viewChannelsRaw(f) {
    var nv = f && f["ca-view-channels"];
    if (nv !== undefined) return nv || "";
    return (f && f["ca-view-layers"]) || "";
}

// Detect whether `text` begins with a known constraint prefix.
// Pure function — takes already-loaded filter + visibility meta lists
// (each entry having {prefix, ...}) rather than reading from `this`.
//
// Matching is GREEDY BY LENGTH across both kinds: a longer prefix
// (`prefix:`) wins over a shorter shared one (`/`). Ties between
// equal-length prefixes resolve by tiddler iteration order (i.e.
// whichever came first in the input arrays — caller decides the order).
//
// Returns `{kind, meta, argText}` on match, where:
//   kind     "filter" | "visibility"   which family the matched meta belongs to
//   meta     the matched meta entry (unchanged reference)
//   argText  the rest of `text` after the prefix (NOT yet sanitised)
// Returns null when no prefix matches OR text is empty.
function detectInputPrefix(text, filterMetas, visibilityMetas) {
    if (!text) return null;
    var candidates = [];
    (filterMetas || []).forEach(function (m) {
        if (m && m.prefix) candidates.push({ kind: "filter", meta: m });
    });
    (visibilityMetas || []).forEach(function (m) {
        if (m && m.prefix) candidates.push({ kind: "visibility", meta: m });
    });
    candidates.sort(function (a, b) {
        return b.meta.prefix.length - a.meta.prefix.length;
    });
    for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (text.indexOf(c.meta.prefix) === 0) {
            return {
                kind: c.kind,
                meta: c.meta,
                argText: text.slice(c.meta.prefix.length)
            };
        }
    }
    return null;
}

// Module-level once-per-session state. Reset via
// `resetDeprecationsForTesting` (specs only). The map is keyed by the
// `key` argument so callers control the dedup granularity (e.g. one
// warning per deprecated field name, not per call site).
var DEPRECATION_SEEN = Object.create(null);
var DEPRECATION_COUNTS = Object.create(null);

// Emit a console.warn for a deprecated schema, at most ONCE per session
// per `key`. Always counts the call in `DEPRECATION_COUNTS` so
// diagnostics can show how often legacy paths are exercised even after
// the user has dismissed the warning. Gated by the config tiddler
// `$:/config/rimir/cascade-palette/show-deprecations` (default "yes");
// set to anything else to silence the console output (counts still
// accrue for diagnostics).
function deprecationWarning(key, message, wiki) {
    if (!key) return;
    DEPRECATION_COUNTS[key] = (DEPRECATION_COUNTS[key] || 0) + 1;
    if (DEPRECATION_SEEN[key]) return;
    DEPRECATION_SEEN[key] = true;
    var show = "yes";
    if (wiki && typeof wiki.getTiddlerText === "function") {
        show = wiki.getTiddlerText(
            "$:/config/rimir/cascade-palette/show-deprecations",
            "yes"
        );
    }
    if (show !== "yes") return;
    if (console && console.warn) {
        console.warn("[cascade-palette] deprecated:", key, "—", message);
    }
}

// Snapshot the per-key call counts. Returns a fresh object so callers
// can safely mutate / serialize without affecting the live state.
function deprecationCounts() {
    var out = {};
    for (var k in DEPRECATION_COUNTS) {
        if (Object.prototype.hasOwnProperty.call(DEPRECATION_COUNTS, k)) {
            out[k] = DEPRECATION_COUNTS[k];
        }
    }
    return out;
}

// Spec-only reset hook. Production code never calls this; specs use it
// in `beforeEach` to get a clean once-per-session slate.
function resetDeprecationsForTesting() {
    DEPRECATION_SEEN = Object.create(null);
    DEPRECATION_COUNTS = Object.create(null);
}

exports.parseNumOrNull = parseNumOrNull;
exports.parseNumOrDefault = parseNumOrDefault;
exports.channelField = channelField;
exports.viewChannelsRaw = viewChannelsRaw;
exports.sanitizeConstraintArg = sanitizeConstraintArg;
exports.buildConstraintInstance = buildConstraintInstance;
exports.detectInputPrefix = detectInputPrefix;
exports.deprecationWarning = deprecationWarning;
exports.deprecationCounts = deprecationCounts;
exports.resetDeprecationsForTesting = resetDeprecationsForTesting;
