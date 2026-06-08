/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-side-preview
type: application/javascript
module-type: library

Side preview pane — right-column wikitext rendering attached to a stage.

Two complementary registration mechanisms feed candidates into the pane:

  (1) Per-menu (explicit).  An entry/action tiddler declares any of:

        ca-preview-template   title of a wikitext tiddler whose body is
                              rendered in the right pane when the user
                              drills into the row. Required to register
                              an explicit candidate.
        ca-preview-context    filter evaluated at drill-time in the
                              parent stage's substitution scope. First
                              result becomes <<currentTiddler>> inside
                              the template AND is exposed to deeper
                              stages as <<stage-preview-context>>.
                              Defaults to the drilled row's title.
        ca-preview-title      caption shown above the preview body.
        ca-preview-name       short pill label (used when multiple
                              candidates apply at once). Defaults to
                              the title, or a truncation of the
                              template title.
        ca-preview-per-row    when "yes", the active context is the
                              CURRENTLY-SELECTED row's title — updated
                              live as the user navigates ↑/↓.

      The drill-site code (`drillSelected`, Space gesture in cp-keyboard)
      calls `_attachPreviewToStage` to stamp the values onto the freshly
      pushed stage record.

  (2) Tag-based (auto-attach).  Tiddlers tagged
      `$:/tags/rimir/cascade-palette/side-preview` declare candidates
      that surface automatically whenever the current context matches
      their `ca-preview-applies` filter. Fields:

        ca-preview-template   defaults to the tagged tiddler's OWN title
                              (the tagged tiddler IS the template).
        ca-preview-applies    filter evaluated with <currentTiddler>
                              bound to the active context. Empty
                              (missing) = applies to every context.
        ca-preview-name       pill label.
        ca-preview-title      caption above the body.
        ca-preview-order      sort order among tag candidates (default
                              100). Per-menu candidates always sort
                              first.

      Tag candidates are re-resolved on every render against the live
      context, so per-row drills naturally surface different previews
      per selected row.

When more than one candidate applies, a pill row at the top of the
preview pane lets the user cycle alternatives via ←/→ (when the preview
pane has focus) or click. With a single candidate the pill row is
suppressed entirely and the pane looks identical to the pre-pill UX.

After every stage push/pop and after `renderStage`, `_renderSidePreview`
resolves the candidate list, picks the active index, renders the pill
row (if needed) + the active candidate's body, and updates the cache.

Cache keyed by (depth, contextTitle, templateTitle) — switching pills
re-renders (different template), but typing inside the active body
reuses the cached widget tree and dispatches `refresh(changes)` into it.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

// Palette variables injected into the filter lab (and into every filter /
// action eval via buildStageVariables in cp-actions.js). This list is the
// single source of truth for the lab's "vars in scope" index.
//
// MAINTENANCE CONTRACT: whenever a new variable is added to
// buildStageVariables, add a row here so the lab documents it. See memory
// [[cascade-palette-filter-lab]].
var FILTER_LAB_VARS = [
    ["query", "current palette query text"],
    ["picked", "selected entity (this stage)"],
    ["parent-picked", "entity the current menu drilled from"],
    ["currentTiddler", "preview context (deepest pinned)"],
    ["context-tiddler", "active context tiddler"],
    ["sticky-context-list", "pinned context titles (TW list)"],
    ["sticky-context-count", "number of pinned titles"],
    ["stage-preview-context", "deepest stage preview context"],
    ["stage-N-picked", "pick at stack depth N (0-based)"]
];

