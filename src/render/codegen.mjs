// Generate a screen implementation from the extracted design data.
//
// The model receives measurements, not a picture to interpret: every box,
// colour, radius and font comes from paint.json, which is read out of the
// Figma response. The model decides structure and idiom -- which elements
// group together, what a rounded teal bar with a dark circle actually is --
// and must not invent or adjust a number.
import fs from "node:fs";
import path from "node:path";
import { complete } from "../llm/client.mjs";
import { fitSize } from "./text-fit.mjs";
import { execFileSync } from "node:child_process";
import { PKG_ROOT, pythonBin } from "../ir/pipeline.mjs";
import { namesByDesigner } from "../judge/decision.mjs";
import { substituteFor } from "./fonts.mjs";
import { missingItems } from "./verify-emitted.mjs";
import { withTopUp, topUpPrompt } from "./top-up.mjs";

export const TARGETS = {
  web: { label: "a single HTML file", file: "index.html" },
  ios: { label: "a SwiftUI view", file: "Screen.swift" },
  android: { label: "a Compose function", file: "Screen.kt" },
};

const RULES = [
  "Reproduce the screen exactly as measured.",
  "Every x, y, width, height, colour and font size is given; copy them verbatim.",
  "Never invent a value that is not in the data, and never round one that is.",
  "Coordinates are absolute, in points, with the origin at the top left of the screen.",
  "Place the screen at the origin: no centring, no page margin, no flex or grid"
    + " wrapper around it. Any outer layout shifts every absolute position and"
    + " breaks the comparison against the design.",
  "The root is exactly the given screen size and clips its contents.",
  "Items are listed in paint order: later items draw on top of earlier ones.",
  "An item with an 'image' field is artwork exported as a file; reference it by the given name.",
  // Narrowed deliberately. The earlier wording -- "skip every item inside
  // that region" -- was read as permission to skip rectangles generally, and
  // one screen lost its background, both round tool buttons, the primary
  // green button and a pill: five filled, rounded, text-less boxes that no
  // artwork covered. They were the buttons themselves, with their labels
  // drawn and nothing underneath.
  "Emit every item in the list, all of them, without exception. The count is"
    + " given above: produce exactly that many. An item with a fill is a"
    + " surface the design is built from -- a button, a card, the screen's own"
    + " background -- not decoration, even when it holds no text of its own.",
  "Tag every element you emit with the item's id so the result can be checked"
    + " against the list: data-id on web, .accessibilityIdentifier on SwiftUI,"
    + " Modifier.testTag on Compose -- which needs"
    + " 'import androidx.compose.ui.platform.testTag', without which the file"
    + " does not compile and the whole screen is lost."
    + " An untagged element cannot be verified and reads as a missing one.",
  "A 'layout' field says how the designer arranged that item's children --"
    + " direction, gap, padding and alignment. It is intent, not instruction:"
    + " the coordinates remain the source of truth and must be reproduced"
    + " exactly. Use it to group and name things sensibly, and so a reader can"
    + " tell a deliberate row of equal gaps from three boxes that happen to"
    + " line up. Do not replace the given positions with a computed layout;"
    + " that shifts every element and loses the comparison.",
  "An item with clips true cuts off whatever overflows it: overflow hidden"
    + " on web, .clipped() on SwiftUI, Modifier.clip on Compose. Without it a"
    + " photo or a long label spills past the card meant to contain it.",
  "An 'effects' list carries the shadows and blurs on an item, and a card"
    + " without its shadow reads as flat against the background."
    + " kind 'shadow' is a box-shadow / .shadow / elevation with the given"
    + " colour, alpha, dx, dy and blur; 'inner-shadow' is the same drawn"
    + " inside; 'blur' blurs the item; 'backdrop-blur' blurs what is behind"
    + " it -- backdrop-filter on web, .ultraThinMaterial on SwiftUI --"
    + " and drawing that one as a layer blur smears the content instead.",
  "The one exception: where an item's box lies inside a region covered by"
    + " exported artwork, place the artwork file once and omit the items"
    + " within that box, because drawing them as coloured rectangles paints"
    + " over the picture. This applies only inside an artwork's own"
    + " rectangle. Never approximate a vector with a rectangle.",
  "Group items into sensible components where the structure is obvious, but keep the geometry identical.",
  "Where a font carries renderAs, ask for that family instead of font.family:"
    + " the design's own name does not resolve on this machine and falls"
    + " through to a serif, which is both the wrong shape and the wrong width.",
  "A text's align field is LEFT, CENTER or RIGHT and must be applied to the"
    + " box, not just to the glyphs. A framed text defaults to centred on"
    + " every platform, so a left-aligned label drifts to the middle of its"
    + " box. On SwiftUI the two take different vocabularies and mixing them"
    + " does not compile: .frame takes alignment: .leading/.center/.trailing"
    + " while .multilineTextAlignment takes .leading/.center/.trailing too --"
    + " never .left or .right, which are not members of TextAlignment."
    + " On Compose set textAlign and give the Box contentAlignment;"
    + " on web set text-align and justify-content.",
  "Where fitFontSize is present render that size instead of font.size: the"
    + " box was measured with the design's font, the fallback face here is"
    + " wider, and this is the size at which the string fits. It is computed"
    + " from the real character advances, so the label needs no shrinking,"
    + " wrapping or clipping of its own.",
  "Never clip or ellipsise a label. '110 BPM' rendered as '110' is missing"
    + " content, and it is what every platform does by default once a text is"
    + " given a width it cannot honour.",
  "radiusFrom marks a corner radius inferred from the shape rather than"
    + " declared: a thin vector is a capsule, an ellipse is fully round."
    + " Apply it the same way.",
  "A stroke is part of the shape, not a detail to drop: the slider handle is a"
    + " dark circle with a 2px teal border, and without the border it reads as"
    + " a grey dot. Draw every stroke at its given colour and width.",
  "Output only the code. No explanation, no markdown fence, no commentary.",
];

