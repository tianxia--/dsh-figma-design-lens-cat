# Rebuilding the conversion pipeline

## Why

Fidelity sits at 65-81% and moves unpredictably between runs of the same
screen. Defects are found one at a time, by looking at a render and tracing
one artefact back to its cause. Six rounds of that produced real fixes but no
stable trend, because the part that decides geometry is a language model, and
it fails differently every time.

Two mature converters solve the same problem without a model at all:

- `FigmaToCode` (bernaferrari) — a Figma plugin that nevertheless takes its
  data as `exportAsync({format: "JSON_REST_V1"})`, which is the REST schema.
  Five deterministic backends read that shape. ~90% of it is portable here.
- `Grida designto-code` — REST input, three IR layers, pixel-diff regression
  bed measuring fidelity against Figma's own renders.

Neither calls an LLM. Both are more accurate than this tool is today.

## What the measurements say

Taken over 8,838 nodes from twelve cached Figma files in this workspace:

| Fact | Measured | Consequence today |
|---|---|---|
| Nodes carrying a `width` field | **0%** | Every size comes from `absoluteBoundingBox` |
| Nodes carrying `rotation` | 8.9% (786 nodes) | Their width, height and origin are all wrong |
| `paddingLeft` absent | 88.7% | `if (node.paddingLeft)` takes the wrong branch |
| `layoutMode` absent | 65.6% | Auto-layout is invisible to us |
| `primaryAxisAlignItems` absent | 90.6% | Alignment is invisible to us |

`absoluteBoundingBox` is the **axis-aligned box of a rotated shape**, not its
size. For a 45-degree rectangle the box is larger than the rectangle on both
axes. We feed it straight into CSS.

## The shape of the change

Today:

    Figma REST → paint list → LLM → HTML / SwiftUI / Compose

Proposed:

    Figma REST
      → normalise      fill defaults, erase groups, recover geometry
      → token IR       assertable, snapshot-testable, no IO
      → emit           deterministic layout, position, size, alignment
      → enrich         LLM names things and groups them; it draws nothing

The division is the point. Coordinates, stacking, clipping and boolean
geometry are exactly what a model guesses wrong and a rule gets right every
time. Naming and component boundaries are the reverse.

---

## Stage 1 — Normalisation

**New file:** `src/ir/normalise.mjs`
**Runs:** immediately after the REST fetch, before `from-figma.js`
**Depends on:** nothing. Pure function over the REST document.

### 1.1 Fill the omitted defaults

REST omits anything left at its default. Every omission is a branch taken
wrongly downstream.

    paddingLeft/Right/Top/Bottom  ??= 0
    layoutMode                    ??= "NONE"
    layoutGrow                    ??= 0
    layoutSizingHorizontal/Vertical ??= "FIXED"
    primaryAxisAlignItems         ??= "MIN"
    counterAxisAlignItems         ??= "MIN"
    textAutoResize                ??= "NONE"
    rotation                      ??= 0

### 1.2 Recover real geometry from the bounding box

The single highest-value function. Given `absoluteBoundingBox` and
`rotation`, invert the AABB to get the unrotated rectangle:

    denominator = cos²θ - sin²θ
    h = (w_box · |sinθ| - h_box · |cosθ|) / -denominator
    w = (w_box - h · |sinθ|) / |cosθ|

Then rotate the four corners, take `minX`/`minY`, and the origin is
`x_box - minX`, `y_box - minY`.

Emit `transform-origin: top left` alongside `rotate()` so the maths lines up.

**Rotation accumulates.** When a GROUP is erased (1.3) its rotation must be
pushed down to its descendants, so thread a `cumulativeRotation` through the
recursion rather than storing it per node.

### 1.3 Structural repairs

