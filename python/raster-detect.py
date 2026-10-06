#!/usr/bin/env python3
"""Find elements that exist only as pixels.

The map base ("Frame 2134243635", 390x844, zero children) is one raster image:
every POI dot, road and label the reviewer sees in it has NO Figma node. File
reading cannot ever list them — they must be detected from the pixels, and
shown as their own category so nobody mistakes them for structured components.

Detection is scoped to RASTER HOST regions (childless nodes larger than an
icon) and looks for small saturated/bright blobs on the surrounding tone —
which is what map pins and location dots are.
"""
import json, sys
from PIL import Image
def find_raster_hosts(ir_file, min_side=200):
    """Raster hosts = big childless IMAGE-bearing nodes, not decorative shapes.

    The first pass swept every childless rectangle including header decoration,
    then dropped every blob because it overlapped an already-known component.
    Hosts are now the genuinely image-like surfaces (map tiles, photos): large
    on BOTH sides and not classified as decoration by name."""
    ir = json.load(open(ir_file))
    screen = ir["screens"][0]
    hosts = []
    DECOR = ("rectangle", "ellipse", "grad", "spacer", "1", "2", "3", "4")
    def walk(n):
        kids = n.get("children") or []
        b = n["box"]
        name = str(n.get("name", "")).strip().lower()
        if (not kids and b["w"] >= min_side and b["h"] >= min_side
                and not any(name.startswith(d) for d in DECOR)):
            hosts.append({"id": n["id"], "name": n["name"], "box": b})
        for c in kids:
            walk(c)
    walk(screen["root"])
    return screen, hosts


def blobs_in(img, box, sx, sy, min_d=4, max_d=60):
    x0, y0 = int(box["x"] * sx), int(box["y"] * sy)
    x1 = min(img.width, int((box["x"] + box["w"]) * sx))
    y1 = min(img.height, int((box["y"] + box["h"]) * sy))
    if x1 <= x0 or y1 <= y0:
        return []
    region = img.crop((x0, y0, x1, y1)).convert("HSV")
    W, H = region.size
    px = region.load()
    # A pin reads as an anomaly against the LOCAL tone, not as an absolute
    # colour: this dark map's 99th-percentile value is ~75 while pins hit 160+.
    # Threshold = median + margin, computed per region.
    vals = sorted(px[x, y][2] for y in range(0, H, 2) for x in range(0, W, 2))
    med = vals[len(vals) // 2]
    thr_v = med + 70
    mask = [[px[x, y][2] > thr_v or (px[x, y][1] > 130 and px[x, y][2] > med + 35)
             for x in range(W)] for y in range(H)]
    seen = [[False] * W for _ in range(H)]
    out = []
    for y in range(H):
        for x in range(W):
            if not mask[y][x] or seen[y][x]:
                continue
            stack = [(x, y)]; seen[y][x] = True
            minx = maxx = x; miny = maxy = y; count = 0
            while stack and count < 20000:
                cx, cy = stack.pop(); count += 1
                minx, maxx = min(minx, cx), max(maxx, cx)
                miny, maxy = min(miny, cy), max(maxy, cy)
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = cx+dx, cy+dy
                    if 0 <= nx < W and 0 <= ny < H and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True; stack.append((nx, ny))
            w, h = maxx - minx + 1, maxy - miny + 1
            if min_d <= w <= max_d and min_d <= h <= max_d and count >= w * h * 0.3:
                out.append({"x": (x0 + minx) / sx, "y": (y0 + miny) / sy,
                            "w": w / sx, "h": h / sy})
    return out
def overlaps_any(b, comps, thr=0.3):
    """Only a component that could BE the blob explains it: similar scale.

    A 596x506 decorative ellipse spans the whole map; letting it 'cover' every
    9-pixel pin meant zero detections. An explaining component may be at most
    6x the blob's size."""
    for c in comps:
        cb = c["box"]
        # text explains its glyphs at ANY scale (a paragraph legitimately
        # covers hundreds of letter-sized blobs); the 6x rule only guards
        # against big decorative shapes swallowing pins
        if c.get("role") != "text" and cb["w"] * cb["h"] > 36 * max(1.0, b["w"] * b["h"]):
            continue
        ix = max(0, min(b["x"]+b["w"], cb["x"]+cb["w"]) - max(b["x"], cb["x"]))
        iy = max(0, min(b["y"]+b["h"], cb["y"]+cb["h"]) - max(b["y"], cb["y"]))
        if ix * iy / max(1e-6, b["w"] * b["h"]) > thr:
            return True
    return False

if __name__ == "__main__":
    png, ir_file, inv_file, out_file = sys.argv[1:5]
    img = Image.open(png).convert("RGB")
    screen, hosts = find_raster_hosts(ir_file)
    inv = json.load(open(inv_file))
    sx = img.width / screen["size"]["w"]
    sy = img.height / screen["size"]["h"]

    found = []
    for h in hosts:
        for b in blobs_in(img, h["box"], sx, sy):
            if overlaps_any(b, inv["components"]):
                continue      # already explained by a file node
            found.append({**{k: round(v, 1) for k, v in b.items()}, "host": h["name"], "hostId": h["id"]})

    json.dump({"note": "Elements that exist only as pixels (found inside raster images; no Figma node). Their meaning needs human confirmation.",
               "hosts": hosts, "detected": found}, open(out_file, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({"rasterHosts": [h["name"] + " " + str(round(h["box"]["w"])) + "x" + str(round(h["box"]["h"])) for h in hosts],
                      "detected": len(found)}, ensure_ascii=False))
