#!/usr/bin/env node
// dsh-figma-design-lens-cat MCP server — stdio JSON-RPC, no SDK dependency.
//
// Design decisions that matter for an AI client:
//
//  1. Every result is TEXT the model can act on, plus a URL a human can open.
//     Raw JSON wastes context and hides what matters (what is missing); a bare
//     URL makes the model blind.
//
//  2. The UI server starts lazily on first use and stays alive, so "analyse
//     this design" ends with a link that actually opens.
//
//  3. Tool granularity mirrors the context budget: list (~0.5KB) → screens
//     (~2KB) → screen (~3KB) → spec (~13KB) → components (on demand). A model
//     never needs to read a 138KB IR to answer a question.
//
//  4. Results state their own limits: a screen with interaction 0% tells the
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { Registry, parseFigmaUrl } from "../store/identity.js";
import { Store, screenIdOf } from "../store/store.js";
import { createServer } from "../web/server.mjs";
import { formatScreen, formatProjects, formatScreens, formatComponents } from "./format.js";
import { lensHome } from "../store/home.mjs";

// Reported to clients in the handshake. Read from package.json so a release
// cannot ship announcing the previous version, as 1.0.1 did.
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
  } catch { return "unknown"; }
})();

const HERE = path.dirname(new URL(import.meta.url).pathname);
// src/mcp/server.mjs -> package root is two levels up, not four. The old depth
// was inherited from the monorepo layout and pointed outside the package.
const ROOT = path.resolve(HERE, "..", "..");
// Default to the user's home, not the package directory: an npm-installed
// package lives in a read-only location and must never write there.
const LENS_HOME = lensHome();
const PORT = Number(process.env.LENS_PORT || 7420);
const registry = new Registry(LENS_HOME);
const store = new Store(LENS_HOME);

// The review UI is a convenience, never a reason to fail a tool call.
//
// listen() reports EADDRINUSE asynchronously, so wrapping the call in try/catch
// caught nothing: the unhandled 'error' event killed the process and every
// client saw "Connection closed" on the first tool call. A port already in use
// usually means another instance is already serving the same store, which is
// fine — link to it instead of dying.
// The review UI is a convenience, never a reason to fail a tool call — but its
// URL must be decided BEFORE a result is rendered, or every answer omits the
// link. listen() reports both success and EADDRINUSE asynchronously, so this
// awaits the outcome once and caches it.
//
// A port already in use almost always means another instance is serving the
// same store, so the link is still correct: point at it rather than giving up.
let uiPort = null;
let uiReady = null;
function ensureUi() {
  if (uiReady) return uiReady;
  uiReady = new Promise((resolve) => {
    let srv;
    try {
      srv = createServer(LENS_HOME, { repoRoot: ROOT });
    } catch {
      resolve(null);
      return;
    }
    const done = (port) => { uiPort = port; resolve(port); };
    srv.on("error", (e) => done(e && e.code === "EADDRINUSE" ? PORT : null));
    srv.listen(PORT, () => done(PORT));
    // never let a hung bind stall a tool call
    setTimeout(() => done(uiPort), 1500);
  });
  return uiReady;
}

// Only offer a link when the UI is actually listening. A dead URL wastes the
// reader's time and makes the whole result look unreliable.
const U = {
  get available() { return uiPort !== null; },
  home: () => "http://127.0.0.1:" + uiPort + "/",
  project: (p) => "http://127.0.0.1:" + uiPort + "/p/" + p,
  screen: (p, s) => "http://127.0.0.1:" + uiPort + "/s/" + p + "/" + s,
};
const openBrowser = (url) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url], () => {});
};