| Repair | Reason |
|---|---|
| `GROUP` → erase, hoist children to grandparent | A group is a Figma editing convenience, not a box. It has no fill, no padding, no layout |
| Childless `FRAME|INSTANCE|COMPONENT` → `RECTANGLE` | A frame with nothing in it is a coloured box; treating it as a container invents a wrapper |
| `HUG` sizing with no children → `FIXED` | Nothing to hug; collapses to zero |
| `visible === false` → drop | Already done, keep |
| Inline `node.style` onto TEXT nodes | So callers read `node.textAlignHorizontal`, not `node.style.textAlignHorizontal` |

### 1.4 Derived flags

- `isRelative` on a parent when `layoutMode === "NONE"` or any child is
  `layoutPositioning === "ABSOLUTE"`. This is where a containing block must be
  established — and nowhere else.
- `uniqueName` from a name→counter map: `Button`, `Button_01`. Deterministic
  names make diffs reviewable across runs, which a model cannot offer.
- `parent` back-reference. The IR becomes a cyclic graph; strip it before
  serialising.

### Acceptance

- A rotated 45° rectangle recovers its true width and height to within 0.5pt.
- Re-running normalisation on the same file is byte-identical.
- The 8,838-node corpus passes with no field left undefined among those in 1.1.

---

## Stage 2 — Token IR

**New file:** `src/ir/token.mjs`

A small, closed vocabulary. Not a mirror of Figma, not a mirror of any target.

    Frame     { layout: "row"|"column"|"stack", gap, padding, align, justify }
    Box       { size, fill, gradient, radius, border, shadow, opacity }
    Text      { content, font, align, sizing, colour }
    Artwork   { src, fit }        // anything geometric we do not rebuild
    Clip      { shape, child }    // mask reconstructed as a subtree
    Positioned{ constraint, child }

Two properties make this worth the layer:

1. **Assertable.** `assert(tree.find("stopButton").box.w === 318)` is a unit
   test. There is no equivalent assertion against a prompt.
2. **No IO.** Asset resolution happens later (Stage 4), so the whole geometric
   pass is synchronous and therefore reproducible.

### Layout decision

Do not infer geometrically. Trust the file:

    absolute ⟺ node.layoutPositioning === "ABSOLUTE"
             ∨ parent.layoutMode === "NONE"
             ∨ parent has no layoutMode

That is the entire rule in both reference implementations. A row of
absolutely-positioned boxes is **not** promoted to a flex row; guessing there
is how layouts drift.

### Sizing

Map Figma's three states to `number | "fill" | null`:

    FILL → "fill"     resolved against the parent axis at emit time
    HUG  → null       emit nothing; intrinsic sizing
    FIXED → number

---

## Stage 3 — Geometry that is never rebuilt

The rule both references converge on, stated plainly: **if CSS cannot express
the shape, export a picture of it.** Not "try, and fall back" — export.

| Node | Action | Why |
|---|---|---|
| `BOOLEAN_OPERATION` | Always export | The result of a union/subtract has no CSS form. We currently draw the operands, which is why a subtracted shape appeared as a grey slab |
| `VECTOR` | Export | The outline lives in path data REST does not return |
| `STAR`, `POLYGON` | Export | Same |
| Non-trivial `ELLIPSE` (arc, ring) | Export | `border-radius` covers the trivial case only |
| Any node whose `exportSettings` contains an SVG entry | Export, unconditionally | The designer already said so |
| Node under a mask | Stage 5 | |

The size cap we use today (4–96pt) is wrong as a gate on *whether* to export.
It is a signal about *what kind of thing it is*, and belongs in naming, not in
the export decision.

### Icon detection, when a name is needed

Structural, in priority order — adapted from `iconDetection.ts`:

1. Disallowed types (TEXT, SLICE, COMPONENT_SET) → not an icon
2. `exportSettings` has SVG → icon, unconditionally
3. VECTOR / BOOLEAN_OPERATION / POLYGON / STAR → icon, size ignored
4. ELLIPSE / RECTANGLE / LINE → icon iff ≤ 64pt
5. Container → icon iff ≤ 64pt **and** recursively contains at least one
   vector or primitive **and zero** nested frame/instance/text

---

## Stage 4 — Two-phase assets

