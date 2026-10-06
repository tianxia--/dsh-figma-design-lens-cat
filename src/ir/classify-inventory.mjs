#!/usr/bin/env node
// Apply classification ONCE and persist it, so overlay / crops / reports all
// read the same filtered truth. Decoration is not discarded: proximity clusters
// become background ASSETS (the header pattern is one exported image, which is
// exactly what a developer needs from it).
//
// Rule-based naming runs here too. semantics scored 0% on every screen because
// LLM enrichment was a manual step that `lens add` never invoked; a screen
// whose components are all nameless cannot be implemented. Deterministic names
// raise the floor, and LLM enrichment overwrites them where it runs.
import fs from "node:fs";
import { splitComponents } from "./classify.js";
import { clusterDecoration } from "./assets.js";
import { collapseDuplicates } from "./dedupe.js";
import { autoNameInventory } from "./autoname.js";

const file = process.argv[2];
const inv = JSON.parse(fs.readFileSync(file, "utf8"));
if (inv.excluded) { console.log("already classified"); process.exit(0); }

const split = splitComponents(inv.components, inv.screen);
const assets = clusterDecoration(split.decoration,
  { screenW: inv.screen.size.w, screenH: inv.screen.size.h }).map((a, i) => ({
  id: "asset-" + (i + 1), ...a, fill: null, radius: 0, opacity: 1, text: null, font: null,
  signature: "asset", composite: { kind: "asset", parts: a.parts, partNames: a.partNames },
}));
const out = { ...inv,
  components: [...split.deliverable, ...assets],
  counts: { ...inv.counts, components: split.deliverable.length + assets.length },
  excluded: { decoration: split.decoration, offCanvas: split.offCanvas, background: split.background } };

let irRoot = null;
try {
  irRoot = JSON.parse(fs.readFileSync(file.replace(".inventory.json", ".ir.json"), "utf8")).screens[0].root;
} catch { /* naming still works without the tree, with less context */ }

// Duplicate layers (two identical status bars stacked) are folded into one, so
// the overlay draws one box where the screen shows one thing.
const dedup = collapseDuplicates(out.components);
out.components = dedup.components;
out.counts.components = dedup.components.length;
out.counts.duplicatesCollapsed = dedup.collapsed;
const autoNamed = autoNameInventory(out, irRoot);

fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log("deliverable " + split.deliverable.length + " + assets " + assets.length
  + " · decoration " + split.decoration.length + " · offCanvas " + split.offCanvas.length
  + " · auto-named " + autoNamed);