// Each target is rendered by a harness that expects a specific entry point,
// so the shape of the output is part of the contract, not a preference.
const SHAPE = {
  web: "A complete HTML document. Reference artwork by bare file name; it sits"
    + " beside the page.",
  ios: "A SwiftUI view named exactly GeneratedScreen, plus the imports it needs."
    + " No @main, no App, no preview provider: the view alone is rendered."
    + " Load artwork with NSImage(contentsOfFile:) using the absolutePath given"
    + " with each artwork entry, not a bare name or a Bundle lookup: the view is"
    + " compiled as a script, so there is no bundle and no working directory"
    + " guarantee."
    + " Give every Text .frame(width:height:) from its measured box, with"
    + " .lineLimit(1) and .minimumScaleFactor(0.8) so it shrinks instead of"
    + " truncating, and place it with .position(x:y:) at the centre of that"
    + " box. Without the scale factor SwiftUI clips: Compression Rate came"
    + " out as 'Compression R...'."
    + " Do not use .fixedSize(): it detaches the text from its position."
    + " Build every colour as Color(.sRGB, red:green:blue:opacity:): the"
    + " measurements are sRGB hex, and the plain Color(red:green:blue:)"
    + " initialiser interprets them in the device space, which shifted the"
    + " teal button from rgb(21,235,218) to rgb(40,234,209).",
  android: "A single @Composable function named exactly GeneratedScreen, plus"
    + " the imports it needs. No Activity and no preview annotation."
    + " Artwork is a drawable resource whose id is given with each file;"
    + " reference it as R.drawable.<id> and import render.R.",
};

function systemPrompt(target) {
  return [
    "You convert a measured design into " + TARGETS[target].label + ".",
    "",
    "Output shape: " + SHAPE[target],
    "",
    "Rules:",
    ...RULES.map((r) => "- " + r),
  ].join("\n");
}

