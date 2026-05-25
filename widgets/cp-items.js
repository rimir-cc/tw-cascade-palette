/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-items
type: application/javascript
module-type: library

Item building + scribe-style bound-value plumbing.

A cascade item is the in-memory record rendered as one row. It comes
from either a tagged tiddler (ENTRY/ACTION/SETTING/...) or a synthetic
JSON object emitted by `ca-items-from`. _buildCascadeItem is the single
factory; readCascadeFields / readCascadeFromObject are the entry points.

Bindings (toggle / number / text / date kinds):
    ca-bind-tiddler   target tiddler title
    ca-bind-field     target field (default "text")
    ca-bind-path      optional comma-separated walk inside the JSON
                      value of the field (e.g. "prefs,layout")
    ca-bind-type      scribetype handler name (default "text/plain")

Value flow on READ:  field text → handler.fromField() → display value
Value flow on WRITE: UI value → handler.toField() → field text

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var DEFAULT_ORDER = C.DEFAULT_ORDER;
var DEFAULT_BIND_TYPE = C.DEFAULT_BIND_TYPE;
var DEFAULT_TRUE_VALUE = C.DEFAULT_TRUE_VALUE;
var DEFAULT_FALSE_VALUE = C.DEFAULT_FALSE_VALUE;
var DEFAULT_STEP = C.DEFAULT_STEP;
var DEFAULT_STEP_MEDIUM = C.DEFAULT_STEP_MEDIUM;
var DEFAULT_STEP_LARGE = C.DEFAULT_STEP_LARGE;
var STRING_ARRAY_TYPE = C.STRING_ARRAY_TYPE;

