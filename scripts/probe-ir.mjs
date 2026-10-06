import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Walk the raw IR looking for a string, reporting where each hit sits in the
// tree and whether it survived into the inventory.
const [pid, sid, needle] = process.argv.slice(2);
const dir = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects", pid, "screens", sid, "latest");
const ir = JSON.parse(fs.readFileSync(path.join(dir, "raw", "ir.json"), "utf8"));
const inv = JSON.parse(fs.readFileSync(path.join(dir, "raw", "inventory.json"), "utf8"));
const rx = new RegExp(needle, "i");
const inInventory = new Set(inv.components.map((c) => c.id));
const excluded = new Map();
for (const [bucket, list] of Object.entries(inv.excluded || {})) {
  for (const c of list || []) excluded.set(c.id, bucket + (c.classificationWhy ? " — " + c.classificationWhy : ""));
}
let n = 0;
const walk = (node, depth, trail) => {
  const label = node.text || node.name || "";
  if (rx.test(label)) {
    n++;
    const where = inInventory.has(node.id) ? "IN INVENTORY"
      : excluded.has(node.id) ? "EXCLUDED: " + excluded.get(node.id)
      : "NOT CARRIED FORWARD";
    console.log("  " + JSON.stringify(String(label).slice(0, 26)));
    console.log("    id      " + node.id);
    console.log("    type    " + node.type + "   visible=" + (node.visible !== false));
    console.log("    box     " + (node.box ? Math.round(node.box.w) + "x" + Math.round(node.box.h)
      + " @" + Math.round(node.box.x) + "," + Math.round(node.box.y) : "-"));
    console.log("    path    " + trail.slice(-4).join(" / "));
    console.log("    status  " + where);
    console.log();
  }
  for (const c of node.children || []) walk(c, depth + 1, [...trail, node.name || node.type]);
};
walk(ir.screens[0].root, 0, []);
if (!n) console.log("  no node matching /" + needle + "/i in the IR at all");
