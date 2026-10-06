// The benchmark runner: analyse, render, score, record.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { chooseSet, setFile, benchRoot } from "./set.mjs";
import { collect, summarise, record, history, PLATFORMS } from "./score.mjs";
import { lensHome } from "../store/home.mjs";

function storeRoot() {
  return lensHome();
}

export function loadSet() {
  try { return JSON.parse(fs.readFileSync(setFile(), "utf8")); } catch { return null; }
}

export function saveSet(data) {
  fs.mkdirSync(benchRoot(), { recursive: true });
  fs.writeFileSync(setFile(), JSON.stringify(data, null, 1));
  return setFile();
}

/** Every phone-sized frame under a page or section. */
export async function discover(fileKey, nodeId, token) {
  const url = "https://api.figma.com/v1/files/" + fileKey
    + "?ids=" + encodeURIComponent(nodeId) + "&depth=4";
  const r = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!r.ok) throw new Error("figma " + r.status + " " + (await r.text()).slice(0, 120));
  const j = await r.json();

  const found = [];
  const walk = (n, section) => {
    const bb = n.absoluteBoundingBox;
    // A phone screen, not a section, a canvas or a stray graphic. A frame with
    // no children is a backdrop holding only a gradient, and there is nothing
    // in it to reproduce or score.
    // Hidden frames and childless backdrops are not screens: the first is a
    // variant the designer switched off, the second holds only a gradient.
    const hasContent = (n.children || []).length > 0 && n.visible !== false;
    if (n.type === "FRAME" && hasContent
      && bb && bb.width >= 320 && bb.width <= 500 && bb.height >= 500) {
      found.push({ id: n.id, name: n.name, w: Math.round(bb.width), h: Math.round(bb.height), section });
      return;
    }
    const next = n.type === "SECTION" ? n.name : section;
    for (const c of n.children || []) walk(c, next);
  };
  walk(j.document, null);
  return found;
}

export function summariseHistory() {
  const runs = history();
  return runs.map((r) => ({
    at: r.at,
    label: r.label,
    overall: r.summary?.overall ?? null,
    web: r.summary?.byPlatform?.web?.pixel ?? null,
    ios: r.summary?.byPlatform?.ios?.pixel ?? null,
    android: r.summary?.byPlatform?.android?.pixel ?? null,
    screens: r.summary?.screens ?? null,
    // A past run is only comparable to another that used the same generator.
    source: (() => {
      const p = r.summary?.byPlatform || {};
      const model = Object.values(p).reduce((a, s) => a + (s.byModel || 0), 0);
      const template = Object.values(p).reduce((a, s) => a + (s.byTemplate || 0), 0);
      if (model && !template) return "model";
      if (!model && template) return "template";
      if (model && template) return "mixed";
      return "unrecorded";
    })(),
  }));
}

export { collect, summarise, record, history, chooseSet, PLATFORMS };
