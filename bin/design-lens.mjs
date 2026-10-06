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
      throw new Error("no Figma token. Run: dsh-figma-design-lens-cat config --token <figd_...>   (or set FIGMA_API_KEY)");
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
    return;
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
    const s = settings.redacted();
    console.log("token:     " + (s.figmaTokenSet ? s.figmaToken : "(not set)"));
    console.log("detectors: " + s.runDetectors);
    console.log("store:     " + LENS_HOME);
    return;
  }

  // Which stored analyses predate the current pipeline. A screen analysed
  // before the paint list existed renders from nothing and scores as though
  // the tool were broken.
  if (cmd === "stale") {
    const { staleness } = await import("../src/ir/staleness.mjs");
    const root = path.join(os.homedir(), ".dsh-figma-design-lens-cat", "projects");
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
      const provider = args[2] || "anthropic";
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        await client.login(provider, {
          prompt: async (p) => (await rl.question(p.message + " ")).trim(),
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
        console.log("authorised: " + provider);
        console.log("credential stored in " + client.authFile());
      } finally {
        rl.close();
      }
      return;
    }

    if (sub === "logout") {
      await client.logout(args[2] || "anthropic");
      console.log("signed out");
      return;
    }

    if (sub === "status") {
      // Presence of a credential is not the same as a working one: an expired
      // OAuth refresh token sat in the file for days while status said "ok"
      // and every generation silently fell back to the template.
      const check = args.includes("--offline") ? null : async (p) => {
        try {
          const model = p === "anthropic" ? "claude-sonnet-4-5" : undefined;
          await client.complete({ provider: p, model, system: "Reply with one word.",
            prompt: "ok", maxTokens: 5 });
          return "ok";
        } catch (e) {
          return /expired|invalid_grant/i.test(String(e.message)) ? "expired" : "error";
        }
      };
      for (const p of ["anthropic", "openai-codex", "github-copilot"]) {
        if (!client.isAuthorised(p)) { console.log("  --      " + p); continue; }
        const state = check ? await check(p) : "stored";
        const mark = state === "ok" ? "ok     " : state === "expired" ? "expired" : "error  ";
        console.log("  " + mark + " " + p
          + (state === "expired" ? "   run: dsh-figma-design-lens-cat llm login " + p : ""));
      }
      console.log("\ncredentials: " + client.authFile());
      return;
    }

    console.log("usage: dsh-figma-design-lens-cat llm <login|logout|status> [provider]");
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
    const { execFileSync } = await import("node:child_process");
    const checks = [];
    checks.push(["node", process.version, Number(process.version.slice(1).split(".")[0]) >= 20]);
    const py = pythonBin();
    let pyv = "not found";
    try { pyv = execFileSync(py, ["--version"], { stdio: "pipe" }).toString().trim(); } catch { /* reported */ }
    checks.push(["python3", pyv, pyv !== "not found"]);
    const vision = detectorsAvailable();
    checks.push(["pillow + numpy", vision ? "available" : "missing (pip install pillow numpy)", vision]);
    let token = "";
    try { token = getSettings().token(); } catch { /* store unreadable */ }
    checks.push(["figma token", token ? "configured" : "missing (dsh-figma-design-lens-cat config --token ...)", !!token]);
    checks.push(["store", LENS_HOME, true]);
    let ok = true;
    for (const [name, val, pass] of checks) {
      if (!pass) ok = false;
      console.log((pass ? "  ok   " : "  FAIL ") + name.padEnd(16) + val);
    }
    console.log();
    console.log(ok ? "ready" : "some checks failed — see above");
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
      console.log("JSON config (Claude Desktop, Cursor, Windsurf, …):");
      console.log();
      console.log(JSON.stringify({ mcpServers: { "dsh-figma-design-lens-cat": {
        command: process.execPath, args: [mcpPath], env: { LENS_HOME } } } }, null, 2));
    }
    return;
  }

  console.log("dsh-figma-design-lens-cat — Figma design understanding for AI coding agents");
  console.log();
  console.log('  dsh-figma-design-lens-cat add "<figma url>" [--project <label>] [--detectors]');
  console.log("  dsh-figma-design-lens-cat list                      projects and readiness");
  console.log("  dsh-figma-design-lens-cat screens <project>         screens in a project");
  console.log("  dsh-figma-design-lens-cat projects                  project identities and aliases");
  console.log("  dsh-figma-design-lens-cat serve [--port 7420]       review UI");
  console.log("  dsh-figma-design-lens-cat config --token <figd_..>  set the Figma token");
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
