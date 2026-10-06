#!/usr/bin/env python3
"""Corroborate the design file against the design image.

Neither source is sufficient alone:
  - the node tree knows ids, properties and hierarchy, but happily reports
    elements a human cannot see (covered by a later sibling, clipped away,
    painted behind an opaque panel) and cannot see anything that was flattened
    into a raster
  - the render shows exactly what is visible, but carries no ids or properties

So each node is checked against the pixels it claims, and each region of visible
ink is checked for a node that explains it. Disagreement in either direction is
the finding:

  agreed      node has distinguishable content where it says it does
  file-only   node exists in the tree but its area is blank/uniform in the
              render -> occluded, transparent, or a layout-only wrapper
  image-only  ink with no node explaining it -> rasterised content or a gap in
              the reader

This is the cross-validation that a single-source pipeline cannot do.
"""
import json, sys
from PIL import Image, ImageChops, ImageFilter

def load(p):
    return Image.open(p).convert("RGB")

def region_stats(img, box, pad=0):
    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
    x0 = max(0, int(x) - pad); y0 = max(0, int(y) - pad)
    x1 = min(img.width, int(x + w) + pad); y1 = min(img.height, int(y + h) + pad)
    if x1 <= x0 or y1 <= y0:
        return None
    crop = img.crop((x0, y0, x1, y1))
    g = crop.convert("L")
    ext = g.getextrema()
    px = list(g.getdata())
    n = len(px)
    mean = sum(px) / n
    var = sum((p - mean) ** 2 for p in px) / n
    return {"contrast": ext[1] - ext[0], "variance": round(var, 1), "mean": round(mean, 1), "pixels": n}

def ink_regions(img, min_area=120):
    """Connected blobs of non-background ink, as coarse boxes."""
    g = img.convert("L")
    hist = g.histogram()
    bg = hist.index(max(hist))
    mask = g.point(lambda v: 255 if abs(v - bg) > 18 else 0)
    mask = mask.filter(ImageFilter.MaxFilter(5))          # merge nearby strokes
    w, h = mask.size
    px = mask.load()
    seen = [[False] * w for _ in range(h)]
    boxes = []
    step = 2
    for y in range(0, h, step):
        for x in range(0, w, step):
            if px[x, y] == 0 or seen[y][x]:
                continue
            stack = [(x, y)]
            seen[y][x] = True
            minx = maxx = x; miny = maxy = y
            count = 0
            while stack and count < 40000:
                cx, cy = stack.pop()
                count += 1
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for dx, dy in ((step, 0), (-step, 0), (0, step), (0, -step)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] > 0:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            area = (maxx - minx) * (maxy - miny)
            if area >= min_area:
                boxes.append({"x": minx, "y": miny, "w": maxx - minx, "h": maxy - miny, "area": area})
    return boxes

def overlaps(a, b):
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix = max(0, min(ax2, bx2) - max(a["x"], b["x"]))
    iy = max(0, min(ay2, by2) - max(a["y"], b["y"]))
    inter = ix * iy
    return inter / max(1, b["w"] * b["h"])

if __name__ == "__main__":
    design_png, inventory_json, out_json = sys.argv[1], sys.argv[2], sys.argv[3]
    img = load(design_png)
    inv = json.load(open(inventory_json))
    comps = inv["components"]

    sw, sh = inv["screen"]["size"]["w"], inv["screen"]["size"]["h"]
    sx, sy = img.width / sw, img.height / sh      # render may include shadow bleed

    agreed, file_only = [], []
    for c in comps:
        box = {"x": c["box"]["x"] * sx, "y": c["box"]["y"] * sy,
               "w": c["box"]["w"] * sx, "h": c["box"]["h"] * sy}
        st = region_stats(img, box, pad=1)
        if st is None:
            file_only.append({**c, "why": "out-of-canvas"})
            continue
        # a node is corroborated when its area is not a flat patch of one colour
        distinguishable = st["contrast"] > 18 or st["variance"] > 40
        (agreed if distinguishable else file_only).append(
            {"id": c.get("id"), "name": c.get("name") or c.get("id") or "",
             "role": c.get("role", "?"), "box": c["box"],
             "stats": st, **({"why": "uniform-area (occluded, transparent, or a bare container)"} if not distinguishable else {})})

    regions = ink_regions(img)
    scaled = [{"x": c["box"]["x"] * sx, "y": c["box"]["y"] * sy,
               "w": c["box"]["w"] * sx, "h": c["box"]["h"] * sy} for c in comps]
    image_only = []
    for r in regions:
        if max((overlaps(s, r) for s in scaled), default=0) < 0.25:
            image_only.append(r)

    result = {
        "screen": inv["screen"],
        "fileComponents": len(comps),
        "imageRegions": len(regions),
        "agreed": len(agreed),
        "fileOnly": len(file_only),
        "imageOnly": len(image_only),
        "corroborationRate": round(len(agreed) / max(1, len(comps)) * 100, 1),
        "fileOnlyDetail": file_only[:20],
        "imageOnlyDetail": sorted(image_only, key=lambda r: -r["area"])[:20],
    }
    json.dump(result, open(out_json, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: result[k] for k in
                      ("fileComponents", "imageRegions", "agreed", "fileOnly", "imageOnly", "corroborationRate")},
                     ensure_ascii=False))
