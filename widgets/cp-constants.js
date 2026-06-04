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
exports.PIN_CONTEXT_MESSAGE = "rimir-cascade-palette-pin-context";
exports.UNPIN_CONTEXT_MESSAGE = "rimir-cascade-palette-unpin-context";
exports.CLEAR_CONTEXT_MESSAGE = "rimir-cascade-palette-clear-context";
exports.ADD_FILTER_MESSAGE = "rimir-cascade-palette-add-filter";
exports.SET_FILTER_MESSAGE = "rimir-cascade-palette-set-filter";
exports.ADD_VISIBILITY_MESSAGE = "rimir-cascade-palette-add-visibility";
exports.SET_VISIBILITY_MESSAGE = "rimir-cascade-palette-set-visibility";
exports.RESET_FILTERS_MESSAGE = "rimir-cascade-palette-reset-filters";
exports.RESET_VISIBILITY_MESSAGE = "rimir-cascade-palette-reset-visibility";
exports.RESET_CONSTRAINTS_MESSAGE = "rimir-cascade-palette-reset-constraints";
exports.ADD_REACH_MESSAGE = "rimir-cascade-palette-add-reach";
exports.RESET_REACH_MESSAGE = "rimir-cascade-palette-reset-reach";
exports.ADD_META_MESSAGE = "rimir-cascade-palette-add-meta";
exports.RESET_META_MESSAGE = "rimir-cascade-palette-reset-meta";
exports.ADD_FIELD_MESSAGE = "rimir-cascade-palette-add-field";
exports.RESET_FIELDS_MESSAGE = "rimir-cascade-palette-reset-fields";
exports.SET_VIEW_MESSAGE = "rimir-cascade-palette-set-view";
exports.APPLY_PRESET_MESSAGE = "rimir-cascade-palette-apply-preset";
exports.SAVE_PRESET_MESSAGE = "rimir-cascade-palette-save-preset";
exports.RECALL_PRESET_MESSAGE = "rimir-cascade-palette-recall-preset";
// View lifecycle — fired from the "Manage views" menu (cp-view-editor).
exports.NEW_VIEW_MESSAGE = "rimir-cascade-palette-new-view";
exports.EDIT_VIEW_MESSAGE = "rimir-cascade-palette-edit-view";
exports.FORK_VIEW_MESSAGE = "rimir-cascade-palette-fork-view";
exports.DELETE_VIEW_MESSAGE = "rimir-cascade-palette-delete-view";
// Lens lifecycle — fired from the "Manage lenses" menu (cp-lens-editor).
// paramObject.slot selects which decoration slot the new lens projects.
exports.NEW_LENS_MESSAGE = "rimir-cascade-palette-new-lens";
// Clone a SHIPPED (shadow-only) lens to an editable USER lens under LENS_NS
// (paramObject.lens = source title) — fired from the shipped lens's field
// drill so its facets become editable without mutating the shadow.
exports.CLONE_LENS_MESSAGE = "rimir-cascade-palette-clone-lens";
// Delete a lens (paramObject.lens = title) — fired by the DEL-confirm stage
// pushed from a lens slot strip, or by ca-on-delete on a "Manage lenses" row.
exports.DELETE_LENS_MESSAGE = "rimir-cascade-palette-delete-lens";

// Axis lifecycle — fired from the "Manage axes" menu (cp-axis-editor),
// mirroring the lens lifecycle. NEW seeds a scratch axis + opens the live
// match-count key editor; CLONE copies a SHIPPED (shadow-only) axis to an
// editable USER axis under AXES_NS (paramObject.axis = source title); DELETE
// removes a user axis (paramObject.axis = title), behind the engine's
// ca-on-delete confirm on the "Manage axes" row.
exports.NEW_AXIS_MESSAGE = "rimir-cascade-palette-new-axis";
exports.CLONE_AXIS_MESSAGE = "rimir-cascade-palette-clone-axis";
exports.DELETE_AXIS_MESSAGE = "rimir-cascade-palette-delete-axis";

