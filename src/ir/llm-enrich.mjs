#!/usr/bin/env node
// LLM enrichment — strictly scoped to what deterministic rules cannot do.
//
// Division of labour, enforced by construction rather than by prompt wording:
//   FILE  owns every number: geometry, colours, font sizes, text content,
//         hierarchy. These are never sent for "improvement" and never
//         overwritten by a model.
//   LLM   owns meaning: what an icon depicts, what role a component plays, a
//         developer-readable name.
//
// Every inferred field lands under `semantic` with a confidence, so a consumer
// can always tell a measurement from a judgement. A hallucinated coordinate
// would corrupt an implementation silently; a wrong icon name is visible and
// cheap to correct.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lensHome } from "../store/home.mjs";
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");




/** Components worth asking about: those whose meaning is not self-evident. */
export function selectForEnrichment(components) {
  return components.filter((c) => {
    if (c.role === "text") return false;            // text speaks for itself
    if (c.role === "asset") return false;           // already explained
    const nameIsJunk = !c.name
      || /^(frame|group|rectangle|ellipse|vector|component)\s*[\d\s]*$/i.test(c.name)
      || /^[\d:;]+$/.test(c.name);
    return c.role === "icon" || c.role === "image" || c.role === "card" || nameIsJunk;
  });
}

export function buildPrompt(screen, items) {
  const lines = [];
  lines.push("You are adding semantic labels to a design-analysis tool's output.");
  lines.push("Screen: " + screen.name + " (" + screen.size.w + "x" + screen.size.h
    + ", " + screen.platform + ").");
  lines.push("");
  lines.push("Each item below has a cropped screenshot. Answer only WHAT IT IS.");
  lines.push("Do not output or infer any numeric value.");
  lines.push("");
  for (const [i, c] of items.entries()) {
    lines.push((i + 1) + ". id=" + c.id + " role=" + c.role
      + " size=" + Math.round(c.box.w) + "x" + Math.round(c.box.h)
      + " at=" + Math.round(c.box.x) + "," + Math.round(c.box.y)
      + (c.fill ? " fill=" + c.fill : "")
      + (c.composite ? " composed of " + c.composite.parts + " shapes" : "")
      + "  layerName=" + JSON.stringify(c.name || ""));
  }
  lines.push("");
  lines.push("Return a JSON array; for each item:");
  lines.push("  id           echo unchanged");
  lines.push("  depicts      what it shows (e.g. 'location pin', 'AED heart badge', 'user avatar'); null if unclear");
  lines.push("  uiRole       icon|avatar|button|badge|card|chart|map|decoration|unknown");
  lines.push("  suggestName  developer-facing camelCase name (e.g. locationPin, aedBadge)");
  lines.push("  confidence   0-1, how sure you are");
  lines.push("");
  lines.push("Rule: if you cannot tell, write null with a low confidence. Do not guess.");
  lines.push("Never output coordinates or colours.");
  return lines.join("\n");
}

/** Merge model output back, never touching measured fields. */
export function mergeSemantics(inventory, answers) {
  const byId = new Map(answers.map((a) => [a.id, a]));
  let enriched = 0;
  for (const c of inventory.components) {
    const a = byId.get(c.id);
    if (!a) continue;
    c.semantic = {
      depicts: a.depicts ?? null,
      uiRole: a.uiRole ?? null,
      suggestName: a.suggestName ?? null,
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      source: "llm",
    };
    enriched++;
  }
  return enriched;
}

if (process.argv[1] && process.argv[1].endsWith("llm-enrich.mjs")) {
  const node = process.argv[2];
  const base = node.replace(":", "-");
  const dir = WORK;
  const inv = JSON.parse(fs.readFileSync(path.join(dir, base + ".inventory.json"), "utf8"));
  const items = selectForEnrichment(inv.components);
  fs.writeFileSync(path.join(dir, base + ".llm-request.txt"), buildPrompt(inv.screen, items));
  fs.writeFileSync(path.join(dir, base + ".llm-items.json"),
    JSON.stringify(items.map((c) => ({ id: c.id, role: c.role, box: c.box, name: c.name,
      crop: "crops-" + base + "/c-" + c.id.replace(/:/g, "-") + ".png" })), null, 1));
  console.log("components needing semantics: " + items.length);
  console.log("prompt: " + path.join(dir, base + ".llm-request.txt"));
  console.log("items:  " + path.join(dir, base + ".llm-items.json"));
}
