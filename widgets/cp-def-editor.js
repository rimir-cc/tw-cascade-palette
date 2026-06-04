/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-def-editor.js
type: application/javascript
module-type: library

In-palette lifecycle for ENTRY and ACTION definitions (Phase 5) — the create /
clone / delete behind "Manage entries" and "Manage actions". One generic
implementation parameterised by a spec object (tag / namespace / manage-entry),
so entries and actions share exactly one code path; thin `_newEntry` /
`_newAction` / … wrappers exist only so the widget message handlers read
cleanly. Mirrors cp-axis-editor, minus the live match-count key editor (entries
and actions have no grouping filter to preview) — creation is just: prompt a
name → save a fresh tagged definition with sane defaults → reopen the list,
where the new row appears under "Your …" and drills into its field editor
(cp-entry-edit-rows / cp-action-edit-rows) to fill in the rest.

USER definitions are real tiddlers edited in place; a SHIPPED (shadow-only)
definition is clone-protected (clone-to-edit, like shipped axes/lenses) — an
in-place edit would write an override that shadows the plugin's copy.
\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

// Transient holder for the name prompt (no live preview needed, so we don't
// pre-create the real definition — that would surface a half-named row).
var NAME_PROMPT_STATE = "$:/state/rimir/cascade-palette/def-name-prompt";

var ENTRY_SPEC = {
    label: "entry",
    tag: C.ENTRY_TAG,
    ns: C.ENTRIES_NS,
    manage: "$:/plugins/rimir/cascade-palette/entries/manage-entries",
    defaults: { "ca-kind": "leaf", "ca-actions": "" }
};
var ACTION_SPEC = {
    label: "action",
    tag: C.ACTION_TAG,
    ns: C.ACTIONS_NS,
    manage: "$:/plugins/rimir/cascade-palette/entries/manage-actions",
    defaults: { "ca-kind": "leaf", "ca-actions": "", "ca-applies": "" }
};

module.exports = function (proto) {

    // Copy a definition's authoring fields (every ca-*) into a fresh field set;
    // title / tags / type are set by the caller.
    function copyDefFields(src) {
        var out = {};
        Object.keys(src || {}).forEach(function (k) {
            if (k.indexOf("ca-") === 0) out[k] = src[k];
        });
        return out;
    }

    // ---- New (prompt name → save → reopen list) ---------------------------

    proto._newDef = function (spec) {
        var self = this;
        this.wiki.setText(NAME_PROMPT_STATE, "text", null, "");
        this.enterEditMode({
            bindTiddler: NAME_PROMPT_STATE,
            bindField: "text",
            kind: "text",
            editKind: "text",
            name: "New " + spec.label + " name",
            initialValue: "",
            returnFocus: "menu",
            onCommitFn: function (name) {
                self._finalizeNewDef(spec, name);
                self.wiki.deleteTiddler(NAME_PROMPT_STATE);
            },
            onCancelFn: function () {
                self.wiki.deleteTiddler(NAME_PROMPT_STATE);
            }
        });
    };

    proto._finalizeNewDef = function (spec, rawName) {
        var name = String(rawName || "").trim() || ("New " + spec.label);
        var newTitle = this._slugTitle(name, spec.ns);
        var fields = {
            title: newTitle,
            tags: [spec.tag],
            type: "text/vnd.tiddlywiki",
            "ca-name": name
        };
        Object.keys(spec.defaults).forEach(function (k) { fields[k] = spec.defaults[k]; });
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        this._reopenManageDef(spec);
        return newTitle;
    };

    // ---- Clone (shipped → editable user copy) -----------------------------

    proto._cloneDefToUser = function (spec, title) {
        var src = this.wiki.getTiddler(title);
        if (!src) return null;
        var sf = src.fields || {};
        var name = (sf["ca-name"] || title.split("/").pop()) + " (copy)";
        var newTitle = this._slugTitle(name, spec.ns);
        var fields = copyDefFields(sf);
        fields.title = newTitle;
        fields.tags = [spec.tag];
        fields.type = "text/vnd.tiddlywiki";
        fields["ca-name"] = name;
        this.wiki.addTiddler(new $tw.Tiddler(fields));
        return newTitle;
    };

    // ---- Delete (refuse shipped) ------------------------------------------

    proto._deleteDef = function (spec, title) {
        if (!title) return false;
        if (this.wiki.isShadowTiddler(title) && !this.wiki.tiddlerExists(title)) {
            if (this.hintEl) {
                this.hintEl.textContent =
                    "Shipped " + spec.label + "s can't be deleted — clone & edit instead.";
            }
            return false;
        }
        this.wiki.deleteTiddler(title);
        return true;
    };

    proto._reopenManageDef = function (spec) {
        if (this.openPaletteAtEntry) this.openPaletteAtEntry(spec.manage);
    };

    // ---- Thin per-kind wrappers (read cleanly in the widget wiring) -------

    proto._newEntry = function () { return this._newDef(ENTRY_SPEC); };
    proto._cloneEntryToUser = function (t) { return this._cloneDefToUser(ENTRY_SPEC, t); };
    proto._deleteEntry = function (t) { return this._deleteDef(ENTRY_SPEC, t); };

    proto._newAction = function () { return this._newDef(ACTION_SPEC); };
    proto._cloneActionToUser = function (t) { return this._cloneDefToUser(ACTION_SPEC, t); };
    proto._deleteAction = function (t) { return this._deleteDef(ACTION_SPEC, t); };

};
