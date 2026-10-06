#!/usr/bin/env python3
"""Background colour a screen is composited on.

A card can be translucent: the incident card fills with white at 10% opacity,
which reads as dark grey over the app's black background and as nothing at all
over the white default of a fresh page. The design render is the only place
that colour actually exists, so it is sampled from there.
"""
import sys, json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: canvas-bg.py <design.png>"}))
        return 2
    try:
        from PIL import Image
    except ImportError:
        print(json.dumps({"error": "pillow missing"}))
        return 1

    im = Image.open(sys.argv[1]).convert("RGB")
    w, h = im.size
    # The most common colour in a thin ring just inside the edge. A corner
    # pixel can fall outside a rounded card and read as the page behind it,
    # which gave pure black for a card whose background is dark teal, while
    # sampling further in hits the content instead.
    ring = max(3, min(w, h) // 25)
    samples = []
    for y in range(h):
        for x in range(w):
            edge = x < ring or y < ring or x >= w - ring or y >= h - ring
            if not edge:
                continue
            # Skip the corner squares, where the rounding lives.
            corner = (x < ring * 3 or x >= w - ring * 3) and (y < ring * 3 or y >= h - ring * 3)
            if corner:
                continue
            samples.append(im.getpixel((x, y)))

    if not samples:
        print(json.dumps({"uniform": False}))
        return 0

    # Median per channel. Exact-colour counting fails on a real render: this
    # background varies by a few levels from pixel to pixel, so no single
    # value dominates even though the colour plainly is uniform.
    med = []
    for i in range(3):
        vals = sorted(s[i] for s in samples)
        med.append(vals[len(vals) // 2])

    # Uniform when most of the ring sits close to that median; a photo or a
    # gradient behind the card does not.
    near = sum(1 for s in samples if max(abs(s[i] - med[i]) for i in range(3)) <= 10)
    if near / len(samples) < 0.7:
        # Not one colour overall -- a gradient, or a screen whose foot carries
        # a light tab bar over a dark body. The upper band is still the app
        # background, and reporting it beats a renderer defaulting to white:
        # the iOS template hard-coded white and scored 6% where the same data
        # rendered at 30% on web.
        band = [im.getpixel((x, y))
                for y in range(ring, max(ring + 1, h // 4))
                for x in (ring, w - 1 - ring)]
        if band:
            # The median, with no agreement test: the point is to give a
            # renderer a better starting colour than white, and a median over
            # the band is close enough for that even where the band shades
            # from black at one edge to a tinted dark at the other.
            bmed = [sorted(s[i] for s in band)[len(band) // 2] for i in range(3)]
            print(json.dumps({
                "uniform": False,
                "dominant": "#%02X%02X%02X" % tuple(bmed),
                "from": "upper-band",
            }))
            return 0
        print(json.dumps({"uniform": False}))
        return 0
    cols = [tuple(med)]

    # Only report a background when the corners agree; a photo or a gradient
    # behind the card has no single colour to report.
    first = cols[0]
    spread = max(max(abs(c[i] - first[i]) for i in range(3)) for c in cols)
    if spread > 12:
        print(json.dumps({"uniform": False}))
        return 0
    avg = tuple(round(sum(c[i] for c in cols) / len(cols)) for i in range(3))
    print(json.dumps({
        "uniform": True,
        "hex": "#%02X%02X%02X" % avg,
    }))
    return 0

if __name__ == "__main__":
    sys.exit(main())
