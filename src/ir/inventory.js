// What did we actually understand from this design?
//
// This inventory is the ground truth for every later dimension, so its
// granularity must match how a person reads the screen — not how the file
// stores it. Three rounds of review corrections shaped the rules below:
//
//   1. a map marker was listed as three separate vectors  -> glyph composites
//   2. header decoration was listed as 18 "components"    -> classify.js
//   3. the achievement card was invisible, only its text  -> card composites
//      appeared
import { signatureOf } from "./schema.js";

const area = (n) => n.box.w * n.box.h;

/** Background = the largest fills stacked at the bottom of the paint order. */
function backgroundOf(screen) {
  const layers = [];
  const total = screen.size.w * screen.size.h;
  const walk = (n, depth) => {
    const a = area(n);
    if (n.style?.fill && a / total >= 0.15 && n.role !== "text") {
      layers.push({ id: n.id, name: n.name, fill: n.style.fill, depth,
        coverage: +(a / total * 100).toFixed(1), box: n.box, radius: n.style.radius || 0 });
    }
    for (const c of n.children || []) walk(c, depth + 1);
  };
  walk(screen.root, 0);
  layers.sort((a, b) => b.coverage - a.coverage);
  return { layers: layers.slice(0, 6), base: layers[0]?.fill || null };
}

const GLYPH_MAX = 72;
const GLYPH_NAME = /icon|marker|badge|avatar|logo|pin|glyph|indicator|weather/i;

function subtreeRoles(n, acc = new Set()) {
  for (const c of n.children || []) { acc.add(c.role); subtreeRoles(c, acc); }
  return acc;
}

// Two kinds of composite, because a reviewer sees both as "one thing":
//   glyph — a purely graphical group small enough to read as one icon
//   card  — a container with its OWN surface (fill / radius / border) holding
//           several elements
// A glyph is atomic. A card is a unit AND a container: it is emitted and then
// walked into, because the developer needs both the card and its contents.
function compositeKind(n) {
  const kids = n.children || [];
  if (!kids.length) return null;
  const roles = subtreeRoles(n);
  // "Purely graphical" was too strict for map markers: the orange incident
  // marker (34x34) holds INSTANCE children and was silently skipped, so the
  // reviewer rightly asked "where are the POI pins?". Size decides: anything
  // this small that isn't raw text reads as ONE glyph regardless of what
  // node types compose it.
  const small = n.box.w <= GLYPH_MAX && n.box.h <= GLYPH_MAX;
  if (small && n.role !== "text") return "glyph";
  const graphicOnly = !roles.has("text") && !roles.has("instance");
  if (graphicOnly) {
    return GLYPH_NAME.test(n.name || "") ? "glyph" : null;
  }
  const s = n.style || {};
  const hasSurface = !!s.fill || (s.radius || 0) >= 6 || !!s.border;
  // the artboard itself has a surface and children but is not a card, and a
  // container spanning most of the screen is a section, not a component
  const screenLike = n.box.w >= (n.__screenW || Infinity) * 0.95 && n.box.h >= (n.__screenH || Infinity) * 0.8;
  if (screenLike) return null;
  if (hasSurface && kids.length >= 2 && n.box.w >= 60 && n.box.h >= 40) return "card";
  return null;
}

function describe(n, path, kind) {
  return {
    id: n.id,
    role: kind === "card" ? "card" : kind === "glyph" ? "icon"
      : (n.style?.image ? "image" : n.role),   // avatars / basemaps / overlays are assets
    role: kind === "card" ? "card" : kind === "glyph" ? "icon" : n.role,
    figmaRole: n.role,
    component: n.component || null,
    path: path.join(" / "),
    box: { x: n.box.x, y: n.box.y, w: n.box.w, h: n.box.h },
    fill: n.style?.fill || null,
    fillFrom: n.style?.fillFrom || null,
    fillOpacity: n.style?.fillOpacity == null ? null : n.style.fillOpacity,
    radius: n.style?.radius || 0,
    border: n.style?.border || null,
    opacity: n.style?.opacity ?? 1,
    text: n.text || null,
    font: n.style?.font ? {
      size: n.style.font.size, weight: n.style.font.weight,
      lineHeight: n.style.font.lineHeight, color: n.style.font.color,
      family: n.style.font.family, align: n.style.font.align,
    } : null,
    signature: signatureOf(n),
    composite: kind
      ? { kind, parts: (n.children || []).length,
          partNames: (n.children || []).map((c) => c.name).slice(0, 6) }
      : null,
  };
}

