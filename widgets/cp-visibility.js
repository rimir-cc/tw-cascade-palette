/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-visibility
type: application/javascript
module-type: library

Visibility subsystem — pills that hide root entries by predicate.

Visibility constraints are declarative tiddlers tagged VISIBILITY_TAG.
Each one declares a TW predicate filter (`ca-visibility-expr`); for each
root-entry title we evaluate the predicate with `currentTiddler` bound
to that title — non-empty result means "hide it". The `<arg>` placeholder
substitutes the user's argument at push time.

This is the structural-hiding half of what was previously called "scope".
The filter (data-narrowing) sibling lives in cp-filters.js.

Visibility ONLY affects root-entry rows. View-source results and drilled
sub-stages are unaffected — those are governed by filters.

Replace-by-kind: one slot per visibility tiddler. The hide-entry kind is
a special case (one pill per hidden title) — `_addHideEntryVisibility`
suffixes the per-title to the tiddler key so multiple coexist.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var VISIBILITY_TAG = C.VISIBILITY_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadVisibilityTiddlers = function () {
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + VISIBILITY_TAG + "]]"
        );
        return titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            return {
                title: title,
                name: f["ca-visibility-name"] || title.split("/").pop(),
                prefix: f["ca-visibility-prefix"] || "",
                argType: (f["ca-visibility-arg"] || "text").toLowerCase(),
                expr: f["ca-visibility-expr"] || "",
                chip: f["ca-visibility-chip"] || "",
                hint: f["ca-visibility-hint"] || "",
                help: f["ca-visibility-help"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        });
    };

    proto._buildVisibilityInstance = function (meta, arg) {
        var safeArg = String(arg || "")
            .replace(/[\r\n\t]/g, " ")
            .replace(/[\]\[]/g, "")
            .trim()
            .slice(0, 200);
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
    };

    proto._pushVisibility = function (instance) {
        if (!instance) return;
        this.visibilities = this.visibilities.filter(function (s) {
            return s.constraintTiddler !== instance.constraintTiddler;
        });
        this.visibilities.push(instance);
        this._renderVisibilityStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this._leaderFiring && this.visibilityStripEl) {
            var pills = this.visibilityStripEl.querySelectorAll(".rcp-pill");
            if (pills.length) {
                this._flashElement(pills[pills.length - 1]);
            }
        }
    };

    proto._removeVisibilityAt = function (idx) {
        if (idx < 0 || idx >= this.visibilities.length) return;
        this.visibilities.splice(idx, 1);
        if (this.visibilityFocusIdx >= this.visibilities.length) {
            this.visibilityFocusIdx = Math.max(0, this.visibilities.length - 1);
        }
        this._renderVisibilityStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.visibilities.length === 0 && this.focus === "visibility") {
            this.setFocus("input");
        } else if (this.focus === "visibility") {
            this._maybeRenderVisibilityHelp();
        }
    };

    proto._clearAllVisibility = function () {
        if (!this.visibilities.length) return;
        this.visibilities = [];
        this.visibilityFocusIdx = 0;
        this._renderVisibilityStrip();
        var top = this.topStage();
        if (top) {
            this.recomputeStage(top);
            this.renderStage();
        }
        if (this.focus === "visibility") this.setFocus("input");
    };

    proto._renderVisibilityStrip = function () {
        if (!this.visibilityStripEl) return;
        while (this.visibilityStripEl.firstChild) {
            this.visibilityStripEl.removeChild(this.visibilityStripEl.firstChild);
        }
        var has = this.visibilities && this.visibilities.length > 0;
        if (this.popupEl) this.popupEl.classList.toggle("rcp-has-visibility", has);
        if (!has) return;
        var self = this;
        this.visibilities.forEach(function (item, i) {
            var pillEl = self.document.createElement("span");
            pillEl.className = "rcp-pill" +
                (self.focus === "visibility" && i === self.visibilityFocusIdx
                    ? " rcp-pill-focused" : "");
            pillEl.textContent = item.chip;
            if (item.hint) pillEl.title = item.hint;
            pillEl.dataset.visibilityIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.visibilityFocusIdx = i;
                self.setFocus("visibility");
            });
            var xEl = self.document.createElement("span");
            xEl.className = "rcp-pill-remove";
            xEl.textContent = "×";
            xEl.title = "Remove this visibility rule";
            xEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                e.stopPropagation();
                self._removeVisibilityAt(i);
            });
            pillEl.appendChild(xEl);
            self.visibilityStripEl.appendChild(pillEl);
        });
    };

    proto._maybeRenderVisibilityHelp = function () {
        if (this.focus !== "visibility") return;
        if (!this.visibilities.length) return;
        var item = this.visibilities[this.visibilityFocusIdx];
        if (!item) return;
        while (this.previewEl.firstChild) {
            this.previewEl.removeChild(this.previewEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-preview-title";
        titleEl.textContent = item.name + (item.arg ? " — " + item.arg : "");
        this.previewEl.appendChild(titleEl);

        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = item.help || item.hint || item.name;
        this.previewEl.appendChild(helpEl);

        var rows = [];
        if (item.arg) rows.push(["Argument", item.arg]);
        if (item.expr) rows.push(["Hides", item.expr]);
        rows.push(["Visibility tiddler", item.constraintTiddler]);
        var dl = this.document.createElement("dl");
        dl.className = "rcp-preview-fields";
        rows.forEach(function (row) {
            var dt = this.document.createElement("dt");
            dt.textContent = row[0];
            var dd = this.document.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        }, this);
        this.previewEl.appendChild(dl);
        this.popupEl.classList.add("rcp-previewing");
    };

    // True if entryTitle should be hidden by any active visibility rule.
    // Each rule's expr is a predicate: evaluated with currentTiddler bound
    // to the entry; non-empty result means "hide". Errors are warned and
    // treated as "doesn't hide".
    proto._visibilityHidesEntry = function (entryTitle) {
        if (!this.visibilities || !this.visibilities.length) return false;
        for (var i = 0; i < this.visibilities.length; i++) {
            var hf = this.visibilities[i].expr;
            if (!hf) continue;
            try {
                var results = this.wiki.filterTiddlers(
                    hf,
                    this.makeFakeWidget({ currentTiddler: entryTitle })
                );
                if (results.length > 0) return true;
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] visibility predicate error",
                        this.visibilities[i].constraintTiddler, "—", err && err.message
                    );
                }
            }
        }
        return false;
    };

    proto._addVisibilityByTitle = function (title) {
        var metas = this._loadVisibilityTiddlers();
        var meta = null;
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === title) { meta = metas[i]; break; }
        }
        if (!meta) return;
        if (meta.argType === "none") {
            this._pushVisibility(this._buildVisibilityInstance(meta, ""));
            return;
        }
        if (!meta.prefix) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] visibility", title,
                    "has arg-type", meta.argType, "but no prefix — cannot be added interactively"
                );
            }
            return;
        }
        var self = this;
        setTimeout(function () {
            if (!self.open) return;
            var top = self.topStage();
            if (top) {
                top.query = meta.prefix;
                self.recomputeStage(top);
            }
            self.inputEl.value = meta.prefix;
            self.setFocus("input");
            self.renderStage();
            self._updateConstraintPrefixCue();
            var len = self.inputEl.value.length;
            try { self.inputEl.setSelectionRange(len, len); } catch (e) { /* ignore */ }
        }, 0);
    };

    // Push a hide-entry visibility for the given title — used by Shift-DEL
    // on root entries. Per-instance tiddler key includes the title so
    // multiple hide-entry pills coexist (replace-by-kind would otherwise
    // overwrite each other since they share the same backing tiddler).
    proto._addHideEntryVisibility = function (title) {
        var hideEntry = "$:/plugins/rimir/cascade-palette/visibility/hide-entry";
        var metas = this._loadVisibilityTiddlers();
        var meta = null;
        for (var i = 0; i < metas.length; i++) {
            if (metas[i].title === hideEntry) { meta = metas[i]; break; }
        }
        if (!meta) {
            if (console && console.warn) {
                console.warn("[cascade-palette] hide-entry visibility not installed:",
                    hideEntry);
            }
            return;
        }
        var instance = this._buildVisibilityInstance(meta, title);
        instance.constraintTiddler = hideEntry + "::" + title;
        this._pushVisibility(instance);
    };

};
