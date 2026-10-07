#!/usr/bin/env node
// Three reports, split by AUDIENCE.
//   review.html  human: annotated render + inventory with thumbnails
//   spec.md      AI/dev: no images, everything as text and numbers
//   tokens.json  tools: tokens, components, assets
import fs from "node:fs";
import path from "node:path";
import { splitComponents } from "./classify.js";
import os from "node:os";
import { lensHome } from "../store/home.mjs";
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");


const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n) => Math.round(n);

function groupBySection(components, screenH) {
  const heads = components
    .filter((c) => c.role === "text" && c.font && c.font.size >= 20)
    .sort((a, b) => a.box.y - b.box.y);
  const bounds = heads.map((h, i) => ({
    title: h.text, y0: h.box.y, y1: i + 1 < heads.length ? heads[i + 1].box.y : screenH,
  }));
  if (!bounds.length) return [{ title: "(whole screen)", y0: 0, y1: screenH, items: components }];
  const out = [{ title: "(top area)", y0: 0, y1: bounds[0].y0, items: [] },
    ...bounds.map((b) => ({ ...b, items: [] }))];
  for (const c of components) {
    const sec = out.find((s) => c.box.y >= s.y0 && c.box.y < s.y1) || out[out.length - 1];
    sec.items.push(c);
  }
  return out.filter((s) => s.items.length);
}

