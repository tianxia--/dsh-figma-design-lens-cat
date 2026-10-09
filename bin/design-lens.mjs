#!/usr/bin/env node
// dsh-figma-design-lens-cat CLI.
//
// Project membership is decided by the Figma file key, never by a label. Under
// MCP the caller is a model that names the same file three different ways;
// letting names create projects splits one design across three directories.
//
// Stores are constructed lazily: printing help or running doctor must not
// require write access to the home directory, which fails in sandboxes and
// read-only images.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Store, screenIdOf } from "../src/store/store.js";
import { Registry } from "../src/store/identity.js";
import { Settings } from "../src/store/settings.js";
import { parseFigmaUrl, fetchFileTitle } from "../src/figma/client.js";
import { analyseScreen, packBundle, detectorsAvailable, pythonBin, PKG_ROOT } from "../src/ir/pipeline.mjs";
import { lensHome } from "../src/store/home.mjs";
import { llmState, PROVIDERS, defaultModel, sdkInstalled, isAuthorised, chooseProvider } from "../src/llm/client.mjs";

const LENS_HOME = lensHome();
const WORK = path.join(LENS_HOME, "work");

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true) : d;
};

let _store, _registry, _settings;
const getStore = () => (_store ||= new Store(LENS_HOME));
const getRegistry = () => (_registry ||= new Registry(LENS_HOME));
const getSettings = () => (_settings ||= new Settings(LENS_HOME));

function printFigmaTokenSetup(prefix = "") {
  const cli = "dsh-figma-design-lens-cat";
  const lines = [
    "Figma token setup:",
    "  1. Open Figma in the browser and go to Account settings → Personal access tokens.",
    "  2. Create a token and copy it once. Do not paste it into chat or commit it.",
    "  3. Save it locally:",
    "       " + cli + " token <your-figma-token>",
    "     or:",
    "       " + cli + " config --token <your-figma-token>",
    "  4. Verify with:",
    "       " + cli + " doctor",
  ];
  for (const line of lines) console.log(prefix + line);
}

// Why a model matters, said once and shown wherever the user decides about
// it. Renders without one silently fell back to a template that scores far
// lower, and nothing at install time said a model was involved at all.
const LLM_WHY = [
  "Rendering a screen to code uses a large language model.",
  "  With one, each screen is rebuilt from code the model writes (web, iOS, Android).",
  "  Without one, renders fall back to a template that only places boxes and text,",
  "  and score far lower. Analysis itself (add, inspect, the MCP tools) works either way.",
];

function printLlmSetup(prefix = "") {
  const cli = "dsh-figma-design-lens-cat";
  const lines = [
    "Connect a model:",
    "  " + cli + " setup                      guided: installs the package and signs you in",
    "  " + cli + " llm login <provider>       providers: " + PROVIDERS.map((p) => p.id).join(", "),
  ];
  for (const line of lines) console.log(prefix + line);
}

async function ask(rl, question, def = true) {
  const a = (await rl.question(question + (def ? " [Y/n] " : " [y/N] "))).trim().toLowerCase();
  if (!a) return def;
  return a === "y" || a === "yes";
}

// Prompts go through an output stream that can be muted. Overriding
// readline's _writeToOutput used to hide typing, but Node 22's readline
// writes through an internal symbol and the key was echoed in full.
async function makeRl() {
  const readline = await import("node:readline/promises");
  const { Writable } = await import("node:stream");
  const out = new Writable({
    write(chunk, enc, cb) { if (!out.muted) process.stdout.write(chunk); cb(); },
  });
  out.muted = false;
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: Boolean(process.stdin.isTTY) });
  rl.lensOut = out;
  return rl;
}

// Read a secret without echoing it: the prompt is written, the keystrokes
// are not. A key typed this way never lands in shell history either, which
// a --api-key argument would.
async function askHidden(rl, question) {
  process.stdout.write(question);
  if (rl.lensOut) rl.lensOut.muted = true;
  try { return (await rl.question("")).trim(); }
  finally {
    if (rl.lensOut) rl.lensOut.muted = false;
    process.stdout.write("\n");
  }
}

/** Connect a built-in service with its API key; its whole catalog becomes choosable. */
async function addServiceKey(rl, provider) {
  const client = await import("../src/llm/client.mjs");
  const svc = (await client.keyServices()).find((s) => s.id === provider);
  if (!svc) {
    throw new Error(provider + " is not a service that takes an API key; see: dsh-figma-design-lens-cat llm services");
  }
  const key = await askHidden(rl, "API key for " + svc.name + " (input hidden): ");
  const r = await client.saveProviderKey(provider, key);
  console.log("saved. " + r.models + " models from " + r.name + " can be chosen now.");
  console.log("renders will use: " + r.provider + " / " + r.model);
  console.log("see or switch models: dsh-figma-design-lens-cat llm models");
}

// The package ships as an optional dependency, so an install that skipped or
// failed it leaves no trace until a render quietly uses the template.
async function installSdk() {
  const { spawnSync } = await import("node:child_process");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  console.log("  running: npm install --include=optional  (in " + PKG_ROOT + ")");
  spawnSync(npm, ["install", "--include=optional"], { cwd: PKG_ROOT, stdio: "inherit" });
  if (sdkInstalled()) { console.log("  ok   LLM package installed"); return true; }
  console.log("  FAIL the LLM package did not install. Run it by hand:");
  console.log("       cd " + PKG_ROOT + " && npm install --include=optional");
  return false;
}

