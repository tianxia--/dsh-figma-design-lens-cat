// Regenerate the model-setup screenshots in docs/images (zh and en).
//
// Builds a throwaway store with demo providers, serves the review UI on
// 7431, drives Chrome through CDP and captures each card. Nothing real is
// read or written: demo keys only, temp store, a stand-in Ollama on 11434.
// Run from the repo root on macOS with Chrome installed:
//   node scripts/doc-screenshots.mjs
import { spawn } from "node:child_process"; import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const REPO = process.cwd(), OUT = path.join(REPO, "docs", "images");
const CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = {
  zh: { gateway: "公司网关", ollama: "本地 Ollama" },
  en: { gateway: "Company gateway", ollama: "Local Ollama" },
};
// A stand-in Ollama: lists models at /v1/models, nothing at the gateway path.
const ollama = http.createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ object: "list", data: ["qwen2.5-coder:14b", "deepseek-r1:14b", "llama3.1:8b", "gemma3:12b"].map((id) => ({ id, object: "model" })) }));
  }
  res.writeHead(404, { "content-type": "text/plain" }); res.end("404 page not found");
});
await new Promise((r) => ollama.listen(11434, "127.0.0.1", r));

async function demoState(lang) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lens-doc-" + lang + "-"));
  fs.writeFileSync(path.join(home, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "demo", refresh: "demo", expires: 4102444800000 } }), { mode: 0o600 });
  const env = { ...process.env, LENS_HOME: home };
  const setup = `const c = await import(${JSON.stringify(REPO + "/src/llm/client.mjs")});
    await c.saveProviderKey("deepseek", "sk-demo-0000000000000000");
    await c.saveCustomProvider({ displayName: ${JSON.stringify(T[lang].gateway)}, baseURL: "https://llm.example.com/v1",
      apiKey: "sk-demo-gateway-00000000", models: [{ id: "qwen3-coder-plus" }, { id: "deepseek-v3.2" }, { id: "glm-4.6" }] });
    await c.chooseModel("anthropic", "claude-sonnet-4-5");`;
  await new Promise((res, rej) => spawn(process.execPath, ["--input-type=module", "-e", setup], { env, stdio: "inherit" })
    .on("exit", (code) => code ? rej(new Error("setup failed")) : res()));
  return { home, env };
}

async function cdp(port) {
  let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json(); if (list.some((t) => t.type === "page")) break; } catch {} await sleep(250); }
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let seq = 0; const pending = new Map();
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  return { ws, send, run };
}

async function shoot(c, selector, file, pad = 12) {
  const r = await c.run(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
  const shot = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
    clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale: 1 } });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.result.data, "base64"));
  console.log("  wrote docs/images/" + file + "  (" + Math.round(r.w) + "x" + Math.round(r.h) + ")");
}

for (const lang of ["zh", "en"]) {
  console.log("== " + lang);
  const { home, env } = await demoState(lang);
  const server = spawn(process.execPath, [path.join(REPO, "bin", "design-lens.mjs"), "serve", "--port", "7431"], { env, stdio: "ignore" });
  await sleep(2500);
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
  const chrome = spawn(CH, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=9333", "--user-data-dir=" + ud, "about:blank"], { stdio: "ignore" });
  const c = await cdp(9333);
  await c.send("Page.enable"); await c.send("Runtime.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1400, deviceScaleFactor: 2, mobile: false });
  const go = async () => { await c.send("Page.navigate", { url: "http://127.0.0.1:7431/settings?lang=" + lang }); await sleep(3500);
    await c.run("window.open = () => null"); };
  const sfx = "." + lang + ".png";

  // 1. The whole model card: model picker, subscriptions, other services.
  await go(); await shoot(c, "#llm-card", "models-overview" + sfx);
  // 2. Add a service -> common service, with Kimi chosen and a key typed.
  await c.run("document.getElementById('cp-add').click()"); await sleep(400);
  await c.run("const s=document.getElementById('sv-id'); s.value='moonshotai-cn'; s.dispatchEvent(new Event('change')); document.getElementById('sv-key').value='sk-demo-kimi-0000000000'");
  await sleep(300); await shoot(c, "#cp-form", "models-add-service" + sfx);
  // 3. Other endpoint: a local Ollama, its models fetched.
  await c.run("document.querySelector('.cp-tab[data-tab=url]').click()"); await sleep(300);
  await c.run(`document.getElementById('cp-name').value=${JSON.stringify(T[lang].ollama)}; document.getElementById('cp-url').value='http://localhost:11434/v1'; document.getElementById('cp-fetch').click()`);
  await sleep(2500); console.log("  fetch:", await c.run("document.getElementById('cp-fetch-msg').textContent"));
  await shoot(c, "#cp-form", "models-add-endpoint" + sfx);
  // 4. An endpoint that cannot list its models: the manual box opens.
  await go(); await c.run("document.getElementById('cp-add').click()"); await sleep(400);
  await c.run("document.querySelector('.cp-tab[data-tab=url]').click()"); await sleep(300);
  await c.run(`document.getElementById('cp-name').value=${JSON.stringify(T[lang].gateway)}; document.getElementById('cp-url').value='http://localhost:11434/gateway/v1'; document.getElementById('cp-key').value='sk-demo-0000000000'; document.getElementById('cp-fetch').click()`);
  await sleep(2500);
  await c.run("document.getElementById('cp-models').value='qwen3-coder-plus | Qwen3 Coder Plus\\nglm-4.6'");
  console.log("  manual open:", await c.run("document.getElementById('cp-manual').open"));
  await shoot(c, "#cp-form", "models-add-manual" + sfx);
  // 5. Subscription sign-in: the waiting panel with the fallback link and paste box.
  await go(); await c.run("document.querySelector('#llm-list button[data-a=login][data-p=\"openai-codex\"]').click()");
  await sleep(3000); await shoot(c, "#llm-card", "models-signin" + sfx);
  const sess = await c.run("fetch('/api/llm').then(r=>r.json()).then(s=>s.login&&s.login.id)");
  if (sess) await c.run(`fetch('/api/llm/session/${sess}/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status)`);
  await sleep(800);
  c.ws.close(); chrome.kill(); server.kill(); await sleep(800);
  fs.rmSync(ud, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
}
ollama.close();
