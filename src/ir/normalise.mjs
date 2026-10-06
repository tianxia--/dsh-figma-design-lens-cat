// Normalising the REST document before anything reads it.
//
// The Figma REST API describes a node differently from how a renderer needs
// it, in three ways that each cause a distinct class of defect:
//
//   1. It omits every property left at its default. Measured over 8,838 nodes
//      in this workspace: paddingLeft absent on 88.7%, layoutMode on 65.6%,
//      primaryAxisAlignItems on 90.6%. Every omission is a downstream branch
//      taken wrongly.
//
//   2. It gives no width, height, x or y -- not on a single node. It gives
//      absoluteBoundingBox, which for a rotated shape is the axis-aligned box
//      *around* it and is larger than the shape on both axes. 786 nodes here
//      carry a rotation, and every one of them was being sized from its box.
//
//   3. It keeps GROUPs, which are an editing convenience with no fill, no
//      padding and no layout, but which do carry a rotation their children
//      must inherit.
//
// This pass runs once, before the IR is built, and is a pure function of the
// document: same input, same output, no IO.

/**
 * The unrotated rectangle whose axis-aligned bounding box is the one given.
 *
 * Figma reports the box after rotation. Feeding its width and height straight
 * into a layout makes every rotated element too large and offset from where
 * the design puts it.
 */
export function rectFromBoundingBox(box, degrees) {
  const theta = (degrees || 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));

  // At 45 degrees cos and sin are equal and the system is singular: the box
  // no longer determines the rectangle. Leaving it as measured is the only
  // honest answer.
  const denominator = cos * cos - sin * sin;
  if (Math.abs(denominator) < 1e-6) {
    return { w: box.width, h: box.height, x: box.x, y: box.y };
  }

  const h = (box.width * sin - box.height * cos) / -denominator;
  const w = (box.width - h * sin) / cos;

  // Where the rotated rectangle's own origin sits inside that box: rotate the
  // four corners about the centre and take the least x and y.
  const c = Math.cos(theta), s = Math.sin(theta);
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  let minX = Infinity, minY = Infinity;
  for (const [px, py] of corners) {
    const rx = px * c - py * s;
    const ry = px * s + py * c;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
  }

  return {
    w: Math.round(w * 100) / 100,
    h: Math.round(h * 100) / 100,
    x: Math.round((box.x - minX) * 100) / 100,
    y: Math.round((box.y - minY) * 100) / 100,
  };
}

// Properties REST leaves out when they hold their default value.
const DEFAULTS = {
  paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0,
  layoutMode: "NONE", layoutGrow: 0,
  layoutSizingHorizontal: "FIXED", layoutSizingVertical: "FIXED",
  primaryAxisAlignItems: "MIN", counterAxisAlignItems: "MIN",
  itemSpacing: 0, rotation: 0,
};

const CONTAINER = new Set(["FRAME", "INSTANCE", "COMPONENT", "COMPONENT_SET"]);

/**
 * Normalise one document in place-ish: the returned tree is new, the input is
 * untouched.
 *
 * Returns { root, warnings } -- warnings name what could not be preserved, so
 * a caller can report where fidelity was lost rather than leaving it silent.
 */
export function normalise(doc) {
  const warnings = new Set();

  const visit = (node, parent, inheritedRotation) => {
    if (!node || node.visible === false) return [];
    if (node.type === "SLICE") return [];

    // A mask defines what its siblings show through; it is not itself drawn.
    // One on a lock screen was a 506x229 white rectangle, and painting it
    // covered the torch and camera buttons under a white slab.
    //
    // Dropping it loses the clipping, so whatever it framed now shows in
    // full. That is visibly wrong in a different way, but a shape that is
    // slightly too large beats a white block over the bottom of the screen.
    if (node.isMask) {
      warnings.add("Mask \"" + (node.name || node.type) + "\" is not"
        + " reproducible: the layers it clips are drawn unclipped");
      return [];
    }


    const n = { ...node };

    // A GROUP is an editing convenience, not a box. Erasing it removes a
    // wrapper that has no appearance of its own, but its rotation is real and
    // has to reach the children that sit inside it.
    if (n.type === "GROUP") {
      const carried = inheritedRotation + degreesOf(n);
      const out = [];
      for (const child of n.children || []) {
        out.push(...visit(child, parent, carried));
      }
      return out;
    }

    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (n[key] === undefined || n[key] === null) n[key] = value;
    }

    // Figma states rotation in radians, anticlockwise; every renderer here
    // wants degrees, clockwise.
    n.rotation = degreesOf(node);
    n.cumulativeRotation = Math.round((inheritedRotation + n.rotation) * 100) / 100;

    if (node.absoluteBoundingBox) {
      const rect = rectFromBoundingBox(node.absoluteBoundingBox, -n.cumulativeRotation);
      n.width = rect.w;
      n.height = rect.h;
      n.absX = rect.x;
      n.absY = rect.y;
      if (n.cumulativeRotation && Math.abs(Math.abs(n.cumulativeRotation % 90) - 45) < 1) {
        warnings.add("Rotation near 45 degrees on \"" + (n.name || n.type)
          + "\": its size cannot be recovered from the bounding box");
      }
    }

    const kids = [];
    for (const child of node.children || []) {
      kids.push(...visit(child, n, n.cumulativeRotation));
    }
    n.children = kids;

    // A container with nothing in it is a coloured box. Treating it as a
    // container invents a wrapper the design does not have.
    if (CONTAINER.has(n.type) && kids.length === 0) n.type = "RECTANGLE";

    // Nothing to hug: a HUG box with no children collapses to zero.
    if (n.layoutSizingHorizontal === "HUG" && !kids.length) n.layoutSizingHorizontal = "FIXED";
    if (n.layoutSizingVertical === "HUG" && !kids.length) n.layoutSizingVertical = "FIXED";

    // So callers read node.textAlignHorizontal rather than reaching through
    // node.style, which half of them forget to do.
    if (n.type === "TEXT" && n.style) {
      for (const [k, v] of Object.entries(n.style)) {
        if (n[k] === undefined) n[k] = v;
      }
      if (n.textAutoResize === undefined) n.textAutoResize = "NONE";
    }

    // A containing block is needed exactly where absolute children are, and
    // nowhere else.
    n.isRelative = n.layoutMode === "NONE"
      || kids.some((k) => k.layoutPositioning === "ABSOLUTE");

    return [n];
  };

  const roots = visit(doc, null, 0);
  return { root: roots[0] || null, warnings: [...warnings] };
}

function degreesOf(node) {
  const r = node.rotation;
  if (!r) return 0;
  // Figma gives radians here; a value already in degrees would be absurd.
  return Math.round(-r * (180 / Math.PI) * 100) / 100;
}
