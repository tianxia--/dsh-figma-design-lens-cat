// Flat list of everything the design actually paints.
//
// The component inventory is a summary for humans: nested instances collapse
// into one row, so a slider reads as a single 158x15 block instead of a 144x5
// bar with a 15x15 handle. That summary is fine for judging readiness and
// wrong for rebuilding the screen, which needs each drawn leaf.
import fs from "node:fs";
import path from "node:path";

/**
 * The arrangement a designer set up, where they set one up.
 *
 * Every item already carries absolute coordinates, and those stay the source
 * of truth: this says what the spacing means, not where to put things. A row
 * of three cards 12 apart and a row of three cards that happen to be 12 apart
 * look identical in coordinates and are different designs, and only the first
 * survives a change of width.
 *
 * A layout with no children states no intent, so it is left out: a gradient
 * frame carrying layoutMode VERTICAL and nothing inside is noise.
 */
function layoutOf(node) {
  const mode = node.layoutMode;
  if (!mode || mode === "NONE") return undefined;
  const kids = (node.children || []).filter((c) => c.visible !== false);
  if (kids.length < 2) return undefined;

  const pad = {
    l: node.paddingLeft || 0, r: node.paddingRight || 0,
    t: node.paddingTop || 0, b: node.paddingBottom || 0,
  };
  const out = {
    direction: mode === "HORIZONTAL" ? "row" : "column",
    gap: Number((node.itemSpacing || 0).toFixed(2)),
  };
  if (pad.l || pad.r || pad.t || pad.b) out.padding = pad;
  // MIN/MAX read as start/end once the direction is known, which is how
  // every target names them.
  const along = { MIN: "start", CENTER: "centre", MAX: "end",
    SPACE_BETWEEN: "space-between" }[node.primaryAxisAlignItems];
  const across = { MIN: "start", CENTER: "centre", MAX: "end" }[node.counterAxisAlignItems];
  if (along) out.along = along;
  if (across) out.across = across;
  if (node.layoutWrap === "WRAP") out.wrap = true;
  return out;
}

/**
 * Shadows and blurs, in the form a renderer needs them.
 *
 * Figma states a shadow as a colour, an offset and a radius, which maps onto
 * CSS box-shadow, SwiftUI .shadow and Compose elevation directly. A blur has
 * only a radius, and whether it applies to the layer or to what sits behind
 * it decides which API draws it.
 *
 * 2,643 nodes in this workspace carry one, mostly on cards and buttons --
 * the visual centre of a screen, and until now dropped entirely.
 */
function effectsOf(node) {
  const out = [];
  for (const e of node.effects || []) {
    if (e.visible === false) continue;
    if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
      out.push({
        kind: e.type === "INNER_SHADOW" ? "inner-shadow" : "shadow",
        colour: e.color ? hex(e.color) : "#000000",
        alpha: e.color && e.color.a != null ? Number(e.color.a.toFixed(3)) : 1,
        dx: Number(((e.offset && e.offset.x) || 0).toFixed(2)),
        dy: Number(((e.offset && e.offset.y) || 0).toFixed(2)),
        blur: Number((e.radius || 0).toFixed(2)),
      });
    } else if (e.type === "LAYER_BLUR") {
      out.push({ kind: "blur", radius: Number((e.radius || 0).toFixed(2)) });
    } else if (e.type === "BACKGROUND_BLUR" || e.type === "GLASS") {
      // What sits behind is blurred, not the node itself: on web that is
      // backdrop-filter, and drawing it as a layer blur smears the content.
      out.push({ kind: "backdrop-blur", radius: Number((e.radius || 0).toFixed(2)) });
    }
  }
  return out.length ? out : undefined;
}

/** Screen one fill over another: the closest approximation to a lightening
 * blend that needs only the fills, not the backdrop they sit on. */
