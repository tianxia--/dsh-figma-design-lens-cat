// Deterministic naming fallback.
//
// semantics scored 0% on every screen because LLM enrichment is a manual step
// and `lens add` never ran it. But a nameless component is not equally nameless:
// its role, its text, its size and its position carry enough signal to produce
// a usable identifier without a model. A button holding "Accept" is
// acceptButton whether or not anyone asks an LLM.
//
// These names are marked source:"rule" so a consumer can tell them from LLM
// inferences and from real Figma layer names. They raise the floor; LLM
// enrichment still improves on them where it runs.

const camel = (s) => {
  const words = String(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).slice(0, 4);
  if (!words.length) return null;
  return words.map((w, i) => {
    const lower = w.toLowerCase();
    return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
};

const ROLE_SUFFIX = { card: "Card", icon: "Icon", image: "Image", instance: "", text: "Text" };

/** Text inside a subtree, used to name containers by what they contain. */
function firstText(node, depth = 0) {
  if (depth > 3) return null;
  if (node.text && node.text.trim()) return node.text.trim();
  for (const c of node.children || []) {
    const t = firstText(c, depth + 1);
    if (t) return t;
  }
  return null;
}

const JUNK = /^(frame|group|rectangle|ellipse|vector|component|instance|union|subtract)[\s\d]*$/i;

export function autoName(c, ctx = {}) {
  // a meaningful Figma layer name always wins
  if (c.name && !JUNK.test(c.name) && !/^[\d:;]+$/.test(c.name)) {
    const n = camel(c.name);
    if (n) return { name: n, basis: "layer" };
  }
  // name by the copy it carries
  const text = c.text || ctx.text;
  if (text) {
    const n = camel(text);
    if (n) return { name: n + (ROLE_SUFFIX[c.role] || ""), basis: "text" };
  }
  // fall back to role plus position, which at least locates it
  const band = ctx.screenH
    ? (c.box.y < ctx.screenH * 0.2 ? "top" : c.box.y > ctx.screenH * 0.8 ? "bottom" : "mid")
    : "";
  const size = Math.round(c.box.w) + "x" + Math.round(c.box.h);
  return { name: (c.role || "node") + (band ? band.charAt(0).toUpperCase() + band.slice(1) : "") + size,
    basis: "position" };
}

/**
 * Give every unnamed component a rule-derived name, keeping them unique.
 * Returns how many were named.
 */
export function autoNameInventory(inv, irRoot) {
  const byId = new Map();
  const index = (n) => { byId.set(n.id, n); for (const k of n.children || []) index(k); };
  if (irRoot) index(irRoot);

  const used = new Set();
  let named = 0;
  for (const c of inv.components) {
    if (c.semantic && c.semantic.suggestName) { used.add(c.semantic.suggestName); continue; }
    const node = byId.get(c.id);
    const ctx = { text: node ? firstText(node) : null, screenH: inv.screen.size.h };
    const { name, basis } = autoName(c, ctx);
    let unique = name, n = 2;
    while (used.has(unique)) unique = name + n++;
    used.add(unique);
    c.semantic = { ...(c.semantic || {}), suggestName: unique,
      depicts: c.semantic?.depicts ?? null,
      uiRole: c.semantic?.uiRole ?? null,
      confidence: basis === "layer" ? 0.9 : basis === "text" ? 0.75 : 0.4,
      source: "rule", basis };
    named++;
  }
  return named;
}