const TOOLS = [
  { name: "analyze_design",

    description: "[dsh-figma-design-lens-cat] PRIMARY ENTRY POINT for Figma-to-code work. When a user provides a figma.com link and asks to implement, rebuild, reproduce, or review a UI, call this before writing UI code or using raw Figma node readers. It analyses the selected Figma screen and stores it as a reusable project artifact. Unlike raw Figma API tools that return a node tree, this runs a full implementation pipeline: recovers exact geometry, colours, typography, effects and layout intent, classifies components, separates decoration from deliverables, exports background/raster assets as files, cross-checks detection with an independent vision model, names unnamed layers, and scores readiness. Use the stored result with get_implementation_spec, get_components and get_assets as the source of truth for implementation. The link must contain node-id (copy it with a frame selected in Figma).",

    inputSchema: { type: "object", required: ["url"], properties: {
      url: { type: "string", description: "Figma design link; must contain node-id" },
      project: { type: "string", description: "Optional project label. Membership is decided by the Figma file; this name is only recorded as an alias you can search by later." },
      detectors: { type: "boolean", description: "Run the image-detector cross-check (slower, on by default)" },

      open: { type: "boolean", description: "Open the result in a browser (default false)" } } } },
  { name: "list_projects",
    description: "[dsh-figma-design-lens-cat] List every analysed project with its screen count, component total and average readiness.",
    inputSchema: { type: "object", properties: {} } },
  { name: "list_screens",
    description: "[dsh-figma-design-lens-cat] List all screens of a project with size, component count, five-axis readiness and buildability verdict.",
    inputSchema: { type: "object", required: ["project"], properties: { project: { type: "string" } } } },
  { name: "get_screen",
    description: "[dsh-figma-design-lens-cat] Get one screen summary: readiness scores, recognition check, composition, gaps that must be resolved first, and a link to the visual review. Call this before implementing a screen to confirm the data is sufficient.",
    inputSchema: { type: "object", required: ["project", "screen"], properties: {
      project: { type: "string" }, screen: { type: "string", description: "screen id, e.g. 15076-22721" },
      open: { type: "boolean" } } } },
  { name: "get_implementation_spec",
    description: "[dsh-figma-design-lens-cat] PRIMARY SPEC for building an analysed Figma screen. Call this after analyze_design and use it instead of raw Figma REST data or generic node trees when generating code. Returns a Markdown implementation plan with provenance, exact design tokens, layout sections, background assets, component guidance, open questions and implementation notes. Treat it as the coding source of truth; use get_components only when you need role-specific exact values and get_assets when you need file paths for exported artwork.",

    inputSchema: { type: "object", required: ["project", "screen"], properties: {
      project: { type: "string" }, screen: { type: "string" } } } },
  { name: "get_components",
    description: "[dsh-figma-design-lens-cat] Get exact component values by role (position, size, fill, radius, border, font, text). role: card|icon|text|instance|image|asset. The measured fields come from the Figma file.",
    inputSchema: { type: "object", required: ["project", "screen", "role"], properties: {
      project: { type: "string" }, screen: { type: "string" }, role: { type: "string" } } } },
  { name: "get_assets",
    description: "[dsh-figma-design-lens-cat] Get paths of the exported image assets (background patterns, illustrations). Reference these files directly instead of redrawing them with shapes.",
    inputSchema: { type: "object", required: ["project", "screen"], properties: {
      project: { type: "string" }, screen: { type: "string" } } } },
  { name: "open_review",
    description: "[dsh-figma-design-lens-cat] Open the visual review page (annotated detection, readiness, component detail) in a browser for human verification.",
    inputSchema: { type: "object", required: ["project", "screen"], properties: {
      project: { type: "string" }, screen: { type: "string" } } } },
];
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const text = (s) => ({ content: [{ type: "text", text: s }] });
// Any label resolves to the same project: id, display name, alias, or fileKey.
// A model that says "CR" one turn and a translated name the next must not create two.
const projSlug = (p) => {
  const rec = registry.find(p);
  if (rec) return rec.id;
  const idx = readJson(path.join(LENS_HOME, "index.json"));
  const hit = idx && idx.projects.find((x) => x.id === p || x.name === p);
  return hit ? hit.id : String(p || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-");
};
const latest = (p, s) => path.join(LENS_HOME, "projects", projSlug(p), "screens", s, "latest");

async function call(name, a) {
  // Decide the UI URL before rendering any result, so every answer can offer
  // the human a page to look at.
  await ensureUi();

  if (name === "list_projects") {
    store.reindex();
    return text(formatProjects(readJson(path.join(LENS_HOME, "index.json")) || { projects: [] },
      U.available ? { home: U.home() } : null));
  }

  if (name === "list_screens") {
    const pj = readJson(path.join(LENS_HOME, "projects", projSlug(a.project), "project.json"));
    if (!pj) return text("project not found: " + a.project);
    return text(formatScreens(pj, U.available ? { project: U.project(projSlug(a.project)) } : null));
  }

  if (name === "get_screen" || name === "open_review") {
    const man = readJson(path.join(latest(a.project, a.screen), "manifest.json"));
    if (!man) return text("screen not found: " + a.project + "/" + a.screen);
    const link = U.available ? U.screen(projSlug(a.project), a.screen) : null;
    if (link && (a.open || name === "open_review")) openBrowser(link);
    if (name === "open_review") {
      return text(link ? "opened in browser: " + link
        : "the review UI is not running. Start it with: dsh-figma-design-lens-cat serve");
    }
    return text(formatScreen(man, link ? { screen: link } : null));
  }

  if (name === "get_implementation_spec") {
    const f = path.join(latest(a.project, a.screen), "implement.md");
    if (!fs.existsSync(f)) return text("implementation spec not found");
    const man = readJson(path.join(latest(a.project, a.screen), "manifest.json"));
    let head = "";
    if (man && man.readiness.blockers.length) {
      head = "> WARNING: this screen has readiness gaps. Read before implementing:\n"
        + man.readiness.blockers.map((b) => "> - [" + b.severity + "] "
            + renderBlocker(b, T_EN).what).join("\n") + "\n\n";
    }
    return text(head + fs.readFileSync(f, "utf8"));
  }

  if (name === "get_components") {
    const dir = path.join(latest(a.project, a.screen), "components");
    const f = path.join(dir, a.role + ".json");
    if (!fs.existsSync(f)) {
      const avail = fs.existsSync(dir) ? fs.readdirSync(dir).map((x) => x.replace(".json", "")) : [];
      return text("no components with role " + a.role + ". Available roles: " + avail.join(", "));
    }
    const man = readJson(path.join(latest(a.project, a.screen), "manifest.json"));
    return text(formatComponents(readJson(f), a.role, man ? man.screen.name : a.screen));
  }

  if (name === "get_assets") {
    const dir = path.join(latest(a.project, a.screen), "assets");
    if (!fs.existsSync(dir)) return text("this screen has no exported image assets.");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
    if (!files.length) return text("this screen has no exported image assets.");
    const rawAssets = readJson(path.join(latest(a.project, a.screen), "raw", "assets.json"));
    const byFile = new Map((rawAssets?.assets || []).map((x) => [path.basename(x.file || ""), x]));
    const L = ["# Image assets (" + files.length + ")", "",
      "Exported during analysis at the designer's own bounds. Reference these files directly instead of redrawing them.", ""];
    for (const f of files) {
      const st = fs.statSync(path.join(dir, f));
      const meta = byFile.get(f);
      const detail = meta
        ? " — " + [meta.kind, meta.name, meta.reason].filter(Boolean).join("; ")
        : "";
      L.push("- " + path.join(dir, f) + "  (" + (st.size / 1024).toFixed(0) + "KB)" + detail);
    }
    return text(L.join("\n"));
  }
  if (name === "analyze_design") {
    const lens = path.join(ROOT, "bin", "design-lens.mjs");
    const args = [lens, "add", a.url];
    if (a.project) args.push("--project", a.project);
    if (a.detectors !== false) args.push("--detectors");

    let out = "";
    try {
      out = execFileSync(process.execPath, args, { cwd: ROOT, stdio: "pipe",
        env: { ...process.env, LENS_HOME }, timeout: 900000 }).toString();
    } catch (e) {
      return text("analysis failed: " + (e.stderr ? e.stderr.toString().slice(0, 500) : e.message));
    }

    // Locate the result exactly as the CLI stored it. The registry is re-read
    // from disk because the CLI wrote it in a child process, and the read is
    // retried: promote() copies a directory tree, and the child can exit before
    // those writes are visible here. Reporting a successful analysis as lost is
    // the worst possible outcome, so a few hundred milliseconds of patience is
    // cheap insurance.
    const parsed = parseFigmaUrl(a.url);
    const sid = parsed.node ? screenIdOf(parsed.node) : null;
    const rec = new Registry(LENS_HOME).all().find((x) => x.fileKey === parsed.fileKey);
    const pid = rec ? rec.id : projSlug(a.project);
    const manPath = path.join(LENS_HOME, "projects", pid, "screens", String(sid), "latest", "manifest.json");
    let man = null;
    for (let i = 0; i < 20 && !man; i++) {
      man = readJson(manPath);
      if (!man) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!man) {
      return text("analysis finished but its result could not be located.\nexpected: "
        + manPath + "\n\n" + out);
    }
    // Hand back the artifact paths, not just a summary: the agent that asked
    // for an analysis is usually about to implement the screen, and making it
    // call a second tool to learn where the spec lives is pure friction.
    const bundleDir = path.join(LENS_HOME, "projects", pid, "screens", String(sid), "latest");
    const listDir = (d) => { try { return fs.readdirSync(path.join(bundleDir, d)); } catch { return []; } };
    const bundle = {
      spec: path.join(bundleDir, "implement.md"),
      componentsDir: path.join(bundleDir, "components"),
      components: listDir("components").map((f) => f.replace(".json", "")),
      assetsDir: path.join(bundleDir, "assets"),
      assets: listDir("assets").filter((f) => f.endsWith(".png")),
      reviewPage: fs.existsSync(path.join(bundleDir, "review", "index.html"))
        ? path.join(bundleDir, "review", "index.html") : null,
      // Route to open once the server is up.
      route: "/s/" + pid + "/" + sid,
    };

    // Opening the review page by default is the point of running an analysis:
    // a human needs to see what was detected, and a link nobody clicks is a
    // report nobody reads. Pass open:false to suppress it.
    const link = U.available ? U.screen(pid, sid) : null;
    if (link && a.open !== false) openBrowser(link);
    return text(formatScreen(man, link ? { screen: link } : null, bundle));
  }


  return text("unknown tool: " + name);
}


let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const reply = (result, error) => {
      if (msg.id === undefined) return;
      process.stdout.write(JSON.stringify(error
        ? { jsonrpc: "2.0", id: msg.id, error }
        : { jsonrpc: "2.0", id: msg.id, result }) + "\n");
    };
    try {
      if (msg.method === "initialize") {
        reply({ protocolVersion: "2024-11-05", capabilities: { tools: {} },
          serverInfo: { name: "dsh-figma-design-lens-cat", version: VERSION } });
      } else if (msg.method === "tools/list") {
        reply({ tools: TOOLS });
      } else if (msg.method === "tools/call") {
        reply(await call(msg.params.name, msg.params.arguments || {}));
      } else if (msg.method && msg.method.startsWith("notifications/")) {
        // no reply
      } else {
        reply(null, { code: -32601, message: "method not found: " + msg.method });
      }
    } catch (e) {
      reply(null, { code: -32603, message: String(e.message).slice(0, 300) });
    }
  }
});
