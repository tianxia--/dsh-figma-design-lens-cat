// Generate a SwiftUI file that renders one screen off-screen.
//
// Rendered with NSHostingView on the host Mac, so no simulator and no Xcode
// project are needed: the generated file is run directly with `xcrun swift`.
import fs from "node:fs";
import path from "node:path";
import { canvasColour, swiftColour } from "./canvas.mjs";
import { loadBackgrounds } from "./web.mjs";

function hexToSwift(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return `Color(red: ${r.toFixed(4)}, green: ${g.toFixed(4)}, blue: ${b.toFixed(4)})`;
}

function swiftWeight(w) {
  const n = Number(w) || 400;
  if (n >= 700) return ".bold";
  if (n >= 600) return ".semibold";
  if (n >= 500) return ".medium";
  if (n <= 300) return ".light";
  return ".regular";
}

// Swift string literals cannot span lines, and design copy often does: a
// paragraph with a real newline produced "unterminated string literal" and
// the whole screen failed to render.
// A SwiftUI ViewBuilder accepts at most ten children, and silently drops the
// rest: a screen with 68 layers rendered as a bare backdrop with everything
// missing, and the compiler said nothing. Nesting them in Groups of ten is
// the documented way past the limit.
function chunk(lines, size = 10) {
  if (lines.length <= size) return lines.join("\n");
  const groups = [];
  for (let i = 0; i < lines.length; i += size) {
    groups.push("      Group {\n" + lines.slice(i, i + size).join("\n") + "\n      }");
  }
  return chunk(groups, size);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

export function renderSwift(manifest, comps, outPng, latest) {
  const size = manifest?.screen?.size || { w: 390, h: 844 };
  // White was hard-coded here, so every dark screen rendered as a white sheet
  // with barely visible translucent cards: 6% against the same data the web
  // template rendered at 30%.
  const backdrop = swiftColour(latest ? canvasColour(latest) : null);

  // Exported artwork carries every icon, illustration and photo in the
  // design. The web template placed it and iOS did not, which is most of why
  // iOS reported 202 missing components against web's 149 on the same data.
  const artwork = (latest ? loadBackgrounds(latest) : []).map((g) => {
    const size = g.rendered || { w: g.box.w, h: g.box.h };
    const x = Math.round((g.box.x + (g.box.w - size.w) / 2) * 100) / 100;
    const y = Math.round((g.box.y + (g.box.h - size.h) / 2) * 100) / 100;
    const file = path.join(latest, "assets", g.file);
    return "      if let img = NSImage(contentsOfFile: \"" + file + "\") {\n"
      + "        Image(nsImage: img).resizable()\n"
      + "          .frame(width: " + size.w + ", height: " + size.h + ")\n"
      + "          .offset(x: " + x + ", y: " + y + ")\n"
      + "      }";
  });
  const layers = comps.map((c) => {
    const m = c.measured, b = m.box, f = m.font || {};
    if (m.text) {
      const col = hexToSwift(f.color) || "Color.black";
      const align = String(f.align || "LEFT").toUpperCase() === "CENTER"
        ? ".center" : (String(f.align).toUpperCase() === "RIGHT" ? ".trailing" : ".leading");
      return `      Text("${esc(m.text)}")
        .font(.system(size: ${f.size || 14}, weight: ${swiftWeight(f.weight)}))
        .foregroundColor(${col})
        .multilineTextAlignment(${align})
        .frame(width: ${b.w}, height: ${b.h}, alignment: ${align === ".center" ? ".center" : ".leading"})
        .offset(x: ${b.x}, y: ${b.y})`;
    }
    // The fill's own alpha, or a translucent card paints over the screen.
    const base = hexToSwift(m.fill) || "Color.clear";
    const fill = (m.fillOpacity != null && m.fillOpacity < 1)
      ? base + ".opacity(" + m.fillOpacity + ")" : base;
    const radius = m.radius ? `.cornerRadius(${m.radius})` : "";
    return `      ${fill}
        .frame(width: ${b.w}, height: ${b.h})${radius ? "\n        " + radius : ""}
        .offset(x: ${b.x}, y: ${b.y})`;
  });

  return `import SwiftUI
import AppKit

struct GeneratedScreen: View {
  var body: some View {
    ZStack(alignment: .topLeading) {
${chunk([backdrop + ".frame(width: " + size.w + ", height: " + size.h + ")"]
  .map((l) => "      " + l).concat(artwork, layers))}
    }
    .frame(width: ${size.w}, height: ${size.h}, alignment: .topLeading)
  }
}

// ImageRenderer rather than NSHostingView.cacheDisplay: the latter returned a
// white bitmap for a dark screen no matter how the backdrop was expressed,
// while ImageRenderer reproduces it exactly and gives the 2x scale directly.
@MainActor
func __render() {
  let renderer = ImageRenderer(content: GeneratedScreen())
  renderer.scale = 2
  guard let cg = renderer.cgImage else {
    FileHandle.standardError.write("render produced no image\\n".data(using: .utf8)!)
    exit(1)
  }
  let rep = NSBitmapImageRep(cgImage: cg)
  guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }
  try? data.write(to: URL(fileURLWithPath: "${outPng}"))
}

MainActor.assumeIsolated { __render() }
`;
}
