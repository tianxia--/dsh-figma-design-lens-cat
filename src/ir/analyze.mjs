#!/usr/bin/env node
// One-shot design analysis: a Figma link in, a full understanding report out.
//
// Chains the pieces that were validated separately: ingest -> IR -> inventory
// -> render -> cross-check(file × image) -> HTML report. Kept as one entry
// point because a reviewer should not have to remember five commands.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseFigmaUrl } from "../figma/client.js";
import { resolveToken, ingestNodes } from "../figma/client.js";
import { figmaToIR } from "./from-figma.js";
import { normalise } from "./normalise.mjs";
import { splitCanvas, describeSplit } from "./split-canvas.mjs";
import { buildInventory } from "./inventory.js";
import { writePaintList } from "./paint-list.mjs";
import os from "node:os";
import { lensHome } from "../store/home.mjs";
const WORK = process.env.DESIGN_LENS_WORK
  || path.join(lensHome(), "work");



const OUT = WORK;

async function renderNode(token, fileKey, id, dest) {
  const url = "https://api.figma.com/v1/images/" + fileKey + "?ids=" + encodeURIComponent(id) + "&format=png&scale=1";
  const r = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!r.ok) throw new Error("images " + r.status);
  const j = await r.json();
  const link = j.images?.[id];
  if (!link) throw new Error("no render for " + id);
  const im = await fetch(link);
  fs.writeFileSync(dest, Buffer.from(await im.arrayBuffer()));
  return dest;
}

