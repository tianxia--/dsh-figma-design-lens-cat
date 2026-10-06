// Fidelity benchmark: a fixed set of screens, scored the same way every run,
// with every run appended to a history so progress is measurable.
//
// Without this, a change is judged by looking at one screen and deciding it
// looks better. That hid two regressions already: a broken file silently fell
// back to templates, and Gradle served a stale PNG as a fresh render.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { lensHome } from "../store/home.mjs";

export function benchRoot() {
  const home = lensHome();
  return path.join(home, "bench");
}

export function setFile() { return path.join(benchRoot(), "set.json"); }
export function historyFile() { return path.join(benchRoot(), "history.jsonl"); }

/**
 * Pick a spread rather than the first N screens.
 *
 * Fidelity varies with what a screen contains -- a map, a translucent card, a
 * dense list -- so a benchmark drawn from one section would improve while the
 * rest regressed silently. Screens are taken round-robin across sections and
 * ordered by height inside each, so short and tall layouts both appear.
 */
export function chooseSet(frames, size = 12) {
  const bySection = new Map();
  for (const f of frames) {
    const key = f.section || "(none)";
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(f);
  }
  for (const list of bySection.values()) list.sort((a, b) => a.h - b.h);

  const sections = [...bySection.keys()].sort();
  const picked = [];
  let round = 0;
  while (picked.length < size && round < 40) {
    let added = false;
    for (const s of sections) {
      if (picked.length >= size) break;
      const list = bySection.get(s);
      // Spread within a section too: take from evenly spaced positions.
      const idx = Math.floor((round * list.length) / Math.max(1, size / sections.length + 1));
      const pick = list[idx] || list[round];
      if (pick && !picked.some((p) => p.id === pick.id)) { picked.push(pick); added = true; }
    }
    if (!added) break;
    round++;
  }
  return picked;
}
