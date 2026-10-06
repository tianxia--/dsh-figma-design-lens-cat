# Comparing against other converters

## FigmaToCode — twelve screens, same comparator

| screen | ours | FigmaToCode |
|---|---|---|
| 17990-193948 | 100.0 | 17.7 |
| 17539-168609 | 87.0 | 0.6 |
| 17467-221609 | 85.2 | 0.3 |
| 17539-167965 | 84.9 | 21.6 |
| 17467-223992 | 76.4 | 57.2 |
| 18277-53310 | 76.4 | 14.7 |
| 17467-220335 | 75.6 | 31.2 |
| 17467-223622 | 70.2 | 9.2 |
| 17595-42253 | 38.4 | 19.3 |
| 17990-193148 | 26.8 | 7.1 |
| 18265-48362 | 17.5 | 8.6 |
| 18308-54943 | 17.0 | 15.0 |

Reproduce: `bash tools/compare-f2c.sh`

The gap is not a verdict on that converter. It is deterministic and built for
the plugin API, and two things it depends on are absent from a REST response:

- **`node.styledTextSegments`** — the styled runs a text node is made of.
  Over REST this is `characters` plus a per-character
  `characterStyleOverrides` array indexing a `styleOverrideTable`;
  run-length encoding that rebuilds the runs. Without it every piece of text
  on the page disappears.
- **`node.parent`** — its entire layout decision is "absolute unless the
  parent is an auto-layout frame". Without the back-reference the test never
  fires: on a screen where 65% of nodes have `layoutMode: NONE`, four
  elements were positioned absolutely instead of most of them.

What remains needs the plugin: images are rendered by calling `exportAsync`
on the live node, so over REST they must be substituted through its
`__FIGMA_IMAGE_<id>__` sentinels, and any vector it would flatten to SVG is
missing.

## Grida designto-code — runs, but its web target stops at the root

`tools/run-grida.cjs` gets it as far as converting. Four things were needed:

1. **A CJS bundle.** Its packages depend on each other with `workspace:^`,
   which yarn v1 cannot resolve, and it ships no `pnpm-workspace.yaml`, so
   pnpm installs only the root. esbuild sidesteps the whole problem. It must
   be CJS: the bundle uses dynamic `require`.
2. **Geometry fields.** Their mapper calls `fillGeometry.map()` on every
   shape. REST does not return path geometry unless asked, so an empty array
   is supplied — which matches their own note, "svg in plugin / png in remote".
3. **An image repository**, set before conversion because the tokenizer
   reserves asset URLs synchronously.
4. **The bundle's own copy of that class.** esbuild inlines it, so setting the
   one in `node_modules` leaves the bundle's unset.

It then converts and emits:

    Web tokenizer: The input design was not handled.
    "Entry point widget" type of "Stack"

Their vanilla target does not implement `Stack`, which is what an absolutely
positioned screen tokenizes to. This is their limitation rather than a gap in
the integration, and it is consistent with their docs: the web target is built
around auto-layout, and Flutter is the more complete backend.

## What the comparison confirms

Fidelity is dominated by what a converter can obtain, not by how carefully it
rebuilds what it has. FigmaToCode gets geometry exactly right by construction
and still scores lower, because a screen's appearance is mostly artwork it
cannot export and text runs it cannot see. Our own largest remaining loss has
the same shape: a font missing on 103 of 121 screens.
