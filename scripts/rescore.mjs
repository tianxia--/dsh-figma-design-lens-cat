#!/usr/bin/env node
// Re-derive readiness for every stored bundle from its retained raw data.
// Needed whenever the scoring rules change: manifests hold a snapshot, and a
// rule fix must reach analyses that already exist rather than only new ones.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scoreReadiness } from "../src/ir/readiness.js";

const HOME = process.env.LENS_HOME || path.join(os.homedir(), ".dsh-figma-design-lens-cat");
const root = path.join(HOME, "projects");
if (!fs.existsSync(root)) { console.log("no projects"); process.exit(0); }

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

let n = 0;
for (const pid of fs.readdirSync(root)) {
  const sdir = path.join(root, pid, "screens");
  if (!fs.existsSync(sdir)) continue;
  for (const sid of fs.readdirSync(sdir)) {
    const variants = ["latest"];
    const vroot = path.join(sdir, sid, "versions");
    if (fs.existsSync(vroot)) for (const v of fs.readdirSync(vroot)) variants.push(path.join("versions", v));
    for (const variant of variants) {
      const dir = path.join(sdir, sid, variant);
      const mf = path.join(dir, "manifest.json");
      if (!fs.existsSync(mf)) continue;
      const man = JSON.parse(fs.readFileSync(mf, "utf8"));
      const raw = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "raw", f), "utf8")); } catch { return null; } };
      const inv = raw("inventory.json");
      if (!inv) continue;

      let detcmp = null;
      const det = raw("detectors.json");
      if (det) {
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
      man.readiness = scoreReadiness(inv, { cross: raw("cross.json"), raster: raw("raster.json"),
        detcmp, bgassets: raw("bg-assets.json") });
      fs.writeFileSync(mf, JSON.stringify(man, null, 1));
      n++;
    }
  }
}
console.log("rescored " + n + " manifests");
