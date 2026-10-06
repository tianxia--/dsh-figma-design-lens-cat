// Figma REST/plugin node tree -> design-ir.
//
// Visibility semantics are applied HERE, once: hidden subtrees never enter the
// IR, so no downstream tool can accidentally generate or score an element a
// human cannot see. (Earlier this logic lived in the linter and had to be
// rediscovered by the corpus builder.)
import { emptyDocument } from "./schema.js";

const hex = (c) => "#" + [c.r, c.g, c.b].map((v) =>
  Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase()).join("");

/**
 * The colour a lightening second fill produces over the first.
 *
 * COLOR_DODGE and SCREEN both brighten toward white by an amount that depends
 * on the backdrop, which is not available here. Screen blending of the two
 * fills is the closest approximation that needs only the fills themselves:
 * it reproduces the direction and most of the magnitude, and leaves the
 * colour far nearer the design than ignoring the second fill entirely.
 */
function lighten(base, over) {
  if (!over || over === base) return base.color;
  const a = over.opacity == null ? 1 : over.opacity;
  const screen = (x, y) => 1 - (1 - x) * (1 - y * a);
  return {
    r: screen(base.color.r, over.color.r),
    g: screen(base.color.g, over.color.g),
    b: screen(base.color.b, over.color.b),
  };
}

const roleOf = (t) => {
  if (t === "TEXT") return "text";
  if (t === "INSTANCE" || t === "COMPONENT") return "instance";
  if (t === "VECTOR" || t === "BOOLEAN_OPERATION" || t === "STAR" || t === "LINE") return "vector";
  if (t === "RECTANGLE" || t === "ELLIPSE") return "shape";
  return "frame";
};
// Fills carry two kinds of information: a SOLID colour, or an IMAGE (avatar
// photos, the map basemap, overlay art). The first converter kept only solids,
// which silently erased every avatar and background image from the IR — the
// reviewer found them missing before we did.
function fillOf(node) {
  const fills = (node.fills || []).filter((x) => x.visible !== false);
  const img = fills.find((x) => x.type === "IMAGE");
  const solid = fills.find((x) => x.type === "SOLID" && x.color);
  // A second fill set to COLOR_DODGE or COLOR lightens what is beneath it, and
  // taking only the first one loses that: a lock screen clock is #999999 at
  // 0.8 in the data and renders near white in Figma. Compositing it properly
  // needs the backdrop, which the paint list does not have, so the lightening
  // is approximated by blending the two fills. 117 layers across 46 screens
  // are affected, all of them COLOR or COLOR_DODGE.
  // After the base fill, not from the start: searching the whole list found
  // the base itself when it happened to be first, and the blend was lost.
  const lightening = fills.slice(fills.indexOf(solid) + 1)
    .find((x) => x.type === "SOLID" && x.color
      && (x.blendMode === "COLOR_DODGE" || x.blendMode === "SCREEN"
        || x.blendMode === "LINEAR_DODGE" || x.blendMode === "COLOR"));
  const gradient = fills.find((x) => typeof x.type === "string" && x.type.startsWith("GRADIENT"));
  return {
    solid: solid ? hex(lighten(solid, lightening)) : undefined,
    // A fill carries its own alpha, separate from the node's opacity. Without
    // it a card filled with white at 0.1 rebuilds as opaque white.
    solidOpacity: solid && solid.opacity != null && solid.opacity !== 1
      ? Number(solid.opacity.toFixed(3)) : undefined,
    image: img ? { scaleMode: img.scaleMode || null } : undefined,
    gradient: gradient ? gradientOf(gradient) : undefined,
  };
}

function gradientOf(fill) {
  const stops = (fill.gradientStops || [])
    .filter((s) => s && s.color)
    .map((s) => ({ at: s.position, color: hex(s.color) }));
  return stops.length ? { type: fill.type, stops } : undefined;
}

// A wrapper often carries no fill of its own while the artwork sits a few
// levels down: an instance holds a vector, a frame holds a group of shapes.
// Reading only the wrapper records an empty box, which renders as nothing and
// reads as "this component has no appearance" downstream. The most prominent
// descendant colour is inherited instead, and marked as such so a consumer can
// tell it apart from a fill the node declares itself.
// The descendant has to cover the wrapper for its colour to describe it. A
// small status pill inside a card is white, but the card is not: inheriting
// it painted opaque white sheets over a dark screen and hid everything.
function inheritedFill(node, depth = 0, root = null) {
  if (!node || depth > 4) return undefined;
  const area = (n) => {
    const b = n.absoluteBoundingBox;
    return b ? b.width * b.height : 0;
  };
  const target = root || node;
  const full = area(target);
  for (const child of node.children || []) {
    if (child.visible === false) continue;
    // Two thirds of the wrapper: enough to be its background rather than a
    // detail sitting on it.
    if (full > 0 && area(child) < full * 0.66) {
      const deeper = inheritedFill(child, depth + 1, target);
      if (deeper) return deeper;
      continue;
    }
    if (child.visible === false) continue;
    const own = fillOf(child);
    // Carry the child's alpha as well. Dropping it turned a stack of cards
    // filled with white at 10% into opaque white sheets that covered the
    // screen, so a dark design rendered as blank panels.
    if (own.solid) {
      return { colour: own.solid, opacity: own.solidOpacity,
        from: child.name || child.type };
    }
    if (own.gradient && own.gradient.stops.length) {
      return { colour: own.gradient.stops[0].color, from: child.name || child.type };
    }
    const deeper = inheritedFill(child, depth + 1, target);
    if (deeper) return deeper;
  }
  return undefined;
}

