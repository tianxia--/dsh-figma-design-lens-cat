// Not every node in a design is something to build.
//
// Shaped by review corrections: decoration listed as components (round 1),
// in-canvas decoration missed by coordinate rules (round 2), and composites
// (cards/icons/images) being re-judged by shape heuristics and deleted for
// having no solid fill (round 3). Composites earned their role upstream —
// content roles pass; only raw shapes go through the decoration heuristics.

const DECOR_PARENT = /background|bg\b|decor|pattern|gradient|blur|glow|header art/i;
const CONTENT_ROLE = new Set(["text", "instance", "card", "icon", "image"]);

export function classifyComponent(c, screen, opts = {}) {
  const b = c.box;
  const path = String(c.path || "");

  const outside = b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= screen.size.w || b.y >= screen.size.h;
  if (outside) return { kind: "off-canvas", why: "entirely outside the artboard" };

  if (CONTENT_ROLE.has(c.role)) {
    if (b.w < 4 || b.h < 4) return { kind: "decoration", why: "too small to perceive" };
    return { kind: "deliverable", why: null };
  }

  if (DECOR_PARENT.test(path)) return { kind: "decoration", why: "inside a background/decoration container" };

  const visibleW = Math.min(b.x + b.w, screen.size.w) - Math.max(b.x, 0);
  const visibleH = Math.min(b.y + b.h, screen.size.h) - Math.max(b.y, 0);
  const visibleRatio = (visibleW * visibleH) / Math.max(1, b.w * b.h);
  if (visibleRatio < 0.85) {
    return { kind: "decoration", why: "only " + Math.round(visibleRatio * 100) + "% inside the artboard; treated as background decoration" };
  }

  if (!c.fill) return { kind: "decoration", why: "no solid fill (gradient/mask/glow layer)" };

  const twins = (opts.nameCounts && opts.nameCounts[c.name]) || 0;
  if (twins >= 3 && !c.text) return { kind: "decoration", why: "same name repeated " + twins + " times with no content; treated as a pattern" };

  if (b.w * b.h > screen.size.w * screen.size.h * 0.4) return { kind: "background", why: "large-area background layer" };
  if (b.w < 4 || b.h < 4) return { kind: "decoration", why: "too small (divider)" };
  return { kind: "deliverable", why: null };
}
/**
 * Clip a box to the artboard.
 *
 * Designers routinely place a component wider than the frame — several states
 * side by side, or a container the frame crops. Figma reports the untrimmed
 * geometry, so a 1198x852 box on a 393x852 screen draws an annotation straight
 * across the whole review image and reads as "the tool got it wrong".
 *
 * What a developer implements is the VISIBLE part, so that is what we record,
 * keeping the original for traceability.
 */
function clipToScreen(box, screen) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const x1 = Math.min(screen.size.w, box.x + box.w);
  const y1 = Math.min(screen.size.h, box.y + box.h);
  if (x1 <= x || y1 <= y) return null;          // entirely outside
  const clipped = { x, y, w: x1 - x, h: y1 - y };
  const changed = clipped.x !== box.x || clipped.y !== box.y
    || clipped.w !== box.w || clipped.h !== box.h;
  return { box: clipped, clipped: changed, originalBox: changed ? { ...box } : null };
}


export function splitComponents(components, screen) {
  const nameCounts = {};
  for (const c of components) nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;
  const out = { deliverable: [], decoration: [], offCanvas: [], background: [] };
  for (const c of components) {
    const { kind, why } = classifyComponent(c, screen, { nameCounts });
    const tagged = { ...c, classification: kind, classificationWhy: why };
    if (kind === "deliverable") {
      // Record what is visible, not what Figma reports untrimmed.
      const fit = clipToScreen(c.box, screen);
      if (!fit) { out.offCanvas.push({ ...tagged, classificationWhy: "entirely outside the artboard" }); continue; }
      out.deliverable.push({ ...tagged, box: fit.box,
        ...(fit.clipped ? { clipped: true, originalBox: fit.originalBox } : {}) });
    }
    else if (kind === "off-canvas") out.offCanvas.push(tagged);
    else if (kind === "background") out.background.push(tagged);
    else out.decoration.push(tagged);
  }
  return out;
}
