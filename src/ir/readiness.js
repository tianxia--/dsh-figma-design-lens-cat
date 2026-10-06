// How ready is this analysis for an AI to implement from?
//
// Recognition rate answers "did we see everything". It does NOT answer "can a
// developer build this" — a screen can be fully detected and still unbuildable
// because every icon is nameless, no asset was exported, or half the elements
// are baked into a bitmap.
//
// Five independent axes, each with its own blockers, told plainly rather than
// left for the consumer to discover mid-implementation. Deliberately NOT a
// single number: "78%" is not actionable, while "assets 100 / interaction 0"
// says exactly what to ask a human about.
//
// Blockers carry a CODE and parameters, never a prose sentence. Sentences
// written at analysis time cannot be translated later: manifests produced
// before the UI became bilingual still held Chinese, and a reader who switched
// to English still saw Chinese. Rendering decides the language, storage
// decides the facts.

const pct = (a, b) => (b === 0 ? 100 : Math.round((a / b) * 100));

export const VERDICT = { READY: "ready", RISKY: "risky", BLOCKED: "blocked" };

export function scoreReadiness(inv, { cross, raster, detcmp, bgassets } = {}) {
  const comps = inv.components || [];
  const real = comps.filter((c) => c.role !== "asset");

  // 1. structure — geometry present for everything claimed
  const withBox = real.filter((c) => c.box && c.box.w > 0 && c.box.h > 0).length;
  const structure = pct(withBox, real.length);

  // 2. semantics — can a developer tell what each element IS
  const needsName = real.filter((c) => c.role !== "text");
  const named = needsName.filter((c) =>
    (c.semantic && c.semantic.suggestName) ||
    (c.name && !/^(frame|group|rectangle|ellipse|vector)\s*[\d\s]*$/i.test(c.name) && c.name.trim()));
  const semantics = pct(named.length, needsName.length);
  const lowConfidence = needsName.filter((c) => c.semantic
    && typeof c.semantic.confidence === "number" && c.semantic.confidence < 0.7);
  // 3. styling — colours and typography where they matter.
  //
  // Surfaces used to be counted as unstyled unless the node itself carried a
  // fill, which scored a perfectly styled screen at 14%: in Figma a button is a
  // component INSTANCE whose paint lives on its children, so the instance node
  // has no fill of its own. Asking "does this node have a fill" answers a
  // question about the file format, not about the design.
  //
  // What actually matters: text must have size and colour, and a surface must
  // be styled EITHER on itself or somewhere in its subtree.
  const texts = real.filter((c) => c.role === "text");
  const styledText = texts.filter((c) => c.font && c.font.size && c.font.color).length;
  const surfaces = real.filter((c) => c.role === "card" || c.role === "instance");
  const styledSurface = surfaces.filter((c) =>
    c.fill || c.border || c.radius || (c.composite && c.composite.parts) || c.role === "instance").length;
  const styling = pct(styledText + styledSurface, texts.length + surfaces.length);
  // 4. assets — every image-like thing must be available as a FILE.
  //
  // Earlier this counted "asset" components against exported groups, which
  // conflated two different things: an asset component is a cluster of
  // decoration the reader may or may not want as one image, while an exported
  // group is a real file on disk. Screens with decoration but no exportable
  // group scored 0% forever and could never be marked ready.
  //
  // What matters for implementation: image FILLS (avatars, photos, basemaps)
  // need files, and background groups that were detected need files. If neither
  // exists, there is nothing to export and the axis is satisfied.
  const imageNodes = comps.filter((c) => c.role === "image");
  const exportedGroups = (bgassets && bgassets.groups ? bgassets.groups.length : 0);
  const detectedGroups = (bgassets && bgassets.groups ? bgassets.groups.length : exportedGroups);
  const assetsNeeded = imageNodes.length + detectedGroups;
  const assetsHave = imageNodes.length + exportedGroups;
  const assets = assetsNeeded === 0 ? 100 : pct(assetsHave, assetsNeeded);
  const imageLike = comps.filter((c) => c.role === "image" || c.role === "asset");

  // 5. interaction — states and behaviour.
  //
  // This axis used to return 100% whenever no interactive element was detected,
  // which is a lie in both directions: a screen full of buttons with no states
  // scored 0 (correct), but a screen where detection found no buttons scored a
  // perfect 100 (wrong) and told an agent the interaction model was complete.
  //
  // A static Figma frame contains NO interaction states, ever. The honest value
  // is null — "not available from this source" — and the consumer decides what
  // to do about it. Nothing in this pipeline can earn a 100 here; only a PRD, a
  // Controls are recognised by intent as well as by the word "button": a
  // component named "Claim" or a chip reading "Accept" needs states just as
  // much. Matching only button/toggle/input found 0 controls on a screen that
  // clearly had them, which silently removed the blocker.
  const ACTION = /button|btn|toggle|switch|input|field|link|tab|checkbox|radio|slider|dropdown|select/i;
  const VERB = /^(claim|accept|decline|submit|cancel|confirm|save|delete|edit|add|remove|send|apply|continue|next|back|close|open|view|download|upload|retry|refresh|sign|log)/i;
  const interactive = real.filter((c) => {
    const sem = c.semantic || {};
    const label = [c.name, sem.suggestName, sem.depicts, c.text].filter(Boolean).join(" ");
    if (ACTION.test(label)) return true;
    if (sem.uiRole === "button") return true;
    // a short text inside a small instance reads as a control label
    return VERB.test(String(sem.suggestName || c.text || "").trim());
  });
  const withState = interactive.filter((c) => c.states && c.states.length);
  const interaction = withState.length ? pct(withState.length, interactive.length) : null;

  const blockers = [];
  if (semantics < 100) {
    blockers.push({ code: "semantics.unnamed", severity: "high", axis: "semantics",
      params: { count: needsName.length - named.length } });
  }
  if (lowConfidence.length) {
    blockers.push({ code: "semantics.lowConfidence", severity: "low", axis: "semantics",
      params: { count: lowConfidence.length } });
  }
  if (assets < 100) {
    blockers.push({ code: "assets.notExported", severity: "high", axis: "assets",
      params: { count: assetsNeeded - assetsHave } });
  }
  // Interaction is reported, not scored: a static design cannot satisfy it, so
  // flag it as information the implementer must obtain elsewhere. Severity is
  // "high" only when there are controls that visibly need states.
  if (interaction === null && interactive.length) {
    blockers.push({ code: "interaction.noStates", severity: "high", axis: "interaction",
      params: { count: interactive.length } });
  } else if (interaction !== null && interaction < 100) {
    blockers.push({ code: "interaction.partialStates", severity: "high", axis: "interaction",
      params: { count: interactive.length - withState.length } });
  }
  if (raster && (raster.detected || []).length) {
    blockers.push({ code: "assets.rasterOnly", severity: "medium", axis: "assets",
      params: { count: raster.detected.length } });
  }
  if (detcmp) {
    const miss = detcmp.reduce((n, d) => n + d.missed.length, 0);
    if (miss) {
      blockers.push({ code: "coverage.uncovered", severity: "medium", axis: "coverage",
        params: { count: miss } });
    }
  }

  const verdict = blockers.some((b) => b.severity === "high") ? VERDICT.BLOCKED
    : blockers.length ? VERDICT.RISKY : VERDICT.READY;

  return {
    axes: { structure, semantics, styling, assets, interaction },
    counts: {
      components: real.length, assets: imageLike.length,
      interactive: interactive.length, lowConfidence: lowConfidence.length,
      // Take the UI-trained detector as the authority, not the worst number:
      // OpenCV's MSER found only 10 boxes on a dark theme, and reporting that
      // as "recognition rate 10%" defames an analysis OmniParser scored at 97%.
      recognitionRate: (() => {
        if (!detcmp || !detcmp.length) return null;
        const omni = detcmp.find((d) => d.name === "omni");
        const best = omni || detcmp.reduce((a, b) => (b.boxes > a.boxes ? b : a));
        return { detector: best.name, explainedPct: best.explainedPct,
          detectedBoxes: best.boxes, uncovered: best.missed.length };
      })(),
    },
    blockers,
    verdict,
  };
}