function styleOf(node) {
  const s = {};
  const f = fillOf(node);
  if (f.solid) s.fill = f.solid;
  if (f.solidOpacity != null) s.fillOpacity = f.solidOpacity;
  if (f.gradient) s.gradient = f.gradient;
  if (f.image) s.image = f.image;   // avatar photos, basemaps, overlay art
  if (!s.fill && !s.image && !s.gradient) {
    const inherited = inheritedFill(node);
    if (inherited) {
      s.fill = inherited.colour;
      if (inherited.opacity != null) s.fillOpacity = inherited.opacity;
      s.fillFrom = inherited.from;   // a measurement, but not this node's own
    }
  }
  if (typeof node.opacity === "number" && node.opacity !== 1) s.opacity = node.opacity;
  if (typeof node.cornerRadius === "number" && node.cornerRadius) s.radius = node.cornerRadius;
  if (node.clipsContent === true) s.clip = true;
  // Rotation survives into the IR so a rotated shape can be recognised as one
  // that is safer to export than to rebuild.
  // Normalisation already states rotation in degrees and folds in whatever a
  // GROUP above contributed. Converting again read 93.5 degrees as radians
  // and recorded 5357.
  if (node.cumulativeRotation) s.rotation = Number(node.cumulativeRotation.toFixed(2));
  else if (node.rotation) s.rotation = Number((node.rotation * 180 / Math.PI).toFixed(2));
  const stroke = (node.strokes || []).find((x) => x.visible !== false && x.type === "SOLID" && x.color);
  if (stroke && node.strokeWeight) s.border = { w: node.strokeWeight, color: hex(stroke.color) };
  if (node.type === "TEXT") {
    const st = node.style || {};
    s.font = {
      family: st.fontFamily || st.fontPostScriptName || undefined,
      size: st.fontSize,
      weight: st.fontWeight || 400,
      lineHeight: node.lineHeight?.unit === "PIXELS" ? node.lineHeight.value : st.lineHeightPx,
      letterSpacing: st.letterSpacing,
      align: st.textAlignHorizontal,
      color: f.solid,
    };
  }
  return s;
}

function layoutOf(node) {
  if (!node.layoutMode || node.layoutMode === "NONE") return undefined;
  return {
    direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
    gap: node.itemSpacing || 0,
    padding: { t: node.paddingTop || 0, r: node.paddingRight || 0, b: node.paddingBottom || 0, l: node.paddingLeft || 0 },
    justify: node.primaryAxisAlignItems,
    align: node.counterAxisAlignItems,
  };
}

function convert(node, origin, ctx) {
  const hidden = node.visible === false || (typeof node.opacity === "number" && node.opacity === 0);
  if (hidden) return null;                       // hidden subtrees never enter the IR
  const b = node.absoluteBoundingBox;
  if (!b) return null;
  const ir = {
    id: node.id,
    name: node.name || "",
    role: roleOf(node.type),
    // Normalisation recovers the true rectangle from the bounding box, which
    // for a rotated shape is larger than the shape on both axes. Fall back to
    // the box only for a document that has not been normalised.
    box: {
      x: +((node.absX != null ? node.absX : b.x) - origin.x).toFixed(2),
      y: +((node.absY != null ? node.absY : b.y) - origin.y).toFixed(2),
      w: +(node.width != null ? node.width : b.width).toFixed(2),
      h: +(node.height != null ? node.height : b.height).toFixed(2),
    },
    style: styleOf(node),
    children: [],
  };
  const lay = layoutOf(node);
  if (lay) ir.layout = lay;
  if (node.type === "TEXT") ir.text = node.characters || "";
  if (node.componentId) ir.component = node.componentId;
  if (ir.style.fill) ctx.colors[ir.style.fill] = (ctx.colors[ir.style.fill] || 0) + 1;
  if (ir.style.font?.size) ctx.fonts[ir.style.font.size] = (ctx.fonts[ir.style.font.size] || 0) + 1;
  for (const c of node.children || []) {
    const k = convert(c, origin, ctx);
    if (k) ir.children.push(k);
  }
  return ir;
}

export function figmaToIR(nodes, meta = {}) {
  const doc = emptyDocument(meta);
  const ctx = { colors: {}, fonts: {} };
  for (const n of nodes) {
    const b = n.absoluteBoundingBox;
    if (!b) continue;
    const root = convert(n, { x: b.x, y: b.y }, ctx);
    if (!root) continue;
    doc.screens.push({
      id: n.id, name: n.name,
      size: { w: Math.round(b.width), h: Math.round(b.height) },
      platform: b.width <= 480 ? "mobile" : b.width <= 900 ? "tablet" : "web",
      root,
    });
  }
  doc.tokens.colors = ctx.colors;
  doc.tokens.fonts = ctx.fonts;
  return doc;
}