const main = async () => {
  const url = process.argv[2];
  if (!url) throw new Error('usage: node analyze.mjs "<figma url>"');
  const { fileKey, node } = parseFigmaUrl(url);
  if (!node) throw new Error("link has no node-id: select a frame in Figma, then copy the link");
  fs.mkdirSync(OUT, { recursive: true });
  const token = resolveToken();

  console.log("1/5 fetching design node " + node);
  const cacheDir = path.join(WORK, "figma", fileKey.slice(0, 8));
  const docs = await ingestNodes({ token, fileKey, ids: [node], cacheDir });
  const doc = docs[node];
  if (!doc) throw new Error("node not returned; confirm the link points at a specific frame");

  // A canvas is not a screen. One here is 4562x5422 and holds six states of
  // the same page beside two component sets and seventeen loose cards: taken
  // as one screen it produced 725 components, a quarter of them unnameable
  // because they sit in the empty space between artboards.
  //
  // Analysing it is refused rather than attempted, because the result looks
  // like an answer and is not one. The caller is told which pages are in it.
  const split = splitCanvas(doc);
  if (split && split.isCanvas && !process.argv.includes("--force")) {
    const lines = describeSplit(split);
    const err = new Error(lines[0] + ". Analyse a page from it, or pass"
      + " --force to take the canvas as one screen.");
    err.split = split;
    err.detail = lines;
    throw err;
  }

  console.log("2/5 converting to design IR");
  // REST omits defaults, gives no width or height on any node, and keeps
  // GROUPs whose rotation their children must inherit. Normalising first
  // means the rest of the pipeline reads a document that describes what is
  // actually on screen.
  const { root: normalised, warnings: normWarnings } = normalise(doc);
  if (!normalised) {
    const why = doc.visible === false ? "it is hidden in Figma"
      : (doc.children || []).length === 0 ? "it has no child layers"
        : "it produced no usable content";
    throw new Error("nothing to analyse in \"" + (doc.name || node) + "\": " + why);
  }
  for (const w of normWarnings) console.log("   note: " + w);

  const ir = figmaToIR([normalised], { source: "figma-rest", fileKey, node });
  const screen = ir.screens[0];
  // A frame yields no screen when it is hidden or holds no layers, and
  // reading .root then failed with advice to check the link. The link was
  // right, so the message names which of the two it actually was.
  if (!screen) {
    const why = doc.visible === false
      ? "it is hidden in Figma"
      : (doc.children || []).length === 0
        ? "it has no child layers"
        : "it produced no usable content";
    throw new Error("nothing to analyse in \"" + (doc.name || node) + "\": " + why);
  }
  const irFile = path.join(OUT, node.replace(":", "-") + ".ir.json");
  fs.writeFileSync(irFile, JSON.stringify(ir, null, 1));

  // Flat list of every painted leaf, kept beside the IR. The inventory
  // collapses nested instances into one row, which is right for a readiness
  // report and lossy for a rebuild: a slider becomes one block instead of a
  // bar, a handle and its tick marks.
  const paintFile = path.join(OUT, node.replace(":", "-") + ".paint.json");
  // The normalised tree, not the raw document: the paint list was the one
  // consumer still reading absoluteBoundingBox directly, so a rotated shape
  // appeared there at 703x692 while the export manifest recorded the same
  // node at its true 416x572.
  const paint = writePaintList(normalised, paintFile);
  console.log("   " + paint.count + " paint units");

  console.log("3/5 building the inventory");
  const inv = buildInventory(screen);
  const invFile = path.join(OUT, node.replace(":", "-") + ".inventory.json");
  fs.writeFileSync(invFile, JSON.stringify(inv, null, 1));

  console.log("4/5 downloading the design render");
  const png = path.join(OUT, node.replace(":", "-") + ".png");
  await renderNode(token, fileKey, node, png);

  console.log("5/5 cross-checking file against image");
  const crossFile = path.join(OUT, node.replace(":", "-") + ".cross.json");
  let cross = null;
  try {
    const script = path.join(WS, "packages", "ui-fidelity", "src", "cross-check.py");
    execFileSync("python3", [script, png, invFile, crossFile], { stdio: "pipe" });
    cross = JSON.parse(fs.readFileSync(crossFile, "utf8"));
  } catch (e) {
    console.log("   cross-check skipped:", String(e.message).slice(0, 80));
  }

  const count = (n) => 1 + (n.children || []).reduce((a, c) => a + count(c), 0);
  const summary = {
    screen: { id: screen.id, name: screen.name, size: screen.size, platform: screen.platform },
    nodes: count(screen.root),
    components: inv.counts.components,
    byRole: inv.counts.byRole,
    layouts: inv.counts.layouts,
    background: inv.background,
    palette: inv.palette.slice(0, 12),
    typography: inv.typography.slice(0, 10),
    componentCandidates: inv.componentCandidates.slice(0, 8),
    cross: cross ? {
      corroborationRate: cross.corroborationRate,
      agreed: cross.agreed, fileOnly: cross.fileOnly, imageOnly: cross.imageOnly,
      fileOnlyDetail: cross.fileOnlyDetail.slice(0, 10),
      imageOnlyDetail: cross.imageOnlyDetail.slice(0, 10),
    } : null,
    files: { ir: irFile, inventory: invFile, render: png, cross: crossFile },
  };
  fs.writeFileSync(path.join(OUT, node.replace(":", "-") + ".summary.json"), JSON.stringify(summary, null, 1));

  console.log();
  console.log("screen:     " + screen.name + "  " + screen.size.w + "x" + screen.size.h + "  (" + screen.platform + ")");
  console.log("nodes/comp: " + summary.nodes + " nodes · " + summary.components + " components " + JSON.stringify(summary.byRole));
  console.log("layouts:    " + summary.layouts);
  console.log("background: " + inv.background.layers.map((l) => l.fill + "(" + l.coverage + "%)").join(" → "));
  console.log("palette:    " + inv.palette.slice(0, 8).map((p) => p.hex + "×" + p.uses).join("  "));
  console.log("fonts:      " + inv.typography.slice(0, 8).map((t) => t.size + "px/" + t.weight + "×" + t.uses).join("  "));
  if (cross) {
    console.log("cross-check:" + cross.corroborationRate + "%  (agreed " + cross.agreed
      + " · file-only " + cross.fileOnly + " · image-only " + cross.imageOnly + ")");
  }
  console.log();
  console.log("artifacts:  " + OUT);
};

main().catch((e) => { console.error("analysis failed:", e.message); process.exit(1); });
