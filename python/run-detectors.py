#!/usr/bin/env python3
"""Run pluggable image detectors on a design render and emit uniform boxes.

Purpose: measure RECOGNITION RATE of the file-based pipeline by comparing what
independent image detectors see against the inventory. Three backends with very
different natures, so their disagreement is informative:

  pil      the original luminance-blob heuristic (baseline 0)
  opencv   MSER stable regions (classic CV, no model)
  omni     OmniParser v2 icon_detect (YOLO trained on UI screenshots)

Output: { detector: [ {x,y,w,h,score} ] } in DESIGN coordinates.
NOTE: OmniParser icon_detect ships under AGPL-3.0 (YOLO lineage) — cleared for
internal evaluation; productisation needs a licensing decision.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".pydeps"))

from PIL import Image
import numpy as np

def to_design(boxes, sx, sy):
    return [{"x": round(b[0] / sx, 1), "y": round(b[1] / sy, 1),
             "w": round(b[2] / sx, 1), "h": round(b[3] / sy, 1),
             "score": round(float(b[4]), 3)} for b in boxes]

def det_pil(img):
    g = img.convert("L")
    hist = g.histogram()
    bg = hist.index(max(hist))
    W, H = g.size
    px = g.load()
    mask = [[abs(px[x, y] - bg) > 40 for x in range(W)] for y in range(H)]
    seen = [[False] * W for _ in range(H)]
    out = []
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            if not mask[y][x] or seen[y][x]:
                continue
            st = [(x, y)]; seen[y][x] = True
            minx = maxx = x; miny = maxy = y; cnt = 0
            while st and cnt < 30000:
                cx, cy = st.pop(); cnt += 1
                minx = min(minx, cx); maxx = max(maxx, cx)
                miny = min(miny, cy); maxy = max(maxy, cy)
                for dx, dy in ((2, 0), (-2, 0), (0, 2), (0, -2)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True; st.append((nx, ny))
            w, h = maxx - minx, maxy - miny
            if 8 <= w <= 400 and 8 <= h <= 400:
                out.append((minx, miny, w, h, 0.5))
    return out

def det_opencv(img):
    import cv2
    arr = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2GRAY)
    mser = cv2.MSER_create(delta=5, min_area=60, max_area=40000)
    regions, _ = mser.detectRegions(arr)
    out = []
    for r in regions:
        x, y, w, h = cv2.boundingRect(r)
        if 8 <= w <= 400 and 8 <= h <= 400:
            out.append((x, y, w, h, 0.5))
    # de-dup near-identical boxes
    out.sort(key=lambda b: -(b[2] * b[3]))
    kept = []
    for b in out:
        dup = any(abs(b[0] - k[0]) < 6 and abs(b[1] - k[1]) < 6
                  and abs(b[2] - k[2]) < 10 and abs(b[3] - k[3]) < 10 for k in kept)
        if not dup:
            kept.append(b)
    return kept[:400]

def det_omni(img, model_path):
    from ultralytics import YOLO
    model = YOLO(model_path)
    res = model.predict(source=np.array(img), conf=0.05, imgsz=1280, verbose=False)[0]
    out = []
    for b in res.boxes:
        x0, y0, x1, y1 = [float(v) for v in b.xyxy[0]]
        out.append((x0, y0, x1 - x0, y1 - y0, float(b.conf[0])))
    return out

if __name__ == "__main__":
    png, design_w, design_h, out_file = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
    img = Image.open(png).convert("RGB")
    sx, sy = img.width / design_w, img.height / design_h
    model_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "..",
                              ".models", "omniparser", "icon_detect", "model.pt")
    results = {}
    import time
    for name, fn in [("pil", det_pil), ("opencv", det_opencv),
                     ("omni", lambda im: det_omni(im, model_path))]:
        t0 = time.time()
        try:
            boxes = fn(img)
            results[name] = {"boxes": to_design(boxes, sx, sy), "seconds": round(time.time() - t0, 1)}
        except Exception as e:
            results[name] = {"error": str(e)[:200]}
    json.dump(results, open(out_file, "w"))
    for k, v in results.items():
        print(k, len(v.get("boxes", [])), "boxes", v.get("seconds", "-"), "s", v.get("error", ""))
