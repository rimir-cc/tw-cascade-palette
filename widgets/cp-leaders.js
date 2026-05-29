/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-leaders
type: application/javascript
module-type: library

Leader subsystem — key + idle-window gesture, plus pill-row surface.

A leader is a tiddler tagged `$:/tags/rimir/cascade-palette/leader`
declaring a key (`ca-leader-key`) and a wikitext action chain
(`ca-leader-actions`). Two activation paths:

  - Typed gesture: input text exactly matches the key AND the user
    stays idle for `ca-leader-idle-ms` ms (default 500) — the leader
    fires. Any keystroke during the idle window cancels.
  - Pill activation: a dedicated leader pill row surfaces every
    visible leader as a `[key] name` pill; ←/→ navigates, ↵ fires.

Per-view scope. A leader may declare `ca-leader-views` — a filter
producing a list of view titles. The leader is then visible (in the
pill row AND matchable by the typed gesture) only when one of those
views is active. Empty / missing `ca-leader-views` means the leader
is global (always available).

Leaders subsume the previous "Add scope" / "Reset scopes" entries:
discoverable via the pill row + details pane (`ca-leader-help`
rendered when a pill is focused or a leader is pending), composable
(one tiddler can declare any combination of set-view / set-filter
/ set-visibility / apply-preset actions).

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
                viewsFilter: f["ca-leader-views"] || "",
                order: self._parseNumOrDefault(f["ca-order"], DEFAULT_ORDER)
            };
        }).filter(function (l) { return l.key; });
        // Stable visual order: ca-order, then name. The typed-gesture
        // path needs greedy key-length matching, so the pill array is
        // sorted by order while _detectLeader scans a length-sorted view.
        leaders.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
        this._leadersCache = leaders;
        return leaders;
    };

    proto._invalidateLeadersCache = function () {
        this._leadersCache = null;
    };

    // Per-leader view-scope test. Empty filter = global (always visible).
    // Non-empty filter resolves to a list of view titles; the leader is
    // visible iff the active view's title appears in that list.
    proto._isLeaderVisibleForActiveView = function (leader) {
        if (!leader.viewsFilter) return true;
        if (!this.activeView) return false;
        var titles;
        try {
            titles = this._filterInScope(
                leader.viewsFilter,
                { currentTiddler: this.activeView }
            );
        } catch (err) {
            return false;
        }
        return titles.indexOf(this.activeView) >= 0;
    };

    // Leaders matching the active view — the set the user actually sees
    // in the pill row, and the set the typed-gesture path matches against.
    proto._visibleLeaders = function () {
        var self = this;
        return this._loadLeaders().filter(function (l) {
            return self._isLeaderVisibleForActiveView(l);
        });
    };

    proto._leaderPillCount = function () {
        return this._visibleLeaders().length;
    };

    // Find the leader whose key exactly matches the input. Returns null
    // when no leader is pending (input is empty, has extra chars, or no
    // visible leader matches). Scans by descending key length so multi-
    // char leaders win over single-char ones (`>>` beats `>` when input
    // is `>>`).
    proto._detectLeader = function (text) {
        if (!text) return null;
        var leaders = this._visibleLeaders().slice().sort(function (a, b) {
            return b.key.length - a.key.length;
        });
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

    // Render a leader's help into the details pane. Used by both the
    // typed-gesture pending state and the pill-row focus state — same
    // payload either way (the leader IS the thing being previewed).
    proto._renderLeaderHelp = function (leader) {
        if (!leader || !this.detailEl) return;
        while (this.detailEl.firstChild) {
            this.detailEl.removeChild(this.detailEl.firstChild);
        }
        var titleEl = this.document.createElement("div");
        titleEl.className = "rcp-detail-title";
        titleEl.textContent = leader.name + " (leader " + leader.key + ")";
        this.detailEl.appendChild(titleEl);
        var helpEl = this.document.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = leader.help || leader.hint || leader.name;
        this.detailEl.appendChild(helpEl);
        var rows = [
            ["Key", leader.key],
            ["Idle", leader.idleMs + "ms"]
        ];
        if (leader.viewsFilter) rows.push(["Views", leader.viewsFilter]);
        if (leader.actions) rows.push(["Actions", leader.actions]);
        rows.push(["Leader tiddler", leader.title]);
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

    // Render the leader pill strip. One pill per visible leader, label
    // is "[key] name". The strip is hidden via `rcp-has-leaders` when
    // no leaders are visible for the active view. Keyboard-focused pill
    // (only meaningful while focus === "leader") gets the focused class.
    proto._renderLeaderStrip = function () {
        if (!this.leaderStripEl) return;
        while (this.leaderStripEl.firstChild) {
            this.leaderStripEl.removeChild(this.leaderStripEl.firstChild);
        }
        var leaders = this._visibleLeaders();
        if (this.popupEl) {
            this.popupEl.classList.toggle("rcp-has-leaders", leaders.length > 0);
        }
        if (this.leaderFocusIdx >= leaders.length) {
            this.leaderFocusIdx = Math.max(0, leaders.length - 1);
        }
        var self = this;
        var focusedEl = null;
        leaders.forEach(function (leader, i) {
            var pillEl = self.document.createElement("span");
            var cls = "rcp-leader-pill";
            if (self.focus === "leader" && i === self.leaderFocusIdx) {
                cls += " rcp-leader-pill-focused";
                focusedEl = pillEl;
            }
            pillEl.className = cls;
            // Two-part label: the key as a kbd-like prefix, then the
            // human name. The CSS gives the key chip its own background
            // so it reads as a press-this affordance.
            var keyEl = self.document.createElement("span");
            keyEl.className = "rcp-leader-pill-key";
            keyEl.textContent = leader.key;
            pillEl.appendChild(keyEl);
            var nameEl = self.document.createElement("span");
            nameEl.className = "rcp-leader-pill-name";
            nameEl.textContent = leader.name;
            pillEl.appendChild(nameEl);
            if (leader.hint) pillEl.title = leader.hint;
            pillEl.dataset.leaderIdx = String(i);
            pillEl.addEventListener("mousedown", function (e) {
                e.preventDefault();
                self.leaderFocusIdx = i;
                self._fireLeader(leader);
            });
            self.leaderStripEl.appendChild(pillEl);
        });
        if (focusedEl) {
            var target = focusedEl;
            setTimeout(function () {
                try {
                    target.scrollIntoView({ inline: "nearest", block: "nearest" });
                } catch (err) { /* older browsers */ }
            }, 0);
        }
    };

    // Render the focused leader's help into the details pane. Mirrors
    // _maybeRenderViewHelp / _maybeRenderPresetHelp — only acts when
    // focus is on this strip, otherwise the menu's per-row preview owns
    // the details pane.
    proto._maybeRenderLeaderHelp = function () {
        if (this.focus !== "leader") return;
        var leaders = this._visibleLeaders();
        var leader = leaders[this.leaderFocusIdx];
        if (!leader) return;
        this._renderLeaderHelp(leader);
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
