#!/usr/bin/env node
// Rank where fidelity is being lost, across every analysed screen.
//
// Finding defects by looking at one render at a time found real bugs but gave
// no sense of which class costs the most. Counting them over the corpus does.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const root = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects");
const counts = new Map();
const perScreen = new Map();
let screens = 0;

const bump = (kind, sid) => {
  counts.set(kind, (counts.get(kind) || 0) + 1);
  if (!perScreen.has(kind)) perScreen.set(kind, new Set());
  perScreen.get(kind).add(sid);
};

for (const proj of fs.readdirSync(root)) {
  const dir = path.join(root, proj, "screens");
  if (!fs.existsSync(dir)) continue;
  for (const sid of fs.readdirSync(dir)) {
    const latest = path.join(dir, sid, "latest");
    const bgFile = path.join(latest, "raw", "bg-assets.json");
    const paintFile = path.join(latest, "raw", "paint.json");
    if (!fs.existsSync(paintFile)) continue;
    screens++;

    if (fs.existsSync(bgFile)) {
      for (const g of JSON.parse(fs.readFileSync(bgFile, "utf8")).groups || []) {
        bump(g.kind || "exported-other", sid);
      }
    }

    const paint = JSON.parse(fs.readFileSync(paintFile, "utf8"));
    const H = paint.screen?.size?.h || 0;
    for (const i of paint.items || []) {
      if (H && i.box.y >= H) bump("offscreen-dropped", sid);
      if (i.font?.sizing === "fixed-width" && i.text) bump("text-may-not-fit", sid);
      const f = i.font?.family;
      if (f) bump("font:" + f, sid);
    }
  }
}

const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log("screens scanned: " + screens);
console.log();
console.log("kind".padEnd(28) + "count".padStart(8) + "screens".padStart(10));
for (const [kind, n] of rows) {
  console.log(kind.slice(0, 27).padEnd(28) + String(n).padStart(8)
    + String(perScreen.get(kind).size).padStart(10));
}