module.exports = function (proto) {

    // Resolve the active context for the preview pane. Walks the stack
    // top-down, picking the first stage that signals preview interest.
    // A stage qualifies via either:
    //
    //   Explicit signal — any of:
    //     _previewTemplate  (per-menu candidate stamped at drill-time)
    //     _previewPerRow    (opt-in to tag-based per-row preview)
    //     _previewContext   (explicit context for tag-based candidates)
    //
    //   Auto-open fallback — no explicit signal, but the stage's view
    //     allows side preview (ca-view-show-side-preview: yes/default)
    //     AND the stage has a selected row with a title. The pane treats
    //     the row title as the context; tag-based candidates whose
    //     `ca-preview-applies` matches will then surface. When no tag
    //     candidate matches, `_resolvePreviewCandidates` returns empty
    //     and `_renderSidePreview` hides the pane — no placeholder.
    //
    // Per-row stages (explicit) and auto-open at the TOP stage re-resolve
    // the context to the currently-selected row (live ↑/↓ tracking).
    // Deeper stages return their stage-time pinned row, locking the
    // preview to the entity the user drilled into (action menus etc.).
    proto._activePreviewContext = function () {
        if (!this.stack) return { context: "", depth: -1, stage: null };
        for (var i = this.stack.length - 1; i >= 0; i--) {
            var s = this.stack[i];
            if (!s) continue;
            var hasMenu = !!s._previewTemplate;
            var hasPerRow = !!s._previewPerRow;
            var hasCtx = !!s._previewContext;
            // Explicit-signal path — original behaviour.
            if (hasMenu || hasPerRow || hasCtx) {
                var context = s._previewContext || "";
                if (hasPerRow && i === this.stack.length - 1 &&
                    s.results && s.results.length > 0 &&
                    s.selectedIndex >= 0 && s.selectedIndex < s.results.length) {
                    var row = s.results[s.selectedIndex];
                    if (row && row.title) context = row.title;
                }
                // Tag-only stages with no resolvable context can't surface
                // any candidates — skip up to the next stage. Menu stages
                // proceed even with empty context (the template renders
                // without a currentTiddler binding).
                if (!hasMenu && !context) continue;
                return { context: context, depth: i, stage: s };
            }
            // Auto-open fallback. Pane opens whenever the active view
            // doesn't opt out and the selected row has a title; the
            // candidate-list emptiness check downstream handles the
            // "nothing to render" case by hiding the pane. Skipped on
            // stages whose rows aren't entities (action menus, confirm
            // stages) — walk past them to find the entity-bearing stage
            // further down, so action-menu navigation doesn't re-anchor
            // the preview to action titles.
            if (s.kind !== "actions" && s.kind !== "confirm" &&
                this._stageAllowsAutoOpenSidePreview(s) &&
                s.results && s.results.length > 0 &&
                s.selectedIndex >= 0 && s.selectedIndex < s.results.length) {
                var topRow = s.results[s.selectedIndex];
                var topTitle = (topRow && topRow.title) || "";
                // A selected row carrying its own preview template anchors the
                // pane even with an empty title (synthetic "Overview" rows have
                // no title) — there the explicit template, not the context,
                // drives the render.
                if (topTitle || (topRow && topRow.previewTemplate)) {
                    return { context: topTitle, depth: i, stage: s };
                }
            }
        }
        return { context: "", depth: -1, stage: null };
    };

    // Per-view opt-out gate for the auto-open fallback. Walks the stack
    // upward from the given stage looking for the nearest `viewTitle`
    // (root + tree stages carry it; filter / action / confirm stages
    // inherit). Falls back to `this.activeView`. Permissive default —
    // unknown views are treated as allowing the pane.
    proto._stageAllowsAutoOpenSidePreview = function (stage) {
        if (!stage) return false;
        var viewTitle = stage.viewTitle || null;
        if (!viewTitle && this.stack) {
            for (var i = this.stack.length - 1; i >= 0; i--) {
                if (this.stack[i] && this.stack[i].viewTitle) {
                    viewTitle = this.stack[i].viewTitle;
                    break;
                }
            }
        }
        viewTitle = viewTitle || this.activeView;
        if (!viewTitle) return true;
        var view = this._getViewByTitle && this._getViewByTitle(viewTitle);
        if (!view) return true;
        return view.showSidePreview !== false;
    };

    // True when ↑/↓ on the top stage should re-render the side preview
    // because the context tracks the row. Two cases: explicit per-row
    // opt-in, OR auto-open is active at the top stage (which is
    // inherently per-row — the synthetic context IS the selected row).
    // Returns false on action / confirm tops since their rows aren't
    // entities — the preview there is anchored to a deeper stage and
    // doesn't move with top selection.
    proto._shouldRerenderPreviewOnRowChange = function () {
        var top = this.stack && this.stack[this.stack.length - 1];
        if (!top) return false;
        if (top._previewPerRow) return true;
        var hasMenu = !!top._previewTemplate;
        var hasCtx = !!top._previewContext;
        if (hasMenu || hasCtx) return false;
        if (top.kind === "actions" || top.kind === "confirm") return false;
        return this._stageAllowsAutoOpenSidePreview(top);
    };

    // Load tag-registered preview candidates once per wiki-change cycle.
    // Each tagged tiddler is a single registration whose body is also
    // the template (no separate "registration tiddler" needed). Cached
    // by `wiki.getChangeCount()` so repeated renders are O(1).
    proto._loadTaggedPreviews = function () {
        var cc = (this.wiki.getChangeCount && this.wiki.getChangeCount()) || 0;
        if (this._taggedPreviewsCache &&
            this._taggedPreviewsCache.changeCount === cc) {
            return this._taggedPreviewsCache.entries;
        }
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + C.SIDE_PREVIEW_TAG + "]]"
        );
        var entries = [];
        for (var i = 0; i < titles.length; i++) {
            var t = this.wiki.getTiddler(titles[i]);
            if (!t) continue;
            var f = t.fields || {};
            var template = f["ca-preview-template"] || titles[i];
            var applies = f["ca-preview-applies"] || "";
            var name = f["ca-preview-name"] || "";
            var titleCap = f["ca-preview-title"] || "";
            var order = parseFloat(f["ca-preview-order"]);
            if (isNaN(order)) order = 100;
            entries.push({
                source: titles[i],
                template: template,
                applies: applies,
                name: name,
                title: titleCap,
                order: order
            });
        }
        entries.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.source < b.source ? -1 : 1;
        });
        this._taggedPreviewsCache = { changeCount: cc, entries: entries };
        return entries;
    };

    // Filter tagged previews by their `ca-preview-applies` against the
    // current context. Empty applies = always applies. Result is the
    // subset of tagged candidates that should appear as pills.
    proto._applicableTaggedPreviews = function (context) {
        var all = this._loadTaggedPreviews();
        if (!all.length) return [];
        var hits = [];
        for (var i = 0; i < all.length; i++) {
            var e = all[i];
            if (!e.applies) { hits.push(e); continue; }
            if (!context) continue; // applies declared, no context to test against
            try {
                var res = this._filterInScope(e.applies, { currentTiddler: context });
                if (res && res.length) hits.push(e);
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] ca-preview-applies filter error on",
                        e.source, "—", err && err.message
                    );
                }
            }
        }
        return hits;
    };

    // Resolve the full candidate list for the active stage. The first
    // entry (if any) is the per-menu declaration; subsequent entries
    // are tag-matched candidates. Dedup by template title (so a tag
    // candidate that names the same template as the menu doesn't show
    // a duplicate pill).
    // Preview candidate contributed by a stage's CURRENTLY-SELECTED row when
    // that row carries its own `ca-preview-template` (item.previewTemplate).
    // Surfaces on mere selection (↑/↓), not only on drill — so synthetic
    // "Overview" rows (and any row with an authored preview) render in the
    // pane the moment they're focused. Returns null when the selected row has
    // no template. Context defaults to the row title; `ca-preview-context`,
    // when set, is resolved as a filter (first result) just like the
    // drill-time path.
    proto._selectedRowPreview = function (stage) {
        if (!stage || !stage.results || !stage.results.length) return null;
        var idx = stage.selectedIndex;
        if (idx < 0 || idx >= stage.results.length) return null;
        var row = stage.results[idx];
        if (!row || !row.previewTemplate) return null;
        var context = row.title || "";
        if (row.previewContext) {
            try {
                var res = this._filterInScope(row.previewContext,
                    { currentTiddler: row.title || "" });
                if (res && res.length) context = res[0];
            } catch (err) {
                if (console && console.warn) {
                    console.warn(
                        "[cascade-palette] row ca-preview-context filter error on",
                        row.title, "—", err && err.message
                    );
                }
            }
        }
        return {
            template: row.previewTemplate,
            context: context,
            title: row.previewTitle || "",
            name: row.previewName || this._defaultPreviewName(row.previewTemplate)
        };
    };

    proto._resolvePreviewCandidates = function () {
        var active = this._activePreviewContext();
        if (active.depth < 0) {
            return { candidates: [], context: "", depth: -1, stage: null };
        }
        var candidates = [];
        var seen = {};
        var s = active.stage;
        // Selected-row template (e.g. a synthetic Overview row) leads the list.
        var rowPrev = this._selectedRowPreview(s);
        if (rowPrev) {
            candidates.push({
                template: rowPrev.template,
                context: rowPrev.context,
                title: rowPrev.title,
                name: rowPrev.name,
                fromTag: false,
                source: ""
            });
            seen[rowPrev.template] = true;
        }
        if (s._previewTemplate && !seen[s._previewTemplate]) {
            var menuName = s._previewMenuName || s._previewTitle ||
                this._defaultPreviewName(s._previewTemplate);
            candidates.push({
                template: s._previewTemplate,
                context: active.context,
                title: s._previewTitle || "",
                name: menuName,
                fromTag: false,
                source: ""
            });
            seen[s._previewTemplate] = true;
        }
        var tagged = this._applicableTaggedPreviews(active.context);
        for (var i = 0; i < tagged.length; i++) {
            var e = tagged[i];
            if (seen[e.template]) continue;
            candidates.push({
                template: e.template,
                context: active.context,
                title: e.title,
                name: e.name || this._defaultPreviewName(e.template),
                fromTag: true,
                source: e.source
            });
            seen[e.template] = true;
        }
        // Resolve activeIdx — prefer matching by stable template title
        // so the user's chosen pill survives candidate-list reshuffles
        // (per-row context change drops some candidates; a higher-order
        // plugin appears and re-orders). Fall back to the index if no
        // template is stashed (first resolve) or the stashed template
        // no longer applies.
        var idx = 0;
        var pinned = s._previewActiveTemplate;
        if (pinned) {
            for (var k = 0; k < candidates.length; k++) {
                if (candidates[k].template === pinned) { idx = k; break; }
            }
        } else {
            idx = s._previewActiveIdx || 0;
            if (idx < 0 || idx >= candidates.length) idx = 0;
        }
        return {
            candidates: candidates,
            context: active.context,
            depth: active.depth,
            stage: s,
            activeIdx: idx
        };
    };

    // Derive a sensible pill label from a template title when no
    // `ca-preview-name` was authored. Takes the last path segment and
    // strips a leading "preview-" / "preview/" if present, so
    // `$:/plugins/foo/preview/instance-view` → "instance-view".
    proto._defaultPreviewName = function (templateTitle) {
        if (!templateTitle) return "Preview";
        var slash = templateTitle.lastIndexOf("/");
        var leaf = slash >= 0 ? templateTitle.substring(slash + 1) : templateTitle;
        if (leaf.indexOf("preview-") === 0) leaf = leaf.substring(8);
        return leaf || "Preview";
    };

    // Render the active preview into `this.sidePreviewEl`. Called from
    // `renderStage` after the cascade redraws. When no candidate
    // applies, the pane is hidden and the cascade column fills the
    // popup again.
    proto._renderSidePreview = function () {
        if (!this.popupEl || !this.sidePreviewEl) return;
        // A direct render supersedes any debounced row-change render
        // (cp-rendering._scheduleRowChangePreview) — clear it so the
        // queued timer can't fire a redundant pass afterward.
        if (this._previewDebounceTimer) {
            clearTimeout(this._previewDebounceTimer);
            this._previewDebounceTimer = null;
        }
        // While editing a filter facet the pane hosts the independent
        // "filter lab" sandbox instead of the normal candidate preview.
        if (this._filterLabActive()) {
            this._renderFilterLab();
            return;
        }
        var resolved = this._resolvePreviewCandidates();
        var candidates = resolved.candidates;
        if (!candidates.length) {
            this._hideSidePreview();
            return;
        }
        var active = candidates[resolved.activeIdx];

        // Render or update the pill row. Hidden via :empty when only
        // one candidate applies — the user gets the same pane as before
        // the multi-candidate feature.
        if (this.sidePreviewPillsEl) {
            while (this.sidePreviewPillsEl.firstChild) {
                this.sidePreviewPillsEl.removeChild(this.sidePreviewPillsEl.firstChild);
            }
            if (candidates.length > 1) {
                var self = this;
                candidates.forEach(function (c, idx) {
                    var pill = self.document.createElement("button");
                    pill.className = "rcp-preview-pill" +
                        (idx === resolved.activeIdx ? " rcp-preview-pill-active" : "");
                    pill.type = "button";
                    pill.textContent = c.name || "?";
                    pill.title = c.title || c.template;
                    pill.setAttribute("data-idx", String(idx));
                    pill.addEventListener("click", function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._setPreviewActiveIdx(idx);
                    });
                    self.sidePreviewPillsEl.appendChild(pill);
                });
            }
        }

        // Title row — optional caption authored on the active candidate.
        // Empty string keeps the row hidden via the `:empty` CSS selector.
        if (this.sidePreviewTitleEl) {
            this.sidePreviewTitleEl.textContent = active.title || "";
        }

        // Cache hit: reuse the rendered DOM verbatim. Cache key now
        // includes the active TEMPLATE so switching pills re-renders.
        var cache = this._sidePreviewCache;
        if (cache && cache.depth === resolved.depth &&
            cache.context === active.context &&
            cache.template === active.template &&
            cache.dom && cache.dom.parentNode === this.sidePreviewBodyEl) {
            this.popupEl.classList.add("rcp-showing-preview");
            return;
        }
        // Clear the body and render fresh.
        while (this.sidePreviewBodyEl.firstChild) {
            this.sidePreviewBodyEl.removeChild(this.sidePreviewBodyEl.firstChild);
        }
        var container = this.document.createElement("div");
        container.className = "rcp-preview-pane-template";
        var widgetNode = null;
        try {
            var parser = this.wiki.parseTiddler(active.template);
            if (!parser) {
                container.textContent = "(preview template not found: " +
                    active.template + ")";
            } else {
                widgetNode = this.wiki.makeWidget(parser, {
                    parentWidget: this.findActionParent() || $tw.rootWidget,
                    document: this.document,
                    variables: { currentTiddler: active.context }
                });
                widgetNode.render(container, null);
            }
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] side preview render error",
                    active.template, "—", err && err.message
                );
            }
            container.textContent = "(preview render error: " +
                (err && err.message) + ")";
        }
        this.sidePreviewBodyEl.appendChild(container);
        // Stash the widget tree on the cache so the wiki change hook can
        // dispatch refresh into it. The tree is built via wiki.makeWidget
        // — that does NOT auto-subscribe to the rootWidget's refresh
        // cycle (the new widget is a standalone tree, not a real child of
        // the rootWidget). Without an explicit refresh, the inputs inside
        // keep typing (they own their own DOM) but any reactive nodes
        // around them — conditionals, computed expressions, validation
        // hints — never re-evaluate. We refresh from the change hook
        // for non-template/non-context changes (template/context changes
        // force a full rebuild instead).
        this._sidePreviewCache = {
            depth: resolved.depth,
            context: active.context,
            template: active.template,
            dom: container,
            widgetNode: widgetNode
        };
        this.popupEl.classList.add("rcp-showing-preview");
    };

    // ===================================================================
    // Filter lab — independent AdvancedSearch-style sandbox
    // ===================================================================
    //
    // Shown in the side-preview while editing a filter facet. It is fully
    // decoupled from the palette input: its own <$edit-text> writes a
    // scratch state tiddler, and a <$list>/<$count> over `subfilter{state}`
    // re-evaluates live (the wiki change hook dispatches refresh into this
    // widget tree — see _refreshSidePreviewOnChange). Palette stage
    // variables (<<sticky-context-list>>, <<context-tiddler>>, …) are
    // injected so trial filters behave exactly as they will in the field.
    // The user copies a working filter back into the palette input by hand.

    proto._filterLabActive = function () {
        return !!(this.editMode && this.editMode.editKind === "filter");
    };

    // Build the collapsible "vars in scope" index (top-right) from
    // FILTER_LAB_VARS. Variable names are HTML-escaped so `<<name>>` shows
    // literally instead of being expanded by the wikitext parser.
    proto._filterLabVarsIndex = function () {
        var rows = FILTER_LAB_VARS.map(function (v) {
            return "<div class=\"rcp-filter-lab-var\">" +
                "<code>&lt;&lt;" + v[0] + "&gt;&gt;</code> " +
                "<span>" + v[1] + "</span></div>";
        }).join("\n");
        return "<details class=\"rcp-filter-lab-vars\">" +
            "<summary>vars in scope</summary>" +
            "<div class=\"rcp-filter-lab-vars-body\">\n" + rows +
            "\n</div></details>";
    };

    proto._filterLabWikitext = function () {
        var s = C.FILTER_LAB_STATE;
        return [
            "\\whitespace trim",
            "<div class=\"rcp-filter-lab\">",
            this._filterLabVarsIndex(),
            "<div class=\"rcp-filter-lab-hint\">Independent filter sandbox — " +
                "palette variables (see top right) are in scope. Copy a " +
                "working filter into the palette input.</div>",
            "<div class=\"rcp-filter-lab-input-row\">" +
                "<$edit-text tiddler=\"" + s + "\" tag=\"input\" type=\"search\" " +
                "class=\"rcp-filter-lab-input\" " +
                "placeholder=\"Try a filter, e.g. [tag[done]]\"/></div>",
            "<div class=\"rcp-filter-lab-count\">" +
                "<$count filter=\"[subfilter{" + s + "}]\"/> match(es)" +
                "<$list filter=\"[subfilter{" + s + "}count[]" +
                "compare:integer:gt[250]]\" variable=\"_\"> · first 250 shown" +
                "</$list></div>",
            "<ul class=\"rcp-filter-lab-list\">",
            "<$list filter=\"[subfilter{" + s + "}limit[250]]\" " +
                "variable=\"labitem\">",
            "<li class=\"rcp-filter-lab-row\"><$text text=<<labitem>>/></li>",
            "</$list>",
            "</ul>",
            "</div>"
        ].join("\n");
    };

    // Prepend a native "copy to palette input" button into the lab's input
    // row. Built in JS (not wikitext) because it pokes the palette input
    // (this.inputEl) directly — copying the lab's current value over and
    // re-triggering the live match-count, so the user can commit it.
    proto._injectFilterLabCopyButton = function (container) {
        if (!container || !container.querySelector) return;
        var row = container.querySelector(".rcp-filter-lab-input-row");
        if (!row) return;
        var self = this;
        var btn = this.document.createElement("button");
        btn.type = "button";
        btn.className = "rcp-filter-lab-copy";
        btn.textContent = "←"; // ← : send leftward to the palette input
        btn.title = "Copy this filter into the palette input";
        btn.setAttribute("aria-label", "Copy filter into palette input");
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            var txt = self.wiki.getTiddlerText(C.FILTER_LAB_STATE, "");
            self.inputEl.value = txt;
            self.inputEl.focus();
            // Re-run the live match-count / validation bound to the input.
            try {
                self.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            } catch (err) {
                if (self.editMode && self.editMode.matchListener) {
                    self.editMode.matchListener();
                }
            }
        });
        row.insertBefore(btn, row.firstChild);
    };

    proto._renderFilterLab = function () {
        if (!this.popupEl || !this.sidePreviewBodyEl) return;
        // Idempotent: if the lab tree is already mounted, leave it in place.
        // The change hook refreshes it live; rebuilding would reset the
        // input and steal the caret mid-type.
        var cache = this._sidePreviewCache;
        if (cache && cache.kind === "filter-lab" && cache.dom &&
            cache.dom.parentNode === this.sidePreviewBodyEl) {
            this.popupEl.classList.add("rcp-showing-preview");
            return;
        }
        if (this.sidePreviewTitleEl) {
            this.sidePreviewTitleEl.textContent = "Filter lab";
        }
        if (this.sidePreviewPillsEl) {
            while (this.sidePreviewPillsEl.firstChild) {
                this.sidePreviewPillsEl.removeChild(this.sidePreviewPillsEl.firstChild);
            }
        }
        while (this.sidePreviewBodyEl.firstChild) {
            this.sidePreviewBodyEl.removeChild(this.sidePreviewBodyEl.firstChild);
        }
        var container = this.document.createElement("div");
        container.className = "rcp-preview-pane-template";
        var widgetNode = null;
        try {
            var parser = this.wiki.parseText(
                "text/vnd.tiddlywiki", this._filterLabWikitext());
            var vars = this.buildStageVariables(this.topStage());
            vars.currentTiddler =
                vars["stage-preview-context"] || vars["parent-picked"] || "";
            widgetNode = this.wiki.makeWidget(parser, {
                parentWidget: this.findActionParent() || $tw.rootWidget,
                document: this.document,
                variables: vars
            });
            widgetNode.render(container, null);
            this._injectFilterLabCopyButton(container);
        } catch (err) {
            if (console && console.warn) {
                console.warn("[cascade-palette] filter lab render error —",
                    err && err.message);
            }
            container.textContent =
                "(filter lab render error: " + (err && err.message) + ")";
        }
        this.sidePreviewBodyEl.appendChild(container);
        // Sentinel context/template so a later normal render never mistakes
        // this for a cache hit (it rebuilds the candidate preview instead).
        this._sidePreviewCache = {
            kind: "filter-lab", dom: container, widgetNode: widgetNode,
            depth: -1, context: " filter-lab", template: " filter-lab"
        };
        this.popupEl.classList.add("rcp-showing-preview");
    };

    // Switch the active preview candidate on the topmost preview-
    // bearing stage. Bounded — wraps around when stepping past either
    // end so ←/← from the first pill lands on the last (and vice versa).
    proto._setPreviewActiveIdx = function (idx) {
        var resolved = this._resolvePreviewCandidates();
        if (!resolved.candidates.length) return;
        var n = resolved.candidates.length;
        if (idx < 0) idx = n - 1;
        if (idx >= n) idx = 0;
        resolved.stage._previewActiveIdx = idx;
        // Pin the template so re-resolution after candidate-list churn
        // keeps the user on the same preview by name, not index.
        resolved.stage._previewActiveTemplate = resolved.candidates[idx].template;
        this._invalidateSidePreviewCache();
        this._renderSidePreview();
    };

    proto._cyclePreviewActive = function (delta) {
        var resolved = this._resolvePreviewCandidates();
        if (resolved.candidates.length < 2) return;
        var n = resolved.candidates.length;
        var idx = (resolved.activeIdx + delta + n) % n;
        this._setPreviewActiveIdx(idx);
    };

    // Dispatch wiki changes into the cached preview widget tree so
    // reactive nodes (conditionals, computed text, validation rows)
    // update in place. Called from the wiki change hook when the
    // change did NOT touch the template/context tiddler (those
    // invalidate the cache and force a full rebuild instead).
    proto._refreshSidePreviewOnChange = function (changes) {
        var cache = this._sidePreviewCache;
        if (!cache || !cache.widgetNode) return;
        try {
            cache.widgetNode.refresh(changes);
        } catch (err) {
            if (console && console.warn) {
                console.warn(
                    "[cascade-palette] side preview refresh error",
                    cache.template, "—", err && err.message
                );
            }
        }
    };

    // True when a keystroke originates from an interactive widget
    // inside the side-preview pane (form input, button, link, …) —
    // the cascade's global keydown handler should let it through so
    // Enter / Space / arrows reach the widget natively. Escape is
    // excluded so the user can always pop focus back to the cascade
    // input from inside the preview. Preview-pane pills are intentionally
    // NOT excluded here (they're <button>s but the cascade handles ←/→
    // via _handleKeydownPreview to keep behaviour symmetric with click).
    proto._keydownTargetIsInsidePreviewWidget = function (e) {
        if (e.key === "Escape") return false;
        if (!this.sidePreviewEl) return false;
        var tgt = e.target;
        if (!tgt || !this.sidePreviewEl.contains(tgt)) return false;
        if (tgt === this.sidePreviewEl ||
            tgt === this.sidePreviewBodyEl ||
            tgt === this.sidePreviewTitleEl ||
            tgt === this.sidePreviewPillsEl) return false;
        // Pills are buttons; we drive them via ←/→ in _handleKeydownPreview
        // rather than letting the native Enter activate them.
        if (this.sidePreviewPillsEl &&
            this.sidePreviewPillsEl.contains(tgt)) return false;
        var tag = (tgt.tagName || "").toLowerCase();
        return tag === "input" || tag === "textarea" || tag === "select" ||
               tag === "button" || tag === "a" ||
               tgt.isContentEditable === true;
    };

    proto._hideSidePreview = function () {
        if (!this.popupEl) return;
        this.popupEl.classList.remove("rcp-showing-preview");
        if (this.sidePreviewTitleEl) {
            this.sidePreviewTitleEl.textContent = "";
        }
        if (this.sidePreviewPillsEl) {
            while (this.sidePreviewPillsEl.firstChild) {
                this.sidePreviewPillsEl.removeChild(this.sidePreviewPillsEl.firstChild);
            }
        }
        if (this.sidePreviewBodyEl) {
            while (this.sidePreviewBodyEl.firstChild) {
                this.sidePreviewBodyEl.removeChild(this.sidePreviewBodyEl.firstChild);
            }
        }
        this._sidePreviewCache = null;
        // If preview had focus when it hid, redirect to input so the
        // user isn't stranded on a hidden section.
        if (this.focus === "preview") this.setFocus("input");
    };

    proto._invalidateSidePreviewCache = function () {
        this._sidePreviewCache = null;
    };

    // True iff the side preview pane is currently visible.
    proto._isSidePreviewVisible = function () {
        return !!(this.popupEl && this.popupEl.classList &&
                  this.popupEl.classList.contains("rcp-showing-preview"));
    };

    // True iff the active preview has more than one candidate pill.
    // Used by the hint footer to swap in the ←→-switch text.
    proto._previewHasMultipleCandidates = function () {
        if (!this._isSidePreviewVisible()) return false;
        var resolved = this._resolvePreviewCandidates();
        return resolved.candidates.length > 1;
    };

    // Keyboard handler when focus is on the preview pane. Esc returns
    // to input; ←/→ cycle between preview pill candidates (when more
    // than one applies); arrow up/down let the browser scroll natively.
    // The pane is interactive — form widgets inside the rendered
    // template handle their own keys via event bubbling (the global
    // keydown listener short-circuits via _keydownTargetIsInsidePreviewWidget
    // when the target is a focusable form element).
    proto._handleKeydownPreview = function (e) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        if (e.key === "ArrowLeft") {
            if (this._previewHasMultipleCandidates()) {
                e.preventDefault();
                this._cyclePreviewActive(-1);
            }
            return;
        }
        if (e.key === "ArrowRight") {
            if (this._previewHasMultipleCandidates()) {
                e.preventDefault();
                this._cyclePreviewActive(1);
            }
            return;
        }
        // ArrowUp / ArrowDown / PageUp / PageDown — native scroll.
    };

};
