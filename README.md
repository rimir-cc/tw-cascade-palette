# tw-cascade-palette

A keyboard-driven, cascading command palette engine for TiddlyWiki. Open with a hotkey, type to filter, Tab to drill into a stage, Esc to back out, Enter to fire an action. Extensible via declarative entry and action tiddlers — no widget code required.

## What it does

- **Cascading stages.** Picking an entity drills into a new stage scoped to that entity (its action menu, or a related set). Stages form a stack; breadcrumb shows the path; Esc pops one level at a time and closes at root.
- **Declarative protocol.** Adding a new cascade edge is one tiddler. Tag `$:/tags/rimir/cascade-palette/{entry,action}`, set `ca-*` fields, save.
- **Generic engine.** Knows nothing about your data model. Catalogue plugins like `rimir/orga-palette` ship the entries/actions; the engine just walks them.
- **Filter substitution.** Filter expressions in entries and actions receive `<<query>>`, `<<picked>>`, `<<parent-picked>>` so cascades can chain naturally.

## Status

- v0.0.1 — initial scaffold, no widget yet.
- v0.0.2 (planned) — single-stage widget + Ctrl-Space binding.
- v0.1.0 (target) — full Tab/Esc/Enter cascade with breadcrumb and action discovery.

## Inspiration

Souk21's `souk21/commandpalette` showed how powerful a TiddlyWiki keyboard palette can be. This plugin is from-scratch because souk21's flat data model (one input, one list, terminal Enter) didn't fit the cascading shape we wanted — but the philosophy of "extend by tagging a tiddler" is the same.

## License

MIT.
