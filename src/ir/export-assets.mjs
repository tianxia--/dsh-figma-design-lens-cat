#!/usr/bin/env node
// Export every clear image/vector asset candidate through the Figma images API.
//
// Asset export is intentionally structural, not detector-gated: if Figma says a
// node is an image fill, vector, boolean artwork, rotated shape, or graphical
// background group, the analysis downloads it before any vision model decides
// what the pixels depict.
import fs from "node:fs";
import path from "node:path";
import { resolveToken } from "../figma/client.js";
import { findBackgroundGroups } from "./bg-groups.js";
import os from "node:os";
import { lensHome } from "../store/home.mjs";

// PNG dimensions live in the IHDR chunk, right after an 8-byte signature.
// Reading them here avoids an image dependency for two integers.
function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");




const main = async () => {
  const node = process.argv[2];
  const fileKey = process.argv[3];
  const base = node.replace(":", "-");
  const dir = WORK;
  const outDir = path.join(dir, "assets-" + base);
  fs.mkdirSync(outDir, { recursive: true });

  const ir = JSON.parse(fs.readFileSync(path.join(dir, base + ".ir.json"), "utf8"));
  const groups = findBackgroundGroups(ir.screens[0]);
  if (!groups.length) { console.log("no exportable background layer groups"); return; }

  const token = resolveToken();
  const ids = groups.map((g) => g.id);
  const url = "https://api.figma.com/v1/images/" + fileKey
    + "?ids=" + encodeURIComponent(ids.join(",")) + "&format=png&scale=2";
  const r = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!r.ok) throw new Error("images " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json();

  const manifest = [];
  for (const g of groups) {
    const link = j.images?.[g.id];
    if (!link) { console.log("  no render for: " + g.id + " " + g.name); continue; }
    const im = await fetch(link);
    const file = "bg-" + g.id.replace(":", "-") + ".png";
    const bytes = Buffer.from(await im.arrayBuffer());
    fs.writeFileSync(path.join(outDir, file), bytes);

    // Figma renders the group's actual ink, which can be shorter than the
    // frame the node declares: the heart thumbnail is an 80x80 frame holding
    // 80x72.5 of artwork. Drawing the file at the frame size stretches it, so
    // the real pixel size travels with the manifest.
    const png = pngSize(bytes);
    const scale = 2;
    // For a rotated shape Figma renders the axis-aligned box around it, which
    // is larger than the shape on both axes: a 416x572 vector came back as a
    // 1021x1007 image and was drawn at that size, covering the screen. Where
    // the node is rotated the recovered box is what the renderer needs; the
    // pixel size still travels in `pixels` for anyone who wants it.
    const rotated = Number(g.rotation || 0) % 180 !== 0;
    const rendered = rotated
      ? { w: Math.round(g.box.w * 100) / 100, h: Math.round(g.box.h * 100) / 100 }
      : png
        ? { w: Math.round((png.w / scale) * 100) / 100, h: Math.round((png.h / scale) * 100) / 100 }
        : null;
    manifest.push({ ...g, file: "assets-" + base + "/" + file, pixels: png, rendered });
    console.log("  exported " + file + "  " + g.name + "  " + Math.round(g.box.w) + "x" + Math.round(g.box.h)
      + "  (" + g.parts + " shapes)");
  }
  const assetManifest = {
    note: "All clear image/vector asset candidates exported during analysis at designer bounds (scale=2). Use these files directly rather than guessing or redrawing their pixels.",
    groups: manifest,
    assets: manifest.map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind || (g.hasImageFill ? "image-fill" : "graphic-group"),
      reason: g.reason,
      file: g.file,
      box: g.box,
      rendered: g.rendered,
      pixels: g.pixels,
      contains: g.contains || [g.id],
    })),
  };
  fs.writeFileSync(path.join(dir, base + ".bg-assets.json"),
    JSON.stringify(assetManifest, null, 1));
  fs.writeFileSync(path.join(dir, base + ".assets.json"),
    JSON.stringify(assetManifest, null, 1));
  console.log("manifest: " + path.join(dir, base + ".bg-assets.json"));
};
main().catch((e) => { console.error("export failed:", e.message); process.exit(1); });
