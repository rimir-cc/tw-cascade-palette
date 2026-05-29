/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-constants
type: application/javascript
module-type: library

Shared constants for the cascade-palette widget. All other cp-*.js
sibling files require these — keep this file free of imports.

\*/
"use strict";

// ---- TW messages ----
exports.OPEN_MESSAGE = "rimir-cascade-palette-open";
exports.OPEN_ENTRY_MESSAGE = "rimir-cascade-palette-open-entry";
exports.ADD_FILTER_MESSAGE = "rimir-cascade-palette-add-filter";
exports.SET_FILTER_MESSAGE = "rimir-cascade-palette-set-filter";
exports.ADD_VISIBILITY_MESSAGE = "rimir-cascade-palette-add-visibility";
exports.SET_VISIBILITY_MESSAGE = "rimir-cascade-palette-set-visibility";
exports.RESET_FILTERS_MESSAGE = "rimir-cascade-palette-reset-filters";
exports.RESET_VISIBILITY_MESSAGE = "rimir-cascade-palette-reset-visibility";
exports.RESET_CONSTRAINTS_MESSAGE = "rimir-cascade-palette-reset-constraints";
exports.ADD_REACH_MESSAGE = "rimir-cascade-palette-add-reach";
exports.RESET_REACH_MESSAGE = "rimir-cascade-palette-reset-reach";
exports.ADD_FIELD_MESSAGE = "rimir-cascade-palette-add-field";
exports.RESET_FIELDS_MESSAGE = "rimir-cascade-palette-reset-fields";
exports.SET_VIEW_MESSAGE = "rimir-cascade-palette-set-view";
exports.APPLY_PRESET_MESSAGE = "rimir-cascade-palette-apply-preset";
exports.SAVE_PRESET_MESSAGE = "rimir-cascade-palette-save-preset";
exports.RECALL_PRESET_MESSAGE = "rimir-cascade-palette-recall-preset";

// ---- Tags consumed by the engine ----
exports.ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";
exports.ACTION_TAG = "$:/tags/rimir/cascade-palette/action";
exports.SETTING_TAG = "$:/tags/rimir/cascade-palette/setting";
exports.DIAGNOSTIC_TAG = "$:/tags/rimir/cascade-palette/diagnostic";
exports.TEMPLATE_TAG = "$:/tags/rimir/cascade-palette/template";
exports.FILTER_TAG = "$:/tags/rimir/cascade-palette/filter";
exports.VISIBILITY_TAG = "$:/tags/rimir/cascade-palette/visibility";
exports.REACH_TAG = "$:/tags/rimir/cascade-palette/reach";
// Legacy tag for search-in-pill tiddlers. Pre-0.0.84 name; engine
// still reads tiddlers carrying it for back-compat, but emits a
// once-per-session deprecation warning. Authors should migrate to
// SEARCH_FIELD_TAG below.
exports.FIELD_TAG = "$:/tags/rimir/cascade-palette/field";
// Canonical tag for search-in-pill tiddlers (0.0.84+).
exports.SEARCH_FIELD_TAG = "$:/tags/rimir/cascade-palette/search-field";
exports.VIEW_TAG = "$:/tags/rimir/cascade-palette/view";
exports.STRUCTURE_LAYER_TAG = "$:/tags/rimir/cascade-palette/structure-layer";
exports.AXIS_TAG = "$:/tags/rimir/cascade-palette/axis";
exports.LEADER_TAG = "$:/tags/rimir/cascade-palette/leader";
exports.PRESET_TAG = "$:/tags/rimir/cascade-palette/preset";
exports.HELP_TAG = "$:/tags/rimir/cascade-palette/help";
// Side-preview registration. Tiddlers tagged with this declare an extra
// preview candidate that auto-attaches whenever the row's resolved context
// matches `ca-preview-applies` (filter evaluated with `<currentTiddler>`
// bound to the context). Per-menu `ca-preview-template` on entries/actions
// still works in parallel — both contribute to the candidate list, and the
// user navigates between alternatives via ←/→ pills inside the preview
// pane. See `widgets/cp-side-preview.js` for the resolution algorithm.
exports.SIDE_PREVIEW_TAG = "$:/tags/rimir/cascade-palette/side-preview";
// Row-icon registration. Tiddlers tagged with this declare a small glyph
// that renders in a footer strip beneath any tiddler-bearing row when
// the icon's `ca-row-icon-applies` filter matches (or, for the built-in
// `ca-row-icon-key: url`, when the row's tiddler carries a value matching
// the configured URL fields). Alt-Enter on the row fires the primary
// icon's action / message. See `widgets/cp-row-icons.js`.
exports.ROW_ICON_TAG = "$:/tags/rimir/cascade-palette/row-icon";

