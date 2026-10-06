// Whether a stored analysis still matches what the pipeline reads.
//
// One screen scored 4.5 and looked like a broken tool. It had been analysed
// three weeks earlier, before the paint list existed, so the renderer had
// nothing to draw from. Re-analysing it took it to 71.1 with no code change.
//
// Age is not the test — an old analysis of an unchanged screen is fine. What
// matters is whether it carries the files the current pipeline consumes.
import fs from "node:fs";
import path from "node:path";

/**
 * Files the renderer cannot work without, and what their absence costs.
 *
 * Keep this list in step with what the pipeline actually reads: a file listed
 * here that nothing consumes produces a false alarm, which is worse than no
 * warning at all.
 */
const REQUIRED = [
  ["raw/paint.json",
    "the paint list, which is what the model is given; without it a render"
    + " falls back to the component inventory and loses most of the screen"],
  ["raw/bg-assets.json",
    "the export manifest, without which vectors and photos are rebuilt as"
    + " coloured rectangles"],
  ["manifest.json", "the screen's own size and name"],
];

/** What is missing from a stored analysis, if anything. */
export function staleness(latest) {
  if (!fs.existsSync(latest)) return { missing: [], absent: true };
  const missing = [];
  for (const [rel, why] of REQUIRED) {
    if (!fs.existsSync(path.join(latest, rel))) missing.push({ file: rel, why });
  }
  return { missing, absent: false };
}

/** One line a person can act on, or null when the analysis is current. */
export function stalenessNote(latest, screenId) {
  const s = staleness(latest);
  if (s.absent) return "\"" + screenId + "\" has not been analysed.";
  if (!s.missing.length) return null;
  return "\"" + screenId + "\" was analysed by an older version and is missing "
    + s.missing.map((m) => m.file).join(", ")
    + ". Re-analyse it before reading its score: " + s.missing[0].why + ".";
}
