import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Report components whose text and geometry coincide. Two identical nodes at
// one position mean the same pixel is claimed twice, which inflates counts and
// draws two boxes over one thing.
const [pid, sid] = process.argv.slice(2);
const dir = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects", pid, "screens", sid, "latest");
const inv = JSON.parse(fs.readFileSync(path.join(dir, "raw", "inventory.json"), "utf8"));

const key = (c) => [c.text || "", Math.round(c.box.x), Math.round(c.box.y),
  Math.round(c.box.w), Math.round(c.box.h)].join("|");
const groups = new Map();
for (const c of inv.components) {
  const k = key(c);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}
let dupes = 0;
for (const [k, list] of groups) {
  if (list.length < 2) continue;
  dupes += list.length - 1;
  console.log(JSON.stringify(k));
  for (const c of list) {
    console.log("  " + String(c.id).padEnd(30) + c.role.padEnd(9)
      + "insideAtomic=" + (c.insideAtomic || "-")
      + "  path=" + (Array.isArray(c.path) ? c.path.slice(-2).join("/") : String(c.path || "")));
  }
  console.log();
}
console.log("components: " + inv.components.length + ", redundant: " + dupes);
