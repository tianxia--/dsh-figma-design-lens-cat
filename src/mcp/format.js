// Formatting analysis results for an AI consumer.
//
// Two audiences share one call: the model needs compact, unambiguous text it
// can act on, and the human next to it needs a page to look at. So every tool
// result carries both — a readable summary plus a URL that opens the review.
//
// Principles carried over from building the reports:
//   - lead with what BLOCKS work (interaction 0% matters more than 71 components)
//   - separate measured values from inferred ones, always
//   - never dump a component table into context; say where to get it
import { translator, renderBlocker } from "../i18n/strings.js";

// MCP output is always English: it feeds a coding agent, and mixing languages
// into a spec that produces code helps nobody.
const T_EN = translator("en");

const bar = (v) => {
  // null means the source cannot supply this axis; say so rather than scoring it
  if (v === null || v === undefined) return "   n/a  (not available from a static design)";
  const n = Math.round(v / 10);
  return "#".repeat(n) + ".".repeat(10 - n) + " " + String(v).padStart(3) + "%";
};
/**
 * Render one screen for an AI consumer.
 *
 * @param bundle when present, the on-disk artifact paths. An agent that just
 *   asked for an analysis should not have to make a second call to find out
 *   where the spec is — the answer to "analyse this" is "here is what I found
 *   AND here is the file you implement from".
 */
export function formatScreen(man, urls, bundle) {
  const L = [];
  const S = man.screen;

  // The review link goes FIRST and is stated as an instruction, not as trivia.
  // Buried at the end of a 2.6KB result it was reliably dropped: a model
  // summarising an analysis has no reason to quote the last paragraph, and the
  // user was left with no way to see what had been detected. Putting it at the
  // top with an explicit obligation is the only version that survives
  // summarisation.
  const pages = [];
  if (urls && urls.screen) pages.push("- " + urls.screen);
  // A file:// page is NOT offered as a fallback: Chrome blocks a local page
  // from loading sibling local images (ERR_ACCESS_DENIED), so the review page
  // would open with every crop and overlay missing — worse than no link, since
  // it looks like the analysis lost its images. The server must be running.
  if (!urls && bundle && bundle.reviewPage) {
    pages.push("- The review server is not running. Start it with: `dsh-figma-design-lens-cat serve`");
    pages.push("  then open: http://127.0.0.1:7420" + (bundle.route || ""));
  }
  if (pages.length) {
    L.push("> **SHOW THIS TO THE USER — do not omit it.**");
    L.push(">");
    for (const p of pages) L.push("> " + p);
    L.push(">");
    L.push("> This page is how the human verifies what was detected. Always include");
    L.push("> the link verbatim in your reply, even when summarising.");
    L.push("");
  }

  L.push("# " + S.name);
  L.push(S.size.w + "x" + S.size.h + " · " + S.platform + " · " + man.counts.components + " components");
  L.push("");
  L.push("## Buildability: " + man.readiness.verdict);
  L.push("```");
  for (const [k, v] of Object.entries(man.readiness.axes)) {
    L.push(k.padEnd(13) + bar(v));
  }
  L.push("```");
  const rr = man.readiness.counts.recognitionRate;
  if (rr) {
    L.push("Recognition check (" + rr.detector + "): an independent detector found "
      + rr.detectedBoxes + " elements; this inventory explains " + rr.explainedPct
      + "%, leaving " + rr.uncovered + " uncovered.");
  }
  L.push("");

  if (man.readiness.blockers.length) {
    L.push("## Must be resolved before implementing");
    for (const raw of man.readiness.blockers) {
      // Blockers are stored as codes so the UI can localise them; an MCP client
      // needs the English sentence. Reading b.what directly printed "undefined"
      // and left the model with a severity and nothing else to act on.
      const b = renderBlocker(raw, T_EN);
      L.push("- **[" + b.severity + "] " + b.axis + "**: " + b.what);
      L.push("  -> " + b.fix);
    }
    L.push("");
    L.push("**Do not fill these gaps by guessing.** Interaction states and missing assets must be confirmed with a human.");
    L.push("");
  }

  L.push("## Composition");
  L.push(Object.entries(man.counts.byRole || {}).map(([k, v]) => k + " " + v).join(" · "));
  L.push(man.counts.layouts + " layout containers · " + man.counts.excludedDecoration
    + " decoration excluded · " + man.counts.rasterOnly + " pixel-only regions");
  L.push("");

  L.push("## How to get more");
  L.push("- To implement this screen: call get_implementation_spec (full text spec, no images, ~13KB)");
  L.push("- For exact values: call get_components(role), role in " + Object.keys(man.counts.byRole || {}).join("/"));
  L.push("- Image assets: " + (man.counts.assetsExported || 0) + " exported, call get_assets for paths");
  L.push("");
  L.push("## Data provenance");
  L.push("- Geometry, colours, font sizes and text come **from the Figma file — exact, do not rewrite**");
  L.push("- Component names and descriptions are **model inferences** with a confidence; <0.7 is flagged");
  if (bundle) {
    L.push("## Files you can use right now");
    L.push("- **Implementation spec**: `" + bundle.spec + "`");
    L.push("  Read this file to build the screen. It is plain text, no images, and contains");
    L.push("  every section, component, colour, font and layout value.");
    if (bundle.components && bundle.components.length) {
      L.push("- **Exact component values**: `" + bundle.componentsDir + "/<role>.json`");
      L.push("  Available roles: " + bundle.components.join(", "));
    }
    if (bundle.assets && bundle.assets.length) {
      L.push("- **Image assets** (" + bundle.assets.length + "): `" + bundle.assetsDir + "/`");
      L.push("  Reference these files directly instead of recreating the artwork.");
    }
    L.push("");
  }
  // Repeat the link at the end as well. A model that reads top-down and then
  // writes its reply from the tail still sees it; duplication costs a few
  // tokens and buys the user a page they can actually open.
  if (pages.length) {
    L.push("## Visual review for the human");
    for (const p of pages) L.push(p);
    if (!urls) L.push("  (the review server is not running; the offline file opens in any browser)");
    L.push("Annotated detection, readiness, blockers and per-component crops.");
    L.push("**Tell the user this page exists** — it is how they verify what was detected.");
  }
  return L.join("\n");
}