function screenBlend(base, over) {
  const a = over.opacity == null ? 1 : over.opacity;
  const s = (x, y) => 1 - (1 - x) * (1 - y * a);
  return { r: s(base.r, over.color.r), g: s(base.g, over.color.g), b: s(base.b, over.color.b) };
}

function hex(c) {
  const v = (x) => Math.round((x || 0) * 255).toString(16).padStart(2, "0");
  return ("#" + v(c.r) + v(c.g) + v(c.b)).toUpperCase();
}

function paintOf(node) {
  const fills = (node.fills || []).filter((f) => f.visible !== false);
  const solid = fills.find((f) => f.type === "SOLID" && f.color);
  const grad = fills.find((f) => String(f.type || "").startsWith("GRADIENT"));
  const img = fills.find((f) => f.type === "IMAGE");
  // A second fill set to COLOR_DODGE or COLOR lightens what is under it.
  // Keeping only the first one left a lock screen clock at #999999 where the
  // design shows it near white. Compositing properly needs the backdrop,
  // which this list does not carry, so the two fills are screened together:
  // that reproduces the direction and most of the magnitude.
  const lift = fills.slice(fills.indexOf(solid) + 1).find((f) =>
    f.type === "SOLID" && f.color
    && ["COLOR_DODGE", "SCREEN", "LINEAR_DODGE", "COLOR"].includes(f.blendMode));
  if (solid) {
    const a = solid.opacity == null ? 1 : solid.opacity;
    const c = lift ? screenBlend(solid.color, lift) : solid.color;
    return { fill: hex(c), fillOpacity: a === 1 ? undefined : Number(a.toFixed(3)) };
  }
  if (grad) {
    return {
      gradient: {
        type: grad.type,
        stops: (grad.gradientStops || []).map((s) => ({
          at: Number((s.position || 0).toFixed(3)), color: hex(s.color),
        })),
      },
    };
  }
  if (img) return { image: { scaleMode: img.scaleMode || null, ref: img.imageRef || null } };
  return null;
}

function strokeOf(node) {
  const s = (node.strokes || []).find((x) => x.visible !== false && x.type === "SOLID" && x.color);
  if (!s || !node.strokeWeight) return undefined;
  return { color: hex(s.color), width: node.strokeWeight };
}

function typographyOf(node) {
  const s = node.style;
  if (!s) return undefined;
  return {
    family: s.fontFamily || null,
    size: s.fontSize || null,
    weight: s.fontWeight || null,
    lineHeight: s.lineHeightPx ? Number(s.lineHeightPx.toFixed(2)) : null,
    letterSpacing: s.letterSpacing ? Number(s.letterSpacing.toFixed(2)) : null,
    align: s.textAlignHorizontal || null,
    valign: s.textAlignVertical || null,
    // Figma records whether the box was drawn around the text or set by hand.
    // WIDTH_AND_HEIGHT means the designer let the label size itself, so a
    // rebuild should wrap its content rather than pin the measured width,
    // which is what truncated 110 BPM to 110 in a fallback font.
    sizing: s.textAutoResize === "WIDTH_AND_HEIGHT" ? "hug"
      : (s.textAutoResize === "HEIGHT" ? "fixed-width" : null),
    truncates: s.textTruncation === "ENDING" || undefined,
  };
}

// Corner radius is not always a field. A VECTOR keeps its rounding inside the
// path geometry, which the API does not return, so a rounded bar arrives with
// cornerRadius null and rebuilds as a hard-edged rectangle. An ellipse is
// fully round by definition. Both are recorded so the shape survives.
function radiusOf(node, bb) {
  if (node.cornerRadius) return { radius: node.cornerRadius };

  const radii = node.rectangleCornerRadii;
  if (Array.isArray(radii) && radii.some((r) => r > 0)) {
    return { radius: Math.max(...radii) };
  }

  if (node.type === "ELLIPSE") {
    return { radius: Math.min(bb.width, bb.height) / 2, radiusFrom: "ellipse" };
  }

  // A vector far thinner than it is long is a capsule in every design system
  // that produces one; squared ends would be the surprising choice.
  if (node.type === "VECTOR" && bb.width && bb.height) {
    const thin = Math.min(bb.width, bb.height);
    const long = Math.max(bb.width, bb.height);
    if (thin <= 8 && long >= thin * 4) {
      return { radius: thin / 2, radiusFrom: "thin-vector" };
    }
  }
  return {};
}


