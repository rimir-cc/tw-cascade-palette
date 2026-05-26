/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-side-preview
type: application/javascript
module-type: library

Side preview pane — right-column wikitext rendering attached to a stage.

An entry/action tiddler can declare three optional fields:

    ca-preview-template   title of a wikitext tiddler whose body is
                          rendered in the right pane when the user drills
                          into the row. Required to enable the feature.
    ca-preview-context    filter evaluated at drill-time in the parent
                          stage's substitution scope (<<picked>>,
                          <<parent-picked>>, <<query>>, ...). The first
                          result becomes <<currentTiddler>> inside the
                          template AND is exposed to deeper stages as
                          <<stage-preview-context>>. Defaults to the
                          drilled row's title.
    ca-preview-title      optional caption shown above the preview body.

The drill-site code (`drillSelected`, Space gesture in cp-keyboard) calls
`_attachPreviewToStage` to stamp `_previewTemplate`, `_previewContext`,
and `_previewTitle` onto the newly-built stage record. After every
stage push/pop and after `renderStage`, `_renderSidePreview` walks the
stack top-down via `_activePreview` to find the topmost stage carrying
a preview and renders it into the right pane. Stages pushed deeper than
the preview-bearing stage inherit it — the user "stays in" the original
preview context.

Cached by (depth, contextTitle, templateTitle) so keystroke-driven
re-renders within the same preview reuse the rendered DOM. Invalidated
by the wiki change hook when either the template tiddler or the
context tiddler changes.

\*/
"use strict";

module.exports = function (proto) {

    // Return the topmost stage on the stack carrying a non-empty
    // `_previewTemplate`, or null if none. Iterates from the top so
    // that a deeper-pushed preview-bearing stage wins over a shallower
    // one (rare, but well-defined).
    proto._activePreview = function () {
        if (!this.stack) return null;
        for (var i = this.stack.length - 1; i >= 0; i--) {
            var s = this.stack[i];
            if (s && s._previewTemplate) {
                var context = s._previewContext || "";
                // Per-row opt-in: when the stage carries `_previewPerRow`,
                // re-resolve the context to the title of the currently-
                // selected row instead of the stage's stamped context.
                // Falls back to the stamped context for empty selection
                // (selectedIndex out of range / synthetic row with no
                // backing title). Applies to the TOP stage only — deeper
                // inherited previews keep their stage-level context.
                if (s._previewPerRow && i === this.stack.length - 1 &&
                    s.results && s.results.length > 0 &&
                    s.selectedIndex >= 0 && s.selectedIndex < s.results.length) {
                    var row = s.results[s.selectedIndex];
                    if (row && row.title) {
                        context = row.title;
                    }
                }
                return {
                    depth: i,
                    template: s._previewTemplate,
                    context: context,
                    title: s._previewTitle || ""
                };
            }
        }
        return null;
    };

    // Render the active preview into `this.sidePreviewEl`. Called from
    // `renderStage` after the cascade redraws. When no preview is
    // active (no stage on the stack carries `_previewTemplate`), the
    // pane is hidden and the cascade column fills the popup again.
    proto._renderSidePreview = function () {
        if (!this.popupEl || !this.sidePreviewEl) return;
        var active = this._activePreview();
        if (!active) {
            this._hideSidePreview();
            return;
        }
        // Title row — optional caption authored on the entry. Empty
        // string keeps the row hidden via the `:empty` CSS selector.
        if (this.sidePreviewTitleEl) {
            this.sidePreviewTitleEl.textContent = active.title || "";
        }
        // Cache hit: reuse the rendered DOM verbatim. Cache key includes
        // the stack depth so a re-attached preview at a different depth
        // gets a fresh render (defensive — the same context+template at
        // a different depth could legitimately render differently if the
        // wikitext consults stack-level state).
        var cache = this._sidePreviewCache;
        if (cache && cache.depth === active.depth &&
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
            depth: active.depth,
            context: active.context,
            template: active.template,
            dom: container,
            widgetNode: widgetNode
        };
        this.popupEl.classList.add("rcp-showing-preview");
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
    // input from inside the preview.
    proto._keydownTargetIsInsidePreviewWidget = function (e) {
        if (e.key === "Escape") return false;
        if (!this.sidePreviewEl) return false;
        var tgt = e.target;
        if (!tgt || !this.sidePreviewEl.contains(tgt)) return false;
        if (tgt === this.sidePreviewEl ||
            tgt === this.sidePreviewBodyEl ||
            tgt === this.sidePreviewTitleEl) return false;
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

    // Keyboard handler when focus is on the preview pane. Esc returns
    // to input; arrows let the browser scroll natively (no
    // preventDefault). The pane is interactive — widgets inside the
    // rendered template handle their own keys via event bubbling.
    proto._handleKeydownPreview = function (e) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.setFocus("input");
            return;
        }
        // ArrowUp / ArrowDown / PageUp / PageDown — native scroll.
    };

};
