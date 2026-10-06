// Collapse components that occupy the same pixels with the same content.
//
// Design files accumulate duplicate layers: a status bar pasted twice, a home
// indicator left behind by a copied frame. Figma reports both, and reporting
// both back is defensible — it is what the file says — but it is not useful.
// A developer implements one status bar, and two identical boxes drawn on the
// annotated overlay read as a detection error rather than as a fact about the
// file.
//
// So identical stacked nodes collapse into one, and the collapse is RECORDED
// (duplicateOf, duplicates) rather than silently applied: the count must stay
// explicable, and a designer may want to know their file has redundant layers.
//
// Deliberately narrow: same text, same role, same box to the pixel. Anything
// that differs in size, position or content is two different things and is left
// alone — a near-miss is exactly the case where guessing would destroy real
// content.
const key = (c) => [
  c.role,
  c.text || "",
  Math.round(c.box.x), Math.round(c.box.y),
  Math.round(c.box.w), Math.round(c.box.h),
].join("|");

export function collapseDuplicates(components) {
  const seen = new Map();
  const kept = [];
  let collapsed = 0;

  for (const c of components) {
    // Assets are synthesised, not read from the file; never fold them together.
    if (c.role === "asset") { kept.push(c); continue; }
    const k = key(c);
    const first = seen.get(k);
    if (!first) {
      seen.set(k, c);
      kept.push(c);
      continue;
    }
    first.duplicates = (first.duplicates || []).concat(c.id);
    collapsed++;
  }
  return { components: kept, collapsed };
}
