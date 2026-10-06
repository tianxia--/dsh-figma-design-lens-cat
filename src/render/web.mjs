// Generate a standalone web page from the extracted components.
//
// The generated project is written under the tool's own directory rather than
// a user repository, so nothing is installed into the project being measured.
import fs from "node:fs";
import path from "node:path";
import { canvasBackdrop } from "./canvas.mjs";

// A fill's own alpha has to survive into the colour, or a card filled with
// white at 0.1 becomes opaque white and hides everything behind it.
function rgba(hex, alpha) {
  if (alpha == null || alpha >= 1) return hex;
  const h = String(hex).replace("#", "");
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Background groups are exported as PNG at their designer bounds. They carry
// the artwork the component inventory only records as an empty box -- icons
// and illustrations have no fill or text to recreate -- so the render must
// place the exported file rather than draw nothing.
export function loadBackgrounds(latest) {
  const file = path.join(latest, "raw", "bg-assets.json");
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return (data.groups || [])
      .filter((g) => g && g.box && g.file)
      .map((g) => ({ box: g.box, file: path.basename(g.file), name: g.name }));
  } catch {
    return [];
  }
}

export function loadComponents(latest) {
  const dir = path.join(latest, "components");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let items;
    try { items = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
    catch { continue; }
    for (const c of Array.isArray(items) ? items : items.items || []) {
      if (c?.measured?.box) out.push(c);
    }
  }
  return out;
}

export function renderHtml(manifest, comps, latest, assetPrefix = "assets/") {
  const size = manifest?.screen?.size || { w: 390, h: 844 };
  const parts = comps.map((c) => {
    const m = c.measured, b = m.box, f = m.font || {};
    const style = [
      "position:absolute",
      `left:${b.x}px`, `top:${b.y}px`,
      `width:${b.w}px`, `height:${b.h}px`,
    ];
    // An inherited colour describes what is inside the box, not the box
    // itself: painting it as a background turns an icon into a solid square
    // and a slider into a filled bar. It is carried for reference and drawn
    // only when the node declares the fill itself.
    if (m.fill && !m.text && !m.fillFrom) {
      style.push("background:" + rgba(m.fill, m.fillOpacity));
    }
    if (m.radius) style.push(`border-radius:${m.radius}px`);
    if (m.border) style.push(`border:1px solid ${m.border.color || m.border}`);
    if (m.opacity != null && m.opacity !== 1) style.push(`opacity:${m.opacity}`);
    if (m.text) {
      style.push(`color:${f.color || "#000"}`);
      style.push(`font-size:${f.size || 14}px`);
      style.push(`font-weight:${f.weight || 400}`);
      if (f.lineHeight) style.push(`line-height:${f.lineHeight}px`);
      if (f.family) style.push(`font-family:'${f.family}',sans-serif`);
      if (f.align) style.push(`text-align:${String(f.align).toLowerCase()}`);
      style.push("display:flex", "align-items:center");
      if (String(f.align).toUpperCase() === "CENTER") style.push("justify-content:center");
    }
    return `<div data-id="${esc(c.id)}" style="${style.join(";")}">${esc(m.text || "")}</div>`;
  });

  // Backgrounds sit under the components: they are the artwork the inventory
  // records as an empty box, not an overlay.
  //
  // The screen also needs the design's own backdrop. Without it the page is
  // white, and a screen whose text is white rendered as nothing at all: this
  // one carried 21 labels and showed one button.
  const back = canvasBackdrop(latest);
  const backdrop = back.gradient
    ? "linear-gradient(to bottom," + back.gradient.from + "," + back.gradient.to + ")"
    : (back.hex || "#FFFFFF");
  const bgs = loadBackgrounds(latest).map((g) =>
    `<img src="${esc(assetPrefix + g.file)}" alt="" style="position:absolute;`
    + `left:${g.box.x}px;top:${g.box.y}px;width:${g.box.w}px;height:${g.box.h}px">`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0}
.screen{position:relative;width:${size.w}px;height:${size.h}px;overflow:hidden;background:${backdrop}}</style>
</head><body><div class="screen">
${bgs.join("\n")}
${parts.join("\n")}
</div></body></html>
`;
}
