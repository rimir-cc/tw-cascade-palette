/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-reach-pills
type: application/javascript
module-type: library

Reach subsystem — pills that decide WHERE in the cascade tree the
search input looks.

A reach pill is a tiddler tagged REACH_TAG that declares a
`ca-reach-mode` field:
  here       — walk the subtree under the current stage
  everywhere — walk the active view's root tree

The matcher (cp-stack.js applyQueryToStage) reads the active mode
from `_activeReachMode()` and dispatches to the deep walker
(cp-deep-search.js) when non-local. Pills can coexist; the wider
scope wins (`everywhere` > `here` > `local`).

Pills push/remove with the same grammar as filter and visibility
pills (cp-filters.js, cp-visibility.js): same shape, just a separate
strip. Pushed via the `rimir-cascade-palette-add-reach` message
(typically from leader keys); removed by `×` mouse click or DEL
when the pill is focused.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var REACH_TAG = C.REACH_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadReachTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + REACH_TAG + "]]"
        );
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-reach-name"] || title.split("/").pop(),
                mode: (f["ca-reach-mode"] || "").toLowerCase(),
                chip: f["ca-reach-chip"] || "",
                hint: f["ca-reach-hint"] || "",
                help: f["ca-reach-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
    };

    proto._buildReachInstance = function (meta) {
        return {
            constraintTiddler: meta.title,
            name: meta.name,
            mode: meta.mode,
            chip: meta.chip || meta.name,
            hint: meta.hint,
            help: meta.help
        };
    };

    proto._pushReach = function (instance) {
        if (!instance) return;
        // Reach pills are mutually exclusive: pushing any reach pill
        // evicts every other reach pill so there's only ever one active.
        // "Here" and "Everywhere" overlap semantically (Everywhere
        // subsumes Here) and having both visible is redundant — the
        // wider one would silently dominate, leaving the narrower one
        // looking active but doing nothing. The user picks one scope at
        // a time. Replace-by-tiddler-title (same pill pushed twice keeps
        // one) is a degenerate case of this rule.
        this.reachPills = [];
        this.reachPills.push(instance);
        this.reachFocusIdx = 0;
        this._renderReachStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this._leaderFiring && this.reachStripEl) {
            var pills = this.reachStripEl.querySelectorAll(".rcp-pill");
            if (pills.length) this._flashElement(pills[pills.length - 1]);
        }
    };

    proto._removeReachAt = function (idx) {
        if (idx < 0 || idx >= this.reachPills.length) return;
        this.reachPills.splice(idx, 1);
        if (this.reachFocusIdx >= this.reachPills.length) {
            this.reachFocusIdx = Math.max(0, this.reachPills.length - 1);
        }
        this._renderReachStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.reachPills.length === 0 && this.focus === "reach") {
            this.setFocus("input");
        } else if (this.focus === "reach") {
            this._maybeRenderReachHelp();
        }
    };

    proto._clearAllReach = function () {
        if (!this.reachPills.length) return;
        this.reachPills = [];
        this.reachFocusIdx = 0;
        this._renderReachStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.focus === "reach") this.setFocus("input");
    };

    proto._renderReachStrip = function () {
        var self = this;
        pillstrip.renderPillStripSection({
            widget:        self,
            stripEl:       self.reachStripEl,
            pills:         self.reachPills,
            focusIdx:      self.reachFocusIdx,
            focusSection:  "reach",
            popupHasClass: "rcp-has-reach",
            pillModifier:  "rcp-pill-reach",
            datasetKey:    "reachIdx",
            removeTitle:   "Remove this reach",
            onSelectAt:    function (i) { self.reachFocusIdx = i; self.setFocus("reach"); },
            onRemoveAt:    function (i) { self._removeReachAt(i); }
        });
    };

    proto._maybeRenderReachHelp = function () {
        if (this.focus !== "reach") return;
        if (!this.reachPills.length) return;
        var item = this.reachPills[this.reachFocusIdx];
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
            ["Mode", item.mode || "—"],
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

    // Active reach mode — read from the (at most one) currently-pushed
    // reach pill. Mutual exclusion in _pushReach guarantees the array
    // never holds more than one entry. Returns "deep-here" / "deep-root"
    // / "local" — same vocabulary the matcher used pre-reach-split, so
    // callers in cp-stack.js and cp-deep-search.js don't need to
    // translate.
    proto._activeReachMode = function () {
        if (!this.reachPills || !this.reachPills.length) return "local";
        var m = this.reachPills[0].mode;
        if (m === "everywhere") return "deep-root";
        if (m === "here") return "deep-here";
        return "local";
    };

    // Push a reach pill by tiddler title. Used by the add-reach message
    // handler (typically dispatched from a leader's action wikitext).
    proto._addReachByTitle = function (title) {
        var metas = this._loadReachTiddlers();
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === title) {
                this._pushReach(this._buildReachInstance(metas[i]));
                return;
            }
        }
    };

};