// The paint list is the payload. Items are trimmed of nulls so the model is
// not asked to reason about absent fields, and kept in paint order.
export function buildPayload(latest) {
  const paint = JSON.parse(fs.readFileSync(path.join(latest, "raw", "paint.json"), "utf8"));
  const assetsDir = path.join(latest, "assets");
  const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

  // A node's position in the paint list is its stacking order. Artwork is
  // looked up by the id it was exported from, so both sequences share one
  // numbering and a renderer can interleave them correctly.
  const paintOrder = new Map(paint.items.map((i) => [i.id, i.order]));
  const paintOrderOf = (id) => (paintOrder.has(id) ? paintOrder.get(id) : -1);

  // Exported artwork covers a region the paint list can only describe as a
  // bounding box, because a vector's outline is not in the data. Saying which
  // file covers which area is the difference between placing the image and
  // bounding box, because a vector's outline is not in the data. Saying which
  // file covers which area is the difference between placing the image and
  // approximating an icon with a coloured rectangle.
  let artwork = [];
  try {
    const assetFile = fs.existsSync(path.join(latest, "raw", "assets.json"))
      ? path.join(latest, "raw", "assets.json")
      : path.join(latest, "raw", "bg-assets.json");
    const bg = JSON.parse(fs.readFileSync(assetFile, "utf8"));
    artwork = (bg.groups || [])
      .filter((g) => g && g.box && g.file)
      .map((g) => {
        // The rendered artwork can be shorter than the frame it came from, so
        // the drawing size is the file's own, centred in the declared box.
        const size = g.rendered || { w: g.box.w, h: g.box.h };
        const x = Math.round((g.box.x + (g.box.w - size.w) / 2) * 100) / 100;
        const y = Math.round((g.box.y + (g.box.h - size.h) / 2) * 100) / 100;
        return {
          file: path.basename(g.file),
          // Paint order in the same numbering as the items, so a decorative
          // shape goes behind the cards drawn over it. Exported artwork and
          // paint items were numbered independently -- 0..58 against 0..177 --
          // so the two sequences could not be compared and a 200pt blob the
          // design tucks under a card was drawn on top of it instead.
          order: paintOrderOf(g.id),
          // Android reaches artwork through a generated R id rather than a
          // path, and the id is the sanitised file name.
          drawableId: path.basename(g.file).replace(/\.[^.]+$/, "")
            .toLowerCase().replace(/[^a-z0-9]/g, "_"),
          absolutePath: path.join(latest, "assets", path.basename(g.file)),
          draw: { x, y, w: size.w, h: size.h },
          covers: g.name || null,
          // The ids this image actually contains. Dropping it here left the
          // coverage test with nothing to consult, so it fell back to
          // geometry on every item and removed the chat bubble and its pill
          // from one screen: both sit over a photo without being part of it.
          contains: g.contains || [],
        };
      });
  } catch { /* no exported artwork */ }

  // Items sitting inside exported artwork are dropped rather than described.
  // Their boxes have a fill but no outline, so anything drawn from them is a
  // coloured rectangle painted over the artwork -- the model was placing the
  // heart image correctly and then hiding it under three red blocks.
  //
  // A full-screen piece is the exception: it is the backdrop, and everything
  // on the screen sits inside it by definition. Letting it absorb the content
  // left one screen with 71 of its 178 items described, and the model drew a
  // third of the design.
  const screenArea = paint.screen.size.w * paint.screen.size.h;
  const swallows = (a) => (a.draw.w * a.draw.h) >= screenArea * 0.8;
  // What each exported image actually contains, by node id. Geometry alone
  // said a notification card's glass layer contained the app icon beside it,
  // because they occupy the same rectangle -- so the icon was treated as
  // already drawn and lost its white backplate. They are siblings.
  const inArtwork = new Set();
  for (const a of artwork) {
    if (swallows(a)) continue;
    for (const id of a.contains || []) inArtwork.add(id);
  }
  const covered = (box, id) => {
    if (id && inArtwork.has(id)) return true;
    // Older analyses carry no id list; fall back to geometry for those.
    return artwork.some((a) => !(a.contains && a.contains.length) && !swallows(a)
      && box.x >= a.draw.x - 6 && box.y >= a.draw.y - 6
      && box.x + box.w <= a.draw.x + a.draw.w + 6
      && box.y + box.h <= a.draw.y + a.draw.h + 6);
  };

  // A box measured with the design font is often too narrow for a fallback
  // face, and every renderer answers by dropping characters: '110 BPM' came
  // back as '110' however the prompt was worded. Width scales linearly with
  // size, so the size that fits is arithmetic rather than a judgement, and
  // keeping the box preserves the layout the designer drew.
  const fitted = (it) => {
    if (!it.text) return null;
    const size = (it.font && it.font.size) || 14;
    return fitSize(it.text, size, it.box.w);
  };

  // A translucent fill covering the whole screen is already part of the
  // canvas colour, which is sampled from the composited design. Sending it
  // as well makes the model paint the same layer twice, which lifted this
  // screen 20 levels and left 91% of its pixels outside tolerance -- against
  // 16% once the offset is removed.
  const full = (box) => box.x <= 1 && box.y <= 1
    && box.w >= paint.screen.size.w - 2 && box.h >= paint.screen.size.h - 2;
  const doubled = (it) => full(it.box) && !it.text
    && it.fillOpacity != null && it.fillOpacity < 1;

  // Figma's default names carry no meaning: 651 layers in this file are
  // called "Vector" and 75 "Ellipse 3129". Passing them tells the model
  // nothing and competes with the names a designer actually chose, so they
  // are dropped. Judged once per distinct name, not per item.
  // Judged in batches, once per distinct name: one call each took 106
  // seconds on a screen with 89 of them.
  //
  // DLC_NAME_FILTER=off keeps every name, so the two runs can be compared on
  // the same screen. Whether dropping them helps is a question for the
  // benchmark, not an assumption.
  const filterNames = process.env.DLC_NAME_FILTER !== "off";
  const meaningful = filterNames
    ? namesByDesigner(paint.items.filter((i) => !i.text).map((i) => i.name))
    : new Map();
  const nameOf = (raw, item) => {
    const name = (raw || "").trim();
    if (!name) return undefined;
    // A text layer is named after its own content in Figma, so the name is
    // never a generated placeholder: judging them dropped a timer reading
    // "00:59:59" as if it were a default shape name.
    if (item && item.text) return name;
    // A name the batch did not cover is kept: the cost of dropping a real
    // one is lost meaning, the cost of keeping a generated one is noise.
    return meaningful.get(name) === false ? undefined : name;
  };

  // Content below the fold belongs to a scroll area the design shows only the
  // top of. Describing it made the model lay out a 1371pt wrapper on an 844pt
  // screen and paint stray blocks over the visible cards: 61 of this screen's
  // items sit past the bottom edge.
  const onScreen = (b) => b.y < paint.screen.size.h
    && b.x < paint.screen.size.w
    && b.y + b.h > 0 && b.x + b.w > 0;

  // A child of a boolean operation is an operand, not a shape to draw. The
  // export rule already skips them; describing them to the model did not, so
  // a 200pt teal square that was being subtracted got painted over a card.
  const BOOLEAN_PARENT = /^(union|subtract|intersect|exclude)\b/i;
  const isOperand = (it) => BOOLEAN_PARENT.test(it.parent || "");

  const items = paint.items.filter((it) =>
    onScreen(it.box) && !isOperand(it) && !doubled(it)
    && !(covered(it.box, it.id) && !it.text)).map((it) => {
    // An element that starts on screen but runs far past it is the scroll
    // area's full extent. Rendered at full height it becomes a 1371pt slab on
    // an 844pt screen, so it is clipped to what the design actually shows.
    const H = paint.screen.size.h;
    const box = it.box.y + it.box.h > H
      ? { ...it.box, h: Math.round((H - it.box.y) * 100) / 100 }
      : it.box;
    const out = { id: it.id, order: it.order, name: nameOf(it.name, it),
      type: it.type, box };
    const fit = fitted(it);
    if (fit) {
      // The size that makes the string fit its measured box in a fallback
      // font, already computed so no renderer has to guess or clip.
      out.fitFontSize = fit;
    }
    for (const k of ["fill", "fillOpacity", "gradient", "stroke", "radius",
      "opacity", "text", "font", "image", "effects", "clips", "layout"]) {
      if (it[k] !== undefined && it[k] !== null) out[k] = it[k];
    }
    // The family to actually ask for. Apple ships SF Pro as the system font
    // but not under that name, so requesting "SF Pro Text" lands on serif --
    // the wrong shape and the wrong width. 180 text items across this corpus
    // name an SF Pro variant.
    if (out.font && out.font.family) {
      const sub = substituteFor(out.font.family);
      if (sub) out.font = { ...out.font, renderAs: sub };
    }
    return out;
  });

  // The colour the screen is composited on. A translucent card has no visible
  // appearance without it: this card fills with white at 10% opacity, which
  // reads as dark grey over the app's black background and as nothing over a
  // white page. The design render is where that colour actually exists.
  let canvas = null;
  try {
    const design = path.join(latest, "review", "design.png");
    if (fs.existsSync(design)) {
      const script = path.join(PKG_ROOT, "python", "canvas-bg.py");
      const out = execFileSync(pythonBin(), [script, design], { stdio: "pipe", timeout: 60000 });
      const parsed = JSON.parse(out.toString());
      if (parsed.uniform) canvas = parsed.hex;
    }
  } catch { /* fall back to leaving it unstated */ }

  return { screen: paint.screen, canvas, assets, artwork, items };
}

