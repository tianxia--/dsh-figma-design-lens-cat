// A System-One decision model, used only for language judgements.
//
// Measured on our own data, this class of model answers a question about
// words well and a question about design semantics badly:
//
//   "does this parent name mean a boolean combine?"   21/21
//   "is this layer name designer-written or default?" 20/20
//   "is this node an icon or a fragment of a shape?"  12/21, below the
//                                                     majority baseline
//
// So it is asked about names and text, never about what to do with a node.
// The rules keep every decision that needs to know how Figma works.
import { execFileSync } from "node:child_process";

const DEFAULT_URL = process.env.DLC_DECISION_URL
  || "https://api.codiv.ai/v1/systemone";
const DEFAULT_MODEL = process.env.DLC_DECISION_MODEL || "openjev-latest";

// Figma's own default names: a shape word with an optional number. Catching
// them locally keeps the service off the critical path for most layers.
const DEFAULT_NAME = /^(rectangle|ellipse|vector|frame|group|line|polygon|star|union|subtract|intersect|exclude|shape|mask)(\s+\d+)?$/i;

function post(body, url, key, timeoutMs) {
  const args = ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), url,
    "-H", "Content-Type: application/json", "-d", JSON.stringify(body)];
  // A local server takes no bearer token and rejects one.
  if (key && !/^http:\/\/(127\.|localhost)/.test(url)) {
    args.splice(4, 0, "-H", "Authorization: Bearer " + key);
  }
  const out = execFileSync("curl", args, { encoding: "utf8", timeout: timeoutMs + 5000 });
  const parsed = JSON.parse(out);
  if (!parsed.answers) throw new Error(JSON.stringify(parsed).slice(0, 200));
  return parsed.answers;
}

/**
 * Ask one multiple-choice question and return the chosen key, or null when
 * the model is not confident enough to act on.
 *
 * Low-confidence answers are dropped rather than used: the same input worded
 * two ways came back "icon 0.719" and "fragment 0.722", so an answer near the
 * middle carries no information.
 */
export function classify({ state, instructions, criteria, minConfidence = 0.6,
  url = DEFAULT_URL, key = process.env.DLC_DECISION_KEY || "", model = DEFAULT_MODEL,
  timeoutMs = 20000 }) {
  try {
    const answers = post({ model, state,
      questions: { q: { type: "choice", instructions, criteria } } }, url, key, timeoutMs);
    const a = answers.q || {};
    const probs = a.probabilities || {};
    const best = a.choice;
    if (!best) return null;
    // Confidence as reported is unstable; the winning probability is not.
    const share = probs[best];
    if (typeof share === "number" && share < minConfidence) return null;
    return best;
  } catch {
    // The pipeline must work with the service absent: every caller has a
    // deterministic answer to fall back on.
    return null;
  }
}

/**
 * Judge many names at once.
 *
 * The API takes several questions per request and they cannot read each
 * other, which is exactly this shape of work. One call per name took 106
 * seconds for a single screen; batching brings that down to a few calls.
 */
export function namesByDesigner(names, opts = {}) {
  const result = new Map();
  const pending = [];
  for (const raw of names) {
    const name = (raw || "").trim();
    if (!name || result.has(name)) continue;
    if (DEFAULT_NAME.test(name)) { result.set(name, false); continue; }
    pending.push(name);
  }

  const url = opts.url || DEFAULT_URL;
  const key = opts.key || process.env.DLC_DECISION_KEY || "";
  const model = opts.model || DEFAULT_MODEL;
  const batch = opts.batch || 20;

  for (let i = 0; i < pending.length; i += batch) {
    const slice = pending.slice(i, i + batch);
    const questions = {};
    slice.forEach((name, n) => {
      questions["q" + n] = {
        type: "choice",
        instructions: "Is the layer name " + JSON.stringify(name)
          + " chosen by a designer to describe what the layer is,"
          + " or generated automatically by the design tool?",
        criteria: {
          designer: "A name describing the element's role or content",
          automatic: "A default name made of a shape type and a number",
        },
      };
    });
    try {
      const answers = post({ model, state:
        "Layer names taken from a mobile UI design file.", questions },
        url, key, opts.timeoutMs || 60000);
      slice.forEach((name, n) => {
        const a = answers["q" + n] || {};
        const probs = a.probabilities || {};
        const share = probs[a.choice];
        // An unconfident answer keeps the name: losing a real one costs
        // meaning, keeping a generated one costs a little noise.
        const automatic = a.choice === "automatic"
          && (typeof share !== "number" || share >= (opts.minConfidence || 0.6));
        result.set(name, !automatic);
      });
    } catch {
      for (const name of slice) result.set(name, true);
    }
  }
  return result;
}

/** Whether a layer name was written by a designer or generated by the tool. */
export function namedByDesigner(name) {
  if (!name || !name.trim()) return false;
  // Figma's defaults are a shape word with an optional number; catching the
  // common ones locally keeps the service off the critical path.
  if (DEFAULT_NAME.test(name.trim())) return false;
  const pick = classify({
    state: "A layer in a design file is named " + JSON.stringify(name) + ".",
    instructions: "Is this name chosen by a designer to describe what the layer is,"
      + " or generated automatically by the design tool?",
    criteria: {
      designer: "A name describing the element's role or content",
      automatic: "A default name made of a shape type and a number",
    },
  });
  // Unknown means keep the name: dropping a real one loses meaning, keeping a
  // generated one only adds a little noise.
  return pick !== "automatic";
}
