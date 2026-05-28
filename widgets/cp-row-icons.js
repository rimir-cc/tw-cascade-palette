/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-row-icons
type: application/javascript
module-type: library

Row-icon subsystem — small glyphs rendered beneath tiddler-bearing rows
to surface external affordances (URLs, attachments, …) without
cluttering the row's main line.

Each glyph is declared as a tiddler tagged
$:/tags/rimir/cascade-palette/row-icon with:

  ca-row-icon-key       Symbolic id ("url", "attachment", …). The key
                        `url` triggers the built-in field-scanning
                        resolver (reads the URL_FIELDS_CONFIG list);
                        other keys rely on the filter fields below.
  ca-row-icon-glyph     The displayed character / emoji.
  ca-row-icon-hint      Tooltip text. Shown on hover.
  ca-row-icon-applies   Optional filter — `<currentTiddler>` is the
                        row's tiddler title. Non-empty result = icon
                        shows. Ignored for the built-in `url` key.
  ca-row-icon-payload   Optional filter — `<currentTiddler>` is the
                        row's tiddler title. First result is bound to
                        `<<payload>>` when the icon fires. The built-in
                        `url` key sets payload from the URL_FIELDS_CONFIG
                        scan and ignores this field.
  ca-row-icon-action    Optional wikitext actions. Fired via the host
                        widget's `invokeViaNavigator` with `<<payload>>`
                        and the standard stage variables.
  ca-row-icon-message   Optional built-in dispatch key. Currently
                        recognised: "open-url" — opens `<<payload>>`
                        in a new browser tab. Falls back to `action`
                        when set; both run if both are present.
  ca-row-icon-primary   "yes" = preferred target for the row-level
                        Alt-↵ keyboard gesture when multiple icons
                        apply. First-seen wins ties; if no icon is
                        flagged primary, the first applicable icon
                        is the target.
  ca-row-icon-order     Display order in the strip (numeric, lower
                        first; default 100).

Two read paths share this module:
  - `_buildItemRowIcons(item)` — called during result rendering to
    compute the per-item icon list (cached on the item).
  - `fireRowIcon(item, icon, opts)` — called by the Alt-↵ keyboard
    branch and by per-glyph clicks; dispatches the icon's action /
    message and stops the event so the row's primary fire path does
    not also run.

\*/
"use strict";

var C = require("$:/plugins/rimir/cascade-palette/widgets/cp-constants");

var URL_PROTOCOL_RE = /^(?:https?|ftp|ftps|mailto|tel):/i;

