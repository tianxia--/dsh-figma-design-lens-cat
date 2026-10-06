#!/usr/bin/env python3
"""Crop every identified component out of the design render.

Reviewing an inventory by coordinates is unusable — nobody can hold "x=217,
y=1273, 40×40" in their head and match it to a screen. Each component gets a
thumbnail showing it IN CONTEXT (padded surroundings) with the component itself
outlined, so verification becomes visual: does this box contain what the row
claims it contains?
"""
import json, os, sys
from PIL import Image, ImageDraw

def main(png, inventory, outdir):
    img = Image.open(png).convert("RGB")
    inv = json.load(open(inventory))
    os.makedirs(outdir, exist_ok=True)

    sw = inv["screen"]["size"]["w"]
    sh = inv["screen"]["size"]["h"]
    sx, sy = img.width / sw, img.height / sh   # render can carry shadow bleed

    manifest = {}
    for c in inv["components"]:
        b = c["box"]
        x, y = b["x"] * sx, b["y"] * sy
        w, h = max(1, b["w"] * sx), max(1, b["h"] * sy)

        # padding scales with the element: a 12px icon needs relatively more
        pad = max(18, min(90, int(max(w, h) * 0.45)))
        x0, y0 = max(0, int(x - pad)), max(0, int(y - pad))
        x1, y1 = min(img.width, int(x + w + pad)), min(img.height, int(y + h + pad))
        if x1 - x0 < 8 or y1 - y0 < 8:
            continue

        crop = img.crop((x0, y0, x1, y1)).copy()
        d = ImageDraw.Draw(crop)
        rx0, ry0 = x - x0, y - y0
        d.rectangle([rx0 - 1, ry0 - 1, rx0 + w + 1, ry0 + h + 1],
                    outline=(239, 68, 68), width=2)

        # keep thumbnails light but readable
        maxw = 260
        if crop.width > maxw:
            crop = crop.resize((maxw, max(1, int(crop.height * maxw / crop.width))), Image.LANCZOS)
        if crop.height > 220:
            crop = crop.resize((max(1, int(crop.width * 220 / crop.height)), 220), Image.LANCZOS)

        name = "c-" + c["id"].replace(":", "-") + ".png"
        crop.save(os.path.join(outdir, name), optimize=True)
        manifest[c["id"]] = name

    json.dump(manifest, open(os.path.join(outdir, "manifest.json"), "w"))
    print(len(manifest))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
