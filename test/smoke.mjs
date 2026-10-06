// Smoke test: modules load, the CLI responds, MCP speaks its protocol,
// and project identity behaves. No network, so CI needs no Figma token.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = "/tmp/dsh-figma-design-lens-cat-smoke";
let failed = 0;

const check = async (name, fn) => {
  try { await fn(); console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + " — " + String(e.message).split("\n")[0]); }
};

fs.rmSync(HOME, { recursive: true, force: true });
// Undefined references are a syntax-check blind spot: node --check accepts a
// file that will throw "X is not defined" on its first call. This session lost
// many rounds to exactly that, so it is now a test.
await check("no undefined module references", () => {
  execFileSync("node", [path.join(ROOT, "scripts", "check-refs.mjs"),
    path.join(ROOT, "src", "mcp", "server.mjs"),
    path.join(ROOT, "src", "web", "server.mjs"),
    path.join(ROOT, "bin", "design-lens.mjs"),
    path.join(ROOT, "src", "ir", "pipeline.mjs")], { stdio: "pipe" });
});
// Anything that starts automatically must be switchable off from the same CLI.
await check("service commands are wired", () => {
  const help = execFileSync("node", [path.join(ROOT, "bin", "design-lens.mjs")], { stdio: "pipe" }).toString();
  for (const sub of ["service install", "service stop", "service uninstall"]) {
    assert(help.includes(sub), "help does not mention: " + sub);
  }
  const out = execFileSync("node", [path.join(ROOT, "bin", "design-lens.mjs"), "service", "status"],
    { stdio: "pipe", env: { ...process.env, LENS_HOME: HOME } }).toString();
  assert(/autostart at login/.test(out), "service status produced no report");
});

await check("cli help", () => {
  const out = execFileSync("node", [path.join(ROOT, "bin", "design-lens.mjs")], { stdio: "pipe" }).toString();
  assert(out.includes("dsh-figma-design-lens-cat"), "help text missing");
});

await check("doctor runs", () => {
  const r = spawnSync("node", [path.join(ROOT, "bin", "design-lens.mjs"), "doctor"],
    { encoding: "utf8", env: { ...process.env, LENS_HOME: HOME } });
  assert(/node\s+v\d+/.test(r.stdout), "doctor produced no node check");
});

await check("public API imports", async () => {
  const m = await import(path.join(ROOT, "src", "index.js"));
  for (const name of ["Store", "Registry", "Settings", "scoreReadiness", "buildInventory", "figmaToIR"]) {
    assert(typeof m[name] !== "undefined", "missing export: " + name);
  }
});

await check("identity resolves aliases to one project", async () => {
  const { Registry } = await import(path.join(ROOT, "src", "store", "identity.js"));
  const R = new Registry(HOME);
  const a = R.resolve("KEY1234567890", { title: "Demo", alias: "Demo" });
  const b = R.resolve("KEY1234567890", { alias: "demo-alias" });
  assert.equal(a.id, b.id, "same file produced two projects");
  assert(R.find("demo-alias"), "alias lookup failed");
  assert(R.find("KEY1234567890"), "fileKey lookup failed");
});

await check("readiness scores and codes blockers", async () => {
  const { scoreReadiness } = await import(path.join(ROOT, "src", "ir", "readiness.js"));
  const inv = { screen: { size: { w: 390, h: 800 } }, components: [
    { role: "text", box: { x: 0, y: 0, w: 100, h: 20 }, text: "Hi",
      font: { size: 14, color: "#000" }, semantic: { suggestName: "greeting", confidence: 0.9 } },
  ] };
  const s = scoreReadiness(inv, {});
  assert.equal(s.axes.structure, 100, "structure should be 100");
  for (const b of s.blockers) assert(b.code, "blockers must carry a code, not prose");
});

await check("i18n renders both languages", async () => {
  const { translator, renderBlocker } = await import(path.join(ROOT, "src", "i18n", "strings.js"));
  const b = { code: "semantics.unnamed", severity: "high", axis: "semantics", params: { count: 3 } };
  const en = renderBlocker(b, translator("en")).what;
  const zh = renderBlocker(b, translator("zh")).what;
  assert(en.includes("3") && /[a-z]/.test(en), "english rendering failed");
  assert(zh.includes("3") && /[\u4e00-\u9fa5]/.test(zh), "chinese rendering failed");
});
// The review link was once buried in the last 15% of a 2.6KB result and models
// reliably dropped it, leaving the user with no way to see what was detected.
// It must lead, and it must read as an instruction.
await check("review link leads the result", async () => {
  const { formatScreen } = await import(path.join(ROOT, "src", "mcp", "format.js"));
  const man = {
    screen: { name: "Demo", size: { w: 390, h: 844 }, platform: "mobile" },
    counts: { components: 3, byRole: { text: 3 }, layouts: 1, excludedDecoration: 0, rasterOnly: 0 },
    readiness: { axes: { structure: 100, semantics: 100, styling: 100, assets: 100, interaction: null },
      counts: {}, blockers: [], verdict: "risky" },
  };
  const out = formatScreen(man, { screen: "http://127.0.0.1:7420/s/p/s" },
    { spec: "/tmp/implement.md", reviewPage: "/tmp/review/index.html" });
  const at = out.indexOf("http://127.0.0.1:7420/s/p/s");
  assert(at >= 0, "live link missing");
  assert(at < out.length * 0.3, "link must appear in the first third, was at "
    + Math.round((at / out.length) * 100) + "%");
  // No file:// link: Chrome blocks a local page from loading its sibling
  // images, so that "fallback" opens with every crop missing.
  assert(!/file:\/\//.test(out), "must not offer a file:// page");

  // Without a server, the result must say how to start one.
  const offline = formatScreen(man, null,
    { spec: "/tmp/implement.md", reviewPage: "/tmp/review/index.html", route: "/s/p/s" });
  assert(/dsh-figma-design-lens-cat serve/.test(offline), "must tell the user how to start the server");
  assert(!/file:\/\//.test(offline), "must not offer a file:// page when the server is down");
});

await check("mcp speaks protocol", () => {
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  ].join("\n") + "\n";
  const r = spawnSync("node", [path.join(ROOT, "bin", "mcp.mjs")], {
    input, timeout: 10000, encoding: "utf8",
    env: { ...process.env, LENS_HOME: HOME, LENS_PORT: "7999" },
  });
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const init = lines.find((l) => l.id === 1);
  const tools = lines.find((l) => l.id === 2);
  assert(init && init.result.serverInfo.name === "dsh-figma-design-lens-cat", "initialize failed");
  assert(tools && tools.result.tools.length >= 8, "expected >= 8 tools, got " + (tools ? tools.result.tools.length : 0));
  for (const t of tools.result.tools) {
    assert(t.description.startsWith("[dsh-figma-design-lens-cat]"), "tool " + t.name + " is not namespaced");
  }
});

console.log();
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