// ---- Config tiddler titles ----
exports.SOFT_DEPTH_CONFIG = "$:/config/rimir/cascade-palette/soft-depth-warning";
exports.POPUP_WIDTH_CONFIG = "$:/config/rimir/cascade-palette/popup-width";
exports.MAX_RESULTS_CONFIG = "$:/config/rimir/cascade-palette/max-results";
exports.DETAILS_ALWAYS_ON_CONFIG = "$:/config/rimir/cascade-palette/details-always-on";
exports.PERF_FOOTER_CONFIG = "$:/config/rimir/cascade-palette/show-perf-footer";
// Space-separated list of fields scanned by the built-in `url` row-icon.
// First field on a row's tiddler whose value matches an http/https/ftp/
// mailto/tel URL prefix wins. Default: "url".
exports.URL_FIELDS_CONFIG = "$:/config/rimir/cascade-palette/url-fields";
// Single field name used to auto-derive `ca-applies` from `ca-entity-type`.
// When set (typically by an installed type-system plugin like `rimir/kind`
// which presets it to `kind.type`), an action with `ca-entity-type: <X>`
// automatically surfaces on any row whose tiddler has `<configured-field>:
// <X>` — no per-action `ca-applies` needed. Empty / missing = no auto-
// derive (engine ships no default; only catalogue + explicit `ca-applies`
// + `*` globals contribute). The cascade-palette plugin does NOT ship a
// default tiddler at this title — the bridge is opt-in via a catalogue /
// type-system plugin that ships the override.
exports.ENTITY_TYPE_FIELD_CONFIG = "$:/config/rimir/cascade-palette/entity-type-field";
// Saved stage stack — written on close (when the close path opts in to
// "preserve") and read by the next openPalette so the user resumes where
// they left off. Uses $:/temp/ so TW does NOT sync it to disk: it's
// session-only by virtue of the namespace, no sessionStorage needed.
exports.SAVED_STACK_TIDDLER = "$:/temp/rimir/cascade-palette/saved-stack";
// Per-layer axis-chain session state. Slug = last segment of layer title.
// Lives under $:/state/ so it survives reload but isn't filesystem-synced.
// Body is JSON: { "axes": [ "<axis-title>", ... ] }.
exports.LAYER_AXES_STATE_PREFIX = "$:/state/rimir/cascade-palette/layer-axes/";

// ---- Defaults for nullable / fallback fields ----
exports.DEFAULT_ORDER = 100;
exports.DEFAULT_MAX_RESULTS = 30;
exports.DEFAULT_SOFT_DEPTH = 10;
exports.DEFAULT_TRUE_VALUE = "yes";
exports.DEFAULT_FALSE_VALUE = "no";
exports.DEFAULT_STEP = 1;
exports.DEFAULT_STEP_MEDIUM = 5;
exports.DEFAULT_STEP_LARGE = 20;
exports.DEFAULT_BIND_TYPE = "text/plain";

// ---- Leader-key idle window default ----
exports.DEFAULT_LEADER_IDLE_MS = 500;

// ---- Bind-type names with special handling ----
// String-array binds get list-membership semantics on toggle (the toggle's
// trueValue is treated as a list element, not a scalar replacement).
exports.STRING_ARRAY_TYPE = "application/x-string-array";

// ---- Footer hint text per palette mode ----
// Section-specific hints surface the relevant gestures inline. Common
// gestures (Tab cycle, ↵ fire, Ctrl-↵ fire+stay, hold Ctrl preview)
// appear in every variant so the user always sees the escape hatches.
exports.HINT_INPUT   = "Tab section · ↓ menu · ↵ fire · Ctrl-↵ fire+stay · Esc back · Shift-Esc close · hold Ctrl detail · ? help";
exports.HINT_MENU    = "Tab section · ↑↓ select · → drill · ← back · Space actions/toggle/edit · +/- adjust · ↵ fire · Esc input · hold Ctrl detail";
// Same as HINT_MENU plus the Alt-↵ row-icon gesture. Surfaced when the
// selected row has at least one row-icon resolved.
exports.HINT_MENU_ROW_ICON = "Tab section · ↑↓ select · → drill · Alt-↵ open · ↵ fire · Esc input · hold Ctrl detail";
// As HINT_MENU_ROW_ICON, but surfaces the icon's ''secondary'' gesture
// (Ctrl-Alt-↵) when present. Shown e.g. on rows with the shipped `url`
// icon, where the primary action opens the URL and the alt action
// copies it to the clipboard.
exports.HINT_MENU_ROW_ICON_ALT = "Tab section · Alt-↵ open · Ctrl-Alt-↵ copy · ↵ fire · Esc input · hold Ctrl detail";
exports.HINT_DETAILS = "Tab section · ↑↓ scroll · Esc input · ↵ fire";
exports.HINT_PREVIEW = "Tab section · ↑↓ scroll · Esc input";
exports.HINT_PREVIEW_PILLS = "Tab section · ←→ switch preview · ↑↓ scroll · Esc input";
exports.HINT_FILTER     = "Tab section · ←→ select · DEL remove · Ctrl-DEL clear all · Esc input";
exports.HINT_VISIBILITY = "Tab section · ←→ select · DEL remove · Ctrl-DEL clear all · Esc input";
exports.HINT_REACH      = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_FIELD      = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_VIEW       = "Tab section · ←→ select · ↵ activate · Esc input";
exports.HINT_LEADER     = "Tab section · ←→ select · ↵/Space fire · Esc input";
exports.HINT_VIEWCONFIG_COMPACT  = "Tab section · ↵/Space/→ expand · Esc input";
exports.HINT_VIEWCONFIG_EXPANDED = "Tab section · ↑↓←→ navigate pills · hold Ctrl preview · Esc collapse";
exports.HINT_PRESET             = "Tab section · ←→ select · ↵ apply · DEL delete · Esc input";
exports.HINT_PRESET_ACTIVE      = "Tab section · ←→ select · ↵ apply · DEL delete · Esc input · (active preset)";
exports.HINT_PRESET_ACTIVE_DIRTY = "preset modified · Ctrl-↵ overwrite · ↵ re-apply · DEL delete · Esc input";
exports.HINT_PRESET_PLUS        = "↵ save current state as new preset · Esc input";
exports.HINT_EDIT       = "↵ commit · Esc cancel";