function specMarkdown(inv, cross, raster, meta, detcmp, bgassets) {
  const S = inv.screen;
  const L = [];
  L.push("# Implementation spec · " + S.name, "");
  L.push("> For direct AI/developer consumption. **No images**: all visual information is written out as text and numbers.");
  L.push("> Origin is the artboard's top-left corner; units are px at 1:1 with the design.", "");
  L.push("## 0. Provenance", "", "| Field | Value |", "|---|---|");
  L.push("| Figma file | `" + meta.fileKey + "` |");
  L.push("| Node | `" + S.id + "` |");
  L.push("| Link | " + meta.url + " |");
  L.push("| Artboard | " + S.name + " · " + S.size.w + "×" + S.size.h + " · " + S.platform + " |");
  L.push("| Analysed at | " + new Date().toISOString() + " |");
  L.push("| Nodes / components | " + meta.nodes + " / " + inv.counts.components + " |");
  if (cross) L.push("| File x image corroboration | " + cross.corroborationRate + "% |");
  L.push("");

  if (bgassets && bgassets.groups && bgassets.groups.length) {
    L.push("## 0.5 Exported image/vector assets (must be implemented as images)", "");
    L.push("These are clear Figma asset candidates exported during analysis at the designer bounds, before detector checks.");
    L.push("Reference the exported files directly; do not recreate the pixels inside them.", "");
    L.push("| Asset | Figma node | Kind | Size | Position | Reason | File |", "|---|---|---|---|---|---|---|");
    for (const g of bgassets.groups) {
      L.push("| " + esc(g.name) + " | `" + g.id + "` | " + (g.kind || (g.hasImageFill ? "image-fill" : "graphic-group")) + " | " + r1(g.box.w) + "×" + r1(g.box.h)
        + " | " + r1(g.box.x) + "," + r1(g.box.y) + " | " + esc(g.reason || "exported asset candidate") + " | `" + g.file + "` |");
    }
    L.push("");
  }

  L.push("## 1. Canvas and background", "", "| Layer | Colour | Coverage | Position | Radius |", "|---|---|---|---|---|");
  for (const b of inv.background.layers) {
    L.push("| " + esc(b.name) + " | `" + b.fill + "` | " + b.coverage + "% | " +
      r1(b.box.x) + "," + r1(b.box.y) + " " + r1(b.box.w) + "×" + r1(b.box.h) + " | " + b.radius + " |");
  }
  L.push("", "**Base colour**: `" + (inv.background.base || "-") + "`", "");

  L.push("## 2. Design tokens", "", "### 2.1 Palette", "", "| Colour | Uses |", "|---|---|");
  for (const p of inv.palette.slice(0, 14)) L.push("| `" + p.hex + "` | " + p.uses + " |");
  L.push("", "### 2.2 Type scale", "", "| Size | Weight | Uses |", "|---|---|---|");
  for (const t of inv.typography) L.push("| " + t.size + "px | " + t.weight + " | " + t.uses + " |");
  L.push("");

  L.push("## 3. Sections and components", "");
  for (const sec of groupBySection(inv.components, S.size.h)) {
    L.push("| Suggested name | What it is | Role | Position | Size | Fill | Text / font |", "|---|---|---|---|---|---|---|");
    for (const c of sec.items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
      const font = c.font ? (c.font.size + "px/" + c.font.weight + " " + (c.font.color || "")) : "";
      const txt = c.text ? "`" + esc(String(c.text).slice(0, 36)) + "` " + font : font;
      const sem = c.semantic || {};
      const nameCell = sem.suggestName
        ? "`" + sem.suggestName + "`" + (sem.confidence !== null && sem.confidence < 0.7 ? " ⚠️" : "")
        : esc(String(c.name || "(unnamed)").slice(0, 26));
      L.push("| " + nameCell + " | " + esc(String(sem.depicts || "-").slice(0, 34)) + " | " + c.role + " | " +
        r1(c.box.x) + "," + r1(c.box.y) + " | " + r1(c.box.w) + "×" + r1(c.box.h) + " | " +
        (c.fill ? "`" + c.fill + "`" : "-") + " | " + txt + " |");
    }
    L.push("");
  }

  L.push("## 4. Layout containers (auto-layout)", "");
  L.push("| Container | Direction | Gap | Padding | Children | Position/size |", "|---|---|---|---|---|---|");
  for (const l of inv.layouts.slice(0, 40)) {
    L.push("| " + esc(String(l.name).slice(0, 26)) + " | " + l.direction + " | " + l.gap + " | " +
      l.padding.t + "/" + l.padding.r + "/" + l.padding.b + "/" + l.padding.l + " | " + l.childCount + " | " +
      r1(l.box.x) + "," + r1(l.box.y) + " " + r1(l.box.w) + "×" + r1(l.box.h) + " |");
  }
  L.push("");

  L.push("## 5. Componentisation candidates", "", "| Signature | Repeats |", "|---|---|");
  for (const c of inv.componentCandidates) L.push("| `" + c.signature + "` | " + c.count + " |");
  L.push("");

  if (cross) {
    L.push("## 6. Cross-check findings", "");
    for (const f of cross.fileOnlyDetail || []) L.push("- In file, not visible in render: `" + f.id + "` " + esc(f.name) + " — " + (f.why || ""));
    for (const r of cross.imageOnlyDetail || []) L.push("- Visible in render, absent from file: region " + r.x + "," + r.y + " " + r.w + "×" + r.h);
    L.push("");
  }
  if (raster && (raster.detected || []).length) {
    L.push("## 7. Content that exists only as pixels", "");
    L.push("Baked into image assets (map POIs, text inside pictures). No Figma node exists for these.", "");
    L.push("| Position | Size | Host image |", "|---|---|---|");
    for (const b of raster.detected.slice(0, 30)) {
      L.push("| " + r1(b.x) + "," + r1(b.y) + " | " + r1(b.w) + "×" + r1(b.h) + " | " + esc(b.host || "-") + " |");
    }
    L.push("");
  }
  if (detcmp && detcmp.length) {
    L.push("## 7.5 Recognition check (independent image detectors)", "");
    L.push("| Detector | Boxes | Time | Explained by inventory | Uncovered |", "|---|---|---|---|---|");
    for (const d of detcmp) {
      L.push("| " + d.name + " | " + d.boxes + " | " + (d.seconds || "-") + "s | " + d.explainedPct + "% | " + d.missed.length + " |");
    }
    L.push("");
    const missed = detcmp.flatMap((d) => d.missed.map((m) => ({ ...m, by: d.name })));
    if (missed.length) {
      L.push("**Detected but not covered by the inventory (needs human confirmation):**", "");
      for (const m of missed.slice(0, 10)) {
        L.push("- @" + r1(m.x) + "," + r1(m.y) + " " + r1(m.w) + "×" + r1(m.h) + "（" + m.by + " conf " + m.score + "）");
      }
      L.push("");
    }
  }
  L.push("## 8. Implementation notes", "");
  L.push("- The artboard is " + S.size.h + "px tall: this is a **scrolling page**.");
  L.push("- Base colour `" + (inv.background.base || "#000000") + "`, primary foreground `#FFFFFF`。");
  L.push("- Coordinates are absolute; when nesting, subtract the parent's origin.");
  return L.join("\n");
}