// ---- Tags consumed by the engine ----
exports.ENTRY_TAG = "$:/tags/rimir/cascade-palette/entry";
exports.ACTION_TAG = "$:/tags/rimir/cascade-palette/action";
exports.SETTING_TAG = "$:/tags/rimir/cascade-palette/setting";
exports.DIAGNOSTIC_TAG = "$:/tags/rimir/cascade-palette/diagnostic";
exports.TEMPLATE_TAG = "$:/tags/rimir/cascade-palette/template";
exports.FILTER_TAG = "$:/tags/rimir/cascade-palette/filter";
exports.VISIBILITY_TAG = "$:/tags/rimir/cascade-palette/visibility";
exports.REACH_TAG = "$:/tags/rimir/cascade-palette/reach";
// Search-in pills are split into two strips (0.0.88+):
//   SEARCH_META_TAG  → pills matching cascade-item author meta
//                       (item[ca-meta-key], e.g. name / hint or any
//                       author-defined key the item-builder populates).
//   SEARCH_FIELD_TAG → pills matching literal tiddler fields
//                       (wiki.getTiddler(item.title).fields[
//                        ca-tiddler-field], e.g. text / caption /
//                        tags / author-defined).
// Pre-0.0.88 `$:/tags/rimir/cascade-palette/field` and the unified
// `search-field` schema with `ca-field-name` are no longer honoured —
// authors must migrate (diagnostics drill `legacy-search-pills`
// lists stragglers).
exports.SEARCH_META_TAG = "$:/tags/rimir/cascade-palette/search-meta";
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
// Lens registration (H4). A lens is a tiddler tagged LENS_TAG that projects
// zero or more row-decoration SLOTS and may contribute actions — unifying
// the former row-label (name slot) + structure-toggle (icon slot)
// subsystems (both removed in the H4 cleanup) into one type-driven
// decorator. Fields:
//   ca-lens-name / -chip / -hint / -help   — display + help text
//   ca-lens-when      — applicability (global existence test; empty result
//                       hides the lens; missing/empty = always applicable)
//   ca-lens-default   — space-separated slot names for which this lens is
//                       the seeded default (e.g. "name") when no state stored
//   ca-lens-<slot>-filter    — cheap per-row projection: filter evaluated
//                       with <currentTiddler> = row title; first non-empty
//                       result fills the slot
//   ca-lens-<slot>-template  — rich per-row projection (wikitext rendered
//                       per visible row; filter wins when both are set)
//   ca-lens-actions   — opt into contributing actions (H4 slice 3). Two
//                       forms, BOTH always-on (gated only by ca-lens-when,
//                       NEVER by slot selection — the Kind lens contributes
//                       an icon AND actions, and its actions must survive
//                       turning the Icon slot off):
//                         "via-entity-type" — declarative marker; the lens
//                            owns the standard entity-type bridge (already
//                            always-on), contributes no extra titles.
//                         <filter> — returns ACTION tiddler titles, run with
//                            <currentTiddler> = the row, surfacing lens-
//                            specific actions (e.g. a Vacation lens adding
//                            "Clear vacation" to a person row on holiday).
//   ca-order          — sort order among lenses (default 100)
// Slots: see LENS_SLOTS. Each slot is a single-select chooser strip; the
// active lens per slot persists under LENS_STATE_PREFIX + <slot>.
exports.LENS_TAG = "$:/tags/rimir/cascade-palette/lens";
// Row-decoration slots a lens can project, in render order:
//   name       — REPLACE the row's display name
//   icon       — AUGMENT-LEAD a glyph before the name
//   annotation — AUGMENT-TRAIL a chip/badge after the name (H4 slice 4)
exports.LENS_SLOTS = ["name", "icon", "annotation"];
// Active lens per slot — body = lens tiddler title (empty = none/off).
// Slug is the slot name. Lives under $:/state/ so the choice survives
// reload but isn't filesystem-synced.
exports.LENS_STATE_PREFIX = "$:/state/rimir/cascade-palette/lens/";
// `ca-lens-actions` marker value — the lens declares it owns the standard
// always-on entity-type action bridge (catalogue + configured-field paths
// in loadActionsForType); it contributes no extra action titles itself.
// Any OTHER non-empty `ca-lens-actions` value is treated as a filter
// returning action tiddler titles to surface on a row.
exports.LENS_ACTIONS_VIA_ENTITY_TYPE = "via-entity-type";

