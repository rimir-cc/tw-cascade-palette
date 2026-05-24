/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-leaders
type: application/javascript
module-type: library

Leader subsystem — key + idle-window gesture.

A leader is a tiddler tagged `$:/tags/rimir/cascade-palette/leader`
declaring a key (`ca-leader-key`) and a wikitext action chain
(`ca-leader-actions`). When the input matches the key exactly AND
stays idle for `ca-leader-idle-ms` ms (default 200), the actions
fire. Any keystroke during the idle window cancels.

Leaders subsume the previous "Add scope" / "Reset scopes" entries:
discoverable via the details pane (`ca-leader-help` rendered when
a leader is pending), composable (one tiddler can declare any
combination of set-view / set-filter / set-visibility / apply-preset
actions).

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var LEADER_TAG = C.LEADER_TAG;
var DEFAULT_LEADER_IDLE_MS = C.DEFAULT_LEADER_IDLE_MS;
var DEFAULT_ORDER = C.DEFAULT_ORDER;

module.exports = function (proto) {

    proto._loadLeaders = function () {
        if (this._leadersCache) return this._leadersCache;
        var self = this;
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + LEADER_TAG + "]]"
        );
        var leaders = titles.map(function (title) {
            var t = self.wiki.getTiddler(title);
            var f = (t && t.fields) || {};
            var idleMs = parseInt(f["ca-leader-idle-ms"], 10);
            if (isNaN(idleMs) || idleMs < 0) idleMs = DEFAULT_LEADER_IDLE_MS;
            return {
                title: title,
                key: f["ca-leader-key"] || "",
                name: f["ca-leader-name"] || title.split("/").pop(),
                hint: f["ca-leader-hint"] || "",
                help: f["ca-leader-help"] || "",
                idleMs: idleMs,
                actions: f["ca-leader-actions"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        }).filter(function (l) { return l.key; });
        // Greedy by key length so multi-char leaders win over single-char
        // ones (`>>` beats `>` when input is `>>`).
        leaders.sort(function (a, b) { return b.key.length - a.key.length; });
        this._leadersCache = leaders;
        return leaders;
    };

    // Find the leader whose key exactly matches the input. Returns null
    // when no leader is pending (input is empty, has extra chars, or no
    // declared leader matches).
    proto._detectLeader = function (text) {
        if (!text) return null;
        var leaders = this._loadLeaders();
        for (var i = 0; i < leaders.length; i++) {
            if (text === leaders[i].key) return leaders[i];
        }
        return null;
    };

    // Visual cue toggle for leader-pending state. Returns true when a
    // leader is currently pending (input handler then skips the
    // constraint-prefix cue to avoid mixed signals). Mirrors the
    // _updateConstraintPrefixCue shape.
    proto._updateLeaderCue = function () {
        if (!this.inputEl) return false;
        var leader = this._detectLeader(this.inputEl.value);
        // Always clear any stale timer first — the input changed.
        if (this._leaderTimer) {
            clearTimeout(this._leaderTimer);
            this._leaderTimer = null;
        }
        if (!leader) {
            if (this._leaderPending) {
                this._leaderPending = null;
                this.inputEl.classList.remove("rcp-input-leader-match");
                this._renderHint();
                if (this.detailsOpen) this.renderDetails();
            }
            return false;
        }
        this._leaderPending = leader;
        this.inputEl.classList.add("rcp-input-leader-match");
        this.hintEl.textContent = "↵ " + leader.key + " — " +
            (leader.hint || leader.name);
        if (this.detailsOpen) this._renderLeaderHelp(leader);
        var self = this;
        this._leaderTimer = setTimeout(function () {
            self._fireLeader(leader);
        }, leader.idleMs);
        return true;
    };

    // Render the pending leader's help into the details pane. Mirrors
    // the strip-help shape — title, help text, key+actions summary as a
    // fields table.
    proto._renderLeaderHelp = function (leader) {
        if (!leader || !this.previewEl) return;
        while (this.previewEl.firstChild) {
            this.previewEl.removeChild(this.previewEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-preview-title";
        titleEl.textContent = leader.name + " (leader " + leader.key + ")";
        this.previewEl.appendChild(titleEl);
        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = leader.help || leader.hint || leader.name;
        this.previewEl.appendChild(helpEl);
        var rows = [
            ["Key", leader.key],
            ["Idle", leader.idleMs + "ms"]
        ];
        if (leader.actions) rows.push(["Actions", leader.actions]);
        rows.push(["Leader tiddler", leader.title]);
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

    // Fire a leader's action wikitext. Clears the input + cue state
    // first so the leader's setActiveView/pushFilter/pushVisibility
    // side-effects don't race with the cue. Sets `_leaderFiring = true`
    // for the duration so flash-animation hooks in _setActiveView /
    // _pushFilter / _pushVisibility can fire.
    proto._fireLeader = function (leader) {
        if (!leader) return;
        // Reset cue + input atomically before the actions run.
        this._leaderTimer = null;
        this._leaderPending = null;
        if (this.inputEl) {
            this.inputEl.value = "";
            this.inputEl.classList.remove("rcp-input-leader-match");
        }
        var stage = this.topStage();
        if (stage) {
            stage.query = "";
            stage.selectedIndex = 0;
        }
        this._leaderFiring = true;
        try {
            if (leader.actions) {
                this.invokeViaNavigator(leader.actions, { picked: "" });
            }
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] leader fire error",
                    leader.title, "—", err && err.message
                );
            }
        }
        // Defer clearing the flag until next microtask so any
        // setTimeout-deferred renders triggered by the actions still
        // see _leaderFiring (e.g. if an action schedules a state-set).
        var self = this;
        setTimeout(function () { self._leaderFiring = false; }, 0);
        this._renderHint();
        if (this.detailsOpen) this.renderDetails();
    };

    // Brief amber pulse on the now-active view pill to confirm the
    // leader's effect. CSS animation defined in styles.tid.
    proto._flashActiveViewPill = function () {
        if (!this.viewStripEl) return;
        var pills = this.viewStripEl.querySelectorAll(".rcp-view-pill-active");
        for (var i = 0; i < pills.length; i++) {
            this._flashElement(pills[i]);
        }
    };

    proto._flashElement = function (el) {
        if (!el) return;
        el.classList.remove("rcp-pill-flash");
        // Force reflow so the re-added class restarts the animation
        // even if the element was already flashing.
        void el.offsetWidth;
        el.classList.add("rcp-pill-flash");
        setTimeout(function () {
            el.classList.remove("rcp-pill-flash");
        }, 400);
    };

};
