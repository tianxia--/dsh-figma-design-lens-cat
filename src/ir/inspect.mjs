#!/usr/bin/env node
// What a Figma node holds, before deciding what to analyse.
//
// Pointing this tool at a canvas rather than a screen produces an answer that
// looks valid and is not: one here yielded 725 components, a quarter of them
// unnameable because they sit in the space between artboards. Listing the
// contents first costs one API call and avoids that entirely.
import { resolveToken, ingestNodes } from "../figma/client.js";
import { splitCanvas } from "./split-canvas.mjs";
import path from "node:path";
import os from "node:os";

const WORK = process.env.DESIGN_LENS_WORK
  || path.join(os.homedir(), ".dsh-figma-design-lens-cat", "work");

function parseLink(url) {
  const file = /\/(?:file|design)\/([A-Za-z0-9]+)/.exec(url || "");
  const node = /node-id=([^&]+)/.exec(url || "");
  return {
    fileKey: file && file[1],
    node: node && decodeURIComponent(node[1]).replace("-", ":"),
  };
}

export async function inspect(url) {
  const { fileKey, node } = parseLink(url);
  if (!fileKey || !node) throw new Error("link needs a file key and a node-id");
  const token = resolveToken();
  const cacheDir = path.join(WORK, "figma", fileKey.slice(0, 8));
  const docs = await ingestNodes({ token, fileKey, ids: [node], cacheDir });
  const doc = docs[node];
  if (!doc) throw new Error("node not returned; confirm the link points at a frame");

  const split = splitCanvas(doc);
  const base = url.split("?")[0];
  const link = (id) => base + "?node-id=" + id.replace(":", "-");

  if (!split || !split.isCanvas) {
    const b = doc.absoluteBoundingBox;
    console.log(doc.name + "  " + (b ? Math.round(b.width) + "x" + Math.round(b.height) : "?"));
    console.log("A single screen. Analyse it with: dsh-figma-design-lens-cat add '" + url + "'");
    return { isCanvas: false };
  }

  console.log(split.canvas.name + "  "
    + (split.canvas.size ? split.canvas.size.w + "x" + split.canvas.size.h : "?")
    + "  — a canvas, not a screen");
  console.log();

  if (split.pages.length) {
    console.log("pages (" + split.pages.length + ")");
    for (const p of split.pages) {
      console.log("  " + p.size.w + "x" + p.size.h + "  " + p.name);
      console.log("     dsh-figma-design-lens-cat add '" + link(p.id) + "'");
    }
    console.log();
  }
  if (split.definitions.length) {
    console.log("component definitions (" + split.definitions.length
      + ") — variants of a reusable part; there is no design render to score them against");
    for (const d of split.definitions) {
      console.log("  " + d.size.w + "x" + d.size.h + "  " + d.name);
    }
    console.log();
  }
  if (split.fragments.length) {
    console.log("loose pieces (" + split.fragments.length
      + ") — cards and controls laid out beside the pages");
    for (const f of split.fragments.slice(0, 8)) {
      console.log("  " + f.size.w + "x" + f.size.h + "  " + f.name);
    }
    if (split.fragments.length > 8) {
      console.log("  … " + (split.fragments.length - 8) + " more");
    }
  }
  return split;
}
