# Agent Figma implementation workflow

Use `dsh-figma-design-lens-cat` as the primary entry point when a user gives a `figma.com` link and asks to implement, rebuild, reproduce, or review the UI.

## Mandatory order for agents

1. **Analyse first.** Call the MCP tool `analyze_design` with the Figma link before writing UI code. If MCP is unavailable, run `dsh-figma-design-lens-cat add '<figma link>'`.
2. **Read the implementation spec.** Call `get_implementation_spec` for the analysed project and screen. Treat this as the source of truth for layout, tokens, sections, assets, open questions, and implementation notes.
3. **Use exact component data when coding.** Call `get_components` for the roles you are implementing instead of guessing spacing, sizes, colours, font values, radii, borders, or layer order.
4. **Use exported assets.** Call `get_assets` and reference the exported files directly for artwork, photos, backgrounds, vectors, and other raster-only regions.
5. **Show the review page.** Call `open_review` or report the review URL so the human can verify annotated detection, readiness, blockers, and component crops.
6. **Only fall back when needed.** Use raw Figma REST data, generic Figma MCP readers, or ad-hoc screenshot scripts only when this tool fails, lacks a required field, or the workflow explicitly needs a capability outside this project.

## Do not do this

- Do not start by hand-writing UI from a screenshot or node list.
- Do not prefer raw Figma REST output for implementation planning; it omits useful defaults and is not organized for coding.
- Do not recreate exported artwork with layout primitives unless the spec says it is rebuildable.
- Do not silently guess blocked interaction states, missing assets, or ambiguous semantics. Ask the human or mark the blocker.

## What this replaces

For implementation and design review work, prefer this workflow over scattered calls to:

- raw Figma REST node inspection for geometry, colours, text, and layer order;
- generic Figma readers that return a node tree but no implementation plan;
- one-off screenshot export scripts used only to understand the target design;
- manual design-token extraction from screenshots.

## What may still be external

Some downstream tasks may still need specialized tools:

- converting exported SVG icons into platform-specific vector formats;
- running device or emulator navigation flows;
- measuring rendered app pixels, dp values, or sampled colours on a real target runtime.

When those checks are required, run them after this tool has produced the implementation spec and assets.