function componentsOf(screen) {
  const out = [];
  const walk = (n, path) => {
    const kids = n.children || [];
    n.__screenW = screen.size.w; n.__screenH = screen.size.h;
    const kind = compositeKind(n);
    const isInstance = n.role === "instance";
    const isLeafVisual = n.role === "text" || n.role === "vector" || n.role === "shape"
      // a childless fill-less frame that is glyph-sized is an icon whose paths
      || (kids.length === 0 && (n.style?.fill || n.style?.image || (n.box.w <= GLYPH_MAX && n.box.h <= GLYPH_MAX && n.box.w >= 8)));

    if (isInstance || kind || isLeafVisual) {
      out.push(describe(n, path, kind));
      // Atomicity by size, not by node type. "Instance = atomic" swallowed the
      // identity card's avatar, name, verified badge and chevron — the reviewer
      // got one big box and nothing inside. Buttons/switches/tags stay atomic;
      // a card-sized instance is walked like any other container.
      const atomicInstance = isInstance && n.box.w <= 200 && n.box.h <= 64;
      if (atomicInstance || kind === "glyph") {
        // Stopping the walk must not discard what the component SAYS. A 28x34
        // "Left Content" instance held "Task Name *" and "Pickup Children";
        // both vanished from the inventory and from the annotated overlay, so
        // the screen looked like it had no label and no value at all.
        //
        // Atomicity is about not exploding a control into parts — it is not a
        // reason to lose its text. Carry the text up and emit the text nodes
        // too, so every visible string is accounted for.
        const texts = [];
        const collect = (m, trail) => {
          if (m.role === "text" && m.text && m.text.trim()) texts.push({ node: m, trail });
          for (const c of m.children || []) collect(c, [...trail, m.name || m.role]);
        };
        for (const c of kids) collect(c, [...path, n.name || n.role]);
        if (texts.length) {
          const owner = out[out.length - 1];
          owner.label = texts.map((t) => t.node.text.trim()).join(" · ");
          for (const t of texts) out.push({ ...describe(t.node, t.trail, null), insideAtomic: n.id });
        }
        return;
      }
    }
    for (const c of kids) walk(c, [...path, n.name || n.role]);
  };
  walk(screen.root, []);
  return out;
}

function layoutsOf(screen) {
  const out = [];
  const walk = (n) => {
    if (n.layout) out.push({ id: n.id, name: n.name, box: n.box, ...n.layout, childCount: (n.children || []).length });
    for (const c of n.children || []) walk(c);
  };
  walk(screen.root);
  return out;
}

export function buildInventory(screen) {
  const components = componentsOf(screen);
  const background = backgroundOf(screen);
  const layouts = layoutsOf(screen);
  const byRole = {};
  for (const c of components) byRole[c.role] = (byRole[c.role] || 0) + 1;
  const colors = {};
  for (const c of components) if (c.fill) colors[c.fill] = (colors[c.fill] || 0) + 1;
  const fonts = {};
  for (const c of components) if (c.font?.size) {
    const k = c.font.size + "/" + (c.font.weight || 400);
    fonts[k] = (fonts[k] || 0) + 1;
  }
  const sig = {};
  for (const c of components) sig[c.signature] = (sig[c.signature] || 0) + 1;
  const repeated = Object.entries(sig).filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([s, n]) => ({ signature: s, count: n }));

  return {
    screen: { id: screen.id, name: screen.name, size: screen.size, platform: screen.platform },
    background,
    counts: { components: components.length, byRole, layouts: layouts.length },
    palette: Object.entries(colors).sort((a, b) => b[1] - a[1]).map(([hex, n]) => ({ hex, uses: n })),
    typography: Object.entries(fonts).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const [size, weight] = k.split("/");
      return { size: +size, weight: +weight, uses: n };
    }),
    componentCandidates: repeated,
    layouts,
    components,
  };
}
