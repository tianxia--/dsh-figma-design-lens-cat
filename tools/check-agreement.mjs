#!/usr/bin/env node
// Do the two records of a screen agree about where things are?
//
// The paint list and the export manifest are built by separate walks, and for
// a while they disagreed: the same rotated node was 703x692 in one and its
// true 416x572 in the other, because only one of them had been moved onto the
// normalised tree. The model reads the paint list, so it was drawing from the
// wrong one.
//
// That class of bug is invisible in any single file and obvious the moment
// the two are compared, so the comparison is worth keeping.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function disagreements(latest, tolerance = 1.5) {
  const paintFile = path.join(latest, "raw", "paint.json");
  const bgFile = path.join(latest, "raw", "bg-assets.json");
  if (!fs.existsSync(paintFile) || !fs.existsSync(bgFile)) return null;

  const paint = JSON.parse(fs.readFileSync(paintFile, "utf8"));
  const groups = JSON.parse(fs.readFileSync(bgFile, "utf8")).groups || [];
  const byId = new Map(paint.items.map((i) => [i.id, i]));

  const out = [];
  for (const g of groups) {
    const item = byId.get(g.id);
    if (!item) continue;   // exported as an ancestor; nothing to compare
    const d = Math.max(
      Math.abs(item.box.x - g.box.x), Math.abs(item.box.y - g.box.y),
      Math.abs(item.box.w - g.box.w), Math.abs(item.box.h - g.box.h));
    if (d > tolerance) {
      out.push({ id: g.id, name: g.name, delta: Math.round(d * 100) / 100,
        paint: item.box, exported: g.box });
    }
  }
  return out;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const root = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects");
  let screens = 0, bad = 0;
  const worst = [];
  for (const proj of fs.readdirSync(root)) {
    const dir = path.join(root, proj, "screens");
    if (!fs.existsSync(dir)) continue;
    for (const sid of fs.readdirSync(dir)) {
      const d = disagreements(path.join(dir, sid, "latest"));
      if (!d) continue;
      screens++;
      if (d.length) { bad++; for (const x of d) worst.push({ sid, ...x }); }
    }
  }
  console.log("screens compared:        " + screens);
  console.log("screens that disagree:   " + bad);
  console.log("nodes that disagree:     " + worst.length);
  if (worst.length) {
    worst.sort((a, b) => b.delta - a.delta);
    console.log();
    for (const w of worst.slice(0, 8)) {
      console.log("  " + w.sid.padEnd(16) + String(w.name).slice(0, 16).padEnd(18)
        + "off by " + w.delta);
      console.log("      paint " + JSON.stringify(w.paint));
      console.log("      export " + JSON.stringify(w.exported));
    }
  }
  process.exit(worst.length ? 1 : 0);
}
