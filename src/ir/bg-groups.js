// Find the layer GROUPS that are really one background image.
//
// The header of this screen is a group named "pattern" holding 12 solid shapes.
// A reviewer looking at it says "that's a background picture" and is right — it
// must ship as ONE exported asset, not as twelve rectangles. The file has no
// IMAGE fill there, so image detection cannot find it and coordinate clustering
// only guesses a box.
//
// The reliable signal is structural: a container whose whole subtree is
// non-textual graphics and spans a meaningful area. It is a real Figma node, so
// it can be exported through the images endpoint at the designer's own bounds.
//
// Two corrections from review: judge by SUBTREE size (the "pattern" group wraps
// a single sub-group, so requiring two direct children skipped it), and take
// the OUTERMOST qualifying group (the inner one slices the asset wrong).
const NAME_HINT = /pattern|background|bg\b|decor|texture|illustration|graphic|art|blob/i;

// Figma names a boolean operation after the operation itself. Its children
// are operands, not drawable parts: one exported alone painted a grey slab
// across a card because the shape was being subtracted from another.
const BOOLEAN_NAME = /^(union|subtract|intersect|exclude)\b/i;

/** Every node id inside a subtree, including its own. */
function descendantIds(node) {
  const out = [node.id];
  const walk = (n) => {
    for (const c of n.children || []) { out.push(c.id); walk(c); }
  };
  walk(node);
  return out;
}

function subtree(n, acc) {
  acc = acc || { roles: new Set(), count: 0, fills: new Set(), images: 0,
    rotated: 0, translucent: 0 };
  for (const c of n.children || []) {
    acc.roles.add(c.role);
    acc.count++;
    if (c.style && c.style.fill) acc.fills.add(c.style.fill);
    // A pane you can see through is a layer of the design, not ink in a
    // picture: flattening a stack of them loses what the stack was for.
    if (c.style && c.style.fillOpacity != null && c.style.fillOpacity < 0.5) {
      acc.translucent++;
    }
    if (c.style && c.style.rotation) acc.rotated++;
    if (c.style && c.style.image) acc.images++;
    subtree(c, acc);
  }
  return acc;
}

