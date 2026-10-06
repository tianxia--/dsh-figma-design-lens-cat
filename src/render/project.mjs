// Write a standalone render project for one screen into the tool's own store.
//
// The project is generated under the tool directory instead of a user
// repository: measuring a design should never require installing anything
// into the codebase being measured.
import fs from "node:fs";
import path from "node:path";
import { loadComponents, renderHtml } from "./web.mjs";
import { renderSwift } from "./ios.mjs";

export const PLATFORMS = ["web", "ios", "android"];

// <store>/projects/<project>/render/<platform>/<screen>/
export function renderRoot(projectDir, platform, screenId) {
  return path.join(projectDir, "render", platform, screenId);
}

// Renders the model's view off-screen and writes the PNG. Appended rather than
// asked for, so the model only has to produce the view itself.
function swiftHarness(manifest, png) {
  const s = manifest?.screen?.size || { w: 390, h: 844 };
  return [
    "",
    "import AppKit",
    "",
    "let __view = NSHostingView(rootView: GeneratedScreen())",
    "__view.frame = NSRect(x: 0, y: 0, width: " + s.w + ", height: " + s.h + ")",
    // bitmapImageRepForCachingDisplay hands back a calibrated-RGB bitmap, and
    // the colours drift: the teal button rendered as rgb(33,235,209) instead
    // of rgb(14,236,218). An explicit bitmap retagged as sRGB matches exactly.
    "guard let __rep = NSBitmapImageRep(",
    "  bitmapDataPlanes: nil, pixelsWide: " + (s.w * 2) + ", pixelsHigh: " + (s.h * 2) + ",",
    "  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,",
    "  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }",
    "__rep.size = NSSize(width: " + s.w + ", height: " + s.h + ")",
    "__view.cacheDisplay(in: __view.bounds, to: __rep)",
    "let __out = __rep.retagging(with: .sRGB) ?? __rep",
    "guard let __data = __out.representation(using: .png, properties: [:]) else { exit(1) }",
    "try __data.write(to: URL(fileURLWithPath: \"" + png + "\"))",
    "",
  ].join("\n");
}

function readManifest(latest) {
  return JSON.parse(fs.readFileSync(path.join(latest, "manifest.json"), "utf8"));
}

// Generation has two modes. The template is deterministic and free but only
// knows how to place boxes and text; a model reads the same measurements and
// works out what they represent -- that a teal bar with a dark circle is a
// slider, that a vector's exported file belongs where its box is. The model is
// used when authorised, and the template stands in when it is not.
export async function generate(platform, latest, projectDir, screenId, opts = {}) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error("unknown platform: " + platform);
  }
  const manifest = readManifest(latest);
  const comps = loadComponents(latest);
  const out = renderRoot(projectDir, platform, screenId);
  fs.mkdirSync(out, { recursive: true });

  // Exported artwork is copied next to the generated page so the render is
  // self-contained and can be opened directly from its own directory.
  const copyAssets = (dest) => {
    const src = path.join(latest, "assets");
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, f), path.join(dest, f));
    }
  };

  const viaModel = async (file) => {
    // Not a failure: the caller asked for the template, or there is no login.
    if (!opts.llm) return null;
    try {
      const { generate: gen } = await import("./codegen.mjs");
      const r = await gen({
        latest, target: platform,
        provider: opts.provider || "anthropic",
        model: opts.model || "claude-sonnet-4-5",
        signal: opts.signal,
        onLog: opts.onLog,
      });
      if (!r.code || r.code.length < 40) {
        return { by: "template",
          fellBackBecause: "the model returned "
            + (r.code ? r.code.length + " characters, too short to be a page"
              : "no code at all") };
      }
      fs.writeFileSync(file, r.code);
      return { by: "model", usage: r.usage };
    } catch (e) {
      // A model failure falls back to the template rather than losing the
      // preview: a rough render is more useful than an empty tab. The reason
      // travels with the result, because a benchmark that silently scores the
      // template reads as a regression in the model.
      const why = String(e.message).slice(0, 200);
      if (opts.onLog) opts.onLog("model generation failed: " + why.slice(0, 120));
      return { by: "template", fellBackBecause: why };
    }
  };

  if (platform === "web") {
    const file = path.join(out, "index.html");
    // The model references artwork by bare file name, so it sits beside the page.
    copyAssets(out);
    copyAssets(path.join(out, "assets"));
    const used = await viaModel(file);
    // Test the field, not the object: the failure case returns a result that
    // carries the reason, and truthiness alone would take a failure for a
    // success and leave the page unwritten.
    const ok = used && used.by === "model";
    if (!ok) fs.writeFileSync(file, renderHtml(manifest, comps, latest));
    return { platform, dir: out, entry: file, png: path.join(out, "render.png"),
      components: comps.length, by: ok ? "model" : "template",
      usage: ok ? used.usage : null,
      ...(used && used.fellBackBecause ? { fellBackBecause: used.fellBackBecause } : {}) };
  }

  if (platform === "ios") {
    const png = path.join(out, "render.png");
    const file = path.join(out, "Screen.swift");
    copyAssets(out);
    const used = await viaModel(file);
    const ok = used && used.by === "model";
    if (ok) {
      // The generated view has to be rendered off-screen and written out; the
      // model produces the view, the harness below turns it into a PNG.
      const body = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, body + "\n" + swiftHarness(manifest, png));
    } else {
      fs.writeFileSync(file, renderSwift(manifest, comps, png, latest));
    }
    return { platform, dir: out, entry: file, png, components: comps.length,
      by: ok ? "model" : "template", usage: ok ? used.usage : null,
      ...(used && used.fellBackBecause ? { fellBackBecause: used.fellBackBecause } : {}) };
  }

  // android is generated by android.mjs once its toolchain is verified
  throw new Error("android generation is not wired up yet");
}