/** Sign in to one provider and make it the one renders use. */
async function signIn(provider, rl) {
  const client = await import("../src/llm/client.mjs");
  await client.login(provider, {
    prompt: async (p) => {
      const opt = p.signal ? { signal: p.signal } : undefined;
      // Codex asks how to log in before anything else. Printing only the
      // message left the user to guess an option id; show the choices and
      // take a number, defaulting to the first (browser login).
      if (p.type === "select" && Array.isArray(p.options) && p.options.length) {
        console.log(p.message);
        p.options.forEach((o, i) => console.log("  " + (i + 1) + ". " + o.label));
        const a = (await rl.question("Choose 1-" + p.options.length + " [1]: ", opt)).trim();
        return (p.options[Number(a || 1) - 1] || p.options[0]).id;
      }
      // The paste-a-code prompt is a fallback that races the browser
      // redirect; its signal fires when the redirect wins, which clears it.
      return (await rl.question(p.message + " ", opt)).trim();
    },
    notify: (e) => {
      if (e.type === "auth_url") {
        // Printed prominently and opened: the URL is easy to miss
        // between the runtime's own warnings.
        console.log("\n" + "-".repeat(60));
        console.log("authorise in the browser:");
        console.log(e.url);
        console.log("-".repeat(60) + "\n");
        if (process.platform === "darwin") {
          import("node:child_process")
            .then((cp) => cp.execFile("open", [e.url], () => {}))
            .catch(() => {});
        }
      } else if (e.type === "device_code") {
        console.log("code " + e.userCode + " at " + e.verificationUri);
      } else if (e.message) {
        console.log(e.message);
      }
    },
  });
  useProvider(provider);
  console.log("authorised: " + provider);
  console.log("credential stored in " + client.authFile());
}

function useProvider(provider) {
  const r = chooseProvider(provider);
  console.log("renders will use: " + r.provider + " / " + r.model);
}


