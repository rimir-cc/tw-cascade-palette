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
var FIELD_TAG = C.FIELD_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadFieldTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + FIELD_TAG + "]]"
        );
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
        if (!this.fieldStripEl) return;
        while (this.fieldStripEl.firstChild) {
            this.fieldStripEl.removeChild(this.fieldStripEl.firstChild);
        }
        var has = this.fieldPills && this.fieldPills.length > 0;
        if (this.popupEl) this.popupEl.classList.toggle("rcp-has-fields", has);
        if (!has) return;
        var self = this;
        this.fieldPills.forEach(function (item, i) {
            var pillEl = self.document.createElement("span");
            pillEl.className = "rcp-pill rcp-pill-field" +
                (self.focus === "field" && i === self.fieldFocusIdx
                    ? " rcp-pill-focused" : "");
            pillEl.textContent = item.chip;
            if (item.hint) pillEl.title = item.hint;
            pillEl.dataset.fieldIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.fieldFocusIdx = i;
                self.setFocus("field");
            });
            var xEl = self.document.createElement("span");
            xEl.className = "rcp-pill-remove";
            xEl.textContent = "×";
            xEl.title = "Remove this field";
            xEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                e.stopPropagation();
                self._removeFieldAt(i);
            });
            pillEl.appendChild(xEl);
            self.fieldStripEl.appendChild(pillEl);
        });
    };

    proto._maybeRenderFieldHelp = function () {
        if (this.focus !== "field") return;
        if (!this.fieldPills.length) return;
        var item = this.fieldPills[this.fieldFocusIdx];
        if (!item) return;
        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-detail-title";
        titleEl.textContent = item.name;
        this.detailEl.appendChild(titleEl);

        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = item.help || item.hint || item.name;
        this.detailEl.appendChild(helpEl);

        var rows = [
            ["Field key", item.fieldKey || "—"],
            ["Tiddler", item.constraintTiddler]
        ];
        var dl = this.document.createElement("dl");
        dl.className = "rcp-detail-fields";
        rows.forEach(function (row) {
            var dt = this.document.createElement("dt");
            dt.textContent = row[0];
            var dd = this.document.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        }, this);
        this.detailEl.appendChild(dl);
        this.popupEl.classList.add("rcp-showing-detail");
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
