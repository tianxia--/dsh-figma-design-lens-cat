// Scoring a benchmark run.
//
// A single blended number cannot say what improved, so every run records the
// same sub-scores: how much of the screen was reproduced, how much was never
// drawn, and how text and shapes fared separately. Text and shapes are split
// because they fail for different reasons -- a missing font caps text while
// leaving shapes untouched, and reading one number hid that for several runs.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PKG_ROOT, pythonBin } from "../ir/pipeline.mjs";
import { historyFile, benchRoot } from "./set.mjs";

export const PLATFORMS = ["web", "ios", "android"];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/** Per-screen, per-platform detail from one preview run. */
export function collect(storeRoot, project, screens) {
  const rows = [];
  for (const sid of screens) {
    const latest = path.join(storeRoot, "projects", project, "screens", sid, "latest");
    for (const plat of PLATFORMS) {
      const dir = path.join(storeRoot, "projects", project, "render", plat, sid);
      const fid = readJson(path.join(dir, "fidelity.json"));
      if (!fid) { rows.push({ screen: sid, platform: plat, ok: false }); continue; }
      // Which generator ran decides what the score means at all.
      const meta = readJson(path.join(dir, "meta.json")) || {};


      const all = fid.all || [];
      const text = all.filter((r) => r.text);
      const shape = all.filter((r) => !r.text);
      const mean = (xs) => xs.length
        ? Math.round((xs.reduce((a, b) => a + b.pixel, 0) / xs.length) * 10) / 10 : null;

      rows.push({
        screen: sid,
        platform: plat,
        ok: true,
        pixel: fid.axes?.pixel ?? null,
        colour: fid.axes?.colour ?? null,
        present: fid.axes?.present ?? null,
        missing: fid.missing ?? null,
        components: fid.components ?? null,
        textScore: mean(text),
        shapeScore: mean(shape),
        verdict: fid.verdict || null,
        generator: meta.generator || "unknown",
      });
    }
  }
  return rows;
}

function average(rows, key) {
  const v = rows.filter((r) => r.ok && typeof r[key] === "number").map((r) => r[key]);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

export function summarise(rows) {
  const out = { screens: new Set(rows.map((r) => r.screen)).size, byPlatform: {} };
  for (const plat of PLATFORMS) {
    const sub = rows.filter((r) => r.platform === plat);
    out.byPlatform[plat] = {
      scored: sub.filter((r) => r.ok).length,
      failed: sub.filter((r) => !r.ok).length,
      pixel: average(sub, "pixel"),
      colour: average(sub, "colour"),
      present: average(sub, "present"),
      text: average(sub, "textScore"),
      shape: average(sub, "shapeScore"),
      missing: sub.filter((r) => r.ok).reduce((a, r) => a + (r.missing || 0), 0),
      // A run where the model never ran measures the template, not the tool.
      byModel: sub.filter((r) => r.ok && r.generator === "model").length,
      byTemplate: sub.filter((r) => r.ok && r.generator !== "model").length,
    };
  }
  out.overall = average(rows, "pixel");
  return out;
}

/** Append a run so successive runs are comparable. */
export function record(entry) {
  fs.mkdirSync(benchRoot(), { recursive: true });
  fs.appendFileSync(historyFile(), JSON.stringify(entry) + "\n");
  return historyFile();
}

export function history() {
  try {
    return fs.readFileSync(historyFile(), "utf8").trim().split("\n")
      .filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}
