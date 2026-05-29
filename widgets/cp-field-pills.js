/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-field-pills
type: application/javascript
module-type: library

Field subsystem — pills that decide WHICH item fields the search
matcher reads.

A field pill is a tiddler tagged FIELD_TAG that declares a
`ca-field-name` field naming the cascade-item key it covers
(`name`, `hint`, `description`, `aliases`, `searchText`, or any
custom field an author chooses to expose).

Semantics (the matcher in cp-actions.js:filterByQuery + the deep
walker in cp-deep-search.js consume `_activeFieldNames()`):
  - No field pills pushed → matcher uses each row's
    `ca-search-fields` declaration (or the global default).
  - One or more field pills pushed → matcher uses the UNION of
    those pill field-names, ignoring per-row config and global
    default. Lets the user say explicitly "match only in
    description" or "match in name AND description".

Push / remove / focus / keyboard model mirrors cp-filters.js and
cp-reach-pills.js exactly. Pushed via the
`rimir-cascade-palette-add-field` message (typically from
leader keys).

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var utils = require("$:/plugins/rimir/cascade-palette/widgets/cp-utils");
var FIELD_TAG = C.FIELD_TAG;
var SEARCH_FIELD_TAG = C.SEARCH_FIELD_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadFieldTiddlers = function () {
        var self = this;
        // Union of the canonical `search-field` tag and the legacy
        // `field` tag (pre-0.0.84). Authors with both shipped see the
        // same tiddler at most once because filter-run union dedupes
        // by title. A once-per-session deprecation warning fires when
        // any legacy-tagged tiddlers are still in the store.
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + SEARCH_FIELD_TAG + "]] " +
            "[all[shadows+tiddlers]tag[" + FIELD_TAG + "]]"
        );
        var legacyCount = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + FIELD_TAG + "]] " +
            "-[all[shadows+tiddlers]tag[" + SEARCH_FIELD_TAG + "]]"
        ).length;
        if (legacyCount > 0) {
            utils.deprecationWarning(
                "tag:" + FIELD_TAG,
                "search-in pill tiddlers should be tagged " + SEARCH_FIELD_TAG +
                " instead of " + FIELD_TAG + " (" + legacyCount + " legacy-tagged tiddler(s) loaded)",
                this.wiki
            );
        }
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-field-name"] || title.split("/").pop(),
                fieldKey: f["ca-field-name"] || "",
                chip: f["ca-field-chip"] || "",
                hint: f["ca-field-hint"] || "",
                help: f["ca-field-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
    };

    proto._buildFieldInstance = function (meta) {
        return {
            constraintTiddler: meta.title,
            name: meta.name,
            fieldKey: meta.fieldKey,
            chip: meta.chip || meta.name,
            hint: meta.hint,
            help: meta.help
        };
    };

    proto._pushField = function (instance) {
        if (!instance) return;
        this.fieldPills = this.fieldPills.filter(function (s) {
            return s.constraintTiddler !== instance.constraintTiddler;
        });
        this.fieldPills.push(instance);
        this._renderFieldStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this._leaderFiring && this.fieldStripEl) {
            var pills = this.fieldStripEl.querySelectorAll(".rcp-pill");
            if (pills.length) this._flashElement(pills[pills.length - 1]);
        }
    };

    proto._removeFieldAt = function (idx) {
        if (idx < 0 || idx >= this.fieldPills.length) return;
        this.fieldPills.splice(idx, 1);
        if (this.fieldFocusIdx >= this.fieldPills.length) {
            this.fieldFocusIdx = Math.max(0, this.fieldPills.length - 1);
        }
        this._renderFieldStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.fieldPills.length === 0 && this.focus === "field") {
            this.setFocus("input");
        } else if (this.focus === "field") {
            this._maybeRenderFieldHelp();
        }
    };

    proto._clearAllFields = function () {
        if (!this.fieldPills.length) return;
        this.fieldPills = [];
        this.fieldFocusIdx = 0;
        this._renderFieldStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.focus === "field") this.setFocus("input");
    };

    proto._renderFieldStrip = function () {
        var self = this;
        pillstrip.renderPillStripSection({
            widget:        self,
            stripEl:       self.fieldStripEl,
            pills:         self.fieldPills,
            focusIdx:      self.fieldFocusIdx,
            focusSection:  "field",
            popupHasClass: "rcp-has-fields",
            pillModifier:  "rcp-pill-field",
            datasetKey:    "fieldIdx",
            removeTitle:   "Remove this field",
            onSelectAt:    function (i) { self.fieldFocusIdx = i; self.setFocus("field"); },
            onRemoveAt:    function (i) { self._removeFieldAt(i); }
        });
    };

    proto._maybeRenderFieldHelp = function () {
        if (this.focus !== "field") return;
        if (!this.fieldPills.length) return;
        var item = this.fieldPills[this.fieldFocusIdx];
        if (!item) return;
        pillstrip.renderConstraintHelp(this, {
            title: item.name,
            help:  item.help || item.hint || item.name,
            rows: [
                ["Field key", item.fieldKey || "—"],
                ["Tiddler", item.constraintTiddler]
            ]
        });
    };

    // Active field-name list — read from the currently-pushed pills.
    // Returns an array of cascade-item field keys, or null when no
    // field pills are pushed (callers fall back to per-row
    // `ca-search-fields` / global default).
    proto._activeFieldNames = function () {
        if (!this.fieldPills || !this.fieldPills.length) return null;
        var keys = [];
        var seen = {};
        for (var i = 0; i < this.fieldPills.length; i++) {
            var k = this.fieldPills[i].fieldKey;
            if (k && !seen[k]) { keys.push(k); seen[k] = true; }
        }
        return keys.length ? keys : null;
    };

    proto._addFieldByTitle = function (title) {
        var metas = this._loadFieldTiddlers();
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === title) {
                this._pushField(this._buildFieldInstance(metas[i]));
                return;
            }
        }
    };

};
