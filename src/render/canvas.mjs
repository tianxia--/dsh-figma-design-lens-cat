// The colour a screen is composited on.
//
// A translucent card has no visible appearance without it: a card filled with
// white at 10% reads as a dark panel over the app's dark background and as
// nothing at all over a white default. The iOS template hard-coded white and
// scored 6% against the same data the web template rendered at 30%.
//
// The value is sampled from the rendered design, which is where the colour
// actually exists, and cached per screen because the sampling shells out.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PKG_ROOT, pythonBin } from "../ir/pipeline.mjs";

const cache = new Map();

export function canvasBackdrop(latest) {
  if (cache.has(latest)) return cache.get(latest);
  let hex = null;
  let grad = null;
  try {
    const design = path.join(latest, "review", "design.png");
    if (fs.existsSync(design)) {
      const script = path.join(PKG_ROOT, "python", "canvas-bg.py");
      const out = execFileSync(pythonBin(), [script, design], { stdio: "pipe", timeout: 60000 });
      const parsed = JSON.parse(out.toString());
      // A uniform edge is the confident answer; a vertical gradient is the
      // common alternative and must be reproduced as one, because flooding
      // the screen with a single sampled colour left the whole lower half
      // wrong and accounted for most of one screen's pixel error.
      hex = parsed.uniform ? parsed.hex : (parsed.dominant || null);
      grad = parsed.gradient || null;
    }
  } catch { /* leaving it unset is better than guessing */ }
  cache.set(latest, { hex, gradient: grad });
  return { hex, gradient: grad };
}

/** The flat colour alone, for callers that cannot express a gradient. */
export function canvasColour(latest) {
  return canvasBackdrop(latest).hex;
}

/** Same colour as SwiftUI literals, so a template can embed it. */
export function swiftColour(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return "Color.white";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return "Color(.sRGB, red: " + r.toFixed(4) + ", green: " + g.toFixed(4)
    + ", blue: " + b.toFixed(4) + ", opacity: 1)";
}

/** Same colour as a Compose literal. */
export function composeColour(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return "Color(0xFFFFFFFF)";
  return "Color(0xFF" + hex.slice(1).toUpperCase() + ")";
}
