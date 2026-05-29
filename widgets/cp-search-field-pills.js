/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-search-field-pills
type: application/javascript
module-type: library

Search-field subsystem — pills that decide WHICH literal tiddler
fields the matcher reads on the row's backing tiddler (e.g. `text`,
`caption`, `tags`, author-defined fields).

A field pill is a tiddler tagged SEARCH_FIELD_TAG that declares a
`ca-tiddler-field` field naming the tiddler field it covers
(`text`, `caption`, `tags`, or any field an author chooses to expose).

Semantics (the matcher in cp-actions.js + the deep walker in
cp-deep-search.js consume `_activeTiddlerFields()`):
  - No field pills pushed → matcher reads no tiddler fields (the
    default search uses cascade-item meta only — see
    cp-search-meta-pills).
  - One or more field pills pushed → matcher reads the UNION of those
    pill `ca-tiddler-field`s for every row that has a backing tiddler.
    Synthetic rows (no backing tiddler) silently skip these pills.

Sister module: cp-search-meta-pills.js — pills matching cascade-item
author meta (name / hint / description / aliases / searchText). Both
strips coexist; the matcher unions their contributions.

Push / remove / focus / keyboard model mirrors cp-search-meta-pills
+ cp-filters + cp-reach-pills exactly. Pushed via the
`rimir-cascade-palette-add-field` message (typically from leader keys).

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var SEARCH_FIELD_TAG = C.SEARCH_FIELD_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadFieldTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + SEARCH_FIELD_TAG + "]]"
        );
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-tiddler-field"] || title.split("/").pop(),
                tiddlerField: f["ca-tiddler-field"] || "",
                chip: f["ca-chip"] || "",
                hint: f["ca-hint"] || "",
                help: f["ca-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
    };

    proto._buildFieldInstance = function (meta) {
        return {
            constraintTiddler: meta.title,
            name: meta.name,
            tiddlerField: meta.tiddlerField,
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
            popupHasClass: "rcp-has-field",
            pillModifier:  "rcp-pill-field",
            datasetKey:    "fieldIdx",
            removeTitle:   "Remove this field pill",
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
            title: item.chip || item.name,
            help:  item.help || item.hint || item.name,
            rows: [
                ["Tiddler field", item.tiddlerField || "—"],
                ["Tiddler", item.constraintTiddler]
            ]
        });
    };

    // Active tiddler-field-name list — read from the currently-pushed
    // pills. Returns an array of tiddler field names, or null when no
    // field pills are pushed (callers know to skip the tiddler-field
    // layer of the matcher entirely).
    proto._activeTiddlerFields = function () {
        if (!this.fieldPills || !this.fieldPills.length) return null;
        var fields = [];
        var seen = {};
        for (var i = 0; i < this.fieldPills.length; i++) {
            var f = this.fieldPills[i].tiddlerField;
            if (f && !seen[f]) { fields.push(f); seen[f] = true; }
        }
        return fields.length ? fields : null;
    };

    // Active field-pill instance list — same order as
    // _activeTiddlerFields but full objects (so the matcher can stamp
    // chip labels into the emitted match records). Returns null when
    // no field pills pushed.
    proto._activeFieldPills = function () {
        if (!this.fieldPills || !this.fieldPills.length) return null;
        var seen = {};
        var out = [];
        for (var i = 0; i < this.fieldPills.length; i++) {
            var p = this.fieldPills[i];
            var f = p.tiddlerField;
            if (f && !seen[f]) { out.push(p); seen[f] = true; }
        }
        return out.length ? out : null;
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
