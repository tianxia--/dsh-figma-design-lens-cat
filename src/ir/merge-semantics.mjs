#!/usr/bin/env node
// Merge LLM semantics into the inventory WITHOUT touching measured fields.
//
// The boundary is the whole point: coordinates, sizes, colours, fonts and text
// come from the Figma file and are never rewritten by a model. The model only
// answers "what is this", which the file cannot say — most layers here have no
// name at all (38 of 71 were literally ""), so without this step the report
// tells a developer "icon 40x40 #E90D46" and nothing more.
//
// Everything inferred lands under `semantic` with a confidence, so a reader can
// always separate measurement from judgement.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lensHome } from "../store/home.mjs";
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");



const node = process.argv[2];
const base = node.replace(":", "-");
const dir = WORK;

const inv = JSON.parse(fs.readFileSync(path.join(dir, base + ".inventory.json"), "utf8"));
const answers = JSON.parse(fs.readFileSync(path.join(dir, base + ".semantics.json"), "utf8"));
const list = Array.isArray(answers) ? answers : (answers.items || answers.components || []);
const byId = new Map(list.map((a) => [a.id, a]));

let merged = 0, lowConf = 0;
for (const c of inv.components) {
  const a = byId.get(c.id);
  if (!a) continue;
  const conf = typeof a.confidence === "number" ? a.confidence : null;
  c.semantic = {
    depicts: a.depicts ?? null,
    uiRole: a.uiRole ?? null,
    suggestName: a.suggestName ?? null,
    confidence: conf,
    source: "llm",
  };
  merged++;
  if (conf !== null && conf < 0.6) lowConf++;
}
fs.writeFileSync(path.join(dir, base + ".inventory.json"), JSON.stringify(inv, null, 1));
console.log("merged " + merged + " semantic records (" + lowConf + " below 0.6 need human confirmation)");
