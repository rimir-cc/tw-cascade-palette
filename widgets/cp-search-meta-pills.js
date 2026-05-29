/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-search-meta-pills
type: application/javascript
module-type: library

Search-meta subsystem — pills that decide WHICH cascade-item author
meta keys the matcher reads (the row's `name`, `hint`, or any
author-defined slot populated by cp-items.js / a custom row-builder).

A meta pill is a tiddler tagged SEARCH_META_TAG that declares a
`ca-meta-key` field naming the cascade-item property it covers
(`name`, `hint`, or any custom key the author has populated on items
via `ca-*` and matching row-builder synthesis).

Semantics (the matcher in cp-actions.js + the deep walker in
cp-deep-search.js consume `_activeMetaKeys()`):
  - No meta pills pushed → matcher uses each row's
    `ca-search-fields` declaration (or the global default
    `name hint`).
  - One or more meta pills pushed → matcher uses the UNION of those
    pill `ca-meta-key`s, ignoring per-row config and global default.
    Lets the user say explicitly "match only in description" or
    "match in name AND description".

Sister module: cp-search-field-pills.js — pills matching literal
tiddler fields (text, caption, tags, ...). Both strips coexist; the
matcher unions their contributions.

Push / remove / focus / keyboard model mirrors cp-search-field-pills
+ cp-filters + cp-reach-pills exactly. Pushed via the
`rimir-cascade-palette-add-meta` message (typically from leader keys).

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var SEARCH_META_TAG = C.SEARCH_META_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadMetaTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + SEARCH_META_TAG + "]]"
        );
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-meta-key"] || title.split("/").pop(),
                metaKey: f["ca-meta-key"] || "",
                chip: f["ca-chip"] || "",
                hint: f["ca-hint"] || "",
                help: f["ca-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
    };

    proto._buildMetaInstance = function (meta) {
        return {
            constraintTiddler: meta.title,
            name: meta.name,
            metaKey: meta.metaKey,
            chip: meta.chip || meta.name,
            hint: meta.hint,
            help: meta.help
        };
    };

    proto._pushMeta = function (instance) {
        if (!instance) return;
        this.metaPills = this.metaPills.filter(function (s) {
            return s.constraintTiddler !== instance.constraintTiddler;
        });
        this.metaPills.push(instance);
        this._renderMetaStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this._leaderFiring && this.metaStripEl) {
            var pills = this.metaStripEl.querySelectorAll(".rcp-pill");
            if (pills.length) this._flashElement(pills[pills.length - 1]);
        }
    };

    proto._removeMetaAt = function (idx) {
        if (idx < 0 || idx >= this.metaPills.length) return;
        this.metaPills.splice(idx, 1);
        if (this.metaFocusIdx >= this.metaPills.length) {
            this.metaFocusIdx = Math.max(0, this.metaPills.length - 1);
        }
        this._renderMetaStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.metaPills.length === 0 && this.focus === "meta") {
            this.setFocus("input");
        } else if (this.focus === "meta") {
            this._maybeRenderMetaHelp();
        }
    };

    proto._clearAllMeta = function () {
        if (!this.metaPills.length) return;
        this.metaPills = [];
        this.metaFocusIdx = 0;
        this._renderMetaStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.focus === "meta") this.setFocus("input");
    };

    proto._renderMetaStrip = function () {
        var self = this;
        pillstrip.renderPillStripSection({
            widget:        self,
            stripEl:       self.metaStripEl,
            pills:         self.metaPills,
            focusIdx:      self.metaFocusIdx,
            focusSection:  "meta",
            popupHasClass: "rcp-has-meta",
            pillModifier:  "rcp-pill-meta",
            datasetKey:    "metaIdx",
            removeTitle:   "Remove this meta pill",
            onSelectAt:    function (i) { self.metaFocusIdx = i; self.setFocus("meta"); },
            onRemoveAt:    function (i) { self._removeMetaAt(i); }
        });
    };

    proto._maybeRenderMetaHelp = function () {
        if (this.focus !== "meta") return;
        if (!this.metaPills.length) return;
        var item = this.metaPills[this.metaFocusIdx];
        if (!item) return;
        pillstrip.renderConstraintHelp(this, {
            title: item.chip || item.name,
            help:  item.help || item.hint || item.name,
            rows: [
                ["Meta key", item.metaKey || "—"],
                ["Tiddler", item.constraintTiddler]
            ]
        });
    };

    // Active meta-key list — read from the currently-pushed pills.
    // Returns an array of cascade-item property names, or null when no
    // meta pills are pushed (callers fall back to per-row
    // `ca-search-fields` / global default — meta-keys only).
    proto._activeMetaKeys = function () {
        if (!this.metaPills || !this.metaPills.length) return null;
        var keys = [];
        var seen = {};
        for (var i = 0; i < this.metaPills.length; i++) {
            var k = this.metaPills[i].metaKey;
            if (k && !seen[k]) { keys.push(k); seen[k] = true; }
        }
        return keys.length ? keys : null;
    };

    // Active meta-pill instance list — same order as _activeMetaKeys
    // but full objects (so the matcher can stamp chip labels into the
    // emitted match records). Returns null when no meta pills pushed.
    proto._activeMetaPills = function () {
        if (!this.metaPills || !this.metaPills.length) return null;
        var seen = {};
        var out = [];
        for (var i = 0; i < this.metaPills.length; i++) {
            var p = this.metaPills[i];
            var k = p.metaKey;
            if (k && !seen[k]) { out.push(p); seen[k] = true; }
        }
        return out.length ? out : null;
    };

    proto._addMetaByTitle = function (title) {
        var metas = this._loadMetaTiddlers();
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === title) {
                this._pushMeta(this._buildMetaInstance(metas[i]));
                return;
            }
        }
    };

};
