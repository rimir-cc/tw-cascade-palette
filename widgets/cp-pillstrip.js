/*\
title: $:/plugins/rimir/cascade-palette/widgets/cp-pillstrip.js
type: application/javascript
module-type: library

Shared pill-strip renderer for the four symmetric constraint strips —
filter, visibility, reach, field. Each strip:

  * iterates a `pills` array (this.filters / this.visibilities /
    this.reachPills / this.fieldPills),
  * renders a flat row of `<span class="rcp-pill[ + modifier][ -focused]">
    chip-text <span class="rcp-pill-remove">×</span></span>`,
  * toggles a `rcp-has-<kind>` class on `popupEl` based on emptiness,
  * wires per-pill click (focus the strip + select the pill) + remove ×
    click (call the strip's onRemoveAt).

Authored as a stateless top-level helper rather than a prototype patch
because it doesn't own any widget state — the caller passes everything
it needs via the `descriptor` object. This keeps the helper pure and
testable, and lets each of cp-filters / cp-visibility / cp-reach-pills /
cp-search-meta-pills / cp-search-field-pills retain its own
`_render…Strip` method (a 5-line wrapper that builds the descriptor and
delegates).

The preset and leader strips have unique structural elements (trailing
"+" save pill, split key/name children, scrollIntoView, dirty markers)
and stay implemented standalone in cp-preset-pills.js / cp-leaders.js.

\*/
"use strict";

// descriptor shape:
//   widget          the cascade-palette widget instance (for `document`,
//                   `popupEl`, `focus`, `setFocus`)
//   stripEl         the strip's container DOM element
//   pills           array of pill items (each with `chip`, `hint`)
//   focusIdx        index of the currently-focused pill within the strip
//   focusSection    the value `widget.focus` must equal for this strip to
//                   show focused-pill highlighting (e.g. "filter")
//   popupHasClass   class to toggle on widget.popupEl when pills non-empty
//                   (e.g. "rcp-has-filters")
//   pillModifier    optional extra base class beyond "rcp-pill"
//                   (e.g. "rcp-pill-reach" or "" for filter/visibility)
//   datasetKey      camelCase dataset key (e.g. "filterIdx")
//   onSelectAt(i)   called when a pill is mouse-clicked (typically:
//                   set focusIdx + setFocus(focusSection))
//   onRemoveAt(i)   called when the × is clicked
//   removeTitle     title (tooltip) text on the × button
function renderPillStripSection(descriptor) {
    var widget    = descriptor.widget;
    var stripEl   = descriptor.stripEl;
    if (!stripEl) return;
    while (stripEl.firstChild) {
        stripEl.removeChild(stripEl.firstChild);
    }
    var pills = descriptor.pills || [];
    var has = pills.length > 0;
    if (widget.popupEl && descriptor.popupHasClass) {
        widget.popupEl.classList.toggle(descriptor.popupHasClass, has);
    }
    if (!has) return;
    var doc = widget.document;
    var modifier = descriptor.pillModifier || "";
    var isFocused = widget.focus === descriptor.focusSection;
    pills.forEach(function (item, i) {
        var pillEl = doc.createElement("span");
        var cls = "rcp-pill";
        if (modifier) cls += " " + modifier;
        if (isFocused && i === descriptor.focusIdx) cls += " rcp-pill-focused";
        pillEl.className = cls;
        pillEl.textContent = item.chip;
        if (item.hint) pillEl.title = item.hint;
        if (descriptor.datasetKey) pillEl.dataset[descriptor.datasetKey] = String(i);
        pillEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            if (descriptor.onSelectAt) descriptor.onSelectAt(i);
        });
        var xEl = doc.createElement("span");
        xEl.className = "rcp-pill-remove";
        xEl.textContent = "×"; // ×
        if (descriptor.removeTitle) xEl.title = descriptor.removeTitle;
        xEl.addEventListener("mousedown", function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (descriptor.onRemoveAt) descriptor.onRemoveAt(i);
        });
        pillEl.appendChild(xEl);
        stripEl.appendChild(pillEl);
    });
}

// Shared help-pane renderer for every pill strip (filter, visibility,
// reach, field, view, viewconfig, preset, leader). Each caller computes
// the title / help text / fields array from its own pill object and
// delegates the DOM work here. Pass `help: ""` to skip the help div;
// pass an empty `rows` array to skip the <dl>.
function renderConstraintHelp(widget, opts) {
    if (!widget.detailEl) return;
    while (widget.detailEl.firstChild) {
        widget.detailEl.removeChild(widget.detailEl.firstChild);
    }
    var doc = widget.document;
    var titleEl = doc.createElement("div");
    titleEl.className = "rcp-detail-title";
    titleEl.textContent = opts.title || "";
    widget.detailEl.appendChild(titleEl);
    if (opts.help) {
        var helpEl = doc.createElement("div");
        helpEl.className = "rcp-details-help";
        helpEl.textContent = opts.help;
        widget.detailEl.appendChild(helpEl);
    }
    var rows = opts.rows || [];
    if (rows.length) {
        var dl = doc.createElement("dl");
        dl.className = "rcp-detail-fields";
        rows.forEach(function (row) {
            var dt = doc.createElement("dt");
            dt.textContent = row[0];
            var dd = doc.createElement("dd");
            dd.textContent = row[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        });
        widget.detailEl.appendChild(dl);
    }
    if (widget.popupEl) widget.popupEl.classList.add("rcp-showing-detail");
}

exports.renderPillStripSection = renderPillStripSection;
exports.renderConstraintHelp = renderConstraintHelp;
