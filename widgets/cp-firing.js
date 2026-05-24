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
        if (stage.kind === "confirm" && picked.kind === "leaf") {
            if (picked.actions) {
                this.invokeViaNavigator(picked.actions, stage.actionVars || {});
            }
            this.popStage();
            return;
        }

        // 1. Leaf entry/action item — fire ca-actions.
        if (picked.kind === "leaf" && picked.actions) {
            // ca-confirm: wrap the leaf's actions in a confirm-drill rather
            // than firing immediately. The confirm stage's Confirm leaf
            // carries the original actions; Cancel is a no-op. Substitution
            // variables (picked, parent-picked, …) are resolved inside the
            // consequence text via the wiki filter substitution, NOT here —
            // the consequence is a plain string passed to buildConfirmStage.
            if (picked.confirm) {
                var vars = this.buildStageVariables(stage, picked.title);
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
        if (picked.kind === "drill") {
            this.drillSelected();
            return;
        }
        // 2b. Toggle — flip the bound boolean. Enter closes (unless
        //     keepOpen), Space always keeps open (handled in handleKeydown).
        if (picked.kind === "toggle") {
            this.fireToggle(stage, picked, keepOpen);
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
        if (!keepOpen) this.close();
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
        // The scribetype's toField turns the rebuilt space-separated
        // string back into a JSON array on write.
        var next;
        if (item.bindType === STRING_ARRAY_TYPE) {
            var raw = this.readBoundValue(item) || "";
            var list = String(raw).split(/\s+/).filter(function (s) { return s; });
            var needle = String(item.trueValue);
            if (current) {
                list = list.filter(function (s) { return s !== needle; });
            } else if (list.indexOf(needle) === -1) {
                list.push(needle);
            }
            next = list.join(" ");
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
        var storage = helpers.toTwDate(next);
        if (storage === undefined) return;
        // Write the TW UTC date string directly via _readBoundRaw's inverse —
        // bypassing the scribetype since we already produced storage form.
        // (Calling writeBoundValue with a display string would re-parse it.)
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
        newFields[item.bindField] = JSON.stringify(root, null, 4);
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
            this.hidePreview();
        }
        var raw = this.readBoundValue(item);
        var initial = "";
        if (item.kind === "number") {
            initial = String(this.readNumberValue(item));
        } else if (raw !== undefined && raw !== null) {
            initial = String(raw);
        }
        this.editMode = {
            item: item,
            savedQuery: stage.query || "",
            savedSelectedIndex: stage.selectedIndex
        };
        this.inputEl.value = initial;
        this.inputEl.placeholder = "Editing: " + (item.name || item.title);
        this.popupEl.classList.add("rcp-editing");
        this.hintEl.textContent = HINT_EDIT;
        // Select-all so a single keypress replaces the value, but the user
        // can also use Home/End/arrows to position the cursor for partial
        // edits.
        var self = this;
        setTimeout(function () { self.inputEl.select(); }, 0);
    };

    proto.exitEditMode = function (commit) {
        if (!this.editMode) return;
        var em = this.editMode;
        var raw = this.inputEl.value;
        if (commit) {
            if (em.item.kind === "number") {
                var n = parseFloat(raw);
                if (!isNaN(n)) {
                    this.writeBoundValue(em.item, String(this.clampNumber(em.item, n)));
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
        var vars = this.buildStageVariables(stage, pickedTitle);
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
        // ca-after-fire="keep" forces keep-open regardless of Enter vs
        // Ctrl-Enter. Used by leaves whose action mutates palette state
        // (preset apply, view switch) — closing immediately after would
        // hide the result.
        if (action.afterFire === "keep") keepOpen = true;
        this.afterAction(stage, keepOpen, function () {
            this.invokeViaNavigator(action.actions, vars);
        });
    };

    // Shared post-action helper: invoke the action, then either close the
    // palette (default) OR recompute + re-render the current stage to
    // reflect any state the action may have mutated (keepOpen=true).
    proto.afterAction = function (stage, keepOpen, doAction) {
        if (!keepOpen) {
            this.close();
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

    proto.drillSelected = function () {
        var stage = this.topStage();
        if (!stage || stage.results.length === 0) return;
        var picked = stage.results[stage.selectedIndex];

        // Tree-view container row → push a tree-stage. The new parentPath
        // extends the current stage's path with the picked container's
        // tiddler title (`_treeParent`). Distinct from filter-drill:
        // there's no ca-next-scope — navigation is purely through repeated
        // children-filter evaluation.
        if (picked._treeContainer && picked._treeParent) {
            var viewTitle = stage.viewTitle || this.activeView;
            var basePath = (stage.parentPath || []).slice();
            basePath.push(picked._treeParent);
            this.pushStage(this.buildTreeStage(
                viewTitle, basePath, picked.name
            ));
            return;
        }

        // Drill entry/action → push filter stage. parent-picked propagation:
        //   - From root: no parent-picked (entries don't have one).
        //   - From action menu: keep the menu's parent-picked (the entity).
        //   - From filter (e.g. nested cascade entry): keep current parent.
        // Either `ca-next-scope` or `ca-items-from` qualifies the drill.
        if (picked.kind === "drill" && (picked.nextScope || picked.itemsFrom)) {
            var parentPicked = stage.kind === "actions"
                ? (stage.parentPicked || null)
                : (stage.parentPicked || null);
            this.pushStage(this.buildFilterStage(picked, parentPicked));
            return;
        }

        // Drill on a dynamic entity result → push action menu stage.
        // Silent no-op when the stage has no entityType (e.g. a diagnostic
        // listing) — these stages drill via $action-navigate from fireSelected
        // instead.
        if (picked.isItem) {
            if (!stage.entityType) return;
            this.pushStage(this.buildActionMenuStage(
                picked.title,
                stage.entityType,
                picked.title
            ));
            return;
        }
        // Tab on a leaf is a no-op.
    };

};
