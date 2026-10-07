#!/usr/bin/env node
// Pack one screen's analysis into a self-describing bundle for batch AI use.
//
// The working directory grew organically: 19 flat files per screen in one
// namespace, mixed with leftovers from other designs. An agent consuming that
// has to guess filenames and will happily read a 138KB IR into context.
//
// The bundle fixes three things:
//   LOCATION   one directory per screen, stable internal names
//   ENTRY      manifest.json is tiny and points at everything else
//   BUDGET     tiers by size so an agent reads only what it needs:
//                tier0 manifest      ~2KB   always read
//                tier1 implement.md  ~15KB  read to build the screen
//                tier2 components/   ~90KB  read for exact per-node data
//                tier3 raw/          ~300KB only for debugging the pipeline
//
// Readiness travels WITH the data: an agent must be able to see that
// interaction states are 0% before it starts writing a button.
import fs from "node:fs";
import path from "node:path";
import { scoreReadiness } from "./readiness.js";
import os from "node:os";
import { lensHome } from "../store/home.mjs";
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");




const copy = (src, dst) => { if (fs.existsSync(src)) { fs.copyFileSync(src, dst); return true; } return false; };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

const main = () => {
  const node = process.argv[2];
  const url = process.argv[3] || "";
  const base = node.replace(":", "-");
  // The pipeline passes explicit directories; falling back to the work dir
  // keeps the module usable standalone for debugging.
  const src = process.argv[4] || WORK;
  const out = process.argv[5] || path.join(WORK, "screens", base);

  for (const d of ["", "components", "assets", "crops", "raw", "review"]) {
    fs.mkdirSync(path.join(out, d), { recursive: true });
  }

  const inv = readJson(path.join(src, base + ".inventory.json"));
  const summary = readJson(path.join(src, base + ".summary.json"));
  const cross = readJson(path.join(src, base + ".cross.json"));
  const raster = readJson(path.join(src, base + ".raster.json"));
  const bgassets = readJson(path.join(src, base + ".bg-assets.json"));
  const assetManifest = readJson(path.join(src, base + ".assets.json"));
  const det = readJson(path.join(src, base + ".detectors.json"));

  let detcmp = null;
  if (det) {
    const iou = (a, b) => {
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy;
      return inter / (a.w * a.h + b.w * b.h - inter || 1);
    };
    detcmp = [];
    for (const [name, d] of Object.entries(det)) {
      if (!d.boxes) continue;
      let explained = 0; const missed = [];
      for (const b of d.boxes) {
        if (inv.components.some((c) => iou(b, c.box) >= 0.3)) explained++; else missed.push(b);
      }
      detcmp.push({ name, boxes: d.boxes.length,
        explainedPct: Math.round(explained / Math.max(1, d.boxes.length) * 100),
        missed: missed.slice(0, 8) });
    }
  }

  const readiness = scoreReadiness(inv, { cross, raster, detcmp, bgassets });

  // ---- tier2: components split by role, with provenance on every field
  const byRole = {};
  for (const c of inv.components) (byRole[c.role] = byRole[c.role] || []).push({
    id: c.id,
    name: (c.semantic && c.semantic.suggestName) || c.name || null,
    describes: (c.semantic && c.semantic.depicts) || null,
    confidence: c.semantic ? c.semantic.confidence : null,
    measured: { box: c.box, fill: c.fill, fillFrom: c.fillFrom || null,
      // A fill's own alpha, distinct from the node's opacity. Dropping it made
      // every translucent card render as opaque white over a dark screen.
      fillOpacity: c.fillOpacity == null ? null : c.fillOpacity,
      radius: c.radius, border: c.border,
      opacity: c.opacity, text: c.text, font: c.font },
    figmaName: c.name || null,
    path: c.path,
  });
  for (const [role, list] of Object.entries(byRole)) {
    fs.writeFileSync(path.join(out, "components", role + ".json"), JSON.stringify(list, null, 1));
  }

  // ---- assets and crops
  const assetDir = path.join(src, "assets-" + base);
  let assetFiles = [];
  if (fs.existsSync(assetDir)) {
    assetFiles = fs.readdirSync(assetDir).filter((f) => f.endsWith(".png"));
    for (const f of assetFiles) copy(path.join(assetDir, f), path.join(out, "assets", f));
  }
  const cropDir = path.join(src, "crops-" + base);
  let cropCount = 0;
  if (fs.existsSync(cropDir)) {
    for (const f of fs.readdirSync(cropDir)) {
      if (copy(path.join(cropDir, f), path.join(out, "crops", f)) && f.endsWith(".png")) cropCount++;
    }
  }

  // The review page is generated during analysis and references files by their
  // staging names (15076-22721.overlay-1.png, crops-15076-22721/...). Packing
  // reorganises them into review/ assets/ crops/ with the prefixes stripped, so
  // every image in the copied page 404s unless the references are rewritten.
  const reviewSrc = path.join(src, base + ".review.html");
  if (fs.existsSync(reviewSrc)) {
    const html = fs.readFileSync(reviewSrc, "utf8")
      .split(base + ".overlay-").join("overlay-")
      .split("crops-" + base + "/").join("../crops/")
      .split("assets-" + base + "/").join("../assets/")
      .split('href="' + base + ".spec.md").join('href="../implement.md')
      .split('href="' + base + ".png").join('href="design.png')
      .split('src="' + base + ".png").join('src="design.png');
    fs.writeFileSync(path.join(out, "review", "index.html"), html);
  }
  // Copy however many overlay tiles exist. The count depends on screen height
  // (one tile per ~1900px), so a fixed list either drops the tail of a tall
  // screen or references a file a short screen never produced.
  const tiles = [];
  for (let i = 1; i <= 24; i++) {
    const f = base + ".overlay-" + i + ".png";
    if (fs.existsSync(path.join(src, f))) {
      copy(path.join(src, f), path.join(out, "review", "overlay-" + i + ".png"));
      tiles.push("review/overlay-" + i + ".png");
    }
  }
  copy(path.join(src, base + ".png"), path.join(out, "review", "design.png"));
  // bg-assets.json records which layer groups were exported as images. It was
  // missing from this list, so readiness saw asset components with no exports
  // and scored 0% — the assets existed, the bundle just did not carry the proof.
  for (const [srcName, dstName] of [[".ir.json", "ir.json"], [".inventory.json", "inventory.json"],
    [".detectors.json", "detectors.json"], [".cross.json", "cross.json"],
    [".raster.json", "raster.json"], [".semantics.json", "semantics.json"],
    [".bg-assets.json", "bg-assets.json"], [".assets.json", "assets.json"], [".paint.json", "paint.json"]]) {
    copy(path.join(src, base + srcName), path.join(out, "raw", dstName));
  }
  copy(path.join(src, base + ".spec.md"), path.join(out, "implement.md"));

  // ---- tier0: the entry point
  const S = inv.screen;
  const manifest = {
    schema: "dsh-figma-design-lens-cat/screen/1",
    screen: { id: S.id, name: S.name, size: S.size, platform: S.platform },
    source: { tool: "figma", fileKey: (url.match(/design\/([A-Za-z0-9]+)/) || [])[1] || null,
      node, url, analysedAt: new Date().toISOString() },
    readiness,
    counts: {
      components: inv.counts.components,
      byRole: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v.length])),
      layouts: inv.counts.layouts,
      excludedDecoration: (inv.excluded && inv.excluded.decoration || []).length,
      rasterOnly: raster ? (raster.detected || []).length : 0,
      assetsExported: assetFiles.length,
      crops: cropCount,
    },
    files: {
      implement: "implement.md",
      components: Object.keys(byRole).map((r) => "components/" + r + ".json"),
      assets: assetFiles.map((f) => "assets/" + f),
      assetManifest: assetManifest ? "raw/assets.json" : null,
      review: "review/index.html",
      annotated: tiles,
      design: "review/design.png",
      raw: ["raw/ir.json", "raw/inventory.json"],
    },
    howToUse: {
      start: "Read implement.md to build this screen; it contains no images and is a complete text spec.",
      exactValues: "For exact values read components/<role>.json; measured.* comes from the Figma file and must not be rewritten.",
      semantics: "name/describes are model inferences with a confidence; below 0.7 needs human confirmation.",
      images: "assets/ holds every clear image/vector candidate exported during analysis; raw/assets.json maps each file back to its Figma node, reason, bounds and kind. Reference exported files directly instead of redrawing.",
      limits: "readiness.blockers lists what this analysis cannot provide (such as interaction states); resolve or ask a human before building.",
    },
  };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  const size = (p) => {
    let total = 0;
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const fp = path.join(d, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp); else total += st.size;
      }
    };
    walk(p);
    return total;
  };
  console.log("packed: " + out);
  console.log("  manifest.json  " + (fs.statSync(path.join(out, "manifest.json")).size / 1024).toFixed(1) + "KB  <- AI entry point");
  console.log("  implement.md   " + (fs.statSync(path.join(out, "implement.md")).size / 1024).toFixed(1) + "KB");
  console.log("  components/    " + Object.keys(byRole).length + " role files");
  console.log("  assets/        " + assetFiles.length + " files");
  console.log("  crops/         " + cropCount + " files");
  console.log("  total          " + (size(out) / 1024 / 1024).toFixed(1) + "MB");
  console.log();
  console.log("readiness: " + Object.entries(readiness.axes).map(([k, v]) => k + " " + v + "%").join(" · "));
  console.log("verdict:   " + readiness.verdict);
};
main();
