#!/usr/bin/env python3
"""Draw every identified component onto the full design render.

One annotated image answers "did you find everything?" in a glance: any element
without a box is a miss. Solid boxes = file components (colour by role); red
dashed = pixels-only content (raster-baked, no Figma node).

Labels are drawn ONLY for containers/icons/assets — labelling every text child
buried the identity card under chips, and the reviewer could not read the card.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

COLORS = {
    "card": (59, 130, 246),
    "icon": (217, 70, 239),
    "image": (16, 185, 129),
    "asset": (245, 158, 11),
    "text": (34, 197, 94),
    "instance": (249, 115, 22),
    "shape": (148, 163, 184),
    "vector": (148, 163, 184),
}

def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
              "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()

def main(png, inventory, out, scale=2):
    img = Image.open(png).convert("RGB")
    inv = json.load(open(inventory))
    sw, sh = inv["screen"]["size"]["w"], inv["screen"]["size"]["h"]
    sx, sy = img.width / sw, img.height / sh

    big = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(big, "RGBA")
    f = font(11)

    order = {"card": 0, "asset": 1, "instance": 2, "icon": 3, "image": 4, "text": 5}
    comps = sorted(inv["components"], key=lambda c: order.get(c.get("role"), 6))
    counts = {}
    for c in comps:
        role = c.get("role", "shape")
        col = COLORS.get(role, (148, 163, 184))
        counts[role] = counts.get(role, 0) + 1
        b = c["box"]
        x0 = b["x"] * sx * scale
        y0 = b["y"] * sy * scale
        x1 = (b["x"] + b["w"]) * sx * scale
        y1 = (b["y"] + b["h"]) * sy * scale
        width = 3 if role in ("card", "asset") else 2
        d.rectangle([x0, y0, x1, y1], outline=col + (255,), width=width)
        if role in ("card", "icon", "asset", "image"):
            label = str(c.get("name") or c.get("id") or "")[:18]
            tw = d.textlength(label, font=f)
            ly = max(0, y0 - 13)
            d.rectangle([x0, ly, x0 + tw + 6, ly + 13], fill=col + (210,))
            d.text((x0 + 3, ly + 1), label, fill=(255, 255, 255), font=f)

    # pixels-only detections: red dashed, glyph runs merged into lines
    raster_path = inventory.replace(".inventory.json", ".raster.json")
    raster_n = 0
    if os.path.exists(raster_path):
        det = json.load(open(raster_path)).get("detected", [])
        det.sort(key=lambda b: (round(b["y"] / 8), b["x"]))
        merged = []
        for b in det:
            if merged:
                m = merged[-1]
                same_line = abs((b["y"] + b["h"] / 2) - (m["y"] + m["h"] / 2)) <= 6
                near = b["x"] - (m["x"] + m["w"]) <= 14
                if same_line and near:
                    nx1 = max(m["x"] + m["w"], b["x"] + b["w"])
                    ny1 = max(m["y"] + m["h"], b["y"] + b["h"])
                    m["x"] = min(m["x"], b["x"]); m["y"] = min(m["y"], b["y"])
                    m["w"] = nx1 - m["x"]; m["h"] = ny1 - m["y"]
                    continue
            merged.append(dict(b))
        raster_n = len(merged)
        for b in merged:
            rx0 = b["x"] * sx * scale
            ry0 = b["y"] * sy * scale
            rx1 = (b["x"] + b["w"]) * sx * scale
            ry1 = (b["y"] + b["h"]) * sy * scale
            xx = rx0
            while xx < rx1:
                d.line([xx, ry0, min(xx + 3, rx1), ry0], fill=(239, 68, 68, 255), width=2)
                d.line([xx, ry1, min(xx + 3, rx1), ry1], fill=(239, 68, 68, 255), width=2)
                xx += 6
            yy = ry0
            while yy < ry1:
                d.line([rx0, yy, rx0, min(yy + 3, ry1)], fill=(239, 68, 68, 255), width=2)
                d.line([rx1, yy, rx1, min(yy + 3, ry1)], fill=(239, 68, 68, 255), width=2)
                yy += 6
    counts["raster(pixels-only)"] = raster_n

    lx, ly = 8, 8
    d.rectangle([lx, ly, lx + 250, ly + 22 + 16 * len(counts)], fill=(0, 0, 0, 190))
    d.text((lx + 8, ly + 5), "%d components detected" % len(comps), fill=(255, 255, 255), font=font(12))
    yy = ly + 24
    for role, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        col = COLORS.get(role, (239, 68, 68) if "raster" in role else (148, 163, 184))
        d.rectangle([lx + 8, yy + 3, lx + 20, yy + 12], fill=col + (255,))
        d.text((lx + 26, yy), "%s  %d" % (role, n), fill=(255, 255, 255), font=f)
        yy += 16

    big.save(out, optimize=True)
    print(json.dumps({"out": out, "components": len(comps), "byRole": counts}, ensure_ascii=False))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