module.exports = function (proto) {

    /* ---------- registry loading + caching ---------- */

    // Load all row-icon-tagged tiddlers and project to a sorted list of
    // icon defs. Cached by wiki.getChangeCount(); the change-hook in
    // cascade-palette-widget.js drops the cache when any row-icon-tagged
    // tiddler is created / modified / deleted.
    proto._loadRowIcons = function () {
        var cc = (this.wiki.getChangeCount && this.wiki.getChangeCount()) || 0;
        if (this._rowIconsCache && this._rowIconsCache.changeCount === cc) {
            return this._rowIconsCache.entries;
        }
        var titles = this.wiki.filterTiddlers(
            "[all[shadows+tiddlers]tag[" + C.ROW_ICON_TAG + "]!has[draft.of]]"
        );
        var entries = [];
        for (var i = 0; i < titles.length; i++) {
            var t = this.wiki.getTiddler(titles[i]);
            if (!t) continue;
            var f = t.fields || {};
            var order = parseFloat(f["ca-row-icon-order"]);
            if (isNaN(order)) order = 100;
            entries.push({
                title:   titles[i],
                key:     f["ca-row-icon-key"]     || "",
                glyph:   f["ca-row-icon-glyph"]   || "•",
                hint:    f["ca-row-icon-hint"]    || "",
                applies: f["ca-row-icon-applies"] || "",
                payload: f["ca-row-icon-payload"] || "",
                action:  f["ca-row-icon-action"]  || "",
                message: f["ca-row-icon-message"] || "",
                primary: (f["ca-row-icon-primary"] || "").toLowerCase() === "yes",
                order:   order
            });
        }
        entries.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return a.title < b.title ? -1 : 1;
        });
        this._rowIconsCache = { changeCount: cc, entries: entries };
        return entries;
    };

    proto._invalidateRowIconsCache = function () {
        this._rowIconsCache = null;
    };

    /* ---------- URL resolution (built-in `url` key) ---------- */

    proto._urlFieldsList = function () {
        var raw = (this.wiki.getTiddlerText(C.URL_FIELDS_CONFIG, "url") || "").trim();
        var parts = raw.split(/\s+/);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            if (parts[i]) out.push(parts[i]);
        }
        return out.length ? out : ["url"];
    };

    proto._resolveUrlForTitle = function (title) {
        if (!title) return "";
        var t = this.wiki.getTiddler(title);
        if (!t) return "";
        var fields = this._urlFieldsList();
        for (var i = 0; i < fields.length; i++) {
            var v = t.fields[fields[i]];
            if (typeof v !== "string") continue;
            var trimmed = v.trim();
            if (trimmed && URL_PROTOCOL_RE.test(trimmed)) return trimmed;
        }
        return "";
    };

    /* ---------- per-item icon list ---------- */

    // Compute the visible row-icon list for an item. Returns [] when the
    // item has no backing tiddler (synthetic rows, root entries, etc.).
    // Result is shaped { key, glyph, hint, payload, action, message,
    // primary, source } per icon — payload pre-resolved so click /
    // keyboard dispatch is variable-free.
    proto.computeRowIconsForItem = function (item) {
        if (!item || !item.isItem || !item.rawTitle) return [];
        var defs = this._loadRowIcons();
        if (!defs.length) return [];
        var title = item.rawTitle;
        var out = [];
        for (var i = 0; i < defs.length; i++) {
            var def = defs[i];
            var payload = "";
            if (def.key === "url") {
                payload = this._resolveUrlForTitle(title);
                if (!payload) continue;
            } else if (def.applies) {
                var hits;
                try {
                    hits = this.wiki.filterTiddlers(
                        def.applies,
                        this.makeFakeWidget({ currentTiddler: title })
                    );
                } catch (err) {
                    if (console && console.warn) {
                        console.warn(
                            "[cascade-palette] ca-row-icon-applies error on",
                            def.title, "—", err && err.message
                        );
                    }
                    continue;
                }
                if (!hits || !hits.length) continue;
                if (def.payload) {
                    try {
                        var pres = this.wiki.filterTiddlers(
                            def.payload,
                            this.makeFakeWidget({ currentTiddler: title })
                        );
                        payload = (pres && pres[0]) || "";
                    } catch (err2) {
                        if (console && console.warn) {
                            console.warn(
                                "[cascade-palette] ca-row-icon-payload error on",
                                def.title, "—", err2 && err2.message
                            );
                        }
                    }
                }
            } else {
                // No built-in handler and no applies filter — never shows.
                continue;
            }
            out.push({
                key:     def.key,
                glyph:   def.glyph,
                hint:    def.hint,
                payload: payload,
                action:  def.action,
                message: def.message,
                primary: def.primary,
                source:  def.title
            });
        }
        return out;
    };

    // The icon Alt-↵ targets when the row has multiple icons. Honours
    // `ca-row-icon-primary: yes`; falls back to the first applicable
    // icon (already in display order via `_loadRowIcons` sort).
    proto.primaryRowIcon = function (item) {
        var icons = item && item._rowIcons;
        if (!icons || !icons.length) return null;
        for (var i = 0; i < icons.length; i++) {
            if (icons[i].primary) return icons[i];
        }
        return icons[0];
    };

    /* ---------- firing ---------- */

    proto.fireRowIcon = function (item, icon, e) {
        if (!icon) return false;
        var fired = false;
        if (icon.message === "open-url") {
            this._openUrlInNewTab(icon.payload);
            fired = true;
        }
        if (icon.action) {
            var stage = this.topStage();
            var vars = stage
                ? this.buildStageVariables(stage, item && item.rawTitle)
                : { "query": "", "picked": "", "parent-picked": "", "context-tiddler": "" };
            vars["payload"] = icon.payload || "";
            vars["row-icon-key"] = icon.key || "";
            vars["currentTiddler"] = item && item.rawTitle ? item.rawTitle : "";
            this.invokeViaNavigator(icon.action, vars);
            fired = true;
        }
        if (fired && e && typeof e.stopPropagation === "function") {
            e.stopPropagation();
        }
        return fired;
    };

    proto._openUrlInNewTab = function (url) {
        if (!url) return;
        // window.open in some browsers returns null when popup-blocked.
        // We deliberately do NOT fall back to location.assign because
        // the user gesture for Alt-Enter / click is direct — modern
        // browsers allow the popup. If blocked, the user sees the
        // blocker UI and can permit it.
        var win = (this.document && this.document.defaultView) ||
            (typeof window !== "undefined" ? window : null);
        if (!win || typeof win.open !== "function") return;
        try {
            win.open(url, "_blank", "noopener,noreferrer");
        } catch (err) {
            if (console && console.warn) {
                console.warn("[cascade-palette] row-icon open-url failed —",
                    err && err.message);
            }
        }
    };

    /* ---------- DOM rendering ---------- */

    // Appends a footer strip to `rowEl` with one glyph per applicable
    // row-icon. No-op when no icons resolve. Each glyph is a span with
    // a tooltip (hint) and a mousedown listener that fires its icon's
    // action / message and prevents the parent row's selection handler
    // from firing.
    proto._renderRowIcons = function (rowEl, item) {
        var icons = this.computeRowIconsForItem(item);
        if (!icons.length) {
            item._rowIcons = [];
            return;
        }
        item._rowIcons = icons;
        var self = this;
        var stripEl = this.document.createElement("div");
        stripEl.className = "rcp-row-icons";
        for (var i = 0; i < icons.length; i++) {
            (function (icon) {
                var btn = self.document.createElement("span");
                btn.className = "rcp-row-icon-glyph";
                if (icon.primary) btn.classList.add("rcp-row-icon-glyph-primary");
                btn.textContent = icon.glyph;
                btn.title = icon.hint
                    ? icon.hint + " · Alt-↵ or click"
                    : "Alt-↵ or click";
                btn.setAttribute("role", "button");
                btn.setAttribute("tabindex", "-1");
                btn.addEventListener("mousedown", function (e) {
                    // Don't let the row's own mousedown selection /
                    // fire path also run.
                    e.preventDefault();
                    e.stopPropagation();
                    self.fireRowIcon(item, icon, e);
                });
                stripEl.appendChild(btn);
            })(icons[i]);
        }
        rowEl.classList.add("rcp-row-has-icons");
        rowEl.appendChild(stripEl);
    };

};