Rendering images is the slowest and most rate-limited call. Do it last, and
only for what is actually referenced.

1. Emit code containing opaque sentinels: `__FIGMA_IMAGE_<nodeId>__`
2. Scan the **emitted string** for which ids appear
3. Request exactly those from `GET /v1/images`
4. Substitute
5. Assert: `if (code.includes("__FIGMA_IMAGE_")) throw`

The post-condition turns a silently broken `<img>` into a hard failure.

---

## Stage 5 — Masks and clipping

Figma's mask semantics are flat: a layer with `isMask` clips the siblings
**below** it. That has to be rebuilt as a hierarchy.

    before                    after
    - parent                  - parent
      - maskee 1                - Clip(shape from masker)
      - maskee 2                    - maskee 1
      - masker  (isMask)            - maskee 2
      - unrelated               - unrelated

Clip shape by masker type: RECTANGLE → rounded rect; ELLIPSE → ellipse;
VECTOR → path. Anything else, or a masker with an image fill → export the
whole parent as one picture.

We do not handle masks at all today. A masked layer renders unmasked at full
bounds.

---

## Stage 6 — What the LLM keeps

Only what rules cannot do:

- Component boundaries: which elements form one card, one row
- Developer-facing names: `parkingCard` rather than `instanceMid350x160`
- Semantic markup: `<button>` rather than `<div onclick>`

It receives the token IR and returns names and groupings. **It never returns
coordinates, sizes, colours or z-order.** Those are already correct.

Measured earlier in this project: asked what kind of element a 390×90 bottom
bar containing "Services / My TAMM / Support" is, the decision model answered
correctly 9 times out of 9 above 0.5 confidence. Asked whether a node should
be exported as an image, it scored 0.57 against a 0.71 majority baseline.
The split above follows that measurement.

---

## Stage 7 — Warnings as output

An 8-line deduplicating `Set<string>`, returned with the code:

    "BOOLEAN_OPERATION exported as image"
    "Frame 'Card' has absolute children; using a stack"
    "Mask on 'Avatar' not reproducible; exported as image"
    "Font 'CircularXX' unavailable; metrics differ"

Two effects. A 70% tool becomes trustworthy, because the user knows which 30%
to inspect. And logging warning frequency across the 113-screen corpus ranks
the defect backlog automatically, instead of finding them one render at a time.

---

## Stage 8 — Regression bed

`GET /v1/images` gives Figma's own render of any node. That is ground truth.

For each of the 113 analysed screens: generate, screenshot headless, diff
against the Figma render, record the percentage. Sort by it. The existing
`src/bench/` harness already records history and separates like-for-like
change from coverage change; extend it rather than replace it.

---

## Sequencing

| Order | Work | Expected effect | Risk |
|---|---|---|---|
| 1 | Stage 1 normalisation | Closes a batch of known defects at once; fixes 786 rotated nodes | Low — pure function, snapshot-testable |
| 2 | Stage 3 export rules | Removes the square-instead-of-shape class entirely | Low |
| 3 | Stage 7 warnings | Makes the remaining backlog visible and ranked | Very low |
| 4 | Stage 2 token IR | Unlocks deterministic emit; enables unit tests | Medium — touches everything |
| 5 | Deterministic emit | Geometry stops fluctuating between runs | Medium |
| 6 | Stage 5 masks | New capability | Medium |
| 7 | Stage 6 LLM narrowed | Model stops being asked to do arithmetic | Low once 5 lands |

Stages 1–3 do not disturb the current flow: normalisation feeds the existing
extraction, and the LLM keeps generating. They should land first and be
measured on their own.

## What this does not fix

- **Missing fonts.** `CircularXX` is not installed and cannot be obtained.
  Text components are capped by metric differences regardless of architecture.
- **Figma-only semantics.** Variable *names* need an Enterprise plan over REST;
  fall back to the variable id.
- **Deliberate designer intent we cannot see.** Where the file is ambiguous the
  output will be too. The warning list is how that surfaces.