/**
 * Repair the mistakes a model makes often enough to be worth fixing outright.
 *
 * A prompt lowers the odds; it does not remove them, and the cost here is a
 * file that will not compile at all rather than a slightly wrong pixel. Only
 * substitutions that are always correct belong here.
 */
function repair(code, target) {
  if (target === "ios") {
    // SwiftUI's TextAlignment has leading/center/trailing and no left or
    // right. A single .left cost a whole screen its render.
    return code
      .replace(/\.multilineTextAlignment\(\s*\.left\s*\)/g, ".multilineTextAlignment(.leading)")
      .replace(/\.multilineTextAlignment\(\s*\.right\s*\)/g, ".multilineTextAlignment(.trailing)");
  }

  if (target === "android") {
    // testTag is in the platform package, which the model omits often enough
    // that asking for the tag cost one screen its entire render: the file did
    // not compile, the renderer kept the previous PNG, and the score sat
    // unchanged at 51 across three runs with nothing reporting a failure.
    // The project depends on material3; importing plain material leaves Text
    // unresolved and loses the whole file.
    code = code.replace(/import androidx\.compose\.material\.([A-Za-z]+)/g,
      "import androidx.compose.material3.$1");

    if (/\.testTag\(/.test(code)
      && !/import androidx\.compose\.ui\.platform\.testTag/.test(code)) {
      const after = /^(import [^\n]+\n)(?![\s\S]*^import )/m;
      if (after.test(code)) {
        return code.replace(after, "$1import androidx.compose.ui.platform.testTag\n");
      }
      return "import androidx.compose.ui.platform.testTag\n" + code;
    }
  }

  return code;
}

function stripFence(text) {
  const t = String(text || "").trim();
  // Models wrap code in a fence even when told not to. Anchoring the closing
  // fence to the end of the reply missed the case where a sentence follows
  // it, and the leading ```swift went into the file as source.
  const fenced = t.match(/```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (fenced) return fenced[1].trim();
  // A fence that was opened and never closed still has to go.
  return t.replace(/^```[a-zA-Z]*\n/, "").replace(/\n```\s*$/, "").trim();
}

export async function generate({ latest, target, provider, model, signal, onLog }) {
  if (!TARGETS[target]) throw new Error("unknown target: " + target);
  const payload = buildPayload(latest);

  const prompt = [
    "Screen: " + payload.screen.name
      + " (" + payload.screen.size.w + "x" + payload.screen.size.h + ")",
    payload.canvas
      ? "Canvas background: " + payload.canvas
        + " -- sampled from the composited design, so it already includes any"
        + " translucent layer covering the whole screen. Paint it behind"
        + " everything and add no further backdrop of your own."
      : "",
    payload.artwork.length
      ? "Exported artwork, each covering the region given (use the file, do not"
        + " redraw it). Both artwork and items carry an order: paint them"
        + " together in that order, so a decorative shape the design tucks"
        + " under a card stays behind it:\n"
        + JSON.stringify(payload.artwork, null, 1)
      : (payload.assets.length
        ? "Exported artwork available: " + payload.assets.join(", ")
        : "No exported artwork."),
    "",
    payload.items.length + " painted items, in paint order."
      + " Your output must contain all " + payload.items.length + " of them,"
      + " each tagged with its id:",
    JSON.stringify(payload.items, null, 1),
  ].join("\n");

  const res = await complete({
    provider, model,
    system: systemPrompt(target),
    prompt,
    // A dense screen is long: 105 items produced 911 lines of SwiftUI and hit
    // a 16k cap mid-expression, so the file would not compile at all. The
    // model allows far more, and an unfinished file is the worst outcome.
    maxTokens: 48000,
    signal,
  });

  // Cut off at the token limit -- a reasoning model spends part of the budget
  // thinking -- leaves a file that ends mid-expression. Say so; the top-up
  // rounds below then ask again for what is missing.
  const cut = (r, what) => {
    if (r && r.stopReason === "length" && onLog) {
      onLog(what + " was cut off at the model's output limit; the code may be incomplete");
    }
  };
  cut(res, "the model's answer");
  const first = repair(stripFence(res.text), target);

  // Ask again for whatever was left out. The model omits items -- one screen
  // lost five filled boxes, and each target lost a different set -- and a
  // second pass over only the gap keeps the parts that were already right.
  const { code, report, trail } = await withTopUp({
    first,
    items: payload.items,
    verify: (c, items) => missingItems(c, items),
    rounds: Number(process.env.DLC_TOPUP_ROUNDS || 3),
    onLog,
    again: async (current, missing) => {
      const r = await complete({
        provider, model,
        system: systemPrompt(target),
        prompt: topUpPrompt(current, missing, target),
        maxTokens: 48000,
        signal,
      });
      cut(r, "a top-up answer");
      return repair(stripFence(r.text), target);
    },
  });

  return {
    code,
    file: TARGETS[target].file,
    usage: res.usage,
    items: payload.items.length,
    // What the model left out. The same payload sent three times omits three
    // different sets, so the result is checked rather than trusted.
    omitted: report,
    // What each round of asking again recovered, so a run that still comes
    // up short says how far it got rather than only that it did.
    topUp: trail,
  };
}

