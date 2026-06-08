/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-firing
type: application/javascript
module-type: library

Selection firing + edit mode + drill push.

`fireSelected` is the dispatcher for Enter / Ctrl-Enter. It handles
pick-mode commits, confirm-stage leaves, regular leaf actions, toggle
flips, dynamic-item navigation, and drill descent. `afterAction` is
the shared close-or-stay helper used by every fire path.

Edit mode repurposes the input as a value editor for text / number /
date kinds. Enter commits (validating numbers, clamping ranges, retrying
on date parse errors); Esc cancels.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");
var STRING_ARRAY_TYPE = C.STRING_ARRAY_TYPE;
var HINT_EDIT = C.HINT_EDIT;

module.exports = function (proto) {

    /* ---------- selection handling ---------- */

    // `keepOpen` (set via Shift-Enter / Shift-Click) fires the action but
    // leaves the palette visible so the user can chain more picks. The
    // current stage gets recomputed afterwards in case the action mutated
    // anything visible (e.g. Mark Done changes a task's status field).
    proto.fireSelected = function (keepOpen) {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // Result-window sentinel ("Show N more" / "Show all N", appended by
        // cp-stack.js#_applyResultWindow). Grow the window and re-slice in
        // place — stage.items is unchanged, so applyQueryToStage (not the full
        // recomputeStage) is enough. Selection lands on the first newly-revealed
        // row so repeated Enter pages down. Checked before every stage-kind
        // branch below so it works in root / tree / filter / actions alike.
        if (picked && picked._windowSentinel) {
            var firstNew = (stage.windowSize === Infinity) ? 0 : stage.windowSize;
            stage.windowSize = picked._windowGrow === "all"
                ? Infinity
                : (stage.windowSize || this.getMaxResults()) + this.getMaxResultsStep();
            this.applyQueryToStage(stage);
            stage.selectedIndex = Math.min(
                firstNew, Math.max(0, stage.results.length - 1)
            );
            this.renderResults();
            return;
        }

        // Deep-search result — replay the drill chain to the picked
        // row's natural parent, then act. `_path` is stamped by
        // cp-deep-search.js's deepWalk; its presence (even when empty,
        // meaning the row is at the search anchor itself) is the deep-
        // result signature. Action mode "fire" = navigate + execute
        // (matches Enter's normal semantic).
        if (picked && picked._path !== undefined) {
            var deepMode = this._activeReachMode
                ? this._activeReachMode()
                : "local";
            this.replayDeepPath(picked, deepMode, "fire");
            return;
        }

        // Axis picker — enter on a row commits that axis into the chain
        // we opened the picker for and pops back to the Structure strip.
        if (stage._isAxisPicker) {
            this._applyAxisPick(stage, picked);
            return;
        }
        // Layer picker — enter on a row adds that shared layer to the view's
        // ca-view-layers (cloning the view to a scratchpad first).
        if (stage._isLayerPicker) {
            this._applyLayerPick(stage, picked);
            return;
        }

        // Pick-mode override — Enter on any row (container or leaf) in a
        // pick-mode stage commits the row's effective path as a filter arg
        // and returns to the prior view. Drilling via Right-arrow still
        // works to narrow before committing.
        var stageView = this._getViewByTitle(stage.viewTitle || this.activeView);
        if (stageView && stageView.pickMode) {
            this._commitPickModeSelection(stage, picked);
            return;
        }

        // Confirm stages: leaf fires its actions (Cancel = no-op) and then
        // pops the stage. Never close-on-fire, regardless of keepOpen — the
        // user expects to return to the previous stage. Action vars captured
        // when the stage was built (e.g. parent-picked from a ca-confirm
        // trigger) are passed through so referenced entities resolve.
        //
        // Pop guard: if the actions replaced the stack (e.g. via the
        // OPEN_ENTRY_MESSAGE handler, which calls openPalette() and rebuilds
        // the stack to [root, entry-stage]), the confirm stage is no longer
        // on top — popping would discard the entry stage the actions just
        // installed. Only pop if our confirm stage is still the top.
        if (stage.kind === "confirm" && picked.kind === "leaf") {
            if (picked.actions) {
                this.invokeViaNavigator(picked.actions, stage.actionVars || {});
            }
            if (this.topStage() === stage) {
                this.popStage();
            }
            return;
        }

        // 0. Overview row — selection already renders its summary in the side
        //    preview; Enter jumps focus INTO that pane so the user can scroll /
        //    interact with it. Falls through to the no-op leaf guard below when
        //    the pane isn't visible (e.g. the view opted out of side preview).
        if (picked._overviewRow && this._isSidePreviewVisible &&
            this._isSidePreviewVisible()) {
            this.setFocus("preview");
            return;
        }
        // 1. Pure-display leaf — no `ca-actions`, but `ca-after-fire: keep`
        //    signals "this row exists to show a message; Enter should be a
        //    no-op". Used by warning rows (kind's title-collision / constraint-
        //    violation / title-formula-empty leaves). Without this guard those
        //    rows fall through to the close-on-fire path at the bottom of
        //    fireSelected and dismiss the palette, even though they should
        //    just sit there until the user fixes the underlying problem.
        if (picked.kind === "leaf" && !picked.actions && picked.afterFire === "keep") {
            return;
        }
        // 2. Leaf entry/action item — fire ca-actions.
        if (picked.kind === "leaf" && picked.actions) {
            // ca-confirm: wrap the leaf's actions in a confirm-drill rather
            // than firing immediately. The confirm stage's Confirm leaf
            // carries the original actions; Cancel is a no-op. Substitution
            // variables (picked, parent-picked, …) are resolved inside the
            // consequence text via the wiki filter substitution, NOT here —
            // the consequence is a plain string passed to buildConfirmStage.
            if (picked.confirm) {
                // In an action-menu stage, `<<picked>>` must resolve to the
                // entity being acted upon (= stage.parentPicked), not the
                // action's own title. Matches fireLeafAction's logic so
                // direct-fire and confirm-wrapped paths are symmetric.
                var entityTitle = stage.kind === "actions"
                    ? (stage.parentPicked || "")
                    : picked.title;
                var vars = this.buildStageVariables(stage, entityTitle);
                this.pushStage(this.buildConfirmStage({
                    title: picked.name || "Confirm",
                    consequence: this._substituteVars(
                        picked.confirmConsequence, vars
                    ),
                    actions: picked.actions,
                    vars: vars
                }));
                return;
            }
            this.fireLeafAction(stage, picked, keepOpen);
            return;
        }
        // 2. Drill entry/action item — push the next stage.
        //    (Shift modifier has no effect — drilling doesn't close anyway.)
        //
        // Exception: drill rows whose `ca-actions` came from a
        // `ca-(view|layer)-row-actions` template (tree-view rows in
        // ''By Namespace'', ''By Date'', ''Hybrid'', etc.) treat Enter
        // as a fire-and-close gesture (typically navigates to the row's
        // tiddler), and Right-arrow as the structural drill — see
        // `drillSelected` which gates the preflight on the same flag.
        // Ctrl-Enter keeps the palette open so the user can chain picks.
        if (picked.kind === "drill") {
            if (picked.actions && picked._actionsFromRowTemplate) {
                this.fireLeafAction(stage, picked, keepOpen);
                return;
            }
            this.drillSelected();
            return;
        }
        // 2b. Toggle — flip the bound boolean. Enter closes (unless
        //     keepOpen), Space always keeps open (handled in handleKeydown).
        if (picked.kind === "toggle") {
            this.fireToggle(stage, picked, keepOpen);
            return;
        }
        // 2c. Text/number/date row — Enter enters edit mode (symmetric with
        //     Space). Without this, Enter on an editable row would fall
        //     through to the close path below, surprising the user who
        //     expects Enter to "engage" the row.
        if (picked.kind === "text" || picked.kind === "number" || picked.kind === "date") {
            this.enterEditMode(picked);
            return;
        }
        // 3. Dynamic filter-stage item (an entity result OR enum value).
        if (picked.isItem) {
            var vars = this.buildStageVariables(stage, picked.title);
            // Action wikitext (entity-default or stage-default) is authored
            // assuming `<<parent-picked>>` is the entity reference — that's
            // the convention when the user has drilled into the action menu
            // (parentPicked is set to the entity). For direct-Enter firing
            // (the user never opened the action menu), parentPicked is the
            // outer-stage pick (or null), so the same action wikitext would
            // navigate to "". Bind parent-picked to the picked instance so
            // both paths invoke the action against the same target.
            vars["parent-picked"] = picked.title;
            vars["keep-open"] = keepOpen ? "yes" : "";
            // 3a. Stage has a default action declared by the parent drill.
            if (stage.stageDefaultAction) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(stage.stageDefaultAction, vars);
                });
                return;
            }
            // 3b. Stage's entity type has a default action (ca-default:yes).
            if (stage.entityDefaultActions && stage.entityDefaultActions.actions) {
                this.afterAction(stage, keepOpen, function () {
                    this.invokeViaNavigator(
                        stage.entityDefaultActions.actions, vars
                    );
                });
                return;
            }
            // 3c. No default — fall back to navigate.
            this.afterAction(stage, keepOpen, function () {
                this.invokeViaNavigator(
                    '<$action-navigate $to=<<picked>>/>',
                    { picked: picked.title }
                );
            });
            return;
        }
        // 4. Anything else — just close (Shift modifier ignored).
        // Preserve the stack: the user fired some action (even if a
        // no-op leaf) and may want to come back to this point.
        if (!keepOpen) this.close("preserve");
    };

    // Replace `<<name>>` tokens in a string with values from a variable map.
    // Used for ca-confirm-consequence text and similar one-shot substitutions
    // where running a full TW wikitext parse would be overkill. Only `<<x>>`
    // is recognised — `$(x)$` and other TW idioms are left alone.
    proto._substituteVars = function (text, vars) {
        if (!text) return "";
        return String(text).replace(/<<([^>]+)>>/g, function (full, name) {
            var v = vars && vars[name];
            return v === undefined || v === null ? "" : String(v);
        });
    };

    proto.fireToggle = function (stage, item, keepOpen) {
        var self = this;
        var current = this.isToggleOn(item);
        // String-array bindings: toggle list-membership of trueValue
        // rather than swapping in trueValue/falseValue scalar literals.
        // Parse/format via TW list-format helpers so entries with spaces
        // (e.g. tiddler titles like "Echo Fox") round-trip through [[...]]
        // quoting. The scribetype's toField then turns the rebuilt list
        // text back into a JSON array on write.
        var next;
        if (item.bindType === STRING_ARRAY_TYPE) {
            var raw = this.readBoundValue(item) || "";
            var list = $tw.utils.parseStringArray(String(raw)) || [];
            // parseStringArray may return the same array instance per call,
            // and downstream code mutates it; copy to be safe.
            list = list.slice();
            var needle = String(item.trueValue);
            if (current) {
                list = list.filter(function (s) { return s !== needle; });
            } else if (list.indexOf(needle) === -1) {
                list.push(needle);
            }
            next = $tw.utils.stringifyList(list);
        } else {
            next = current ? item.falseValue : item.trueValue;
        }
        // afterAction expects a doAction callback. We close-or-stay via the
        // same shared helper so behaviour stays uniform with leaf/item paths.
        this.afterAction(stage, keepOpen, function () {
            self.writeBoundValue(item, next);
        });
    };

    // Number editing — +/- adjust by step; Shift = stepMedium; Ctrl = stepLarge.
    // Always keeps the palette open: numbers are rarely a one-shot commit
    // (you usually want to nudge a few times), and there's no "fire and
    // close" semantic that would feel right.
    proto.fireNumber = function (stage, item, delta) {
        var current = this.readNumberValue(item);
        var next = this.clampNumber(item, current + delta);
        if (next === current) return;  // already at clamp
        this.writeBoundValue(item, String(next));
        // Value read live in _appendResultRow; just re-render.
        this.renderResults();
    };

    /* ---------- date editing ----------

    The `date` kind uses the same modifier scaffolding as `number`:
        bare +/-  = ±day      × ca-step-day (default 1)
        Shift +/- = ±month    × ca-step-month (default 1)
        Ctrl +/-  = ±year     × ca-step-year (default 1)
    Space enters text edit-mode with the current value pre-filled in the
    scribetype's display format. Smart parser accepts ISO / German /
    today / tomorrow / yesterday / ±N[d|w|m|y] — handled in scribetype.

    Storage round-trips via the configured scribetype (default
    application/x-tw-date for `ca-kind: date`). If no bind-type is set,
    we fall back to that default so authors don't have to repeat it on
    every date item.

    \-------------------------------------------- */

    // Lazily-cached date-helpers module (shared with the scribetypes).
    // Returns null when scribe isn't loaded — date kind silently no-ops.
    proto._dateHelpers = function () {
        if (this._dateHelpersCache === undefined) {
            try {
                this._dateHelpersCache = require(
                    "$:/plugins/rimir/scribe/modules/scribetypes/_date-helpers.js"
                );
            } catch (err) {
                this._dateHelpersCache = null;
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] scribe plugin not loaded — " +
                        "ca-kind: date silently disabled. Add rimir/scribe."
                    );
                }
            }
        }
        return this._dateHelpersCache;
    };

    // Per-item +/- steps. Reuses ca-step / ca-step-medium / ca-step-large
    // semantics: ca-step-day defaults to 1, etc. Authors can override per
    // item if they want e.g. "+/- 7 days at a time".
    proto._dateStepFor = function (item, unit) {
        var t = item.title ? this.wiki.getTiddler(item.title) : null;
        var f = (t && t.fields) || (item.title ? {} : item._raw || {});
        var key = "ca-step-" + unit;
        var raw = f[key];
        var n = this._parseNumOrNull(raw);
        return n === null ? 1 : n;
    };

    // Read the current date as a JS Date object, or null if unset.
    // Empty field → null; caller treats null as "start from today".
    proto.readDateValue = function (item) {
        var raw = this._readBoundRaw(item);
        if (raw === undefined || raw === null || raw === "") return null;
        var helpers = this._dateHelpers();
        if (!helpers) return null;
        return helpers.fromTwDate(raw);
    };

    proto.fireDate = function (stage, item, unit, sign) {
        var helpers = this._dateHelpers();
        if (!helpers) return;
        var current = this.readDateValue(item);
        // Empty-value semantics: + starts from today, - also from today.
        if (!current) current = new Date(new Date().setHours(0, 0, 0, 0));
        var step = this._dateStepFor(item, unit) * sign;
        var next;
        if (unit === "day")        next = helpers.addDays(current, step);
        else if (unit === "month") next = helpers.addMonths(current, step);
        else if (unit === "year")  next = helpers.addMonths(current, step * 12);
        else return;
        // Pick storage format by bind-type:
        //   application/x-tw-date     → 8-char YYYYMMDD (local digits)
        //   application/x-tw-datetime → 17-char YYYYMMDDHHmmsssss (UTC)
        // Mirrors the scribetype's toField — keeps the format consistent
        // between the typed-input path and the +/- arithmetic path.
        var storage = (item.bindType === "application/x-tw-date")
            ? helpers.toTwDateOnly(next)
            : helpers.toTwDate(next);
        if (storage === undefined) return;
        // Write the storage string directly — bypassing the scribetype
        // since we already produced storage form. (Calling
        // writeBoundValue with a display string would re-parse it.)
        this._writeRawAtField(item, storage);
        this.renderResults();
    };

    // Write a pre-converted value directly at the field/sub-path, skipping
    // the scribetype toField pass. Used by edit kinds that have already done
    // the conversion themselves (e.g. fireDate has the TW date string ready).
    proto._writeRawAtField = function (item, value) {
        if (!item.bindTiddler) return;
        if (!item.bindPath) {
            var existing = this.wiki.getTiddler(item.bindTiddler);
            var fields = { title: item.bindTiddler };
            fields[item.bindField] = String(value);
            this.wiki.addTiddler(new $tw.Tiddler(
                (existing && existing.fields) || {},
                fields
            ));
            return;
        }
        var t = this.wiki.getTiddler(item.bindTiddler);
        var fieldText = t && t.fields[item.bindField];
        var root;
        try { root = fieldText ? JSON.parse(fieldText) : {}; }
        catch (e) { root = {}; }
        var parts = item.bindPath.split(",");
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
            var k = parts[i];
            if (node[k] === undefined || node[k] === null || typeof node[k] !== "object") {
                node[k] = {};
            }
            node = node[k];
        }
        node[parts[parts.length - 1]] = value;
        var newFields = { title: item.bindTiddler };
        // Compact JSON only. Pretty-printing (indent > 0) injects newlines
        // into the field value; TW's filesystem adaptor treats control chars
        // in non-text fields as "unsafe" and silently switches the tiddler
        // from .tid to .json file format, orphaning the .tid file on disk.
        // (Mirrors the fix in cp-items.js.)
        newFields[item.bindField] = JSON.stringify(root);
        this.wiki.addTiddler(new $tw.Tiddler(
            (t && t.fields) || {},
            newFields
        ));
    };

    /* ---------- edit mode (text + direct-set numbers) ---------- */

    proto.enterEditMode = function (item) {
        var stage = this.topStage();
        if (!stage) return;
        // Edit mode and preview drawer are mutually exclusive — drop the
        // preview if it was up so the editor can use the full popup.
        if (this.detailsOpen) {
            this.detailsOpen = false;
            this.hideDetail();
        }
        var initial = "";
        if (item.initialValue !== undefined) {
            // Explicit pre-fill (e.g. the view editor's save-as-new name
            // prompt) — overrides the bound value.
            initial = String(item.initialValue);
        } else if (item.kind === "number") {
            initial = String(this.readNumberValue(item));
        } else {
            var raw = this.readBoundValue(item);
            if (raw !== undefined && raw !== null) initial = String(raw);
        }
        this.editMode = {
            item: item,
            savedQuery: stage.query || "",
            savedSelectedIndex: stage.selectedIndex,
            // Where to return focus on commit/cancel. Default "menu"
            // (rows entered from the result list); "viewconfig" routes back
            // to the Structure strip for in-place facet editing.
            returnFocus: item.returnFocus || "menu",
            editKind: item.editKind || ""
        };
        this.inputEl.value = initial;
        this.inputEl.placeholder = "Editing: " + (item.name || item.title);
        this.popupEl.classList.add("rcp-editing");
        this.hintEl.textContent = HINT_EDIT;
        var self = this;
        // Filter editKind: live, debounced match-count / parse-error feedback
        // in the hint line. Counting is cheap (`.length` only, no row
        // materialisation); the wiki is not written until commit.
        if (item.editKind === "filter") {
            var renderCount = function () {
                var val = self.inputEl.value;
                var tail = " · ↵ commit · Esc cancel";
                try {
                    var n = self._filterInScope(val, { currentTiddler: "" }).length;
                    self.inputEl.classList.remove("rcp-edit-error");
                    self.hintEl.textContent =
                        "✓ " + n + " match" + (n === 1 ? "" : "es") + tail;
                } catch (err) {
                    self.inputEl.classList.add("rcp-edit-error");
                    self.hintEl.textContent =
                        "✗ " + ((err && err.message) || "filter error") + tail;
                }
            };
            this.editMode.matchListener = function () {
                if (self._editMatchTimer) clearTimeout(self._editMatchTimer);
                self._editMatchTimer = setTimeout(renderCount, 150);
            };
            this.inputEl.addEventListener("input", this.editMode.matchListener);
            renderCount();
            // Seed the side-preview filter lab with the field's current
            // value and show it. The lab is an independent sandbox (its own
            // input + live result list) — see cp-side-preview._renderFilterLab.
            if (this._renderFilterLab) {
                this.wiki.setText(C.FILTER_LAB_STATE, "text", null, initial);
                this._renderFilterLab();
            }
        }
        // Select-all so a single keypress replaces the value, but the user
        // can also use Home/End/arrows to position the cursor for partial
        // edits.
        setTimeout(function () { self.inputEl.select(); }, 0);
    };

    proto.exitEditMode = function (commit) {
        if (!this.editMode) return;
        var em = this.editMode;
        var raw = this.inputEl.value;
        var committedValue;
        if (commit) {
            if (em.item.kind === "number") {
                var n = parseFloat(raw);
                if (!isNaN(n)) {
                    committedValue = String(this.clampNumber(em.item, n));
                    this.writeBoundValue(em.item, committedValue);
                }
                // If unparseable, silently discard — feels safer than writing
                // garbage to a config tiddler.
            } else {
                // Date kind (and text kind) write through the scribetype.
                // For date, the smart parser throws on garbage input; we
                // catch and stay in edit mode so the user can fix the typo
                // rather than losing their input.
                try {
                    this.writeBoundValue(em.item, raw);
                    committedValue = raw;
                } catch (err) {
                    this.inputEl.classList.add("rcp-edit-error");
                    this.hintEl.textContent = "✗ " +
                        (err && err.message ? err.message : "invalid input") +
                        " — fix and ↵ to retry, Esc to cancel";
                    // Keep editMode active; let user retry.
                    return;
                }
            }
        }
        this.editMode = null;
        this.inputEl.classList.remove("rcp-edit-error");
        // Detach the live filter match-count listener (if any).
        if (em.matchListener) {
            this.inputEl.removeEventListener("input", em.matchListener);
            if (this._editMatchTimer) {
                clearTimeout(this._editMatchTimer);
                this._editMatchTimer = null;
            }
        }
        // Leaving a filter edit — drop the filter lab and let the next
        // render restore the normal candidate preview (editMode is now
        // null, so _renderSidePreview no longer routes to the lab).
        if (em.editKind === "filter") {
            if (this._invalidateSidePreviewCache) {
                this._invalidateSidePreviewCache();
            }
            if (this._renderSidePreview) this._renderSidePreview();
        }
        // ca-on-commit: action wikitext fired AFTER the value lands (or
        // would have landed — bind-less rows fire onCommit on commit, using
        // the input as a transient capture). <<picked>> = the committed
        // value, <<parent-picked>> = the stage's outer pick. Used by single-
        // shot text rows like kind's "+ Create new kind…" where the user
        // types a key once and a follow-up action creates the artifact.
        if (commit && em.item.onCommit && committedValue !== undefined) {
            // buildStageVariables tolerates a null stage (returns base vars
            // with empty stage-derived fields) — matches the pre-0.0.82
            // fallback shape for orphaned-edit-mode commits.
            var commitVars = this.buildStageVariables(
                this.topStage(),
                committedValue
            );
            this.invokeViaNavigator(em.item.onCommit, commitVars);
        }
        // JS commit/cancel callbacks — used by the view editor's
        // save-as-new name prompt. The callback owns the follow-up render
        // (finalize + reload + re-render), so we restore the input chrome
        // and return without the default menu / viewconfig teardown. On
        // cancel with no onCancelFn, fall back to returning to the strip.
        if (em.item.onCommitFn || em.item.onCancelFn) {
            this.inputEl.value = em.savedQuery || "";
            this.inputEl.placeholder = "Type to filter…";
            this.popupEl.classList.remove("rcp-editing");
            if (commit && em.item.onCommitFn) {
                em.item.onCommitFn(committedValue);
            } else if (!commit && em.item.onCancelFn) {
                em.item.onCancelFn();
            } else {
                // Cancelled save-as-new — scratchpad stays; back to the strip.
                if (this._renderViewConfigStrip) this._renderViewConfigStrip();
                this._renderHint();
                this.setFocus(em.returnFocus === "viewconfig" ? "viewconfig" : "menu");
            }
            return;
        }
        // Structure-strip facet edit: return to the Structure strip rather
        // than the result menu. On commit the view definition changed, so
        // _afterViewConfigEdit reloads the (stale) view cache, rebuilds the
        // live preview, and re-renders the strip; on cancel we just restore
        // the strip + focus.
        if (em.returnFocus === "viewconfig") {
            this.inputEl.value = em.savedQuery || "";
            this.inputEl.placeholder = "Type to filter…";
            this.popupEl.classList.remove("rcp-editing");
            this.viewConfigExpanded = true;
            if (commit && this._afterViewConfigEdit) {
                this._afterViewConfigEdit();
            } else {
                // Cancel: stay on the pill being edited. setFocus resets the
                // index to 0, so restore it after re-rendering the strip.
                var keepIdx = this.viewConfigFocusIdx || 0;
                this.setFocus("viewconfig");
                var n = (this._viewConfigPillList &&
                    this._viewConfigPillList.length) || 0;
                if (n > 0) {
                    this.viewConfigFocusIdx = Math.max(0, Math.min(keepIdx, n - 1));
                    if (this._renderViewConfigStrip) this._renderViewConfigStrip();
                }
                this._renderHint();
            }
            return;
        }
        var stage = this.topStage();
        if (stage) {
            stage.query = em.savedQuery;
            stage.selectedIndex = em.savedSelectedIndex;
            this.recomputeStage(stage);
        }
        this.inputEl.value = em.savedQuery;
        this.inputEl.placeholder = "Type to filter…";
        this.popupEl.classList.remove("rcp-editing");
        this._renderHint();
        this.renderStage();
        // Edit was entered from the menu (Enter / Space on a text/number/
        // date row), so return focus there. The row is still selected (we
        // restored `selectedIndex` above) — arrow keys, DEL, Ctrl-↑/↓,
        // Enter to re-edit all work immediately without re-grabbing focus.
        this.setFocus("menu");
    };

    /* ---------- post-fire dispatch ---------- */

    proto.fireLeafAction = function (stage, action, keepOpen) {
        // In an action-menu stage, leaf-action `<<picked>>` is the entity
        // the menu acts on (the parent-picked). Otherwise (root entry leaf),
        // `<<picked>>` is the action's own title — only meaningful if the
        // action references itself, which is unusual.
        var pickedTitle = stage.kind === "actions"
            ? (stage.parentPicked || "")
            : action.title;
        // ca-after-fire="keep" forces keep-open regardless of Enter vs
        // Ctrl-Enter. Used by leaves whose action mutates palette state
        // (preset apply, view switch) — closing immediately after would
        // hide the result. Applied before var-build so the action sees
        // the effective keep-open value.
        if (action.afterFire === "keep") keepOpen = true;
        // View-level `ca-view-after-fire: stay` opts the whole view into
        // keep-open semantics for every row fire — used by multiselect
        // views (worga's pick-attendees, settings drills) where each
        // Enter is one tick of a longer selection flow rather than a
        // commit-and-close. Per-row `ca-after-fire: keep` wins if set;
        // this is the view-wide default below it.
        var fireView = this._getViewByTitle(stage.viewTitle || this.activeView);
        if (fireView && fireView.afterFire === "stay") keepOpen = true;
        // Expose Ctrl-Enter (or ca-after-fire="keep") to action wikitext
        // as `<<keep-open>>` = "yes" | "". Lets a single save-leaf branch
        // on "mass-create" vs "single create + navigate" without needing
        // two distinct rows. The cascade-palette docs the protocol; kind
        // plugin's save-leaf is the first consumer.
        var vars = this.buildStageVariables(stage, pickedTitle, {
            "keep-open": keepOpen ? "yes" : ""
        });
        // ca-after-fire="pop" overrides the default close-on-fire: invoke
        // the action, pop this stage, and keep the palette open on the
        // previous stage. Used by single-select sub-drills (ref / enum
        // picker leaves inside a create/edit flow) so the user lands back
        // on the field-edit stage with their pick already applied.
        if (action.afterFire === "pop") {
            var self = this;
            self.invokeViaNavigator(action.actions, vars);
            setTimeout(function () {
                if (!self.open) return;
                self.popStage();
            }, 0);
            return;
        }
        this.afterAction(stage, keepOpen, function () {
            this.invokeViaNavigator(action.actions, vars);
        });
    };

    // Shared post-action helper: invoke the action, then either close the
    // palette (default) OR recompute + re-render the current stage to
    // reflect any state the action may have mutated (keepOpen=true).
    proto.afterAction = function (stage, keepOpen, doAction) {
        if (!keepOpen) {
            // Close-on-fire is the most common "I picked something" exit
            // — preserve so the next open lands the user back at the
            // same drill (typical pattern: drill into a kind → fire an
            // action that opens a tiddler → user comes back to continue).
            this.close("preserve");
            doAction.call(this);
            return;
        }
        // Run the action first; then refresh current stage so any state
        // changes the action triggered are reflected immediately.
        doAction.call(this);
        var self = this;
        // Defer recompute slightly — most TW actions are synchronous, but
        // statewrap/listops widgets schedule writes that take effect on the
        // next microtask. A 0ms timeout lets pending writes land first.
        setTimeout(function () {
            if (!self.open) return;
            self.recomputeStage(stage);
            self.renderStage();
        }, 0);
    };

    /* ---------- deep-search path replay ----------

    When the user picks a row from a deep-search result list, the row
    carries a `_path` array of `{name, item}` records naming the drill
    chain from the search anchor (current stage for deep-here, root view
    for deep-root) to the picked item's natural parent. Replay walks
    that chain — pushing each intermediate stage exactly as
    `drillSelected` would — so the cascade lands at the picked row's
    real location BEFORE the row's own action fires. This preserves any
    `<<parent-picked>>` / `<<stage-N-picked>>` dependencies the picked
    row's action wikitext might have, and leaves the user inside the
    drill's subtree (rather than at root) so they can keep navigating
    from where the search dropped them.

    `mode` is the active deep-search mode at pick time — "deep-here"
    means the current top stage is the replay anchor; "deep-root" means
    pop to the root stage first. Both end with the picked row engaged
    (drilled or fired) at its real position.

    \------------------------------------------------ */

    proto.replayDeepPath = function (picked, mode, action) {
        if (!picked) return;
        // Informational truncation sentinel — has no real target.
        if (picked._deepTruncated) return;
        var path = picked._path || [];
        // action: "fire" (default, Enter) | "drill" (Right-arrow)
        //       | "select" (Space — pin only, no execute)
        action = action || "fire";

        // 1. Position the stack for replay.
        if (mode === "deep-root" && this.stack.length > 1) {
            this.stack.length = 1;
            this.recomputeStage(this.stack[0]);
        }
        // deep-here: leave the stack alone — current top IS the anchor.

        // 2. Push each path step's drill stage. Each step's item is a
        // drillable item (filter-stage drill or tree-container) — we
        // descend the same way the user would by hand.
        for (var i = 0; i < path.length; i++) {
            if (!this._drillOnItemForReplay(path[i].item)) {
                // Couldn't push (item no longer drillable — schema may
                // have changed between walk and replay). Surface what
                // we have so the user isn't left in a confused state.
                this.renderStage();
                return;
            }
        }

        // 3. Locate the picked row in the now-top stage and select it.
        var top = this.topStage();
        if (!top) { this.renderStage(); return; }
        var idx = this._locateItemInStage(top, picked);
        if (idx === -1) {
            // Result moved or was deleted between walk and replay.
            // Render the closest-reachable stage and bail — the user
            // can re-search from here.
            this.renderStage();
            return;
        }
        top.selectedIndex = idx;
        this.setFocus("menu");
        this.renderStage();

        // 4. Engage the picked row per action mode.
        //   - "select": pin only — position + select, no execute. The
        //     user can now use any normal cascade gesture (Enter to fire,
        //     Space to edit, Right to drill) from the natural stage. The
        //     safe "go look at it in context" gesture.
        //   - "drill": replay-then-drillSelected. Drills if drillable;
        //     no-op on plain leaves. Matches Right-arrow's normal sem.
        //   - "fire" (default): replay-then-fireSelected. Drill rows
        //     descend; leaf rows fire their action. Matches Enter sem.
        if (action === "select") {
            return;
        }
        if (action === "drill") {
            this.drillSelected();
            return;
        }
        if (this._isReplayDrillable(picked)) {
            this.drillSelected();
        } else {
            // fireSelected with keepOpen=false matches default close-on-
            // pick behaviour for normal cascade picks. The user can chain
            // a follow-up search by reopening the palette; the pill
            // state is preserved across opens.
            this.fireSelected(false);
        }
    };

    proto._isReplayDrillable = function (item) {
        if (!item) return false;
        if (item._treeContainer && item._treeParent) return true;
        if (item.kind === "drill" && (item.nextScope || item.itemsFrom)) return true;
        if (item.entityType && item.kind === "leaf") return true;
        return false;
    };

    // Same dispatcher logic as drillSelected, but operates on a
    // supplied item rather than the focused row. Returns true when a
    // stage was pushed (so the replay loop can detect failure). Reuses
    // _attachPreviewToStage so any preview-template the row registered
    // still surfaces during replay — search hits inside a preview-
    // anchored subtree retain their preview context.
    proto._drillOnItemForReplay = function (item) {
        var top = this.topStage();
        if (!top) return false;

        if (item._treeContainer && item._treeParent) {
            var viewTitle = top.viewTitle || this.activeView;
            var basePath = (top.parentPath || []).slice();
            basePath.push(item._treeParent);
            var treeStage = this.buildTreeStage(
                viewTitle, basePath, item.name, item._layerIdx
            );
            this._attachPreviewToStage(treeStage, item, top);
            this.pushStage(treeStage);
            return true;
        }
        if (item.kind === "drill" && (item.nextScope || item.itemsFrom)) {
            var filtStage = this.buildFilterStage(item, top.parentPicked || null);
            this._attachPreviewToStage(filtStage, item, top);
            this.pushStage(filtStage);
            return true;
        }
        // Entity-type leaves don't appear inside the BFS frontier (the
        // deep walker doesn't descend into action menus), so we don't
        // need to handle them as intermediate path nodes here. If one
        // ever shows up, treat it as non-drillable for replay.
        return false;
    };

    // Find the freshly-computed counterpart of `target` in `stage.items`.
    // Matching priority: title (real items) → name (synthetic items, no
    // backing tiddler). Returns -1 when the picked row's identity can't
    // be re-established (typical when the underlying data changed
    // between the walk and the replay).
    proto._locateItemInStage = function (stage, target) {
        if (!stage || !stage.items || !target) return -1;
        var targetTitle = target.title || "";
        var targetName = target.name || "";
        for (var i = 0; i < stage.items.length; i++) {
            var it = stage.items[i];
            if (targetTitle && it.title === targetTitle) return i;
            if (!targetTitle && it.name === targetName) return i;
        }
        // Name-fallback when title-match failed (e.g. tiddler renamed
        // between walk and replay): pick first name-match.
        if (targetTitle) {
            for (var j = 0; j < stage.items.length; j++) {
                if (stage.items[j].name === targetName) return j;
            }
        }
        return -1;
    };

    proto.drillSelected = function () {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // ca-actions on a drill row fire on every drill-enter (before the
        // next stage is pushed). Author-side contract: keep the actions
        // idempotent — backing out and re-entering the drill re-fires them.
        // Used e.g. by kind to seed a fresh draft with field defaults before
        // the create-fields drill renders. Backward-compatible — drill items
        // without ca-actions behave exactly as before.
        //
        // Exception: skip when `_actionsFromRowTemplate` is set — the
        // ca-actions came from a `ca-(view|layer)-row-actions` template
        // (typically a $action-navigate intended for Enter), NOT from the
        // row tiddler's own intentional ca-actions. Right-arrow on a tree
        // container should be purely structural; firing the template's
        // navigate as a side-effect was a regression introduced when
        // 0.0.66 added the drill-preflight feature.
        if (picked && picked.kind === "drill" && picked.actions &&
            !picked._actionsFromRowTemplate) {
            var preVars = this.buildStageVariables(stage, picked.title || "");
            this.invokeViaNavigator(picked.actions, preVars);
        }

        // Deep-search result — same intercept as fireSelected, so
        // Right-arrow on a deep result also replays the path before
        // drilling. Action mode "drill" = navigate + drillSelected
        // (drills if drillable, no-op for plain leaves — matches the
        // existing Right-arrow semantic).
        if (picked && picked._path !== undefined) {
            var deepMode = this._activeReachMode
                ? this._activeReachMode()
                : "local";
            this.replayDeepPath(picked, deepMode, "drill");
            return;
        }

        // Tree-view container row → push a tree-stage pinned to the layer
        // the container came from. parentPath extends with the picked
        // container's tiddler title; layerIdx propagates so the descent
        // runs only that layer's `children` filter (other layers don't
        // contribute children under a node they didn't produce).
        if (picked._treeContainer && picked._treeParent) {
            var viewTitle = stage.viewTitle || this.activeView;
            var basePath = (stage.parentPath || []).slice();
            basePath.push(picked._treeParent);
            var treeStage = this.buildTreeStage(
                viewTitle, basePath, picked.name,
                picked._layerIdx
            );
            this._attachPreviewToStage(treeStage, picked, stage);
            this.pushStage(treeStage);
            return;
        }
        // View-layer entity-type drill: a leaf row whose emitting layer
        // declared `ca-layer-row-entity-type` (and produced a non-empty
        // type for this row) opens an action-menu stage of that type on
        // Right-arrow. Containers never reach here (handled above) — the
        // action menu is reserved for leaves so Right-arrow on a folder
        // still descends.
        if (picked.entityType && picked.kind === "leaf") {
            var actStage = this.buildActionMenuStage(
                picked.title, picked.entityType, picked.name
            );
            this._attachPreviewToStage(actStage, picked, stage);
            this.pushStage(actStage);
            return;
        }

        // Drill entry/action → push filter stage. parent-picked is inherited
        // from the current stage uniformly (action-menu and filter stages
        // both carry it; root has none). Either `ca-next-scope` or
        // `ca-items-from` qualifies the drill.
        if (picked.kind === "drill" && (picked.nextScope || picked.itemsFrom)) {
            var filtStage = this.buildFilterStage(
                picked, stage.parentPicked || null
            );
            this._attachPreviewToStage(filtStage, picked, stage);
            this.pushStage(filtStage);
            return;
        }

        // Drill on a dynamic entity result → push action menu stage.
        // Silent no-op when the stage has no entityType (e.g. a diagnostic
        // listing) — these stages drill via $action-navigate from fireSelected
        // instead.
        if (picked.isItem) {
            if (!stage.entityType) return;
            var dynActStage = this.buildActionMenuStage(
                picked.title,
                stage.entityType,
                picked.title
            );
            this._attachPreviewToStage(dynActStage, picked, stage);
            this.pushStage(dynActStage);
            return;
        }
        // Tree-view leaf / generic real-tiddler row with applicable actions —
        // mirrors the Space-key fallback (cp-keyboard.js _handleKeydownMenu).
        // Right-arrow on a row that has no tree children, no entity-type,
        // and no next-scope but DOES have action tiddlers whose `ca-applies`
        // filter matches the title should open the action menu (same gesture
        // as Space). Pre-flight `loadActionsForType` so empty matches still
        // no-op rather than opening an empty stage.
        if (picked.title && !picked.isSynthetic) {
            var fallbackType = picked.entityType ||
                (picked.isItem ? stage.entityType : null) ||
                null;
            var fallbackApplicable = this.loadActionsForType(
                fallbackType, picked.title
            );
            if (fallbackApplicable && fallbackApplicable.length > 0) {
                var fallbackActStage = this.buildActionMenuStage(
                    picked.title, fallbackType, picked.name
                );
                this._attachPreviewToStage(fallbackActStage, picked, stage);
                this.pushStage(fallbackActStage);
                return;
            }
        }
        // Right-arrow on a leaf without an entity-type, next-scope, or any
        // applicable actions is a no-op.
    };

    // Read `ca-preview-*` fields from a row and attach the resolved
    // template / context / title onto a freshly-built stage record. The
    // context filter is evaluated in the PARENT stage's substitution
    // scope (so `<<picked>>` resolves to the row being drilled into,
    // `<<parent-picked>>` to the parent stage's pick, etc.). Default
    // context is the row's title — common for actions where `<<picked>>`
    // is the entity being acted upon. Called at every drill site so the
    // preview pane stays in sync with stack pushes.
    //
    // Three activation paths feed the side-preview pane:
    //
    //  (a) Per-menu template: item has `ca-preview-template`. Stamp it
    //      as the explicit primary candidate. Tag-based candidates
    //      whose `ca-preview-applies` filter matches the active
    //      context get added as additional pills at render time.
    //
    //  (b) Tag-only opt-in: item has `ca-preview-context` or
    //      `ca-preview-per-row` but NO template. Enable the pane and
    //      populate candidates purely from tagged side-previews. Use
    //      this when the menu has no preferred preview but the rows
    //      are previewable entities (e.g. browse lists where the
    //      tag-based kind-instance preview should auto-attach).
    //
    //  (c) Inheritance: neither set, but the parent stage carries
    //      `_previewPerRow` + `_previewTemplate`. The sub-drill keeps
    //      the parent's preview but locks the context to the row that
    //      was just drilled into (the parent's selected row). For
    //      action-menu sub-stages this is critical — without the lock,
    //      navigating actions would re-resolve the context to action
    //      titles instead of the entity being acted upon.
    proto._attachPreviewToStage = function (newStage, item, parentStage) {
        var rowTitle = (item && item.title) || "";
        var ctx = "";
        var hasMenu = !!(item && item.previewTemplate);
        var hasOptIn = !!(item && (item.previewContext || item.previewPerRow));
        if (hasMenu || hasOptIn) {
            ctx = rowTitle;
            if (item.previewContext) {
                try {
                    var vars = this.buildStageVariables(parentStage, rowTitle);
                    var titles = this._filterInScope(item.previewContext, vars);
                    ctx = (titles && titles.length) ? titles[0] : "";
                } catch (err) {
                    if (console && console.warn) {
                        console.warn(
                            "[cascade-palette] ca-preview-context filter error on",
                            rowTitle, "—", err && err.message
                        );
                    }
                    ctx = "";
                }
            }
            newStage._previewContext = ctx;
            newStage._previewPerRow = !!item.previewPerRow;
            newStage._previewActiveIdx = 0;
            if (hasMenu) {
                newStage._previewTemplate = item.previewTemplate;
                newStage._previewTitle = item.previewTitle || "";
                newStage._previewMenuName = item.previewName || "";
            }
            return;
        }
        if (parentStage && parentStage._previewPerRow &&
            (parentStage._previewTemplate || parentStage._previewContext)) {
            // Inherit. Two flavours depending on the new stage's kind:
            //   - "actions": rows are actions (NOT entities) → LOCK the
            //     context to the parent's drilled-into row (the entity)
            //     so action-menu navigation doesn't shift the preview
            //     anchor.
            //   - everything else (filter / tree / leaf): rows could be
            //     entities themselves (e.g. Help → Plugins → list of
            //     plugin help sections) → KEEP per-row so the preview
            //     tracks the sub-stage's selected row.
            if (parentStage._previewTemplate) {
                newStage._previewTemplate = parentStage._previewTemplate;
                newStage._previewTitle = parentStage._previewTitle || "";
                newStage._previewMenuName = parentStage._previewMenuName || "";
            }
            if (newStage.kind === "actions") {
                newStage._previewContext = rowTitle ||
                    parentStage._previewContext || "";
                newStage._previewPerRow = false;
            } else {
                newStage._previewContext = parentStage._previewContext || "";
                newStage._previewPerRow = true;
            }
            newStage._previewActiveIdx = 0;
        }
    };

};