export function formatProjects(index, urls) {
  const L = ["# Analysed projects", ""];
  if (!index.projects.length) return "No projects yet. Use analyze_design on a Figma link to start.";
  for (const p of index.projects) {
    const s = p.summary;
    L.push("## " + p.name + "  (" + p.id + ")");
    L.push(s.screens + " screens · " + s.components + " components · " + s.ready + "/" + s.screens + " ready to build");
    L.push("Average readiness: " + Object.entries(s.readiness).map(([k, v]) => k + " " + v + "%").join(" · "));
    L.push("");
  }
  if (urls) L.push("Management UI: " + urls.home);
  return L.join("\n");
}

export function formatScreens(project, urls) {
  const L = ["# " + project.name + " — " + project.screens.length + " screens", ""];
  L.push("| Screen | Size | Components | Readiness (structure/semantics/styling/assets/interaction) | Verdict |");
  L.push("|---|---|---|---|---|");
  for (const s of project.screens) {
    const r = s.readiness;
    L.push("| " + s.name + " (" + s.screenId + ") | " + s.size.w + "x" + s.size.h
      + " | " + s.components
      + " | " + r.structure + "/" + r.semantics + "/" + r.styling + "/" + r.assets + "/" + r.interaction
      + " | " + s.verdict + " |");
  }
  L.push("");
  L.push("For one screen: get_screen(project, screenId)");
  if (urls) L.push("Visual: " + urls.project);
  return L.join("\n");
}

export function formatComponents(list, role, screenName) {
  const L = ["# " + screenName + " — " + role + " components (" + list.length + ")", ""];
  L.push("measured.* comes from the Figma file and is exact; name/describes are model inferences.");
  L.push("");
  for (const c of list) {
    const m = c.measured || {};
    const b = m.box || {};
    L.push("## " + (c.name || c.id));
    if (c.describes) L.push(c.describes + (c.confidence != null ? "  (confidence " + c.confidence + ")" : ""));
    L.push("- box: x=" + Math.round(b.x) + " y=" + Math.round(b.y)
      + " w=" + Math.round(b.w) + " h=" + Math.round(b.h));
    if (m.fill) L.push("- fill: " + m.fill + (m.radius ? "  radius " + m.radius : ""));
    if (m.border) L.push("- border: " + m.border.w + "px " + m.border.color);
    if (m.font) L.push("- font: " + m.font.size + "px/" + m.font.weight
      + (m.font.color ? " " + m.font.color : "")
      + (m.font.lineHeight ? "  line-height " + m.font.lineHeight : ""));
    if (m.text) L.push("- text: " + JSON.stringify(m.text));
    L.push("- node: " + c.id);
    L.push("");
  }
  return L.join("\n");
}
