#!/usr/bin/env python3
"""Slice the annotated overlay into viewable tiles.

The previous inline version computed the tile count from one budget and then
wrote tiles using a different step, so a tall screen lost its tail silently: a
910x3841 design produced 7684px of overlay and kept 3074px of it. Sixty percent
of the screen was missing from the review page while the analysis itself was
complete — the worst kind of bug, because the data was right and only the
presentation lied.

Rules here: cover the full height exactly, never emit a zero-height tile, and
report the covered range so a caller can assert it.
"""
import sys, os
from PIL import Image

MAX_EDGE = 1900          # keep each tile within common image limits


def slice_overlay(src, out_prefix, max_edge=MAX_EDGE):
    img = Image.open(src)
    w, h = img.size
    if h <= max_edge:
        out = f"{out_prefix}-1.png"
        img.save(out, optimize=True)
        return [(out, w, h)], h

    n = (h + max_edge - 1) // max_edge          # ceil: enough tiles to cover h
    step = (h + n - 1) // n                     # ceil: every tile covers its share
    tiles, covered = [], 0
    for i in range(n):
        y0 = i * step
        y1 = min(h, y0 + step)
        if y1 <= y0:
            break
        out = f"{out_prefix}-{i + 1}.png"
        img.crop((0, y0, w, y1)).save(out, optimize=True)
        tiles.append((out, w, y1 - y0))
        covered = y1
    return tiles, covered


if __name__ == "__main__":
    src, prefix = sys.argv[1], sys.argv[2]
    tiles, covered = slice_overlay(src, prefix)
    total = Image.open(src).size[1]
    for path, w, h in tiles:
        print(f"{os.path.basename(path)} {w}x{h}")
    if covered != total:
        print(f"ERROR: covered {covered}px of {total}px", file=sys.stderr)
        sys.exit(1)
    print(f"covered {covered}/{total}px in {len(tiles)} tiles")
