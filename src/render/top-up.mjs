// Asking again for what the first pass left out.
//
// The model omits items: one screen lost five filled boxes, another lost a
// different set on each target. Regenerating the whole page re-rolls
// everything, including the parts that were right. Sending only the gap
// keeps what worked and is cheap, because the gap is small.
//
// This only helps when the data was correct and the model skipped it. A
// defect in extraction repeats itself however many times it is sent, so the
// fix for that is upstream, not here.

/** The prompt for a follow-up pass: the code so far, and what is missing. */
export function topUpPrompt(code, missing, target) {
  const tag = {
    web: 'data-id="<id>"',
    ios: '.accessibilityIdentifier("<id>")',
    android: 'Modifier.testTag("<id>")',
  }[target] || "the item id";

  return [
    "The implementation below is missing " + missing.length + " item"
      + (missing.length === 1 ? "" : "s") + " from the design.",
    "",
    "Add them. Change nothing else: every element already present must keep"
      + " its position, size, colour and order exactly as it is.",
    "Each added element carries its id as " + tag + ".",
    "",
    "Return the complete file, not a fragment.",
    "",
    "Missing items:",
    JSON.stringify(missing, null, 1),
    "",
    "Current implementation:",
    code,
  ].join("\n");
}

/**
 * Generate, then ask again for whatever was left out.
 *
 * Stops when nothing is missing, when a pass adds nothing — a model that
 * cannot place an item will not place it on the fourth attempt either — or
 * at the round limit.
 */
export async function withTopUp({ first, again, items, verify, rounds = 3, onLog }) {
  let code = first;
  let report = verify(code, items);
  const trail = [];

  for (let round = 1; report && report.missing.length && round <= rounds; round++) {
    const before = report.missing.length;
    trail.push({ round, missing: before });
    if (onLog) {
      onLog("round " + round + ": " + before + " of " + items.length
        + " items missing, asking again");
    }

    let next;
    try {
      next = await again(code, report.missing);
    } catch (e) {
      if (onLog) onLog("top-up failed: " + String(e.message).slice(0, 120));
      break;
    }
    if (!next || next.length < code.length * 0.5) {
      // A reply shorter than half the file is not the file: taking it would
      // lose more than the round could add.
      if (onLog) onLog("top-up returned a fragment; keeping the previous result");
      break;
    }

    const after = verify(next, items);
    if (!after || after.missing.length >= before) {
      if (onLog) onLog("top-up added nothing; stopping");
      break;
    }
    code = next;
    report = after;
  }

  return { code, report, trail };
}
