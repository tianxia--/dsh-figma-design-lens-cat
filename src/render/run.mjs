// Render a generated project to PNG and score it against the design.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generate, renderRoot } from "./project.mjs";
import { PKG_ROOT, pythonBin } from "../ir/pipeline.mjs";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export function findChrome() {
  return process.env.DESIGN_LENS_CHROME
    || CHROME_CANDIDATES.find((p) => fs.existsSync(p))
    || null;
}

function screenSize(latest) {
  const m = JSON.parse(fs.readFileSync(path.join(latest, "manifest.json"), "utf8"));
  return m?.screen?.size || { w: 390, h: 844 };
}

export function renderWeb(gen, latest) {
  const chrome = findChrome();
  if (!chrome) return { ok: false, error: "no Chrome-family browser found" };
  const { w, h } = screenSize(latest);
  try {
    execFileSync(chrome, [
      "--headless", "--disable-gpu", "--hide-scrollbars",
      `--window-size=${w},${h}`,
      `--screenshot=${gen.png}`,
      gen.entry,
    ], { stdio: "pipe", timeout: 120000 });
    return { ok: fs.existsSync(gen.png), png: gen.png };
  } catch (e) {
    return { ok: false, error: (e.stderr ? e.stderr.toString() : e.message).slice(0, 300) };
  }
}

export function renderIos(gen) {
  if (process.platform !== "darwin") {
    return { ok: false, error: "SwiftUI rendering requires macOS" };
  }
  try {
    execFileSync("xcrun", ["swift", gen.entry], {
      stdio: "pipe", timeout: 300000, cwd: gen.dir,
    });
    return { ok: fs.existsSync(gen.png), png: gen.png };
  } catch (e) {
    return { ok: false, error: (e.stderr ? e.stderr.toString() : e.message).slice(0, 300) };
  }
}

export function score(latest, builtPng, outJson) {
  const script = path.join(PKG_ROOT, "python", "compare.py");
  const design = path.join(latest, "review", "design.png");
  const args = [script, design, builtPng, latest];
  if (outJson) args.push(outJson);
  try {
    const out = execFileSync(pythonBin(), args, { stdio: "pipe", timeout: 180000 });
    return { ok: true, result: JSON.parse(out.toString()) };
  } catch (e) {
    // Keep the tail: a Python traceback ends with the actual error and starts
    // with frames, so truncating the head throws away the useful part.
    const raw = (e.stderr ? e.stderr.toString() : e.message).trim();
    return { ok: false, error: raw.length > 400 ? "…" + raw.slice(-400) : raw };
  }
}

export function renderAndScore(platform, latest, projectDir, screenId) {
  const gen = generate(platform, latest, projectDir, screenId);
  const r = platform === "web" ? renderWeb(gen, latest) : renderIos(gen);
  if (!r.ok) return { ...gen, ok: false, error: r.error };
  const s = score(latest, gen.png, path.join(gen.dir, "fidelity.json"));
  if (!s.ok) return { ...gen, ok: false, error: s.error };
  return { ...gen, ok: true, fidelity: s.result };
}
