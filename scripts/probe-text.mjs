import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// Show the text components in a vertical band, to compare what the file says
// against what a screenshot shows.
const [pid, sid, yMin, yMax] = process.argv.slice(2);
const dir = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects", pid, "screens", sid, "latest");
const inv = JSON.parse(fs.readFileSync(path.join(dir, "raw", "inventory.json"), "utf8"));
const lo = Number(yMin || 0), hi = Number(yMax || 1e9);
const near = inv.components
  .filter((c) => c.role === "text" && c.box.y >= lo && c.box.y <= hi)
  .sort((a, b) => a.box.y - b.box.y);
for (const c of near) {
  console.log("  y=" + String(Math.round(c.box.y)).padStart(4)
    + "  " + JSON.stringify(String(c.text || "").slice(0, 28)).padEnd(32)
    + Math.round(c.box.w) + "x" + Math.round(c.box.h)
    + "  " + (c.font ? c.font.size + "px" : ""));
}
