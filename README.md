# dsh-figma-design-lens-cat

Figma design understanding for AI coding agents.

It reads a Figma screen and produces the information an implementation needs:
every element's true geometry, its colours and type, the artwork that cannot
be rebuilt from data, and the arrangement the designer set up. It then renders
what a model generated from that information on web, iOS and Android, and
scores it against Figma's own render of the same screen -- so the quality of
the extraction is measured rather than assumed.

![The review page for one screen](docs/images/ui-screen.png)

## What it is for

A model given a list of Figma nodes writes plausible code that does not match
the design. The gap is rarely the model: it is what the node list leaves out.
The REST API returns no width or height on any node, omits every property left
at its default, and describes a rotated shape by the box around it rather than
the shape itself.

This tool closes that gap, and proves it did by rendering the result.

## Install

```bash
npm install -g dsh-figma-design-lens-cat
```

A Figma personal access token is required:

```bash
dsh-figma-design-lens-cat token <your-figma-token>
```

## Use

```bash
# What a Figma link actually holds -- a screen, or a canvas of many
dsh-figma-design-lens-cat inspect '<figma link>'

# Analyse one screen
dsh-figma-design-lens-cat add '<figma link>'

# Open the local review UI
dsh-figma-design-lens-cat serve
```

Everything stays on the machine it runs on. Nothing is uploaded.

![The screens in a project](docs/images/ui-projects.png)

## What it extracts

| | |
|---|---|
| **Geometry** | True width, height and origin, recovered from the bounding box by inverting the rotation. Verified to 0.0000pt against known rectangles. |
| **Colour** | Fills including blended layers: a second fill set to COLOR_DODGE lightens what is under it, and taking only the first loses that. |
| **Type** | Family, size, weight, alignment, and the size at which a string fits its measured box in a fallback font. |
| **Artwork** | Vectors, boolean operations and photos exported as images, because their outlines are not in the data at any size. |
| **Effects** | Shadows and blurs, with a background blur kept apart from a layer blur: they are different APIs and confusing them smears the content. |
| **Layout** | The direction, gap, padding and alignment a designer set up -- as intent. Coordinates remain the source of truth. |
| **Clipping** | Whether a node cuts off what overflows it. |

## How the result is checked

Generation is verified rather than trusted. Every emitted element carries its
node id -- `data-id` on web, `accessibilityIdentifier` on SwiftUI,
`testTag` on Compose -- and the output is compared against the list it was
given. Anything missing is sent back in a second pass that adds only the gap,
up to three rounds, keeping whatever was already correct.

Failures are never silent. A build that does not compile, an expired login, an
analysis older than the pipeline -- each says so instead of leaving a previous
result in place.

## Fidelity

Two screens of a file the tool had not seen, rendered from the extraction and
scored against Figma's own render. Left to right: the design, then web, iOS
and Compose.

![The same screens on three platforms](docs/images/fidelity.png)

| screen | web | iOS | Compose |
|---|---|---|---|
| scene list | 85.5 | 81.5 | 79.6 |
| lesson detail | 85.3 | 74.6 | 79.5 |

Photography, rounded cards, status pills and CJK text all come through. What
remains is dominated by fonts: a commercial family that is not installed
cannot be obtained through the API, and text set in a substitute has different
metrics however exactly it is positioned.

## MCP server

```json
{
  "mcpServers": {
    "dsh-figma-design-lens-cat": { "command": "dsh-figma-design-lens-cat-mcp" }
  }
}
```

Tools: `analyse_screen`, `list_projects`, `screen_report`,
`implementation_brief`.

## Commands

| | |
|---|---|
| `inspect <link>` | What a node holds, before analysing it |
| `add <link>` | Analyse one screen |
| `serve` | Local review UI on port 7420 |
| `projects` | What has been analysed |
| `stale` | Which stored analyses predate the current pipeline |
| `bench` | Fidelity across a fixed set of screens, over time |
| `llm login <provider>` | Sign in for code generation |
| `token <figma-token>` | Store the Figma token |

## Requirements

- Node 18 or newer
- Python 3 with Pillow and NumPy, for image comparison
- Chrome, for web rendering
- Xcode command line tools, for iOS rendering (macOS only)
- A JDK, for Compose rendering

Each is optional: a missing one disables its own target and nothing else.

## Licence

MIT