const main = async () => {
  if (cmd === "add" || cmd === "analyze") {
    const url = args[1];
    if (!url) throw new Error('usage: dsh-figma-design-lens-cat add "<figma url>" [--project <label>] [--detectors]');
    const { fileKey, node } = parseFigmaUrl(url);
    if (!fileKey || !node) {
      throw new Error("the link must contain a file key and node-id — select a frame in Figma, then copy the link");
    }
    const settings = getSettings();
    if (!settings.token()) {
      throw new Error("no Figma token configured. Run `dsh-figma-design-lens-cat setup` for the first-time guide, or save one with `dsh-figma-design-lens-cat token <your-figma-token>`. Create the token in Figma Account settings → Personal access tokens. Do not paste the token into chat.");
    }

    const store = getStore();
    const registry = getRegistry();
    const title = await fetchFileTitle(fileKey, settings.token());
    const label = flag("project");
    const proj = registry.resolve(fileKey, { title, alias: label });
    console.log("project: " + proj.name + "  (" + proj.id + ")  fileKey=" + fileKey);
    if (label && label !== proj.name) console.log('  label "' + label + '" recorded as alias');
    console.log("node:    " + node);

    store.ensureProject(proj.id, { fileKey, name: proj.name, aliases: proj.aliases });
    const wantDetectors = flag("detectors") ? true : settings.read().runDetectors;
    const r = analyseScreen({ url, node, fileKey, workDir: WORK,
      withDetectors: wantDetectors && detectorsAvailable(), lensHome: LENS_HOME }, console.log);
    // Stage 1 failing means there is no IR, so every later stage fails too and
    // the "bundle" that gets stored is an empty shell. Storing it anyway left a
    // screen in the project that looks analysed and contains nothing — worse
    // than a clean failure, because it hides the real problem behind six
    // cascading errors.
    const fatal = r.errors.find((e) => e.startsWith("[1/7]"));
    if (fatal) {
      const detail = fatal.replace("[1/7] fetch Figma node and build IR: ", "");
      // Only suggest checking the link when the node could not be read at
      // all; an empty frame was found correctly and needs no such advice.
      // The link is only worth questioning when the node could not be read.
      // An empty frame was found correctly, and so was a canvas: both need
      // different advice, and offering the wrong one sends people to check
      // something that is not broken.
      const hint = /no content to analyse|holds \d+ page/.test(detail) ? ""
        : "\n  The link must point at a frame that exists in this file."
          + "\n  Select the frame in Figma, then copy the link.";
      throw new Error(detail + hint);
    }


    if (r.errors.length) {
      console.log();
      console.log("  " + r.errors.length + " stage(s) reported errors:");
      for (const e of r.errors) console.log("    " + e);
    }

    const { stamp, dir } = store.newVersion(proj.id, node);
    packBundle(node, url, WORK, dir);
    store.promote(proj.id, node, stamp);
    store.reindex();

    const m = store.readManifest(proj.id, node);
    console.log();
    console.log("stored: " + store.latestDir(proj.id, node));
    if (m) {
      console.log("readiness: " + Object.entries(m.readiness.axes).map(([k, v]) => k + " " + (v === null || v === undefined ? "n/a" : v + "%")).join(" · "));

      console.log("verdict:   " + m.readiness.verdict);
      console.log("review:    http://127.0.0.1:" + (settings.read().port || 7420)
        + "/s/" + proj.id + "/" + screenIdOf(node));
    }
    const st = llmState();
    if (!st.ready) {
      console.log();
      console.log("note: " + st.message + "; renders of this screen will use the template.");
      console.log("      Connect one with: dsh-figma-design-lens-cat setup");
    }
    return;
  }

  if (cmd === "token") {
    const token = args[1];
    if (!token) {
      printFigmaTokenSetup();
      return;
    }
    getSettings().write({ figmaToken: String(token) });
    console.log("Figma token saved to " + LENS_HOME + "/settings.json");
    console.log("Run `dsh-figma-design-lens-cat doctor` to verify setup.");
    return;
  }

  if (cmd === "setup") {
    const interactive = process.stdin.isTTY && process.stdout.isTTY && !args.includes("--no-input");
    const settings = getSettings();
    console.log("dsh-figma-design-lens-cat first-time setup");
    console.log();

    console.log("[1/2] Figma token (required)");
    if (settings.token()) {
      console.log("  ok   figma token     configured");
    } else {
      console.log("  FAIL figma token     missing");
      console.log();
      printFigmaTokenSetup("  ");
    }
    console.log();

    console.log("[2/2] Model for code generation (optional, strongly recommended)");
    for (const line of LLM_WHY) console.log("  " + line);
    console.log();
    let st = llmState();
    if (st.ready) {
      console.log("  ok   model           " + st.message);
    } else if (!interactive) {
      console.log("  warn model          " + st.message);
      printLlmSetup("  ");
    } else {
      const rl = await makeRl();
      try {
        if (await ask(rl, "  Set up a model now?", true)) {
          if (!sdkInstalled()) {
            console.log("  This needs the optional package @earendil-works/pi-ai (about 90 packages from npm).");
            if (await ask(rl, "  Install it now?", true)) await installSdk();
          }
          if (sdkInstalled()) {
            console.log();
            console.log("  Which model service do you want renders to use?");
            PROVIDERS.forEach((p, i) => console.log("    " + (i + 1) + ". " + p.label
              + "  [" + p.id + "]" + (isAuthorised(p.id) ? "  (signed in)" : "")));
            const other = PROVIDERS.length + 1;
            console.log("    " + other + ". Another service with an API key (DeepSeek, Kimi, Qwen, Z.AI, OpenAI, Gemini, OpenRouter, ...)");
            const pick = Number((await rl.question("  Choose 1-" + other + " [1]: ")).trim() || 1);
            if (pick === other) {
              const client = await import("../src/llm/client.mjs");
              const services = await client.keyServices();
              const top = services.slice(0, 15);
              top.forEach((s, i) => console.log("    " + String(i + 1).padStart(2) + ". " + s.name
                + "  [" + s.id + "]  " + s.models + " models" + (s.added ? "  (added)" : "")));
              console.log("    or type the id of any of " + services.length + " services (dsh-figma-design-lens-cat llm services)");
              const a = (await rl.question("  Choose 1-" + top.length + " or an id [1]: ")).trim() || "1";
              const chosen = /^\d+$/.test(a) ? (top[Number(a) - 1] || top[0]).id : a;
              try { await addServiceKey(rl, chosen); }
              catch (e) { console.log("  FAIL " + String(e.message).slice(0, 200)); }
            } else {
              const provider = (PROVIDERS[pick - 1] || PROVIDERS[0]).id;
              if (isAuthorised(provider)) {
                useProvider(provider);
              } else {
                try {
                  await signIn(provider, rl);
                } catch (e) {
                  console.log("  FAIL sign-in did not complete: " + String(e.message).slice(0, 160));
                  console.log("       Try again with: dsh-figma-design-lens-cat llm login " + provider);
                }
              }
            }
          }
        } else {
          console.log("  Skipped. Renders will use the template until a model is connected.");
        }
      } finally {
        rl.close();
      }
    }
    st = llmState();

    console.log();
    console.log("Summary");
    console.log("  " + (settings.token() ? "ok  " : "FAIL") + " figma token     "
      + (settings.token() ? "configured" : "missing"));
    console.log("  " + (st.ready ? "ok  " : "warn") + " model           "
      + (st.ready ? st.message : st.message + " (renders use the template)"));
    console.log();
    console.log("Next steps:");
    console.log("  dsh-figma-design-lens-cat inspect '<figma link>'");
    console.log("  dsh-figma-design-lens-cat add '<figma link>'");
    console.log("  dsh-figma-design-lens-cat serve");
    process.exit(settings.token() ? 0 : 1);
  }

  if (cmd === "config") {
    const settings = getSettings();
    const token = flag("token");
    if (token && token !== true) {
      settings.write({ figmaToken: String(token) });
      console.log("token saved to " + LENS_HOME + "/settings.json");
    }
    const det = flag("detectors");
    if (det !== null) settings.write({ runDetectors: det !== "false" });
    const lp = flag("llm-provider");
    if (lp && lp !== true) {
      // Built-in subscriptions and custom providers alike; chooseProvider
      // keeps a model already chosen for that provider.
      try { chooseProvider(lp); } catch (e) {
        const known = [...PROVIDERS.map((p) => p.id), ...Object.keys((settings.read().llmProviders) || {})];
        throw new Error(e.message + " (known: " + known.join(", ") + ")");
      }
    }
    const lm = flag("llm-model");
    if (lm && lm !== true) settings.write({ llmModel: String(lm) });
    const s = settings.redacted();
    const st = llmState();
    console.log("token:     " + (s.figmaTokenSet ? s.figmaToken : "(not set)"));
    console.log("detectors: " + s.runDetectors);
    console.log("model:     " + (st.ready ? st.message : "(none: " + st.message + ")"));
    console.log("store:     " + LENS_HOME);
    return;
  }

  // Wire this tool into the agents that will call it. Editing each client's
  // config by hand means editing JSON by hand, and a trailing comma there
  // takes down the editor's whole configuration.
  if (cmd === "install") {
    const { install, detect, CLIENTS } = await import("../src/mcp/install.mjs");
    const which = args[1];

    if (!which) {
      console.log("Clients found on this machine:");
      for (const c of detect()) {
        console.log("  " + (c.present ? "found  " : "absent ") + c.key.padEnd(16) + c.label);
      }
      console.log();
      console.log("Install into one:  dsh-figma-design-lens-cat install <client>");
      console.log("Or into all found: dsh-figma-design-lens-cat install all");
      return;
    }

    const targets = which === "all"
      ? detect().filter((c) => c.present).map((c) => c.key)
      : [which];
    if (!targets.length) {
      console.log("No supported client found. Install one, or add this by hand:");
      console.log('  { "command": "dsh-figma-design-lens-cat-mcp" }');
      return;
    }
    for (const t of targets) {
      const r = install(t);
      console.log((r.ok ? r.action : "skipped") + "  " + r.label
        + (r.ok ? "" : " -- " + r.why));
      console.log("    " + r.file);
      // Desktop apps get absolute paths; say which, so a stale one is easy to spot.
      if (r.ok && r.gui && r.entry) console.log("    runs: " + r.entry.command + " " + (r.entry.args || []).join(" "));
      if (r.warning) console.log("    warning: " + r.warning);
    }
    console.log();
    console.log("Restart the client for it to pick this up (Cmd+Q for desktop apps; closing the window is not enough).");
    if (targets.some((t) => CLIENTS[t] && CLIENTS[t].gui)) {
      console.log("Desktop apps are given absolute paths. After changing Node versions or reinstalling");
      console.log("the package elsewhere, run this again; doctor reports a path that has gone stale.");
    }
    return;
  }

  // Which stored analyses predate the current pipeline. A screen analysed
  // before the paint list existed renders from nothing and scores as though
  // the tool were broken.
  if (cmd === "stale") {
    const { staleness } = await import("../src/ir/staleness.mjs");
    const { lensHome } = await import("../src/store/home.mjs");
    const root = path.join(lensHome(), "projects");
    if (!fs.existsSync(root)) { console.log("no projects yet"); return; }
    let total = 0;
    const rows = [];
    for (const proj of fs.readdirSync(root)) {
      const sdir = path.join(root, proj, "screens");
      if (!fs.existsSync(sdir)) continue;
      for (const sid of fs.readdirSync(sdir)) {
        total++;
        const s = staleness(path.join(sdir, sid, "latest"));
        if (s.missing.length) rows.push({ proj, sid, missing: s.missing.map((m) => m.file) });
      }
    }
    console.log(total + " screens, " + rows.length + " need re-analysing");
    for (const r of rows) {
      console.log("  " + r.proj + " / " + r.sid);
      console.log("     missing " + r.missing.join(", "));
    }
    if (rows.length) {
      console.log();
      console.log("Re-analyse with: dsh-figma-design-lens-cat add '<the screen's Figma link>'");
    }
    return;
  }

  // What a node holds, before committing to analysing it. Pointing the tool
  // at a canvas produces an answer that looks valid and is not.
  if (cmd === "inspect") {
    const url = args[1];
    if (!url) throw new Error("usage: dsh-figma-design-lens-cat inspect <figma link>");
    if (!getSettings().token()) {
      throw new Error("no Figma token configured. Run `dsh-figma-design-lens-cat setup` for the first-time guide, or save one with `dsh-figma-design-lens-cat token <your-figma-token>`.");
    }
    const { inspect } = await import("../src/ir/inspect.mjs");
    await inspect(url);
    return;
  }

  if (cmd === "bench") {
    const sub = args[1] || "show";
    const bench = await import("../src/bench/run.mjs");

    if (sub === "init") {
      const url = args[2];
      if (!url) { console.log("usage: bench init <figma page or section url> [--size 12]"); return; }
      const m = url.match(/\/design\/([A-Za-z0-9]+)/);
      const node = (url.match(/node-id=([0-9A-Za-z:-]+)/) || [])[1];
      if (!m || !node) { console.log("the link needs a file key and a node-id"); return; }
      const sizeArg = args.indexOf("--size");
      const size = sizeArg > 0 ? Number(args[sizeArg + 1]) || 12 : 12;

      const frames = await bench.discover(m[1], node.replace("-", ":"), getSettings().token());
      console.log("found " + frames.length + " phone frames");
      const picked = bench.chooseSet(frames, size);
      const file = bench.saveSet({
        fileKey: m[1], node, createdAt: new Date().toISOString(),
        available: frames.length, screens: picked,
      });
      console.log("benchmark set: " + picked.length + " screens -> " + file);
      for (const s of picked) {
        console.log("  " + s.id.padEnd(16) + s.w + "x" + s.h + "  " + String(s.name).slice(0, 44));
      }
      return;
    }

    if (sub === "score") {
      const set = bench.loadSet();
      if (!set) { console.log("no benchmark set; run bench init first"); return; }
      const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "unlabelled";
      // No default project: whichever one was being worked on when this was
      // written is not a sensible fallback for anyone else.
      const project = args.includes("--project")
        ? args[args.indexOf("--project") + 1] : null;
      if (!project) {
        throw new Error("bench score needs --project <id>; see dsh-figma-design-lens-cat projects");
      }
      const ids = set.screens.map((s) => s.id.replace(":", "-"));
      const rows = bench.collect(LENS_HOME, project, ids);
      const summary = bench.summarise(rows);
      bench.record({ at: new Date().toISOString(), label, summary, rows });

      console.log("screens scored: " + summary.screens);
      for (const p of bench.PLATFORMS) {
        const s = summary.byPlatform[p];
        console.log("  " + p.padEnd(8)
          + "pixel " + String(s.pixel ?? "-").padStart(5)
          + "  text " + String(s.text ?? "-").padStart(5)
          + "  shape " + String(s.shape ?? "-").padStart(5)
          + "  missing " + s.missing
          + "  (" + s.byModel + " model, " + s.byTemplate + " template, "
          + s.failed + " unrendered)");
      }
      console.log("overall pixel: " + summary.overall);

      // Say it plainly: a run the model never touched measures the template.
      const model = Object.values(summary.byPlatform).reduce((a, s) => a + s.byModel, 0);
      const template = Object.values(summary.byPlatform).reduce((a, s) => a + s.byTemplate, 0);
      if (!model && template) {
        console.log("\nWARNING: every render came from the template, so this run"
          + " does not measure model output.\n         Check: dsh-figma-design-lens-cat llm status");
      } else if (template) {
        console.log("\nnote: " + template + " render(s) fell back to the template.");
      }
      return;
    }

    if (sub === "compare") {
      const runs = bench.history();
      if (runs.length < 2) { console.log("need two runs to compare"); return; }
      const { compare } = await import("../src/bench/compare.mjs");
      const a = runs[runs.length - 2], b = runs[runs.length - 1];
      const c = compare(a, b);

      console.log("before: " + a.label);
      console.log("after : " + b.label);
      console.log();
      console.log("like-for-like over " + c.common + " renders present in both:");
      console.log("  " + c.likeForLike.before + " -> " + c.likeForLike.after
        + "  (" + (c.likeForLike.delta >= 0 ? "+" : "") + c.likeForLike.delta + ")");
      console.log("coverage: " + c.coverage.before + " -> " + c.coverage.after
        + "  (+" + c.coverage.gained + " newly rendering, -" + c.coverage.lost + " lost)");
      if (c.coverage.gained) {
        console.log("  note: a newly rendering screen usually scores low at first,"
          + " so it lowers the overall mean while being an improvement.");
      }
      if (c.regressed.length) {
        console.log("\nworse:");
        for (const m of c.regressed) console.log("  " + m.key + "  " + m.delta);
      }
      if (c.improved.length) {
        console.log("\nbetter:");
        for (const m of c.improved) console.log("  " + m.key + "  +" + m.delta);
      }
      return;
    }

    if (sub === "history") {
      const rows = bench.summariseHistory();
      if (!rows.length) { console.log("no runs recorded yet"); return; }
      console.log("date              label                overall    web    ios android  source");
      for (const r of rows) {
        console.log(String(r.at).slice(0, 16) + "  "
          + String(r.label).slice(0, 20).padEnd(20)
          + String(r.overall ?? "-").padStart(7)
          + String(r.web ?? "-").padStart(7)
          + String(r.ios ?? "-").padStart(7)
          + String(r.android ?? "-").padStart(7)
          + "  " + (r.source || "?"));
      }
      return;
    }

    if (sub === "show") {
      const set = bench.loadSet();
      if (!set) { console.log("no benchmark set; run bench init first"); return; }
      console.log("file " + set.fileKey + " node " + set.node
        + " · " + set.screens.length + " of " + set.available + " frames");
      for (const s of set.screens) {
        console.log("  " + s.id.padEnd(16) + s.w + "x" + s.h + "  " + String(s.name).slice(0, 44));
      }
      return;
    }

    console.log("usage: dsh-figma-design-lens-cat bench <init|score|history|show>");
    return;
  }

  if (cmd === "llm") {
    const sub = args[1];
    const client = await import("../src/llm/client.mjs");

    if (sub === "login") {
      // A subscription signs in through the browser; any other built-in
      // service is connected with its API key, typed without echo.
      const provider = args[2] || "anthropic";
      const rl = await makeRl();
      try {
        if (PROVIDERS.some((p) => p.id === provider)) await signIn(provider, rl);
        else await addServiceKey(rl, provider);
      } finally {
        rl.close();
      }
      return;
    }

    if (sub === "logout") {
      const provider = args[2] || "anthropic";
      if (PROVIDERS.some((p) => p.id === provider)) {
        await client.logout(provider);
        console.log("signed out of " + provider);
      } else {
        console.log(await client.removeProviderKey(provider) ? "removed the API key for " + provider : "no API key saved for " + provider);
      }
      return;
    }

    // Built-in services that need only an API key: `llm login <id>` adds one.
    if (sub === "services") {
      const list = await client.keyServices();
      if (!list.length) { console.log("the LLM package is not installed; run: dsh-figma-design-lens-cat setup"); return; }
      const w = Math.max(...list.map((s) => s.id.length));
      for (const s of list) {
        console.log("  " + s.id.padEnd(w + 2) + String(s.models).padStart(4) + " models  " + s.name + (s.added ? "  (added)" : ""));
      }
      console.log();
      console.log("add one:  dsh-figma-design-lens-cat llm login <id>     (asks for its API key)");
      console.log("any other endpoint:  dsh-figma-design-lens-cat llm provider add <name> --base-url <url> --api-key-env <VAR>");
      return;
    }

    if (sub === "status") {
      // Each provider is checked with its own model (checkProvider): passing
      // none for anything but anthropic failed with "unknown model" and
      // reported a working Codex or Copilot login as broken.
      const check = args.includes("--offline") ? null
        : async (p) => (await client.checkProvider(p)).state;
      const active = llmState().provider;
      for (const { id: p } of PROVIDERS) {
        if (!client.isAuthorised(p)) { console.log("  --      " + p); continue; }
        const state = check ? await check(p) : "stored";
        const mark = state === "ok" ? "ok     " : state === "expired" ? "expired" : state === "stored" ? "stored " : "error  ";
        console.log("  " + mark + " " + p + (p === active ? "   (used for renders)" : "")
          + (state === "expired" ? "   run: dsh-figma-design-lens-cat llm login " + p : ""));
      }
      for (const c of client.listCustomProviders()) {
        if (!c.ready) { console.log("  error   " + c.id + "   " + c.why); continue; }
        const state = check ? await check(c.id) : "stored";
        const mark = state === "ok" ? "ok     " : state === "stored" ? "stored " : "error  ";
        console.log("  " + mark + " " + c.id + "   (custom, " + c.keySource + ")"
          + (c.id === active ? "   (used for renders)" : ""));
      }
      console.log("\ncredentials: " + client.authFile());
      return;
    }

    // Every model a render could use, grouped by provider.
    if (sub === "models") {
      const { groups, current } = await client.listModelGroups();
      for (const g of groups) {
        const where = g.kind === "custom" ? "  " + g.api + "  " + g.baseURL : "";
        console.log(g.label + "  [" + g.id + "]" + where + (g.ready ? "" : "  -- " + g.why));
        if (!g.ready && g.kind === "subscription") {
          console.log("    " + g.models.length + " models; sign in with: dsh-figma-design-lens-cat llm login " + g.id);
          console.log();
          continue;
        }
        const w = Math.max(10, ...g.models.map((m) => m.id.length));
        for (const m of g.models) {
          const on = current && current.provider === g.id && current.model === m.id;
          console.log((on ? "  * " : "    ") + m.id.padEnd(w + 2) + (m.name !== m.id ? m.name : ""));
        }
        console.log();
      }
      console.log(current ? "renders use: " + current.provider + " / " + current.model : "no model is connected");
      console.log("switch with:  dsh-figma-design-lens-cat llm use <provider>/<model>");
      return;
    }

    // Choose the model renders use: "provider/model", "provider model", or a
    // provider alone to keep its current model.
    if (sub === "use") {
      const a = args[2] || "";
      const [provider, model] = a.includes("/") && !args[3]
        ? [a.slice(0, a.indexOf("/")), a.slice(a.indexOf("/") + 1)] : [a, args[3]];
      if (!provider) throw new Error("usage: dsh-figma-design-lens-cat llm use <provider>/<model>");
      const r = model ? await client.chooseModel(provider, model) : client.chooseProvider(provider);
      console.log("renders will use: " + r.provider + " / " + r.model);
      return;
    }

    // One request to a provider, with a given model or the one renders use.
    if (sub === "test") {
      const provider = args[2] || llmState().provider;
      if (!provider) throw new Error("usage: dsh-figma-design-lens-cat llm test <provider> [model]");
      const r = await client.checkProvider(provider, args[3]);
      console.log(r.state + "  " + provider + (r.model ? " / " + r.model : "") + (r.detail ? "  " + r.detail : "")
        + (r.note ? "  (" + r.note + ")" : ""));
      process.exit(r.state === "ok" ? 0 : 1);
    }

    // Custom providers: endpoints the built-in catalog does not describe.
    if (sub === "provider") {
      const op = args[3] !== undefined || ["add", "remove", "list"].includes(args[2]) ? args[2] : "list";
      if (op === "list") {
        const list = client.listCustomProviders();
        if (!list.length) console.log("no custom providers; add one with: dsh-figma-design-lens-cat llm provider add <id> --base-url <url> --model <id>");
        for (const c of list) {
          console.log(c.displayName + "  [" + c.id + "]  " + c.api + "  " + c.baseURL);
          console.log("    key: " + (c.apiKeySet ? c.apiKey : c.apiKeyEnv ? "$" + c.apiKeyEnv : "none")
            + (c.ready ? "" : "  -- " + c.why));
          console.log("    models: " + c.models.map((m) => m.id).join(", "));
        }
        return;
      }
      const id = args[3];
      if (!id) throw new Error("usage: dsh-figma-design-lens-cat llm provider " + op + " <id>");
      if (op === "remove") {
        console.log(client.removeCustomProvider(id) ? "removed " + id : "no custom provider " + id);
        return;
      }
      if (op !== "add") throw new Error("usage: dsh-figma-design-lens-cat llm provider <add|list|remove>");
      const { parseModelArg } = await import("../src/llm/custom.mjs");
      const many = (n) => args.flatMap((x, i) => (x === "--" + n && args[i + 1] ? [args[i + 1]] : []));
      const existing = client.customProviders()[id];
      let models = many("model").map(parseModelArg);
      // No --model: ask the endpoint which models it serves. --fetch-models
      // does the same for a provider already added.
      if (!models.length && (!existing || args.includes("--fetch-models"))) {
        const k = flag("api-key");
        const d = await client.discoverModels({
          id: existing ? id : undefined,
          baseURL: flag("base-url") === true ? undefined : flag("base-url") || (existing && existing.baseURL),
          apiKey: k === true ? undefined : k || undefined,
          apiKeyEnv: flag("api-key-env") === true ? undefined : flag("api-key-env") || (existing && existing.apiKeyEnv),
          api: flag("api") === true ? undefined : flag("api") || (existing && existing.api) || undefined,
        }).catch((e) => { throw new Error(e.message + "; or name them with --model <id>"); });
        models = d.models;
        console.log("found " + models.length + " models at " + d.url);
      }
      const key = flag("api-key");
      const r = await client.saveCustomProvider({
        id,
        displayName: flag("name") === true ? undefined : flag("name") || (existing && existing.displayName),
        api: flag("api") === true ? undefined : flag("api") || (existing && existing.api),
        baseURL: flag("base-url") === true ? undefined : flag("base-url") || (existing && existing.baseURL),
        apiKey: key === true ? undefined : key || undefined,
        apiKeyEnv: flag("api-key-env") === true ? undefined : flag("api-key-env") || (existing && existing.apiKeyEnv),
        models: models.length ? models : (existing ? existing.models : []),
      });
      console.log((existing ? "updated " : "added ") + r.displayName + "  [" + r.id + "]  " + r.api + "  " + r.baseURL);
      console.log("    models: " + r.models.map((m) => m.id).join(", "));
      console.log("    key: " + (r.apiKeySet ? r.apiKey + " (saved, mode 600)" : r.apiKeyEnv ? "$" + r.apiKeyEnv : "none")
        + (r.ready ? "" : "  -- " + r.why));
      if (key && key !== true) {
        console.log("note: a key on the command line stays in your shell history;");
        console.log("      --api-key-env or the web Settings page avoid that.");
      }
      console.log("use it:  dsh-figma-design-lens-cat llm use " + r.id + "/" + r.models[0].id);
      return;
    }

    console.log("usage: dsh-figma-design-lens-cat llm <login|logout|status|models|use|test|provider> ...");
    return;
  }

  if (cmd === "env") {
    const { inspect, CHECKS, runCheck } = await import("../src/env/checks.mjs");

    if (args.includes("--setup-android")) {
      const { installWrapper } = await import("../src/env/gradle.mjs");
      const { installProxyRoot } = await import("../src/env/truststore.mjs");
      const w = installWrapper();
      console.log(w.ok
        ? (w.reused ? "gradle wrapper already installed: " : "gradle wrapper installed: ") + w.path
        : "gradle wrapper: " + w.error);
      const tr = installProxyRoot();
      console.log(tr.ok ? "trust store: " + tr.path : "trust store: " + tr.error);
      console.log(w.ok
        ? "android rendering is ready; the first render downloads its toolchain"
        : "android rendering still needs a Gradle wrapper");
      process.exit(w.ok ? 0 : 1);
    }

    if (args.includes("--trust-proxy")) {
      const { installProxyRoot } = await import("../src/env/truststore.mjs");
      const r = installProxyRoot();
      console.log(r.ok ? "trust store written: " + r.path : "failed: " + r.error);
      if (r.ok) console.log("the generated Android project will use it automatically");
      process.exit(r.ok ? 0 : 1);
    }

    const { results, capabilities } = inspect();
    const want = args.slice(1).find((a) => !a.startsWith("--"));

    for (const [key, cap] of Object.entries(capabilities)) {
      if (want && key.toLowerCase() !== want.toLowerCase()) continue;
      console.log((cap.ready ? "  ready    " : "  blocked  ") + cap.label);
      for (const name of cap.checks) {
        const r = results[name];
        if (!r) continue;
        const mark = r.ok ? "ok  " : (r.optional ? "warn" : "FAIL");
        console.log("    " + mark + " " + name.padEnd(14) + String(r.value).slice(0, 52));
        if (!r.ok && r.fix) console.log("         fix: " + r.fix);
      }
      console.log();
    }

    const blocked = Object.values(capabilities).filter((c) => !c.ready);
    if (!blocked.length) console.log("every capability is ready");
    else console.log(blocked.length + " capability(ies) need attention — see fix lines above");
    process.exit(blocked.length ? 1 : 0);
  }

  if (cmd === "doctor") {
    // The same list the web Settings page shows, so the two never disagree.
    const { doctorChecks, doctorOk } = await import("../src/env/doctor.mjs");
    const checks = doctorChecks();
    for (const c of checks) {
      const mark = c.ok ? "  ok   " : c.optional ? "  warn " : "  FAIL ";
      const fix = !c.ok && c.fix ? " — " + (c.fix.startsWith("dsh-") ? "run: " : "") + c.fix : "";
      console.log(mark + (c.label + " ").padEnd(16) + c.value + fix);
    }
    const ok = doctorOk(checks);
    const token = checks.find((c) => c.id === "figmaToken").ok;
    const st = llmState();
    console.log();
    if (!token) {
      printFigmaTokenSetup("  ");
      console.log();
    }
    if (!st.ready) {
      for (const line of LLM_WHY) console.log("  " + line);
      console.log();
      printLlmSetup("  ");
      console.log();
    }
    console.log("The same check is in the web UI: Settings → Environment check.");
    console.log(ok ? (st.ready ? "ready" : "ready (renders will use the template until a model is connected)")
      : "some checks failed — see above");
    process.exit(ok ? 0 : 1);
  }

  if (cmd === "list") {
    const store = getStore();
    store.reindex();
    const idxFile = path.join(LENS_HOME, "index.json");
    if (!fs.existsSync(idxFile)) { console.log("no projects yet"); return; }
    const idx = JSON.parse(fs.readFileSync(idxFile, "utf8"));
    if (!idx.projects.length) { console.log("no projects yet"); return; }
    const registry = getRegistry();
    for (const p of idx.projects) {
      const rec = registry.all().find((r) => r.id === p.id);
      const s = p.summary;
      console.log(p.name + "  (" + p.id + ")");
      console.log("  fileKey " + (rec ? rec.fileKey : "-")
        + (rec && rec.aliases.length ? "  aliases: " + rec.aliases.join(", ") : ""));
      console.log("  " + s.screens + " screens · " + s.components + " components · "
        + s.ready + "/" + s.screens + " ready to build");
      console.log("  readiness " + Object.entries(s.readiness).map(([k, v]) => k + " " + (v === null || v === undefined ? "n/a" : v + "%")).join(" · "));

    }
    return;
  }

  if (cmd === "screens") {
    const rec = getRegistry().find(args[1]);
    const pid = rec ? rec.id : args[1];
    const f = path.join(getStore().projectDir(pid), "project.json");
    if (!fs.existsSync(f)) throw new Error("project not found: " + args[1]);
    const p = JSON.parse(fs.readFileSync(f, "utf8"));
    console.log(p.name + " — " + p.screens.length + " screens");
    for (const s of p.screens) {
      console.log("  " + s.name.slice(0, 34).padEnd(36) + s.size.w + "x" + s.size.h + "  "
        + String(s.components).padStart(3) + " components  " + s.verdict);
    }
    return;
  }

  if (cmd === "projects") {
    for (const r of getRegistry().all()) {
      console.log(r.name + "  (" + r.id + ")");
      console.log("  fileKey: " + r.fileKey);
      if (r.aliases.length) console.log("  aliases: " + r.aliases.join(", "));
    }
    return;
  }

  if (cmd === "serve") {
    const { createServer } = await import("../src/web/server.mjs");
    const port = Number(flag("port", getSettings().read().port || 7420));
    getStore().reindex();
    createServer(LENS_HOME, { repoRoot: PKG_ROOT }).listen(port, () => {
      console.log("dsh-figma-design-lens-cat UI: http://127.0.0.1:" + port);
      console.log("store: " + LENS_HOME);
      const st = llmState();
      console.log("model: " + (st.ready ? st.message
        : "none (" + st.message + ") — renders will use the template; run: dsh-figma-design-lens-cat setup"));
    });
    return;
  }

  if (cmd === "reindex") {
    const i = getStore().reindex();
    console.log("indexed " + i.projects.length + " projects");
    return;
  }
  if (cmd === "service") {
    const svc = await import("../src/service.js");
    const sub = args[1] || "status";
    const port = Number(flag("port", getSettings().read().port || 7420));
    const cliPath = path.join(PKG_ROOT, "bin", "design-lens.mjs");

    if (sub === "install" || sub === "enable") {
      const f = svc.install({ nodeBin: process.execPath, cliPath, lensHome: LENS_HOME, port });
      console.log("installed and started: " + f);
      console.log("  UI:   http://127.0.0.1:" + port);
      console.log("  logs: " + path.join(LENS_HOME, "logs"));
      console.log();
      console.log("It now starts automatically at login.");
      console.log("  pause it:  dsh-figma-design-lens-cat service stop");
      console.log("  remove it: dsh-figma-design-lens-cat service uninstall");
      return;
    }
    if (sub === "stop" || sub === "disable") {
      svc.stop();
      console.log("stopped. It will start again at next login.");
      console.log("  start now:     dsh-figma-design-lens-cat service start");
      console.log("  remove for good: dsh-figma-design-lens-cat service uninstall");
      return;
    }
    if (sub === "start") { svc.start(); console.log("started: http://127.0.0.1:" + port); return; }
    if (sub === "restart") { svc.stop(); svc.start(); console.log("restarted: http://127.0.0.1:" + port); return; }
    if (sub === "uninstall" || sub === "remove") {
      const f = svc.uninstall();
      console.log("removed: " + f);
      console.log("It no longer starts at login. Run it by hand with: dsh-figma-design-lens-cat serve");
      return;
    }
    if (sub === "logs") {
      const f = path.join(LENS_HOME, "logs", "server.log");
      if (!fs.existsSync(f)) { console.log("no log yet: " + f); return; }
      const lines = fs.readFileSync(f, "utf8").split("\n");
      console.log(lines.slice(-40).join("\n"));
      return;
    }

    const s = svc.status(port);
    console.log("autostart at login: " + (s.installed ? "yes" : "no"));
    console.log("loaded by launchd:  " + (s.loaded ? "yes" : "no"));
    console.log("listening on " + port + ":  " + (s.listening ? "yes" : "no"));
    console.log("agent file: " + s.plist);
    console.log("logs:       " + s.logs);
    console.log();
    if (!s.installed) console.log("enable it: dsh-figma-design-lens-cat service install");
    else if (!s.listening) console.log("start it:  dsh-figma-design-lens-cat service start");
    else console.log("open:      http://127.0.0.1:" + port);
    return;
  }

  if (cmd === "install-mcp") {
    const target = String(flag("client", "claude"));
    const mcpPath = path.join(PKG_ROOT, "bin", "mcp.mjs");
    if (target === "claude") {
      console.log("Run this once:");
      console.log();
      console.log("  claude mcp add dsh-figma-design-lens-cat --scope user \\");
      console.log('    --env LENS_HOME="$HOME/.dsh-figma-design-lens-cat" \\');
      console.log("    -- " + process.execPath + " " + mcpPath);
    } else if (target === "codex") {
      console.log("Add to ~/.codex/config.toml:");
      console.log();
      console.log("  [mcp_servers.dsh-figma-design-lens-cat]");
      console.log('  command = "' + process.execPath + '"');
      console.log('  args = ["' + mcpPath + '"]');
      console.log('  env = { LENS_HOME = "' + LENS_HOME + '" }');
    } else {
      console.log("JSON config (Claude Desktop, Cursor, WorkBuddy, Windsurf, …):");
      console.log();
      console.log(JSON.stringify({ mcpServers: { "dsh-figma-design-lens-cat": {
        command: process.execPath, args: [mcpPath], env: { LENS_HOME } } } }, null, 2));
    }
    return;
  }

  console.log("dsh-figma-design-lens-cat — Figma design understanding for AI coding agents");
  console.log();
  console.log("  dsh-figma-design-lens-cat setup                     first-time guide: Figma token and model");
  console.log("  dsh-figma-design-lens-cat doctor                    check local setup");
  console.log('  dsh-figma-design-lens-cat add "<figma url>" [--project <label>] [--detectors]');
  console.log("  dsh-figma-design-lens-cat list                      projects and readiness");
  console.log("  dsh-figma-design-lens-cat screens <project>         screens in a project");
  console.log("  dsh-figma-design-lens-cat projects                  project identities and aliases");
  console.log("  dsh-figma-design-lens-cat serve [--port 7420]       review UI");
  console.log("  dsh-figma-design-lens-cat token <figma-token>       set the Figma token");
  console.log("  dsh-figma-design-lens-cat config --token <figd_..>  set the Figma token");
  console.log("  dsh-figma-design-lens-cat llm login <provider>      connect a model: " + PROVIDERS.map((p) => p.id).join(", "));
  console.log("  dsh-figma-design-lens-cat llm status                which providers work, which one renders use");
  console.log("  dsh-figma-design-lens-cat llm models                every model renders can use, grouped by provider");
  console.log("  dsh-figma-design-lens-cat llm use <provider>/<model> choose the model renders use");
  console.log("  dsh-figma-design-lens-cat llm provider add <id> --base-url <url> --model <id> [--api ...] [--api-key-env ...]");
  console.log("  dsh-figma-design-lens-cat service install    run the UI in the background, start at login");
  console.log("  dsh-figma-design-lens-cat service status     is it installed / running?");
  console.log("  dsh-figma-design-lens-cat service stop       stop now (returns at next login)");
  console.log("  dsh-figma-design-lens-cat service start      start it again");
  console.log("  dsh-figma-design-lens-cat service uninstall  remove it completely");
  console.log("  dsh-figma-design-lens-cat service logs       last 40 log lines");
  console.log("  dsh-figma-design-lens-cat install-mcp [--client claude|codex|json]");
  console.log();
  console.log("  (short alias: dlc)");
  console.log("store: " + LENS_HOME);
};

main().catch((e) => { console.error("error: " + e.message); process.exit(1); });