// ---- Config tiddler titles ----
exports.SOFT_DEPTH_CONFIG = "$:/config/rimir/cascade-palette/soft-depth-warning";
exports.POPUP_WIDTH_CONFIG = "$:/config/rimir/cascade-palette/popup-width";
exports.MAX_RESULTS_CONFIG = "$:/config/rimir/cascade-palette/max-results";
exports.DETAILS_ALWAYS_ON_CONFIG = "$:/config/rimir/cascade-palette/details-always-on";
exports.PIN_PILL_ROWS_CONFIG = "$:/config/rimir/cascade-palette/pin-pill-rows";
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
// Sticky context — list of tiddler titles the user has pinned for the
// duration of a workday flow (call, meeting, focus). Single field `list`
// in TW parseStringArray format. Lives under $:/temp/ so it's purely
// page-session — closes with the browser tab AND clears on full reload.
// Matches the user's expectation that workday context tracks one
// continuous flow, not a multi-session memory. Exposed to every filter
// eval as the <<sticky-context-list>> / <<sticky-context-count>>
// variables; rendered as a dedicated pill strip above the visibility
// strip.
exports.STICKY_CONTEXT_TITLE = "$:/temp/rimir/cascade-palette/sticky-context";
// Scratchpad namespace — session-only working copies of definition
// tiddlers (views/layers/axes/...). A scratchpad is created by cloning a
// persisted definition; ALL editing happens here, strictly isolated from
// the originals until the user commits (save-as-new / overwrite / discard).
// Lives under $:/state/ so it survives accidental reload but is NOT
// filesystem-synced (same rationale as layer-axes state). Each scratchpad
// gets a `<scratch-id>/` sub-namespace; the definition tiddler carries
// bookkeeping fields `cp-scratch-kind` (view|layer|axis|entry|action) and
// `cp-scratch-source` (the persisted title it was cloned from, empty for
// create-from-scratch).
exports.SCRATCHPAD_PREFIX = "$:/state/rimir/cascade-palette/scratchpad/";
// Scratch state tiddler for the side-preview "filter lab" — an
// AdvancedSearch-style independent filter input + live result list shown
// while editing a filter facet. Decoupled from the palette input: the user
// experiments here and copies a working filter back. $:/state ⇒ not synced.
exports.FILTER_LAB_STATE = "$:/state/rimir/cascade-palette/filter-lab";
exports.SCRATCH_KIND_FIELD = "cp-scratch-kind";
exports.SCRATCH_SOURCE_FIELD = "cp-scratch-source";
// Marks a view scratchpad created PURELY as a live-preview carrier for
// shared-layer edits (the user never asked to edit the view itself). Such a
// scratchpad shows no view-level commit pills and is torn down automatically
// once its last edited layer is committed/discarded. Cleared if the user goes
// on to edit a view-scoped facet, promoting it to a genuine view edit.
exports.SCRATCH_PREVIEW_ONLY_FIELD = "cp-scratch-preview-only";
// Persisted namespaces for new / saved definitions (collision-safe slug
// appended). User definitions share the shadow namespace — a real tiddler
// at a fresh slug simply doesn't collide; the slug loop guards the rest.
exports.VIEWS_NS = "$:/plugins/rimir/cascade-palette/views/";
exports.LAYERS_NS = "$:/plugins/rimir/cascade-palette/structure-layers/";
exports.AXES_NS = "$:/plugins/rimir/cascade-palette/axes/";
// User-created lenses (collision-safe slug appended). Shipped lenses live
// in the same namespace as plugin shadows; a fresh slug doesn't collide.
exports.LENS_NS = "$:/plugins/rimir/cascade-palette/lens/";

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
// Menu hint is composed per-row from the tokens below in `_renderHint`'s
// menu branch — each token is gated on a capability of the selected row
// (`picked.kind`, `picked._rowIcons`, `loadActionsForType`, etc.) so the
// hint only advertises gestures that actually do something on this row.
exports.HINT_TOKENS = {
    "tab-section":      "Tab section",
    "select":           "↑↓ select",
    "drill":            "→ drill",
    "back":             "← back",
    "actions":          "Space actions",
    "pin":              "Space pin",
    "toggle":           "Space toggle",
    "edit":             "Space edit",
    "adjust":           "+/- adjust",
    "fire":             "↵ fire",
    "open-icon":        "Alt-↵ open",
    "copy-icon":        "Ctrl-Alt-↵ copy",
    "esc-input":        "Esc input",
    "esc-tiddler":      "Esc tiddler",
    "hold-ctrl-detail": "hold Ctrl detail"
};
exports.HINT_DETAILS = "Tab section · ↑↓ scroll · Esc input · ↵ fire";
exports.HINT_PREVIEW = "Tab section · ↑↓ scroll · Esc input";
exports.HINT_PREVIEW_PILLS = "Tab section · ←→ switch preview · ↑↓ scroll · Esc input";
exports.HINT_FILTER     = "Tab section · ←→ select · DEL remove · Ctrl-DEL clear all · Esc input";
exports.HINT_CONTEXT    = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_VISIBILITY = "Tab section · ←→ select · DEL remove · Ctrl-DEL clear all · Esc input";
exports.HINT_REACH      = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_META       = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_FIELD      = "Tab section · ←→ select · DEL remove · Esc input";
exports.HINT_VIEW       = "Tab section · ←→ select · ↵ activate · Esc input";
exports.HINT_LENS       = "Tab section · ←→ select (← (off) to disable) · ↵ activate / + New · e edit · DEL delete · ↑↓ slot · Esc input";
exports.HINT_LEADER     = "Tab section · ←→ select · ↵/Space fire · Esc input";
exports.HINT_VIEWCONFIG_COMPACT  = "Tab section · ↵/Space/→ expand · Esc input";
exports.HINT_VIEWCONFIG_EXPANDED = "Tab section · ↑↓←→ navigate pills · hold Ctrl preview · Esc collapse";
exports.HINT_PRESET             = "Tab section · ←→ select · ↵ apply · DEL delete · Esc input";
exports.HINT_PRESET_ACTIVE      = "Tab section · ←→ select · ↵ apply · DEL delete · Esc input · (active preset)";
exports.HINT_PRESET_ACTIVE_DIRTY = "preset modified · Ctrl-↵ overwrite · ↵ re-apply · DEL delete · Esc input";
exports.HINT_PRESET_PLUS        = "↵ save current state as new preset · Esc input";
exports.HINT_EDIT       = "↵ commit · Esc cancel";
