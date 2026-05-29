/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-preset-pills
type: application/javascript
module-type: library

Preset pill strip — horizontal scrollable row of preset bundles.

Replaces the legacy Presets view (which presented saved bundles as
result rows). The strip sits above the view strip and surfaces every
preset as a pill; ← / → cycle focus across pills, ↵ applies the
focused one. Pills overflow horizontally — they don't wrap. When
focus moves past the visible edge, the focused pill is scrolled into
view via `scrollIntoView({ inline: "nearest" })`.

Pill ordering is static (`ca-order` field, then name). No MRU
reordering — pills stay in the same visual position across sessions.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var pillstrip = require("$:/plugins/rimir/cascade-palette/widgets/cp-pillstrip");
var PRESET_TAG = C.PRESET_TAG;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    // Discover all preset tiddlers, parse fields, sort by ca-order then
    // name. Returns the cached list on subsequent calls until invalidated
    // via `_invalidatePresetPills` (called from the wiki change hook when
    // a preset tiddler changes / is deleted).
    proto._loadPresetPills = function () {
        if (this._presetPills) return this._presetPills;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + PRESET_TAG + "]!has[draft.of]]"
        );
        var pills = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var orderRaw = f["ca-order"];
            var order = orderRaw !== undefined && orderRaw !== ""
                ? parseFloat(orderRaw) : DEFAULT_ORDER;
            if (isNaN(order)) order = DEFAULT_ORDER;
            return {
                title: title,
                name: f["ca-preset-name"] || title.split("/").pop(),
                hint: f["ca-preset-hint"] || "",
                view: f["ca-preset-view"] || "",
                constraintsJson: f["ca-preset-constraints"] || "{}",
                order: order
            };
        });
        pills.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this._presetPills = pills;
        return pills;
    };

    proto._invalidatePresetPills = function () {
        this._presetPills = null;
    };

    // (Re)render the preset-strip pill row. The strip is always visible
    // because the trailing "+" save pill is always present — it doubles
    // as the discoverable "save current state as new preset" affordance,
    // mirroring the `s` leader. The keyboard-focused pill (only meaningful
    // while focus === "preset") gets the focused class and is scrolled
    // into view so navigation across the overflow window feels continuous.
    // The "+" pill is the last navigable index (= pills.length).
    proto._renderPresetStrip = function () {
        if (!this.presetStripEl) return;
        while (this.presetStripEl.firstChild) {
            this.presetStripEl.removeChild(this.presetStripEl.firstChild);
        }
        var pills = this._loadPresetPills();
        // Strip is always visible — the "+" pill is always there.
        if (this.popupEl) this.popupEl.classList.add("rcp-has-presets");
        var navigableCount = pills.length + 1; // real presets + the "+" pill
        if (this.presetFocusIdx >= navigableCount) {
            this.presetFocusIdx = Math.max(0, navigableCount - 1);
        }
        var self = this;
        var focusedEl = null;
        // Compute dirty once per render — _isActivePresetDirty walks the
        // current lists so we don't want to call it per pill.
        var dirty = this._isActivePresetDirty();
        pills.forEach(function (preset, i) {
            var pillEl = self.document.createElement("span");
            var cls = "rcp-preset-pill";
            if (self.focus === "preset" && i === self.presetFocusIdx) {
                cls += " rcp-preset-pill-focused";
                focusedEl = pillEl;
            }
            var isActive = preset.title === self.activePresetTitle;
            if (isActive) {
                cls += " rcp-preset-pill-active";
                if (dirty) cls += " rcp-preset-pill-dirty";
            }
            pillEl.className = cls;
            // Dirty marker — a trailing "*" makes the state visible even
            // without colour cues (e.g. on screen readers / B&W displays).
            pillEl.textContent = preset.name + (isActive && dirty ? " *" : "");
            if (preset.hint) pillEl.title = preset.hint;
            pillEl.dataset.presetIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.presetFocusIdx = i;
                self._applyPreset(preset.title);
            });
            self.presetStripEl.appendChild(pillEl);
        });
        // Trailing "+" save pill — always present, always last index.
        var plusIdx = pills.length;
        var plusEl = self.document.createElement("span");
        var plusCls = "rcp-preset-pill rcp-preset-pill-plus";
        if (self.focus === "preset" && self.presetFocusIdx === plusIdx) {
            plusCls += " rcp-preset-pill-focused";
            focusedEl = plusEl;
        }
        plusEl.className = plusCls;
        plusEl.textContent = "+";
        plusEl.title = "Save current state as new preset";
        plusEl.dataset.presetIdx = String(plusIdx);
        plusEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            self.presetFocusIdx = plusIdx;
            self.enterSaveMode();
        });
        self.presetStripEl.appendChild(plusEl);
        // Scroll the focused pill into view in the horizontal overflow.
        // Defer one frame so the just-appended DOM has layout.
        if (focusedEl) {
            var target = focusedEl;
            setTimeout(function () {
                try {
                    target.scrollIntoView({ inline: "nearest", block: "nearest" });
                } catch (err) { /* ignore — older browsers */ }
            }, 0);
        }
    };

    // Render the focused preset's snapshot into the details pane.
    // Mirrors _maybeRenderViewHelp so the user gets the same level of
    // affordance from a preset pill as from a view pill.
    proto._maybeRenderPresetHelp = function () {
        if (this.focus !== "preset") return;
        var pills = this._loadPresetPills();
        // Plus pill — last navigable index. Show save-help instead of
        // per-preset metadata.
        if (this.presetFocusIdx === pills.length) {
            pillstrip.renderConstraintHelp(this, {
                title: "Save preset as…",
                help:  "Capture the current state (view + filters + visibility) as a new preset. Press Enter to open the name prompt; type a name, Enter to commit, Esc to cancel.",
                rows:  []
            });
            return;
        }
        var preset = pills[this.presetFocusIdx];
        if (!preset) return;
        var rows = [];
        // View name (resolved from the cached views table) — fall back
        // to the raw title if the view was uninstalled.
        var viewName = preset.view;
        var viewMeta = this._getViewByTitle(preset.view);
        if (viewMeta) viewName = viewMeta.name;
        if (preset.view) rows.push(["View", viewName]);
        // Filters / Visibility summary: list each as "name(arg)" with the
        // human name resolved from the constraint tiddler. Empty list
        // shows "(none)" explicitly so authors know the field was parsed.
        var bundle;
        try { bundle = JSON.parse(preset.constraintsJson); }
        catch (err) { bundle = {}; }
        if (!bundle || typeof bundle !== "object") bundle = {};
        var filtersList = Array.isArray(bundle.filters) ? bundle.filters : [];
        var visList = Array.isArray(bundle.visibility) ? bundle.visibility : [];
        function describe(list, metas) {
            if (!list.length) return "(none)";
            return list.map(function (s) {
                var meta = null;
                for (var i = 0; i < metas.length; i++) {
                    if (metas[i].title === s.title) { meta = metas[i]; break; }
                }
                var label = (meta && meta.name) || s.title || "?";
                return s.arg ? label + "(" + s.arg + ")" : label;
            }).join(", ");
        }
        rows.push(["Filters", describe(filtersList, this._loadFilterTiddlers())]);
        rows.push(["Visibility", describe(visList, this._loadVisibilityTiddlers())]);
        rows.push(["Preset tiddler", preset.title]);
        pillstrip.renderConstraintHelp(this, {
            title: preset.name,
            help:  preset.hint || "",
            rows:  rows
        });
    };

    // Number of NAVIGABLE pills in the preset strip = real presets + the
    // trailing "+" save pill, which is always present. Used by the Tab
    // cycle, the pill-strip dispatcher (arrow bounds), and the setFocus
    // sanity check. Always ≥ 1, so the preset section is always part of
    // the Tab cycle (the "+" pill is keyboard-reachable even when no
    // presets exist).
    proto._presetPillCount = function () {
        return this._loadPresetPills().length + 1;
    };

};
