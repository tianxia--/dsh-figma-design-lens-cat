#!/usr/bin/env python3
"""Score how closely a rendered screen matches the design.

Scores are reported per axis and never blended into one number: a geometry
error and a colour error need different fixes, and an average hides both.
The comparison is per component because a whole-image diff is too forgiving --
a 4px offset of every element still scores 96% against the design.
"""
import json, sys, os

# Per-channel difference a viewer starts to notice. Below this, two pixels
# read as the same colour and should not count against the score.
JND = 12

# Standard deviation under which a patch carries no detail: a flat fill or an
# empty area rather than an icon, a chart or text.
FLAT_STD = 3.0

def load_components(latest):
    out = []
    d = os.path.join(latest, "components")
    if not os.path.isdir(d):
        return out
    for f in sorted(os.listdir(d)):
        if not f.endswith(".json"):
            continue
        try:
            items = json.load(open(os.path.join(d, f)))
        except Exception:
            continue
        for c in (items if isinstance(items, list) else items.get("items", [])):
            if (c.get("measured") or {}).get("box"):
                out.append(c)
    return out

def srgb_to_lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_lab(rgb):
    r, g, b = [srgb_to_lin(v) for v in rgb]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.00000
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))

def delta_e(c1, c2):
    l1, a1, b1 = rgb_to_lab(c1)
    l2, a2, b2 = rgb_to_lab(c2)
    return ((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) ** 0.5

def hex_to_rgb(h):
    if not h or not isinstance(h, str) or not h.startswith("#"):
        return None
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) < 6:
        return None
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def dominant_rgb(img):
    """Most common colour in a patch.

    Compared against the same patch of the design rather than the declared
    fill: a text box is mostly background, so its dominant colour is the
    background, and checking it against the font colour always fails.
    """
    small = img.convert("RGB").resize((16, 16))
    counts = {}
    for px in list(small.getdata()):
        counts[px] = counts.get(px, 0) + 1
    return max(counts.items(), key=lambda kv: kv[1])[0]

def compare(design_png, built_png, latest, tol_px=2.0):
    from PIL import Image
    import numpy as np

    design = Image.open(design_png).convert("RGB")
    built = Image.open(built_png).convert("RGB")

    # The built screen is captured at device resolution and the design is at
    # frame resolution. Normalise to the design frame so boxes line up.
    if built.size != design.size:
        built = built.resize(design.size, Image.LANCZOS)

    comps = load_components(latest)
    rows, dw, dh = [], design.size[0], design.size[1]

    for c in comps:
        m = c["measured"]
        b = m["box"]
        x, y = int(b["x"]), int(b["y"])
        w, h = int(b["w"]), int(b["h"])
        if w < 2 or h < 2:
            continue
        rect = (max(0, x), max(0, y), min(x + w, dw), min(y + h, dh))
        if rect[2] <= rect[0] or rect[3] <= rect[1]:
            continue

        pd = design.crop(rect)
        pb = built.crop(rect)
        ad = np.asarray(pd, dtype=float)
        ab = np.asarray(pb, dtype=float)

        # Score by how much of the patch differs, not by the average
        # difference. Averaging dilutes a real miss: an icon that was never
        # drawn leaves a blank patch whose mean is close to the design's pale
        # background, which scored 75% for rendering nothing at all.
        delta = np.abs(ad - ab).max(axis=2)
        differing = float((delta > JND).mean())
        pixel = 100.0 * (1.0 - differing)

        # A patch the design fills with detail but the build leaves flat is
        # missing content, whatever the averages say.
        design_flat = float(ad.std()) < FLAT_STD
        built_flat = float(ab.std()) < FLAT_STD
        missing = built_flat and not design_flat
        if missing:
            pixel = min(pixel, 5.0)

        de = delta_e(dominant_rgb(pd), dominant_rgb(pb))

        rows.append({
            "id": c.get("id"),
            "name": c.get("name") or c.get("figmaName"),
            "box": {"x": x, "y": y, "w": w, "h": h},
            "pixel": round(pixel, 1),
            "deltaE": round(de, 1) if de is not None else None,
            "missing": missing,
            "text": (m.get("text") or None),
        })

    return rows


def summarise(rows):
    """Report each axis separately and list what actually failed."""
    if not rows:
        return {"verdict": "no-components", "axes": {}, "worst": []}

    pixels = [r["pixel"] for r in rows]
    des = [r["deltaE"] for r in rows if r["deltaE"] is not None]

    # deltaE <= 2.3 is the "just noticeable difference" threshold.
    colour_ok = [d for d in des if d <= 2.3]

    missing = [r for r in rows if r.get("missing")]

    axes = {
        "pixel": round(sum(pixels) / len(pixels), 1),
        "colour": round(len(colour_ok) / len(des) * 100, 1) if des else None,
        # What fraction of components are recognisably there at all.
        "present": round((len(rows) - len(missing)) / len(rows) * 100, 1),
    }
    failing = sorted([r for r in rows if r["pixel"] < 90], key=lambda r: r["pixel"])

    # Missing content outranks a poor score: a component that was never drawn
    # is a different problem from one drawn slightly wrong.
    verdict = "match"
    if missing:
        verdict = "incomplete"
    elif any(r["pixel"] < 75 for r in rows):
        verdict = "mismatch"
    elif failing:
        verdict = "drift"

    return {
        "verdict": verdict,
        "axes": axes,
        "components": len(rows),
        "failing": len(failing),
        "missing": len(missing),
        "worst": failing[:10],
    }

def main():
    if len(sys.argv) < 4:
        print("usage: compare.py <design.png> <built.png> <latest-dir> [out.json]")
        return 2
    design, built, latest = sys.argv[1], sys.argv[2], sys.argv[3]
    rows = compare(design, built, latest)
    result = summarise(rows)
    result["all"] = rows
    if len(sys.argv) > 4:
        json.dump(result, open(sys.argv[4], "w"), indent=1)
    out = {k: v for k, v in result.items() if k != "all"}
    print(json.dumps(out, indent=1))
    return 0

if __name__ == "__main__":
    sys.exit(main())