// that only position their children add nothing to a rebuild.
function isDrawn(node) {
  if (node.visible === false) return false;
  if (node.type === "TEXT" && node.characters) return true;
  const painted = (node.fills || []).some((f) => f.visible !== false);
  const stroked = (node.strokes || []).some((s) => s.visible !== false);
  return painted || stroked;
}

export function paintList(rootNode) {
  const root = rootNode.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const items = [];
  let order = 0;

  const walk = (node, parentName) => {
    if (node.visible === false) return;
    const bb = node.absoluteBoundingBox;
    const kids = (node.children || []).filter((c) => c.visible !== false);

    if (bb && bb.width && bb.height && isDrawn(node)) {
      const paint = paintOf(node);
      const stroke = strokeOf(node);
      if (paint || stroke || node.type === "TEXT") {
        items.push({
          order: order++,
          id: node.id,
          name: node.name || null,
          type: node.type,
          parent: parentName || null,
          // Normalisation recovers the true rectangle; the bounding box is
          // the axis-aligned box around a rotated shape and is larger on both
          // axes. Reading it here put the same node in this list at 703x692
          // while the export manifest had it at its real 416x572.
          box: {
            x: Math.round(((node.absX != null ? node.absX : bb.x) - root.x) * 100) / 100,
            y: Math.round(((node.absY != null ? node.absY : bb.y) - root.y) * 100) / 100,
            w: Math.round((node.width != null ? node.width : bb.width) * 100) / 100,
            h: Math.round((node.height != null ? node.height : bb.height) * 100) / 100,
          },
          ...(paint || {}),
          ...(stroke ? { stroke } : {}),
          ...radiusOf(node, bb),
          // Shadows and blurs: 2,643 nodes here carry one, and a card
          // without its shadow reads as flat against the background.
          ...(effectsOf(node) ? { effects: effectsOf(node) } : {}),
          // Whether the node cuts off what overflows it. 15% of nodes here
          // do, and without it a photo or a long label spills past the card
          // that was meant to contain it.
          ...(node.clipsContent ? { clips: true } : {}),
          // What the spacing means, not where to put things: the coordinates
          // above stay the source of truth. 33% of nodes here were arranged
          // by the designer and the model was told none of it.
          ...(layoutOf(node) ? { layout: layoutOf(node) } : {}),
          // A rotated shape reports an axis-aligned bounding box, so without
          // the angle a 45-degree pointer rebuilds as a plain square.
          // Normalisation already states rotation in degrees; converting it
          // again treated 180 degrees as 180 radians.
          ...(node.cumulativeRotation
            ? { rotation: Number(node.cumulativeRotation.toFixed(2)) }
            : node.rotation
              ? { rotation: Number((node.rotation * 180 / Math.PI).toFixed(2)) } : {}),
          ...(node.opacity != null && node.opacity !== 1
            ? { opacity: Number(node.opacity.toFixed(3)) } : {}),
          ...(node.type === "TEXT"
            ? { text: node.characters, font: typographyOf(node) } : {}),
          leaf: kids.length === 0,
        });
      }
    }
    for (const c of kids) walk(c, node.name || parentName);
  };

  walk(rootNode, null);
  return {
    screen: {
      id: rootNode.id,
      name: rootNode.name,
      size: { w: Math.round(root.width), h: Math.round(root.height) },
    },
    count: items.length,
    items,
  };
}

export function writePaintList(rootNode, outFile) {
  const data = paintList(rootNode);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data, null, 1));
  return data;
}