export function findBackgroundGroups(screen, opts) {
  const minArea = (opts && opts.minArea) || 0.04;
  const maxDepth = (opts && opts.maxDepth) || 4;
  const screenArea = screen.size.w * screen.size.h;
  const out = [];

  const walk = (n, depth, inBoolean) => {
    const kids = n.children || [];
    // Depth limits the search for background groups, which are near the top.
    // A rotated shape is not: the tooltip pointer sits five levels down, and
    // stopping early left it to be rebuilt as a square.
    const selfRotatedHere = n.style && n.style.rotation
      && n.role !== "text" && kids.length === 0;
    // Past the depth limit the search for background groups stops, but the
    // walk continues: a rotated shape can sit far deeper than a background
    // does, and the tooltip pointer is five levels down.
    const tooDeep = depth > maxDepth;
    // Two kinds of leaf are worth exporting rather than rebuilding, because
    // in both cases the bounding box says nothing about the shape:
    //
    //   a rotated shape - its box is axis-aligned, so a 45-degree pointer
    //   rebuilds as a square;
    //
    //   a vector - its outline lives in path data the API does not return, so
    //   an icon rebuilds as a coloured rectangle, or the model invents a
    //   plausible icon of its own to fill the space.
    const leaf = (n.children || []).length === 0 && n.role !== "text";
    // A boolean operation is one shape however many children it lists: the
    // children are the paths being combined, not parts to draw separately.
    // Requiring a leaf left a warning triangle to rebuild as a red dot.
    const combined = n.role === "vector" && (n.children || []).length > 0;
    // A vector's outline is never in the data, so it has to be exported at
    // any size. The 96pt cap was meant to separate icons from backgrounds,
    // but it also left a 200pt decorative blob to rebuild as a plain square
    // painted over a card. Only a piece large enough to be the backdrop
    // itself is left to the background rules.
    const isIcon = !inBoolean && (leaf || combined) && n.role === "vector"
      && n.box.w >= 4 && n.box.h >= 4
      // Nearly the whole screen means it is the backdrop, and the background
      // rules own that. Anything smaller is a decoration whose outline is not
      // in the data either way: a 356x609 wave and a 390x506 illustration sat
      // just past a half-screen limit and rebuilt as plain rectangles.
      && (n.box.w * n.box.h) < screenArea * 0.92;
    const selfRotated = leaf && n.style && n.style.rotation;
    // A node filled with a photo has no describable appearance at all: the
    // pixels live in Figma, and the extraction can only record the average
    // colour, which turned a map into a flat slab painted over the screen.
    const photo = n.style && n.style.image && n.box.w >= 24 && n.box.h >= 24;
    if (selfRotated || isIcon || photo) {
      out.push({
        id: n.id,
        // Depth-first order is paint order. Without it two full-screen photos
        // stacked differently on each platform: the same wallpaper came out
        // purple on web and green on Compose.
        order: out.length,
        name: n.name || (photo ? "(image)" : isIcon ? "(icon)" : "(rotated shape)"),
        box: { x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h },
        parts: 1,
        fills: (n.style && n.style.fill) ? [n.style.fill] : [],
        hasImageFill: Boolean(photo),
        coverage: +(((n.box.w * n.box.h) / screenArea) * 100).toFixed(1),
        // The nodes this image actually contains. Geometry alone is not the
        // test: a notification card's glass layer covers the same rectangle
        // as the app icon beside it, and treating the icon as already drawn
        // left it without its white backplate. Only a descendant is inside.
        contains: descendantIds(n),
        // Figma renders a rotated shape into the axis-aligned box around it,
        // which is larger than the shape. The exporter needs the angle to
        // know that the PNG's size is not the size to draw at.
        ...(n.style && n.style.rotation ? { rotation: n.style.rotation } : {}),
        // A machine-readable kind beside the prose, so a corpus scan can
        // count which class of loss costs the most instead of leaving the
        // backlog to be discovered one render at a time.
        kind: photo ? "photo-as-image"
          : selfRotated ? "rotated-as-image"
            : BOOLEAN_NAME.test(n.name || "") ? "boolean-as-image"
              : "vector-as-image",
        reason: photo
          ? "filled with a photo; the pixels are not in the data"
          : selfRotated
            ? "rotated " + n.style.rotation + " degrees; its box does not describe its shape"
            : "vector outline is not in the data; its box does not describe its shape",
      });
      return;
    }

    // Depth bounds the search so a deeply nested card is not mistaken for a
    // backdrop. A group the designer named as decoration is not a guess
    // though, and one sat six levels down: its four stacked rectangles and
    // ellipses were left to be rebuilt separately, and the model assembled
    // them into a shape the design does not contain.
    const namedDecoration = NAME_HINT.test(n.name || "");
    if ((!tooDeep || namedDecoration) && kids.length >= 1) {
      const st = subtree(n);
      const graphicOnly = !st.roles.has("text") && !st.roles.has("instance");
      const area = (n.box.w * n.box.h) / screenArea;
      const named = NAME_HINT.test(n.name || "");
      const rotatedArt = graphicOnly && st.rotated > 0;

      // A group of translucent panes is a stack of cards, not a picture.
      // Flattening one into a single image loses the layering the design is
      // built from -- a notification card is three panes at 0.07 opacity,
      // each slightly wider than the last.
      //
      // DLC_KEEP_TRANSLUCENT=off restores the old behaviour so the two can be
      // compared on the same screen.
      // A pane with a translucent pane under it is a stack of cards, and
      // flattening it into one image loses the layering the design is built
      // from. The panes are siblings rather than nested -- a notification
      // card is three of them at 0.07 opacity, 274, 314 and 354 wide -- so
      // the node's own fill counts alongside the subtree's.
      const selfTranslucent = n.style && n.style.fillOpacity != null
        && n.style.fillOpacity < 0.5;
      const translucentStack = process.env.DLC_KEEP_TRANSLUCENT !== "off"
        && !rotatedArt
        && (st.translucent + (selfTranslucent ? 1 : 0)) >= 2;

      if (!translucentStack
        && graphicOnly && (rotatedArt || (st.count >= 3 && (area >= minArea || named)))) {
        out.push({
          id: n.id,
          name: n.name || "(unnamed group)",
          box: { x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h },
          parts: st.count,
          // Which nodes this image really contains. A card's glass layer and
          // the app icon beside it occupy the same rectangle without one
          // being inside the other, and geometry alone dropped the icon.
          contains: descendantIds(n),
          fills: [...st.fills].slice(0, 8),
          hasImageFill: st.images > 0,
          coverage: +(area * 100).toFixed(1),
          reason: named
            ? "layer name marks it as background/pattern (" + n.name + ")"
            : "purely graphical subtree covering " + (area * 100).toFixed(1) + "% of the artboard",
        });
        // The exported image covers this node's box, so its descendants are
        // already in it -- unless one reaches outside that box. A 416x572
        // vector inside a 390x200 frame is not in the frame's image, and
        // skipping it left the illustration to rebuild as a rectangle.
        const escapes = (m) => {
          const b = m.box;
          return b.x < n.box.x - 1 || b.y < n.box.y - 1
            || b.x + b.w > n.box.x + n.box.w + 1
            || b.y + b.h > n.box.y + n.box.h + 1;
        };
        const outside = [];
        const collect = (m) => {
          if (escapes(m)) { outside.push(m); return; }
          for (const c of m.children || []) collect(c);
        };
        for (const c of kids) collect(c);
        const boolCtx = inBoolean || BOOLEAN_NAME.test(n.name || "");
        for (const m of outside) walk(m, depth + 1, boolCtx);
        return;
      }
    }
    // A child of a boolean operation is consumed by it. Exporting one on its
    // own painted a grey slab across a card: the shape was being subtracted,
    // not drawn.
    const boolHere = inBoolean || BOOLEAN_NAME.test(n.name || "");
    for (const c of kids) walk(c, depth + 1, boolHere);
  };
  walk(screen.root, 0, false);
  return out;
}