module.exports = function (proto) {

    proto.readCascadeFields = function (title) {
        var t = this.wiki.getTiddler(title);
        var f = (t && t.fields) || {};
        return this._buildCascadeItem(f, title);
    };

    // Build a cascade item from an object of ca-* properties. Used by both
    // readCascadeFields (where the object is a tiddler's field map) and
    // ca-items-from synthesis (where the object is parsed-JSON from a
    // user filter). Synthetic items have empty title — downstream code
    // that touches title must early-return on empty.
    proto.readCascadeFromObject = function (obj) {
        var title = obj["title"] || "";  // synthetic items carry no backing tiddler
        var item = this._buildCascadeItem(obj, title);
        item.isSynthetic = !title;
        return item;
    };

    proto._buildCascadeItem = function (f, title) {
        var orderRaw = f["ca-order"];
        var order = orderRaw !== undefined && orderRaw !== ""
            ? parseFloat(orderRaw)
            : DEFAULT_ORDER;
        if (isNaN(order)) order = DEFAULT_ORDER;
        return {
            title: title,
            name: f["ca-name"] || title || "",
            hint: f["ca-hint"] || "",
            icon: f["ca-icon"] || "",
            kind: f["ca-kind"] || "leaf",
            order: order,
            group: title ? this.resolveGroup(title, f) : (f["ca-group"] || ""),
            actions: f["ca-actions"] || "",
            nextScope: f["ca-next-scope"] || "",
            // `ca-items-from`: drill items can synthesise their child stage
            // from a filter that returns JSON-encoded item shapes (one per
            // result). Mutually exclusive with `ca-next-scope`; if both
            // present, ca-items-from wins.
            itemsFrom: f["ca-items-from"] || "",
            nextTitle: f["ca-next-title"] || "",
            nextEntityType: f["ca-next-entity-type"] || "",
            nextDefaultAction: f["ca-next-default-action"] || "",
            // When `yes`, the next-stage filter results are rendered as
            // plain item rows (no chevron, Enter navigates) even if the
            // result tiddlers carry `ca-kind`. Diagnostic listings use
            // this so loaded entries/actions don't look drillable.
            nextAsLink: (f["ca-next-as-link"] || "").toLowerCase() === "yes",
            // Scribe-style binding used by `ca-kind: toggle` (and future
            // edit kinds). `bindPath` is a comma-separated walk into the
            // field text when it's JSON. `bindType` selects a scribetype
            // handler (default text/plain — pass-through). Setting a richer
            // type like application/x-string-array enables list-membership
            // semantics on toggle and provides array round-tripping for
            // text/number/date kinds.
            bindTiddler: f["ca-bind-tiddler"] || "",
            bindField: f["ca-bind-field"] || "text",
            bindPath: f["ca-bind-path"] || "",
            bindType: f["ca-bind-type"] ||
                ((f["ca-kind"] === "date") ? "application/x-tw-date" : DEFAULT_BIND_TYPE),
            trueValue: f["ca-true-value"] || DEFAULT_TRUE_VALUE,
            falseValue: f["ca-false-value"] || DEFAULT_FALSE_VALUE,
            // Numeric edit-kind config. `min`/`max` are nullable so callers
            // can opt into the slider rendering by setting both. Step
            // magnitudes are layered by modifier: bare key = step, Shift =
            // stepMedium, Ctrl = stepLarge.
            minValue: this._parseNumOrNull(f["ca-min"]),
            maxValue: this._parseNumOrNull(f["ca-max"]),
            step: this._parseNumOrDefault(f["ca-step"], DEFAULT_STEP),
            stepMedium: this._parseNumOrDefault(f["ca-step-medium"], DEFAULT_STEP_MEDIUM),
            stepLarge: this._parseNumOrDefault(f["ca-step-large"], DEFAULT_STEP_LARGE),
            defaultValue: this._parseNumOrNull(f["ca-default-value"]),
            // Suffix appended to the displayed value (e.g. "vw" for a width
            // setting). Storage stays bare numeric; consumers concatenate
            // when applying.
            unit: f["ca-unit"] || "",
            // Date display format — TW format-date template string. Used by
            // `ca-kind: date` row rendering. Default `DD.MM.YYYY` (German);
            // override with e.g. `YYYY-0MM-0DD` or `DDth MMM YYYY`.
            dateFormat: f["ca-date-format"] || "DD.MM.YYYY",
            // Confirm-on-fire (P3): when `ca-confirm: yes` is set on a leaf,
            // fireSelected wraps its actions in a confirm-stage instead of
            // firing them directly. consequence-text supports the standard
            // stage substitution variables.
            confirm: (f["ca-confirm"] || "").toLowerCase() === "yes",
            confirmConsequence: f["ca-confirm-consequence"] || "",
            // Post-fire behaviour for leaves. Default = close palette. "pop"
            // = fire action, pop one stage, keep palette open — useful for
            // sub-drills that act as pickers (e.g. ref / enum single-select
            // inside a multi-field edit flow): user picks a value, lands
            // back on the parent stage to continue editing other fields.
            afterFire: (f["ca-after-fire"] || "").toLowerCase(),
            // DEL on this row fires this action wikitext (in place of the
            // built-in restore-default / delete-tiddler paths). If
            // `ca-on-delete-consequence` is set, DEL pushes a confirm-stage
            // first; otherwise it fires immediately. Useful for synthetic
            // JSON-item rows (e.g. one element of a JSON array field) where
            // "delete this row" means mutating the parent tiddler, not
            // deleting any tiddler.
            onDelete: f["ca-on-delete"] || "",
            onDeleteConsequence: f["ca-on-delete-consequence"] || "",
            // ca-on-commit (text/number/date kinds): action wikitext fired
            // after a successful edit-mode commit, with <<picked>> bound to
            // the value the user just typed. Lets single-shot text rows
            // chain a create action onto the user's input — e.g. "+ Create
            // new kind…" types a key then immediately fires $action-
            // createtiddler. Bind-less rows can use it as a pure value
            // capture (no field is written; the value lives only in
            // <<picked>> for the action's lifetime).
            onCommit: f["ca-on-commit"] || "",
            // Side preview registration. When set on an entry/action,
            // drilling into the row pushes a new stage AND attaches a
            // right-pane preview to it: the engine renders the named
            // template tiddler's wikitext with `currentTiddler` bound to
            // the value of `ca-preview-context` (a filter evaluated at
            // drill-time in the standard stage substitution scope —
            // defaults to <<picked>>, i.e. the row title itself). The
            // pane stays visible while that stage (or any deeper one) is
            // on the stack, and the context value is also exposed to
            // deeper stages as <<stage-preview-context>>.
            previewTemplate: f["ca-preview-template"] || "",
            previewContext: f["ca-preview-context"] || "",
            previewTitle: f["ca-preview-title"] || "",
            isItem: false,           // entries / actions vs dynamic items
            isSynthetic: false       // overridden by readCascadeFromObject
        };
    };

    proto._parseNumOrNull = function (raw) {
        if (raw === undefined || raw === null || raw === "") return null;
        var n = parseFloat(raw);
        return isNaN(n) ? null : n;
    };

    proto._parseNumOrDefault = function (raw, fallback) {
        var n = this._parseNumOrNull(raw);
        return n === null ? fallback : n;
    };

    /* ---------- bound-value read/write ---------- */

    // Lazily-cached scribetype handler map. Built on first access; if scribe
    // is loaded later (unlikely but defensive), this re-fetches.
    proto._scribeHandlers = function () {
        if (!this._scribeHandlersCache) {
            this._scribeHandlersCache = $tw.modules.getModulesByTypeAsHashmap("scribetype") || {};
        }
        return this._scribeHandlersCache;
    };

    proto._handlerFor = function (bindType) {
        var handlers = this._scribeHandlers();
        return handlers[bindType] || handlers[DEFAULT_BIND_TYPE] || null;
    };

    // Read the raw value at the item's bind target — field text in whole-
    // field mode, or the JSON-decoded sub-path value. No type conversion.
    proto._readBoundRaw = function (item) {
        if (!item.bindTiddler) return undefined;
        var t = this.wiki.getTiddler(item.bindTiddler);
        if (!t) return undefined;
        var fieldText = t.fields[item.bindField];
        if (fieldText === undefined) return undefined;
        if (!item.bindPath) return fieldText;
        try {
            var node = JSON.parse(fieldText);
            var parts = item.bindPath.split(",");
            for (var i = 0; i < parts.length; i++) {
                if (node === null || node === undefined) return undefined;
                node = node[parts[i]];
            }
            return node;
        } catch (err) {
            return undefined;
        }
    };

    proto.readBoundValue = function (item) {
        var raw = this._readBoundRaw(item);
        if (raw === undefined) return undefined;
        var handler = this._handlerFor(item.bindType);
        if (handler && typeof handler.fromField === "function") {
            try {
                return handler.fromField(raw);
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] bind-type", item.bindType,
                        "fromField error on", item.bindTiddler, "—",
                        err && err.message
                    );
                }
                return undefined;
            }
        }
        return raw;
    };

    proto.writeBoundValue = function (item, value) {
        if (!item.bindTiddler) return;
        var handler = this._handlerFor(item.bindType);
        var converted = value;
        if (handler && typeof handler.toField === "function") {
            try {
                converted = handler.toField(value);
            } catch (err) {
                // Bad input from the user — surface and abort the write so
                // the previous value stays intact.
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] bind-type", item.bindType,
                        "toField rejected input", JSON.stringify(value),
                        "—", err && err.message
                    );
                }
                throw err;
            }
        }
        if (!item.bindPath) {
            // Whole-field write. Strings go in verbatim; non-strings are
            // JSON-serialised (matches scribe.js writeFromState behaviour).
            var existing = this.wiki.getTiddler(item.bindTiddler);
            var fields = { title: item.bindTiddler };
            if (converted === undefined || converted === null) {
                fields[item.bindField] = "";
            } else if (typeof converted === "string") {
                fields[item.bindField] = converted;
            } else {
                fields[item.bindField] = JSON.stringify(converted);
            }
            this.wiki.addTiddler(new $tw.Tiddler(
                (existing && existing.fields) || {},
                fields
            ));
            return;
        }
        // Sub-path write — read JSON, mutate, serialize back. Walks ahead
        // create intermediate objects so deep paths into a missing tree
        // still resolve.
        var t = this.wiki.getTiddler(item.bindTiddler);
        var fieldText = t && t.fields[item.bindField];
        var root;
        try {
            root = fieldText ? JSON.parse(fieldText) : {};
        } catch (err) {
            root = {};
        }
        var parts = item.bindPath.split(",");
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var key = parts[i];
            if (node[key] === undefined || node[key] === null || typeof node[key] !== "object") {
                node[key] = {};
            }
            node = node[key];
        }
        node[parts[parts.length - 1]] = converted;
        var newFields = { title: item.bindTiddler };
        // Single-line JSON. Pretty-printing (indent > 0) injects newlines
        // into the field value; TW's filesystem adaptor treats control
        // chars in non-text fields as "unsafe" and silently switches the
        // tiddler from .tid to .json file format, orphaning the .tid file
        // on disk. Compact JSON keeps the .tid format stable across edits.
        newFields[item.bindField] = JSON.stringify(root);
        this.wiki.addTiddler(new $tw.Tiddler(
            (t && t.fields) || {},
            newFields
        ));
    };

    // An item is "overridden" when its bound tiddler exists in the wiki
    // store AND is also defined as a shadow — meaning the user has saved
    // a real tiddler over the plugin's shadow. Pure shadows (untouched
    // defaults) and user-only tiddlers (no shadow source) are not
    // overridden in this sense.
    proto.isOverridden = function (item) {
        if (!item || !item.bindTiddler) return false;
        return this.wiki.tiddlerExists(item.bindTiddler) &&
            this.wiki.isShadowTiddler(item.bindTiddler);
    };

    // Read the shadow's value for a bound item — i.e. what the value
    // would be if the override were deleted. Uses the boot-time
    // shadowTiddlers map (semi-private API) since `wiki.getTiddler`
    // resolves overrides first.
    proto.getDefaultValue = function (item) {
        if (!item || !item.bindTiddler) return undefined;
        var src = $tw.boot && $tw.boot.shadowTiddlers && $tw.boot.shadowTiddlers[item.bindTiddler];
        if (!src || !src.tiddler) return undefined;
        var fields = src.tiddler.fields || {};
        return fields[item.bindField];
    };

    proto.readNumberValue = function (item) {
        var raw = this.readBoundValue(item);
        if (raw === undefined || raw === null || raw === "") {
            return item.defaultValue !== null ? item.defaultValue : 0;
        }
        var n = parseFloat(raw);
        if (isNaN(n)) return item.defaultValue !== null ? item.defaultValue : 0;
        return n;
    };

    proto.clampNumber = function (item, n) {
        if (item.minValue !== null && n < item.minValue) n = item.minValue;
        if (item.maxValue !== null && n > item.maxValue) n = item.maxValue;
        return n;
    };

    proto.stepMagnitudeFor = function (item, e) {
        if (e.ctrlKey) return item.stepLarge;
        if (e.shiftKey) return item.stepMedium;
        return item.step;
    };

    proto.isToggleOn = function (item) {
        var v = this.readBoundValue(item);
        if (v === undefined || v === null || v === "") {
            // Fall back: treat unset as off by default.
            return false;
        }
        // List-membership semantics: when bound to a string-array field,
        // the toggle's trueValue is one element of a multi-value set.
        // "on" = trueValue is currently in the list. Bare bind types use
        // scalar comparison.
        if (item.bindType === STRING_ARRAY_TYPE) {
            var list = String(v).split(/\s+/).filter(function (s) { return s; });
            var needle = String(item.trueValue);
            return list.indexOf(needle) !== -1;
        }
        if (typeof v === "boolean") return v;
        var s = String(v).toLowerCase();
        return s === String(item.trueValue).toLowerCase() ||
            s === "yes" || s === "true" || s === "on" || s === "1";
    };

};
