/*\
title: $:/plugins/rimir/cascade-palette/widgets/cascade-palette-startup.js
type: application/javascript
module-type: startup

Startup module that mounts the cascade-palette widget directly into
document.body. We don't use `$:/tags/AboveStory` because appify replaces the
story-river section of the page template, and the palette would silently fail
to render in app mode.

By mounting into document.body via a startup module we sidestep the entire
"which tag renders inside which template" question — the widget DOM is always
present regardless of which UI mode is active.

\*/
(function () {
    "use strict";

    exports.name = "rimir-cascade-palette-mount";
    exports.platforms = ["browser"];
    exports.after = ["render"];
    exports.synchronous = true;

    exports.startup = function () {
        // Avoid double-mounting if the startup module is invoked twice for
        // any reason.
        if (document.getElementById("rimir-cascade-palette-mount")) return;

        var container = document.createElement("div");
        container.id = "rimir-cascade-palette-mount";
        document.body.appendChild(container);

        try {
            // Wrap the palette in `\import [all[shadows+tiddlers]tag[$:/tags/Macro]]`
            // so that any \function / \procedure / \define declarations in
            // Macro-tagged tiddlers (e.g. rimir/kind's cascade-helpers.tid)
            // are visible inside the palette's widget scope. Without this,
            // `[function[kind.find-by-kind-items]]` and friends in entry /
            // action ca-items-from filters can't resolve — our root-mounted
            // widget doesn't inherit the page-template's macro imports.
            var src =
                "\\import [all[shadows+tiddlers]tag[$:/tags/Macro]!has[draft.of]]\n" +
                "<$cascade-palette/>";
            var parser = $tw.wiki.parseText(
                "text/vnd.tiddlywiki",
                src
            );
            var widget = $tw.wiki.makeWidget(parser, {
                parentWidget: $tw.rootWidget,
                document: document
            });
            widget.render(container, null);
            if (console && console.log) {
                console.log(
                    "[cascade-palette] startup mount complete — widget in document.body"
                );
            }
        } catch (err) {
            if (console && console.error) {
                console.error(
                    "[cascade-palette] startup mount failed:",
                    err && err.message,
                    err
                );
            }
        }
    };
})();
