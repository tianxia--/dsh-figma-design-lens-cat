// Estimate rendered text width and pick a size that fits its box.
//
// The boxes are measured in Figma with the design's own font. That font is
// usually not installed where the screen is rebuilt, so the same string needs
// a different width and every renderer answers by dropping characters: a
// 53pt tooltip showed "110" instead of "110 BPM" whatever the prompt said.
// Deciding the size here turns a judgement call into arithmetic.

// Average advance per em for a fallback sans face, measured in a browser with
// -apple-system/Helvetica/Arial. Digits and capitals are much wider than
// lowercase, so one blended ratio misjudges numeric labels badly.
const ADVANCE = {
  digit: 0.5562,
  upper: 0.6774,
  lower: 0.4895,
  space: 0.2778,
  punct: 0.3730,
};

function classOf(ch) {
  if (ch >= "0" && ch <= "9") return "digit";
  if (ch >= "A" && ch <= "Z") return "upper";
  if (ch >= "a" && ch <= "z") return "lower";
  if (ch === " ") return "space";
  return "punct";
}

/** Width in points that a string needs at a given size. */
export function measureText(text, size) {
  let em = 0;
  for (const ch of String(text || "")) em += ADVANCE[classOf(ch)] || 0.55;
  return em * (size || 14);
}

/**
 * Size that keeps the string inside its box, or null when it already fits.
 * Width scales linearly with size, so the ratio gives the answer directly.
 */
export function fitSize(text, size, boxWidth, minRatio = 0.7) {
  if (!text || !boxWidth) return null;
  const needed = measureText(text, size);
  if (needed <= boxWidth) return null;
  // Aim slightly inside the box. The advances are averages over a fallback
  // stack, so a size that fits exactly on paper still overflows by a fraction
  // in a specific face, and a fraction is enough to lose the last character.
  const scaled = size * ((boxWidth * 0.97) / needed);
  const floor = size * minRatio;
  // Below the floor the label would be unreadable; the box is simply wrong
  // for this font, and overflowing is the lesser fault.
  return scaled < floor ? Number(floor.toFixed(2)) : Number(scaled.toFixed(2));
}
