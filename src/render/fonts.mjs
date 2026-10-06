// Which design fonts are actually available for rendering.
//
// A text box is measured in Figma with the design's own font. When that font
// is missing here the same string renders at a different width and weight, so
// the text components lose fidelity for a reason that has nothing to do with
// the generated code. Saying so keeps an environment gap from being read as
// an implementation fault.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const FONT_DIRS = [
  path.join(os.homedir(), "Library", "Fonts"),
  "/Library/Fonts",
  "/System/Library/Fonts",
  "/System/Library/Fonts/Supplemental",
];

function normalise(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

let cache = null;

function installed() {
  if (cache) return cache;
  const names = new Set();
  for (const dir of FONT_DIRS) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!/\.(ttf|ttc|otf|otc|dfont)$/i.test(f)) continue;
      names.add(normalise(f.replace(/\.[^.]+$/, "")));
    }
  }
  cache = names;
  return names;
}

/**
 * Families that exist under another name on this machine.
 *
 * Apple ships SF Pro as the system font but not under that name: asking for
 * "SF Pro Text" by name falls through to serif, which is the wrong shape and
 * the wrong width. Naming the substitute costs nothing and is exact, unlike
 * a fallback stack that merely lands somewhere.
 */
export const SUBSTITUTE = {
  "sf pro": "-apple-system",
  "sf pro text": "-apple-system",
  "sf pro display": "-apple-system",
  "sf pro rounded": "-apple-system",
  "sf compact": "-apple-system",
  "helvetica neue": "Helvetica Neue",
  "roboto": "Helvetica Neue",
  "inter": "Helvetica Neue",
};

/** The family to actually render with, or null when there is no substitute. */
export function substituteFor(family) {
  return SUBSTITUTE[String(family || "").toLowerCase().trim()] || null;
}

/** Fonts the design uses, each marked present or missing. */
export function auditFonts(paintItems) {
  const used = new Map();
  for (const item of paintItems || []) {
    const family = item?.font?.family;
    if (!family) continue;
    used.set(family, (used.get(family) || 0) + 1);
  }

  const have = installed();
  const out = [];
  for (const [family, count] of used) {
    const key = normalise(family);
    // A family may ship as one file per weight, so a prefix match counts.
    const present = [...have].some((f) => f === key || f.startsWith(key) || key.startsWith(f));
    out.push({ family, count, present });
  }
  return out.sort((a, b) => b.count - a.count);
}
