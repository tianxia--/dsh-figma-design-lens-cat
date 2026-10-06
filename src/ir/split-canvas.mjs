// Splitting a design canvas into the pages it holds.
//
// A Figma node given to this tool is not always a screen. One in this
// workspace is 4562x5422 and holds six states of the same 1280x800 page, two
// component sets, and seventeen loose cards and buttons laid out beside them.
// Analysed as one screen it produced 725 components, a quarter of which could
// not be named because they sit in the empty space between the artboards.
//
// The split is structural, not visual: what a designer puts directly on a
// canvas is either a page, a definition, or a piece they are working on.

/** Frames of a size a person would actually view. */
const MIN_PAGE_W = 240;
const MIN_PAGE_H = 320;

/**
 * What a node holds, if it holds anything separable.
 *
 * Returns null when the node is a single screen and should be analysed as it
 * is — which is the common case and must stay the default.
 */
export function splitCanvas(doc) {
  const kids = (doc.children || []).filter((c) => c.visible !== false);
  if (kids.length < 2) return null;

  const pages = [];
  const definitions = [];
  const fragments = [];

  for (const c of kids) {
    const b = c.absoluteBoundingBox;
    if (!b) continue;
    const entry = { id: c.id, name: c.name || "(unnamed)", type: c.type,
      size: { w: Math.round(b.width), h: Math.round(b.height) },
      at: { x: Math.round(b.x), y: Math.round(b.y) } };

    // A component set defines the variants of a reusable part. It is not a
    // page and cannot be scored against a design: there is nothing to render
    // it against.
    if (c.type === "COMPONENT_SET" || c.type === "COMPONENT") {
      definitions.push(entry);
    } else if ((c.type === "FRAME" || c.type === "INSTANCE")
      && b.width >= MIN_PAGE_W && b.height >= MIN_PAGE_H) {
      pages.push(entry);
    } else {
      fragments.push(entry);
    }
  }

  // One page and nothing else is just a screen with a wrapper around it.
  if (pages.length < 2 && !definitions.length) return null;

  // Pages of wildly different sizes are the signal that this is a canvas
  // rather than a screen whose children happen to be large.
  const sizes = new Set(pages.map((p) => p.size.w + "x" + p.size.h));

  return {
    isCanvas: pages.length >= 2 || definitions.length > 0,
    canvas: { id: doc.id, name: doc.name || "(unnamed)",
      size: doc.absoluteBoundingBox
        ? { w: Math.round(doc.absoluteBoundingBox.width),
          h: Math.round(doc.absoluteBoundingBox.height) }
        : null },
    pages,
    definitions,
    fragments,
    distinctPageSizes: [...sizes],
  };
}

/** A line per finding, for a person deciding what to analyse. */
export function describeSplit(split) {
  if (!split) return [];
  const out = [];
  out.push(split.canvas.name + " holds "
    + split.pages.length + " page" + (split.pages.length === 1 ? "" : "s")
    + (split.definitions.length ? ", " + split.definitions.length + " component definition"
      + (split.definitions.length === 1 ? "" : "s") : "")
    + (split.fragments.length ? ", and " + split.fragments.length + " loose piece"
      + (split.fragments.length === 1 ? "" : "s") : ""));
  for (const p of split.pages) {
    out.push("  page      " + p.name + "  " + p.size.w + "x" + p.size.h);
  }
  for (const d of split.definitions) {
    out.push("  defines   " + d.name + "  " + d.size.w + "x" + d.size.h
      + "  (not a page; nothing to render it against)");
  }
  return out;
}
