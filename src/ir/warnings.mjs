// Where fidelity was lost, said out loud.
//
// A converter that reproduces most of a design silently is hard to trust: the
// user cannot tell which part to check. Naming each lossy decision turns a
// 75%-accurate render into a 75%-accurate render plus a list of the 25%.
//
// It also ranks the work. Counting warnings across a corpus says which defect
// class costs the most, instead of finding them one render at a time.

/** A deduplicating collector; the same loss reported twice is one entry. */
export function warnings() {
  const seen = new Map();

  return {
    add(kind, detail) {
      const key = kind + "|" + (detail || "");
      if (!seen.has(key)) seen.set(key, { kind, detail: detail || null, count: 0 });
      seen.get(key).count++;
    },
    list() {
      return [...seen.values()].sort((a, b) => b.count - a.count);
    },
    get size() { return seen.size; },
  };
}

/**
 * The kinds, named once so a report can group by them and a corpus scan can
 * count them. The text is what a user reads, so it says what was lost rather
 * than which function noticed.
 */
export const KIND = {
  ROTATION_UNRECOVERABLE: "rotation-unrecoverable",
  BOOLEAN_AS_IMAGE: "boolean-as-image",
  VECTOR_AS_IMAGE: "vector-as-image",
  MASK_UNSUPPORTED: "mask-unsupported",
  FONT_MISSING: "font-missing",
  OFFSCREEN_DROPPED: "offscreen-dropped",
  GRADIENT_APPROXIMATED: "gradient-approximated",
  TEXT_RESIZED: "text-resized",
};

export function describe(kind, detail) {
  const d = detail ? " (" + detail + ")" : "";
  switch (kind) {
    case KIND.ROTATION_UNRECOVERABLE:
      return "Rotation near 45 degrees" + d + ": the true size cannot be"
        + " recovered from a bounding box, so it is left as measured";
    case KIND.BOOLEAN_AS_IMAGE:
      return "Boolean operation" + d + " exported as an image: the result of a"
        + " union or subtraction has no equivalent in CSS or SwiftUI";
    case KIND.VECTOR_AS_IMAGE:
      return "Vector" + d + " exported as an image: its outline is path data"
        + " the REST API does not return";
    case KIND.MASK_UNSUPPORTED:
      return "Mask on" + d + " not reproducible: the masked layer is drawn"
        + " unclipped";
    case KIND.FONT_MISSING:
      return "Font" + d + " is not installed: text keeps its position but its"
        + " metrics differ, which caps how closely it can match";
    case KIND.OFFSCREEN_DROPPED:
      return "Content below the fold" + d + " dropped: the design shows only"
        + " the top of a scrollable area";
    case KIND.GRADIENT_APPROXIMATED:
      return "Gradient" + d + " approximated: its type has no direct"
        + " equivalent on this platform";
    case KIND.TEXT_RESIZED:
      return "Text" + d + " rendered smaller than measured so it fits the box"
        + " its design font was measured in";
    default:
      return kind + d;
  }
}
