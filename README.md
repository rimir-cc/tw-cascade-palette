# tw-cascade-palette

A keyboard-driven, cascading command palette engine for TiddlyWiki. Open with a hotkey, type to filter, Right-arrow to drill into a stage, Space to open the action menu on any tiddler row, Esc to back out, Enter to fire an action. Extensible via declarative entry and action tiddlers — no widget code required.

## What it does

- **Cascading stages.** Picking an entity drills into a new stage scoped to that entity (its action menu, or a related set). Stages form a stack; breadcrumb shows the path; Esc pops one level at a time and closes at root.
- **Declarative protocol.** Adding a new cascade edge is one tiddler. Tag `$:/tags/rimir/cascade-palette/{entry,action}`, set `ca-*` fields, save.
- **Generic engine.** Knows nothing about your data model. Catalogue plugins like `rimir/orga-palette` ship the entries/actions; the engine just walks them.
- **Filter substitution.** Filter expressions in entries and actions receive `<<query>>`, `<<picked>>`, `<<parent-picked>>` so cascades can chain naturally.

## Features

The engine ships well beyond the core cascade:

- **Views & channels** — compose the result list as Entries / All tiddlers / By namespace / By parent / Hybrid / By date, picked from a pill strip.
- **Axes** — per-channel grouping chains (year → month → day, status → prefix, etc.), editable live.
- **Filters, visibility & presets** — pill strips that narrow results, hide entries, and save/replay view + filter combinations.
- **Leaders** — single-key shortcuts (clear constraints, tree-picker, save preset, help, …).
- **Side-preview pane** — per-menu or tag-auto-attached wikitext preview of the focused row.
- **Row icons, lenses (name / icon / annotation row decorations, authored in-palette), sticky context, deep-tree search**, and a typed-field edit protocol (toggle / number / text / date settings, confirm gestures, reorder).

See the in-plugin documentation tab for the full protocol and authoring guide.

## Inspiration

Souk21's `souk21/commandpalette` showed how powerful a TiddlyWiki keyboard palette can be. This plugin is from-scratch because souk21's flat data model (one input, one list, terminal Enter) didn't fit the cascading shape we wanted — but the philosophy of "extend by tagging a tiddler" is the same.

## License

MIT.
