#!/usr/bin/env node
// How much of the geometry that cannot be rebuilt is actually covered by an
// exported image.
//
// Getting this number right took four attempts, and each wrong answer pointed
// at a defect that was not there:
//
//   matching by node id      — an exported group carries the ancestor's id,
//                              so a covered child looked missing
//   requiring full containment — a shape that starts above the top edge is
//                              still drawn inside its parent's image
//   ignoring the visible clip — a node reaching past the screen is covered
//                              when the part on screen is covered
//
// The definition that holds: clip the node to the screen, then ask whether
// that visible rectangle sits inside any exported region.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const NEEDS_IMAGE = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON"]);
const OPERAND_PARENT = /^(union|subtract|intersect|exclude)\b/i;

export function coverage(latest) {
  const paintFile = path.join(latest, "raw", "paint.json");
  const bgFile = path.join(latest, "raw", "bg-assets.json");
  if (!fs.existsSync(paintFile)) return null;

  const paint = JSON.parse(fs.readFileSync(paintFile, "utf8"));
  const boxes = fs.existsSync(bgFile)
    ? (JSON.parse(fs.readFileSync(bgFile, "utf8")).groups || []).map((g) => g.box)
    : [];
  const W = paint.screen?.size?.w || 0;
  const H = paint.screen?.size?.h || 0;

  let needed = 0, covered = 0;
  const missing = [];

  for (const item of paint.items || []) {
    if (!NEEDS_IMAGE.has(item.type)) continue;
    // An operand of a boolean is consumed by it and is never its own asset.
    if (OPERAND_PARENT.test(item.parent || "")) continue;

    const b = item.box;
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(W, b.x + b.w), y1 = Math.min(H, b.y + b.h);
    if (x1 <= x0 || y1 <= y0) continue;   // nothing of it is on screen

    needed++;
    const vis = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const t = 3;
    // A node is covered when it is itself exported, or when its visible part
    // sits inside an exported region. Testing only containment missed the
    // first case: an exported box is recorded unclipped, so a shape reaching
    // past the screen never matched the clipped rectangle of itself.
    const isSelf = (a) => Math.abs(a.x - b.x) <= t && Math.abs(a.y - b.y) <= t
      && Math.abs(a.w - b.w) <= t && Math.abs(a.h - b.h) <= t;
    const contains = (a) => vis.x >= a.x - t && vis.y >= a.y - t
      && vis.x + vis.w <= a.x + a.w + t && vis.y + vis.h <= a.y + a.h + t;
    const hit = boxes.some((a) => isSelf(a) || contains(a));

    if (hit) covered++;
    else missing.push({ name: item.name, type: item.type, box: vis });
  }

  return { needed, covered, missing };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const root = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects");
  let needed = 0, covered = 0;
  const worst = [];
  for (const proj of fs.readdirSync(root)) {
    const dir = path.join(root, proj, "screens");
    if (!fs.existsSync(dir)) continue;
    for (const sid of fs.readdirSync(dir)) {
      const r = coverage(path.join(dir, sid, "latest"));
      if (!r) continue;
      needed += r.needed; covered += r.covered;
      for (const m of r.missing) worst.push({ sid, ...m });
    }
  }
  const pct = needed ? (100 * covered / needed).toFixed(1) : "0.0";
  console.log("geometry needing an image: " + needed);
  console.log("covered by an export:      " + covered + " (" + pct + "%)");
  console.log("uncovered:                 " + (needed - covered));
  worst.sort((a, b) => (b.box.w * b.box.h) - (a.box.w * a.box.h));
  console.log();
  console.log("largest uncovered:");
  for (const m of worst.slice(0, 8)) {
    console.log("  " + m.sid.padEnd(16) + String(m.name).slice(0, 16).padEnd(18)
      + m.type.padEnd(20) + Math.round(m.box.w) + "x" + Math.round(m.box.h));
  }
}