function reviewHtml(inv, cross, raster, meta, base, detcmp, bgassets) {
  // List the overlay tiles that actually exist. A tall screen slices into five,
  // a short one into one; hardcoding two shipped a broken image on every short
  // screen and hid most of every tall one.
  const overlayTiles = (() => {
    const found = [];
    for (let i = 1; i <= 24; i++) {
      const f = base + ".overlay-" + i + ".png";
      if (fs.existsSync(path.join(WORK, f))) found.push(f);
    }
    return found.length ? found : [base + ".overlay.png"];
  })();
  const S = inv.screen;
  const crops = meta.crops || {};
  // Grouped by how sure the naming is, because a flat list buries the parts
  // worth reading. One screen here has 725 components of which 65 are the
  // same 80x80 instance repeated across a background illustration: they are
  // not wrong, but they are not what anyone opens this page to look at.
  const tierOf = (c) => {
    const s = c.semantic || {};
    if (s.confidence == null) return "unrated";
    if (s.confidence >= 0.7) return "named";
    if (s.confidence >= 0.5) return "uncertain";
    return "unnamed";
  };

  const rowHtml = (c) => `
    <tr><td>${crops[c.id] ? '<img class="thumb" src="' + meta.cropDir + "/" + crops[c.id] + '" loading="lazy">' : "-"}</td>
    <td><b>${esc((c.semantic && c.semantic.suggestName) || c.name || "(unnamed)")}</b><br>
      <span style="color:#71717a">${esc((c.semantic && c.semantic.depicts) || "")}</span><br>
      <code style="font-size:10px">${esc(c.id)}</code>${c.semantic && c.semantic.confidence != null && c.semantic.confidence < 0.7 ? ' <span style="color:#b45309">' + c.semantic.confidence.toFixed(2) + '</span>' : ""}</td>
    <td>${c.role}</td><td>${r1(c.box.x)},${r1(c.box.y)}<br>${r1(c.box.w)}×${r1(c.box.h)}</td>
    <td>${c.fill ? '<span class="sw" style="background:' + c.fill + '"></span>' + c.fill : "-"}</td>
    <td>${c.font ? c.font.size + "px/" + c.font.weight : "-"}</td>
    <td>${esc(String(c.text || "").slice(0, 36))}</td></tr>`;

  // Open by default only while a tier is small enough to scan. 542 named
  // components is still a page nobody reads top to bottom.
  const OPEN_UP_TO = 60;
  const TIERS = [
    ["named", "Named", "the model or a rule is confident"],
    ["uncertain", "Uncertain", "named, but worth checking"],
    ["unrated", "Not assessed", ""],
    // Last, and named for what it is. Confirmed on a screen carrying 725
    // components: the 183 in this tier are the same 80x80 instance repeated
    // across a background illustration, which the extraction split into
    // separate components instead of treating as one picture. They are
    // defects in the extraction, not parts of the design.
    ["unnamed", "Probable extraction errors",
      "no text, no fill, no distinct shape; usually one decoration split into"
      + " many instances. Not expected to be implemented."],
  ];

  const sorted = inv.components.slice().sort((a, b) => a.box.y - b.box.y);

  // How much of this screen's inventory is not usable, stated before the
  // tables rather than left to be discovered by expanding one.
  const broken = sorted.filter((c) => tierOf(c) === "unnamed").length;
  const brokenNote = broken
    ? '<p style="margin:8px 0;padding:8px 10px;border-left:3px solid #b45309;'
      + 'background:#fffbeb;font-size:12.5px">'
      + broken + " of " + sorted.length + " components ("
      + Math.round((100 * broken) / sorted.length) + "%) could not be named: "
      + "no text, no fill, no distinct shape. Where these are one decoration "
      + "split into many instances, the extraction is at fault and they are "
      + "not meant to be built.</p>"
    : "";
  const rows = TIERS.map(([tier, title, note]) => {
    const group = sorted.filter((c) => tierOf(c) === tier);
    if (!group.length) return "";
    const open = group.length <= OPEN_UP_TO && tier !== "unnamed";
    // One table per tier, inside a details element: the big tiers stay shut
    // until asked for, and the header says how many are in there.
    return `<tr><td colspan="7" style="padding:0;border:0">
      <details ${open ? "open" : ""} style="margin:14px 0 4px">
        <summary style="cursor:pointer;font-weight:600;font-size:13px;padding:6px 0">
          ${title} · ${group.length}${note ? ' <span style="color:#71717a;font-weight:400">— ' + note + "</span>" : ""}
        </summary>
        <table style="width:100%;margin-top:6px">${group.map(rowHtml).join("")}</table>
      </details></td></tr>`;
  }).join("");
  const bgCards = (bgassets && bgassets.groups || []).map((g) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
      <img src="${g.file}" style="width:150px;border:1px solid #e4e4e7;border-radius:6px;background:#fff">
      <div style="font-size:11.5px">
        <b>${esc(g.name)}</b> <code>${g.id}</code><br>
        ${r1(g.box.w)}×${r1(g.box.h)} @${r1(g.box.x)},${r1(g.box.y)} · ${g.parts} shapes<br>
        ${(g.fills || []).map((f) => '<span class="sw" style="background:' + f + '"></span>' + f).join(" ")}<br>
        <span style="color:#71717a">${esc(g.reason)}</span><br>
        <code>${esc(g.file)}</code>
      </div>
    </div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Design analysis · ${esc(S.name)}</title>
<style>
 body{font:13px/1.6 -apple-system,Inter,sans-serif;margin:0;background:#f6f6f7;color:#18181b}
 header{background:#fff;border-bottom:1px solid #e4e4e7;padding:14px 22px}
 h1{font-size:17px;margin:0 0 4px}
 .meta{color:#71717a;font-size:12px}
 main{display:flex;gap:22px;padding:22px;align-items:flex-start;max-width:1560px;margin:0 auto}
 .shot{flex:0 0 420px;background:#fff;padding:10px;border:1px solid #e4e4e7;border-radius:10px}
 .shot img{display:block;width:100%;border-radius:6px}
 .panel{flex:1;min-width:0}
 .card{background:#fff;border:1px solid #e4e4e7;border-radius:10px;padding:14px 16px;margin-bottom:14px}
 h2{font-size:14px;margin:0 0 10px}
 table{width:100%;border-collapse:collapse;font-size:11.5px}
 th,td{text-align:left;padding:4px 7px;border-bottom:1px solid #f1f1f3;vertical-align:top}
 th{color:#71717a;font-weight:600;background:#fafafa}
 .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;border:1px solid #d4d4d8;vertical-align:-1px}
 .k{display:inline-block;background:#f4f4f5;border-radius:4px;padding:2px 7px;margin:2px 5px 2px 0;font-size:11px}
 .warn{background:#fffbeb;border-color:#fde68a}
 .ok{background:#f0fdf4;border-color:#bbf7d0}
 .thumb{max-width:220px;max-height:120px;border:1px solid #e4e4e7;border-radius:4px;display:block;background:#fff}
</style></head><body>
<header>
 <h1>${esc(S.name)}</h1>
 <div class="meta">${S.size.w}×${S.size.h} · ${S.platform} · nodes ${meta.nodes} · components ${inv.counts.components}
 · layouts ${inv.counts.layouts}${cross ? " · corroboration " + cross.corroborationRate + "%" : ""}
 · <a href="${esc(meta.url)}" target="_blank">Open in Figma</a> · <a href="${base}.spec.md">Implementation spec</a></div>
</header>
<main>
 <div class="shot">
  <div style="font-size:11px;color:#71717a;margin-bottom:6px">Overlay: solid = file components · red dashed = pixels only | <a href="${base}.png" target="_blank">original</a></div>
  ${overlayTiles.map((f, i) => '<img src="' + f + '" alt="overlay ' + (i + 1) + '"'
      + (i ? ' style="margin-top:8px"' : "") + ">").join("\n  ")}
 </div>
 <div class="panel">
  ${bgCards ? `<div class="card ok"><h2>Background image assets (exported, use directly)</h2>${bgCards}</div>` : ""}
  <div class="card"><h2>Background composition</h2>
   ${inv.background.layers.map((b) => `<span class="k"><span class="sw" style="background:${b.fill}"></span>${b.fill} · ${b.coverage}%</span>`).join("")}
  </div>
  <div class="card"><h2>Palette</h2>
   ${inv.palette.slice(0, 16).map((p) => `<span class="k"><span class="sw" style="background:${p.hex}"></span>${p.hex} ×${p.uses}</span>`).join("")}
  </div>
  <div class="card"><h2>Type scale</h2>
   ${inv.typography.map((t) => `<span class="k">${t.size}px / ${t.weight} ×${t.uses}</span>`).join("")}
  </div>
  ${detcmp && detcmp.length ? `<div class="card"><h2>Recognition check (independent detectors)</h2>
   <table><tr><th>Detector</th><th>Boxes</th><th>Time</th><th>Explained</th><th>Uncovered</th></tr>
   ${detcmp.map((d) => `<tr><td>${d.name}</td><td>${d.boxes}</td><td>${d.seconds || "-"}s</td><td>${d.explainedPct}%</td><td>${d.missed.length}</td></tr>`).join("")}
   </table>
   ${detcmp.flatMap((d) => d.missed.map((m) => `<div style="color:#b45309">· uncovered @${r1(m.x)},${r1(m.y)} ${r1(m.w)}×${r1(m.h)}（${d.name}）</div>`)).join("")}
  </div>` : ""}
  ${raster && (raster.detected || []).length ? `<div class="card warn"><h2>Pixels-only content (red dashed)</h2>
   <div style="font-size:12px;color:#92400e;margin-bottom:6px">Baked into images with no Figma node. If it must be interactive, ask design to make it a component.</div>
   ${raster.detected.slice(0, 20).map((b) => `<div>· @${r1(b.x)},${r1(b.y)} ${r1(b.w)}×${r1(b.h)}</div>`).join("")}
  </div>` : ""}
  <div class="card"><h2>Components · ${inv.counts.components}</h2>
   ${brokenNote}
   <table>
    <tr><th>Crop</th><th>Node / name</th><th>Role</th><th>Position / size</th><th>Fill</th><th>Font</th><th>Text</th></tr>
    ${rows}
   </table>
  </div>
 </div>
</main></body></html>`;
}

const main = () => {
  const node = process.argv[2];
  const url = process.argv[3] || "";
  const dir = WORK;
  const base = node.replace(":", "-");
  const invRaw = JSON.parse(fs.readFileSync(path.join(dir, base + ".inventory.json"), "utf8"));
  const inv = invRaw.excluded ? invRaw : (() => {
    const split = splitComponents(invRaw.components, invRaw.screen);
    return { ...invRaw, components: split.deliverable,
      counts: { ...invRaw.counts, components: split.deliverable.length },
      excluded: { decoration: split.decoration, offCanvas: split.offCanvas, background: split.background } };
  })();
  const summary = JSON.parse(fs.readFileSync(path.join(dir, base + ".summary.json"), "utf8"));

  const read = (suffix) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, base + suffix), "utf8")); } catch { return null; }
  };
  const cross = read(".cross.json");
  const raster = read(".raster.json");
  const bgassets = read(".bg-assets.json");

  let detcmp = null;
  const det = read(".detectors.json");
  if (det) {
    const iou = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy;
      return inter / (a.w * a.h + b.w * b.h - inter || 1);
    };
    const centerIn = (a, b) => a.x + a.w / 2 >= b.x && a.x + a.w / 2 <= b.x + b.w
      && a.y + a.h / 2 >= b.y && a.y + a.h / 2 <= b.y + b.h;
    detcmp = [];
    for (const [name, d] of Object.entries(det)) {
      if (!d.boxes) continue;
      let explained = 0;
      const missed = [];
      for (const b of d.boxes) {
        if (inv.components.some((c) => iou(b, c.box) >= 0.3 || centerIn(b, c.box))) explained++;
        else missed.push(b);
      }
      detcmp.push({ name, boxes: d.boxes.length, seconds: d.seconds,
        explainedPct: Math.round(explained / Math.max(1, d.boxes.length) * 100),
        missed: missed.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 8) });
    }
  }

  const cropDir = "crops-" + base;
  let crops = {};
  try { crops = JSON.parse(fs.readFileSync(path.join(dir, cropDir, "manifest.json"), "utf8")); } catch {}
  const meta = { url, nodes: summary.nodes, crops, cropDir,
    fileKey: (url.match(/design\/([A-Za-z0-9]+)/) || [])[1] || "-" };

  fs.writeFileSync(path.join(dir, base + ".spec.md"), specMarkdown(inv, cross, raster, meta, detcmp, bgassets));
  fs.writeFileSync(path.join(dir, base + ".review.html"), reviewHtml(inv, cross, raster, meta, base, detcmp, bgassets));
  fs.writeFileSync(path.join(dir, base + ".tokens.json"), JSON.stringify({
    screen: inv.screen, background: inv.background, colors: inv.palette,
    typography: inv.typography, componentCandidates: inv.componentCandidates,
    layouts: inv.layouts, components: inv.components,
    backgroundAssets: bgassets ? bgassets.groups : [],
    rasterOnly: raster ? raster.detected : [],
    excluded: inv.excluded,
  }, null, 1));

  console.log("review page: " + path.join(dir, base + ".review.html"));
  console.log("Implementation spec: " + path.join(dir, base + ".spec.md"));
  console.log("tokens:      " + path.join(dir, base + ".tokens.json"));
};
main();
