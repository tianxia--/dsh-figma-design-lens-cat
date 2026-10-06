// Decoration is not garbage — it is an ASSET.
//
// The header's abstract pattern was silently dropped as "decoration", but a
// developer still needs it: as one exported image. So excluded decoration is
// clustered by proximity and each cluster becomes a background-asset entry.
//
// Provenance matters as much as the box: a reviewer asked "which image is this,
// I think there's a real picture behind the header" — the honest answer is that
// there is no image node at all, it is a layer group named "pattern" holding 12
// solid shapes. Recording the source group and the fill kinds answers that
// question in the report instead of costing a round trip.

const commonPrefix = (paths) => {
  if (!paths.length) return "";
  const parts = paths.map((p) => String(p || "").split(" / "));
  const out = [];
  for (let i = 0; i < parts[0].length; i++) {
    const seg = parts[0][i];
    if (parts.every((p) => p[i] === seg)) out.push(seg); else break;
  }
  return out.join(" / ");
};

export function clusterDecoration(decoration, opts = {}) {
  const gap = opts.gap ?? 60;
  if (!decoration.length) return [];
  const items = decoration.map((d) => ({ ...d }));
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const members = [items[i]];
    used.add(i);
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < items.length; j++) {
        if (used.has(j)) continue;
        const b = items[j].box;
        const near = members.some((m) => {
          const a = m.box;
          return !(b.x > a.x + a.w + gap || a.x > b.x + b.w + gap ||
                   b.y > a.y + a.h + gap || a.y > b.y + b.h + gap);
        });
        if (near) { members.push(items[j]); used.add(j); grew = true; }
      }
    }
    const x0 = Math.min(...members.map((m) => m.box.x));
    const y0 = Math.min(...members.map((m) => m.box.y));
    const x1 = Math.max(...members.map((m) => m.box.x + m.box.w));
    const y1 = Math.max(...members.map((m) => m.box.y + m.box.h));
    const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0);
    const cx1 = Math.min(opts.screenW ?? Infinity, x1);
    const cy1 = Math.min(opts.screenH ?? Infinity, y1);
    if (cx1 - cx0 < 8 || cy1 - cy0 < 8) continue;

    const sourceGroup = commonPrefix(members.map((m) => m.path)) || "(root)";
    const fills = [...new Set(members.map((m) => m.fill).filter(Boolean))];
    const kinds = [...new Set(members.map((m) => m.figmaRole || m.role))];
    const nature = fills.length
      ? "solid shapes composed together (no IMAGE fill)"
      : "unfilled layers (gradient/mask/glow)";

    clusters.push({
      role: "asset",
      name: "Background asset " + (clusters.length + 1),
      box: { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 },
      parts: members.length,
      partNames: [...new Set(members.map((m) => m.name).filter(Boolean))].slice(0, 6),
      sourceGroup,
      nature,
      kinds,
      fills: fills.slice(0, 8),
      note: "from layer group \"" + sourceGroup + "\": " + members.length + " shapes (" + nature
        + "). Export as one image asset rather than recreating each shape.",
    });
  }
  return clusters;
}
