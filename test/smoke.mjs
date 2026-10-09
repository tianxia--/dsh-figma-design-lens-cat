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
    path.join(ROOT, "src", "ir", "pipeline.mjs"),
    path.join(ROOT, "src", "llm", "client.mjs"),
    path.join(ROOT, "src", "llm", "custom.mjs"),
    path.join(ROOT, "src", "web", "llm-login.mjs")], { stdio: "pipe" });
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

// A custom provider has to reach its own endpoint with its own key, be
// choosable model by model, and never leave settings unmasked. An
// OpenAI-compatible server on loopback stands in for the gateway.
await check("custom model provider routes renders", async () => {
  const client = await import(path.join(ROOT, "src", "llm", "client.mjs"));
  if (!client.sdkInstalled()) return;   // the SDK is optional; nothing to route through
  const http = await import("node:http");
  const seen = [];
  const srv = http.createServer((req, res) => {
    // The listing "Fetch model list" reads; any key but the right one is refused.
    if (req.url.endsWith("/models")) {
      const ok = req.headers.authorization === "Bearer sk-smoke-1234567890";
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      return res.end(ok ? JSON.stringify({ data: [{ id: "m2" }, { id: "m1" }, { id: "m1" }] }) : "{}");
    }
    let b = ""; req.on("data", (c) => b += c); req.on("end", () => {
      const j = JSON.parse(b || "{}"); seen.push({ auth: req.headers.authorization, model: j.model });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ch = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
      ch({ id: "x", object: "chat.completion.chunk", created: 1, model: j.model,
        choices: [{ index: 0, delta: { role: "assistant", content: "pong:" + j.model }, finish_reason: null }] });
      ch({ id: "x", object: "chat.completion.chunk", created: 1, model: j.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const prev = process.env.LENS_HOME;
  process.env.LENS_HOME = path.join(HOME, "llm");
  try {
    const base = "http://127.0.0.1:" + srv.address().port + "/v1";
    await client.saveCustomProvider({ id: "acme", api: "openai-completions", baseURL: base,
      apiKey: "sk-smoke-1234567890", models: [{ id: "m1" }, { id: "m2", name: "Model Two" }] });
    const { groups } = await client.listModelGroups();
    const g = groups.find((x) => x.id === "acme");
    assert(g && g.ready && g.models.length === 2, "custom provider is not listed as usable");
    await client.chooseModel("acme", "m2");
    assert.equal(client.llmState().message, "acme / m2");
    const r = await client.complete({ provider: "acme", model: "m2", system: "s", prompt: "ping" });
    assert.equal(r.text, "pong:m2");
    assert.equal(seen[0].auth, "Bearer sk-smoke-1234567890");
    await assert.rejects(client.chooseModel("acme", "nope"), /no model/);
    await assert.rejects(client.saveCustomProvider({ id: "anthropic", baseURL: base, models: [{ id: "x" }] }), /built-in/);
    const { Settings } = await import(path.join(ROOT, "src", "store", "settings.js"));
    assert(!JSON.stringify(new Settings(process.env.LENS_HOME).redacted()).includes("sk-smoke-1234567890"),
      "redacted settings expose the key");
    // An endpoint lists its own models, and a provider needs no id typed.
    const d = await client.discoverModels({ baseURL: base, apiKey: "sk-smoke-1234567890" });
    assert.deepEqual(d.models.map((m) => m.id), ["m1", "m2"]);
    await assert.rejects(client.discoverModels({ baseURL: base, apiKey: "wrong" }), /401/);
    const auto = await client.saveCustomProvider({ displayName: "Smoke Gateway", baseURL: base, models: d.models });
    assert.equal(auto.id, "smoke-gateway");
    // A built-in service: its key alone makes its whole catalog choosable.
    const k = await client.saveProviderKey("deepseek", "sk-smoke-deepseek");
    assert.equal(client.llmState().provider, "deepseek");
    assert(k.models > 0 && k.model, "no default model for the service");
    assert(await client.removeProviderKey("deepseek"));
    assert.notEqual(client.llmState().provider, "deepseek");
  } finally {
    srv.close();
    if (prev === undefined) delete process.env.LENS_HOME; else process.env.LENS_HOME = prev;
  }
});

console.log();
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
