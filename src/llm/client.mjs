// LLM access, isolated behind one interface.
//
// The package has no runtime dependencies by design, so the SDK is an optional
// dependency and is imported lazily: a user who never turns on code generation
// must not be forced to install it, and its absence is a clear message rather
// than a crash on startup.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { lensHome } from "../store/home.mjs";
import { Settings } from "../store/settings.js";
import { readiness as customReadiness, normalise as normaliseCustom, redact as redactCustom,
  buildProvider as buildCustomProvider } from "./custom.mjs";

export function storeDir() {
  return lensHome();
}

export function authFile() {
  return path.join(storeDir(), "auth.json");
}

export function isAuthorised(provider = "anthropic") {
  try {
    const data = JSON.parse(fs.readFileSync(authFile(), "utf8"));
    return Boolean(data && data[provider]);
  } catch {
    return false;
  }
}

/** Every provider with a stored credential: subscriptions and API-key services. */
function authorisedIds() {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(authFile(), "utf8")) || {});
  } catch {
    return [];
  }
}

// Built-in services that work with nothing but an API key, most asked-for
// first. Each brings its own model catalog, so adding one is choosing it and
// pasting a key. Every other key-only service in the SDK follows these.
const KEY_FIRST = ["deepseek", "moonshotai-cn", "moonshotai", "kimi-coding", "qwen-token-plan-cn",
  "qwen-token-plan", "zai-coding-cn", "zai", "minimax-cn", "minimax", "openai", "google", "openrouter",
  "anthropic", "xai", "groq", "mistral", "together", "fireworks", "huggingface", "nvidia"];
// Services that need more than a key (cloud accounts, deployment names, an
// endpoint per account) or that sign in through a subscription instead.
const KEY_EXCLUDED = new Set(["amazon-bedrock", "azure-openai-responses", "google-vertex",
  "cloudflare-ai-gateway", "cloudflare-workers-ai", "openai-codex", "github-copilot", "radius"]);

// The providers a user can sign in to with a subscription they already have,
// and the model each one generates with unless settings say otherwise.
// Generation used to name anthropic everywhere, so a user signed in to
// Codex or Copilot was treated as signed out and silently got the template.
export const PROVIDERS = [
  { id: "anthropic", label: "Claude (Claude Pro / Max subscription)", model: "claude-sonnet-4-5" },
  { id: "openai-codex", label: "ChatGPT (Plus / Pro subscription, via Codex)", model: "gpt-5.5" },
  { id: "github-copilot", label: "GitHub Copilot", model: "claude-sonnet-4.6" },
];

export function defaultModel(provider) {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (p) return p.model;
  // An API-key service records its default when the key is saved.
  const d = (readSettings().llmDefaults || {})[provider];
  return d || undefined;
}

/** Is the optional SDK on disk? Checked without importing it. */
export function sdkInstalled() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, "node_modules", "@earendil-works", "pi-ai", "package.json"))) {
      return true;
    }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(storeDir(), "settings.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Whether renders can use a model, which one, and if not, why not.
 *
 * One answer for every caller: setup, doctor, the CLI and the renderer all
 * read this, so the reason a render used the template is the same sentence
 * the user was shown when they set the tool up.
 */
export function llmState() {
  const s = readSettings();
  if (!sdkInstalled()) {
    return { ready: false, reason: "sdk", provider: null, model: null,
      message: "the LLM package (@earendil-works/pi-ai) is not installed" };
  }
  const custom = customOf(s);
  // A provider counts only if a model can be named for it: a subscription has
  // a default, a custom provider lists its models, and an API-key service
  // records one when its key is saved.
  const named = (id) => defaultModel(id) || (s.llmProvider === id && s.llmModel);
  const signedIn = authorisedIds();
  // Subscriptions first, then API-key services, then custom providers.
  const usable = [
    ...PROVIDERS.filter((p) => signedIn.includes(p.id)).map((p) => p.id),
    ...signedIn.filter((id) => !PROVIDERS.some((p) => p.id === id) && !custom[id] && named(id)),
    ...Object.keys(custom).filter((id) => customReadiness(custom[id]).ok),
  ];
  const provider = (s.llmProvider && usable.includes(s.llmProvider) ? s.llmProvider : null)
    || usable[0] || null;
  if (!provider) {
    const blocked = Object.entries(custom).map(([id, c]) => [id, customReadiness(c)]).find(([, r]) => !r.ok);
    return { ready: false, reason: "login", provider: s.llmProvider || null, model: null,
      message: blocked ? "no model is connected (" + blocked[0] + ": " + blocked[1].why + ")"
        : "no model is connected" };
  }
  const own = custom[provider];
  // A model chosen for this provider stays chosen. For a custom provider it
  // must still be one it lists; a built-in catalog is checked when chosen.
  const kept = s.llmProvider === provider && s.llmModel
    && (!own || own.models.some((m) => m.id === s.llmModel)) ? s.llmModel : null;
  const model = kept || (own ? own.models[0].id : defaultModel(provider));
  return { ready: true, reason: null, provider, model, custom: Boolean(own),
    message: provider + " / " + model };
}

/** Custom providers from settings, keyed by id. */
function customOf(s) {
  const out = {};
  for (const [id, c] of Object.entries((s && s.llmProviders) || {})) {
    if (c && Array.isArray(c.models) && c.models.length) out[id] = c;
  }
  return out;
}

export function customProviders() {
  return customOf(readSettings());
}

/** Can renders call this provider right now: signed in, or a usable custom one. */
export function providerReady(id) {
  const c = customOf(readSettings())[id];
  if (c) return customReadiness(c).ok;
  return isAuthorised(id);
}

async function loadSdk() {
  try {
    return await import("@earendil-works/pi-ai");
  } catch {
    throw new Error(
      "LLM support needs an optional package that is not installed; run: dsh-figma-design-lens-cat setup");
  }
}

// Credentials live beside the rest of the store rather than in the working
// directory, so one login serves every project on this machine.
//
// The SDK ships an in-memory store and expects the app to supply persistence.
// The contract is read/list/modify/delete, where modify is the only write path
// and must serialise, because OAuth refresh runs inside it and two concurrent
// requests must not rotate the same token twice.
function fileCredentialStore(file) {
  let chain = Promise.resolve();

  const load = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  };
  const save = (data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 });
  };

  return {
    async read(providerId) {
      return load()[providerId];
    },
    async list() {
      // Metadata only: enumeration must never resolve secrets.
      return Object.entries(load()).map(([providerId, c]) => ({
        providerId, type: c && c.type,
      }));
    },
    async modify(providerId, fn) {
      const run = chain.then(async () => {
        const data = load();
        const next = await fn(data[providerId]);
        if (next === undefined) delete data[providerId];
        else data[providerId] = next;
        save(data);
        return next;
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    async delete(providerId) {
      await this.modify(providerId, () => undefined);
    },
  };
}

async function buildModels(sdk) {
  const { createModels } = sdk;
  return createModels({ credentials: fileCredentialStore(authFile()) });
}

// Registering every built-in provider keeps login and generation working for
// whichever subscription the user already has, without a hard-coded choice.
async function models() {
  await loadSdk();
  const all = await import("@earendil-works/pi-ai/providers/all");
  const m = all.builtinModels({ credentials: fileCredentialStore(authFile()) });
  // Custom providers join the catalog, so getModel/complete treat them like
  // any other. One that cannot be built is skipped rather than taking every
  // render down with it; listModelGroups reports why.
  for (const [id, spec] of Object.entries(customProviders())) {
    if (m.getProvider(id)) continue;   // never shadow a built-in provider
    try { m.setProvider(await buildCustomProvider(id, spec)); } catch { /* reported by listModelGroups */ }
  }
  return m;
}

/** Provider ids the SDK's own catalog owns; a custom provider may not reuse one. */
export async function builtinProviderIds() {
  if (!sdkInstalled()) return PROVIDERS.map((p) => p.id);
  const all = await import("@earendil-works/pi-ai/providers/all");
  return all.getBuiltinProviders().map((p) => p.id || p);
}

/**
 * Run the provider's OAuth flow and persist the credential.
 * io.signal cancels it: the flow listens on a fixed local port for the
 * browser's redirect, and a login abandoned without cancelling keeps that
 * port bound, so the next attempt fails until the process exits.
 */
export async function login(provider, io) {
  const m = await models();
  await m.login(provider, "oauth", {
    prompt: async (p) => io.prompt(p),
    notify: (e) => io.notify(e),
    ...(io.signal ? { signal: io.signal } : {}),
  });
  return { ok: true, provider, stored: authFile() };
}

/** Make a provider the one renders use, keeping a model chosen for it before. */
export function chooseProvider(provider) {
  const own = customOf(readSettings())[provider];
  if (!own && !PROVIDERS.some((p) => p.id === provider) && !isAuthorised(provider)) {
    throw new Error("unknown provider: " + provider);
  }
  const settings = new Settings(storeDir());
  const s = settings.read();
  const keep = s.llmProvider === provider && s.llmModel
    && (!own || own.models.some((m) => m.id === s.llmModel));
  const model = keep ? s.llmModel : (own ? own.models[0].id : defaultModel(provider));
  if (!model) throw new Error("choose a model for " + provider + ": dsh-figma-design-lens-cat llm use " + provider + "/<model>");
  settings.write({ llmProvider: provider, llmModel: model });
  return { provider, model };
}

/**
 * Choose the exact model renders use. The provider must be usable and the
 * model one it actually offers: a typo here would otherwise surface only as
 * every render falling back to the template.
 */
export async function chooseModel(provider, model) {
  const { groups } = await listModelGroups();
  const g = groups.find((x) => x.id === provider);
  if (!g) throw new Error("unknown provider: " + provider);
  if (!g.ready) throw new Error(provider + " is not usable: " + (g.why || "not signed in"));
  if (!g.models.some((m) => m.id === model)) {
    throw new Error(provider + " has no model \"" + model + "\"; run: dsh-figma-design-lens-cat llm models");
  }
  new Settings(storeDir()).write({ llmProvider: provider, llmModel: model });
  return { provider, model };
}

/**
 * Every model a render could use, grouped by provider: each signed-in
 * subscription with its whole catalog, then each custom provider.
 * `include` limits the subscriptions listed (the web page shows two).
 */
export async function listModelGroups({ include } = {}) {
  const st = llmState();
  const groups = [];
  let m = null;
  if (sdkInstalled()) { try { m = await models(); } catch { m = null; } }
  for (const p of PROVIDERS) {
    if (include && !include.includes(p.id)) continue;
    const list = m ? m.getModels(p.id) : [];
    groups.push({ id: p.id, label: p.label, kind: "subscription", ready: isAuthorised(p.id),
      ...(isAuthorised(p.id) ? {} : { why: "not signed in" }),
      models: list.map((x) => ({ id: x.id, name: x.name || x.id })) });
  }
  // Built-in services connected with an API key, each with its own catalog.
  const custom = customProviders();
  for (const id of authorisedIds()) {
    if (PROVIDERS.some((p) => p.id === id) || custom[id]) continue;
    const list = m ? m.getModels(id) : [];
    const prov = m && m.getProvider(id);
    groups.push({ id, label: (prov && prov.name) || id, kind: "api-key", ready: true,
      models: list.map((x) => ({ id: x.id, name: x.name || x.id })) });
  }
  for (const [id, spec] of Object.entries(customProviders())) {
    const r = redactCustom(id, spec);
    const registered = m ? m.getModels(id).length > 0 : true;
    groups.push({ id, label: r.displayName, kind: "custom", ready: r.ready && registered,
      ...(r.why ? { why: r.why } : registered ? {} : { why: "could not be registered with the SDK" }),
      api: r.api, baseURL: r.baseURL, models: r.models });
  }
  return { groups, current: st.ready ? { provider: st.provider, model: st.model } : null };
}

/** Add or replace a custom provider. Returns its redacted form. */
export async function saveCustomProvider(input) {
  const settings = new Settings(storeDir());
  const s = settings.read();
  const all = { ...(s.llmProviders || {}) };
  const id = String(input.id || "").trim().toLowerCase()
    || autoId(input, [...Object.keys(all), ...(await builtinProviderIds())]);
  const { spec } = normaliseCustom({ ...input, id }, all[id], await builtinProviderIds());
  all[id] = spec;
  const patch = { llmProviders: all };
  // If the chosen model of this provider no longer exists, fall back to its first.
  if (s.llmProvider === id && !spec.models.some((m) => m.id === s.llmModel)) patch.llmModel = spec.models[0].id;
  settings.write(patch);
  return redactCustom(id, spec);
}

// An id for a provider added without one: from its name, else its host.
// "Acme Gateway" -> acme-gateway; https://llm.matrx.io/v1 -> llm-matrx-io.
// A name with no Latin letters or digits ("公司网关") slugs to nothing, so
// the host is used then too.
function autoId(input, taken) {
  let host = "";
  try { host = new URL(String(input.baseURL || "")).hostname; } catch { /* normalise reports it */ }
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const base = slug(input.displayName) || slug(host) || "custom";
  let id = base, n = 2;
  while (taken.includes(id)) id = base + "-" + n++;
  return id;
}

/**
 * Built-in services that work with only an API key, each with the size of
 * its catalog and whether a key is already saved. Sorted most-used first.
 */
export async function keyServices() {
  if (!sdkInstalled()) return [];
  const all = await import("@earendil-works/pi-ai/providers/all");
  const m = all.builtinModels({});
  const out = [];
  for (const p of m.getProviders()) {
    if (KEY_EXCLUDED.has(p.id) || PROVIDERS.some((x) => x.id === p.id)) continue;
    if (!p.auth || !p.auth.apiKey) continue;
    const n = m.getModels(p.id).length;
    if (!n) continue;
    out.push({ id: p.id, name: p.name || p.id, models: n, added: isAuthorised(p.id) });
  }
  const rank = (id) => (KEY_FIRST.includes(id) ? KEY_FIRST.indexOf(id) : 1000);
  return out.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/**
 * Connect a built-in service with its API key. Its whole catalog becomes
 * choosable, and it becomes the provider renders use, with its first model.
 */
export async function saveProviderKey(provider, key) {
  const k = String(key || "").trim();
  if (!k) throw new Error("enter the API key");
  const svc = (await keyServices()).find((x) => x.id === provider);
  if (!svc) throw new Error(provider + " is not a service that takes an API key");
  await fileCredentialStore(authFile()).modify(provider, async () => ({ type: "api_key", key: k }));
  const all = await import("@earendil-works/pi-ai/providers/all");
  // The default model: the first stable one. Catalogs list previews and
  // experiments too, and Kimi's first entry was a dated preview.
  const catalog = all.builtinModels({}).getModels(provider);
  const first = catalog.find((x) => !/preview|exp|vision/i.test(x.id)) || catalog[0];
  const settings = new Settings(storeDir());
  const defaults = { ...(settings.read().llmDefaults || {}), [provider]: first.id };
  settings.write({ llmDefaults: defaults, llmProvider: provider, llmModel: first.id });
  return { provider, name: svc.name, model: first.id, models: svc.models };
}

/** Forget a service's API key. Subscriptions sign out with logout instead. */
export async function removeProviderKey(provider) {
  if (!isAuthorised(provider)) return false;
  await fileCredentialStore(authFile()).modify(provider, async () => undefined);
  const settings = new Settings(storeDir());
  const s = settings.read();
  const defaults = { ...(s.llmDefaults || {}) };
  delete defaults[provider];
  settings.write({ llmDefaults: defaults,
    ...(s.llmProvider === provider ? { llmProvider: null, llmModel: null } : {}) });
  return true;
}

/**
 * Ask an endpoint which models it serves: GET <baseURL>/models, the listing
 * OpenAI-compatible servers (and Ollama, LM Studio, most gateways) answer,
 * and Anthropic's /v1/models. With an `id`, a blank or masked key falls back
 * to the one saved for that provider, so editing does not need it retyped.
 */
export async function discoverModels({ baseURL, apiKey, apiKeyEnv, api = "openai-completions", id } = {}) {
  const existing = id ? customProviders()[id] : null;
  let base = String(baseURL || (existing && existing.baseURL) || "").trim().replace(/\/+$/, "");
  try { new URL(base); } catch { throw new Error("enter a valid address, e.g. https://api.example.com/v1"); }
  let key = typeof apiKey === "string" && apiKey.trim() && !apiKey.includes("…") ? apiKey.trim() : "";
  if (!key && existing && existing.apiKey) key = existing.apiKey;
  const env = apiKeyEnv || (existing && existing.apiKeyEnv);
  if (!key && env) key = String(process.env[env] || "");

  const anthropic = api === "anthropic-messages";
  const headers = { accept: "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  if (anthropic) { headers["anthropic-version"] = "2023-06-01"; if (key) headers["x-api-key"] = key; }
  const tries = [base + "/models"];
  if (!/\/v1$/.test(base)) tries.push(base + "/v1/models");

  let why = "";
  for (const url of tries) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        why = "HTTP " + r.status + " from " + url + (r.status === 401 || r.status === 403 ? " -- check the API key" : "");
        if (r.status === 401 || r.status === 403) break;
        continue;
      }
      const j = await r.json();
      const list = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : null;
      if (!list) { why = "unrecognised reply from " + url; continue; }
      const seen = new Set();
      const models = [];
      for (const x of list) {
        const mid = String(typeof x === "string" ? x : (x && (x.id || x.model || x.name)) || "").trim();
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);
        const name = x && typeof x === "object" ? String(x.display_name || x.displayName || "").trim() : "";
        models.push({ id: mid, name: name && name !== mid ? name : mid });
      }
      if (!models.length) { why = url + " lists no models"; continue; }
      models.sort((a, b) => a.id.localeCompare(b.id));
      return { models, url };
    } catch (e) {
      why = (e && e.name === "TimeoutError" ? "no reply within 15s from " + url : String((e && e.message) || e)).slice(0, 200);
    }
  }
  throw new Error("could not list the models (" + why + "); enter the model ids by hand instead");
}

export function removeCustomProvider(id) {
  const settings = new Settings(storeDir());
  const s = settings.read();
  const all = { ...(s.llmProviders || {}) };
  if (!all[id]) return false;
  delete all[id];
  const patch = { llmProviders: all };
  if (s.llmProvider === id) { patch.llmProvider = null; patch.llmModel = null; }
  settings.write(patch);
  return true;
}

/** Custom providers in a form safe to show; keys are masked. */
export function listCustomProviders() {
  return Object.entries(customProviders()).map(([id, spec]) => redactCustom(id, spec));
}

/**
 * Does a provider still work? One tiny request, with the given model, the
 * model renders use, or the provider's default -- in that order.
 * Presence of a credential is not the same as a working one: an expired
 * refresh token sat in the file for days while status said "ok".
 */
export async function checkProvider(provider, model, { maxTokens = 256 } = {}) {
  if (!providerReady(provider)) {
    const c = customProviders()[provider];
    return c ? { state: "error", detail: customReadiness(c).why || "not usable" } : { state: "signed-out" };
  }
  const cur = llmState();
  const own = customProviders()[provider];
  const use = model || (cur.provider === provider && cur.model ? cur.model
    : own ? own.models[0].id : defaultModel(provider));
  try {
    // The test asks whether the model replies, judged by what its reply
    // holds: a text block, or a thinking block -- a reasoning model may still
    // be thinking when the small test budget runs out, and that is a reply.
    // Real failures -- network, key, unknown model, quota -- are errors.
    const r = await complete({ provider, model: use, system: "Reply with one word.", prompt: "ok",
      maxTokens, requireText: false });
    if (!r.text.trim() && !r.thinking.trim()) {
      return { state: "error", model: use, detail: "the model replied with no text and no thinking" };
    }
    if (!r.text.trim()) {
      return { state: "ok", model: use, note: "connected; the reply was still in its thinking block" };
    }
    return { state: "ok", model: use };
  } catch (e) {
    const detail = String(e.message || e).slice(0, 200);
    return { state: /expired|invalid_grant/i.test(detail) ? "expired" : "error", model: use, detail };
  }
}

export async function logout(provider) {
  const m = await models();
  await m.logout(provider);
  return { ok: true, provider };
}

export async function listProviders() {
  const m = await models();
  return (m.getProviders ? m.getProviders() : []).map((p) => p.id || p);
}

/**
 * One request, one answer. Code generation is a single transformation, not a
 * conversation, so no tools and no history are involved.
 */
export async function complete({ provider, model, system, prompt, maxTokens = 8000, signal, requireText = true }) {
  const m = await models();
  const target = m.getModel(provider, model);
  if (!target) throw new Error("unknown model: " + provider + "/" + model);

  const result = await m.complete(target, {
    systemPrompt: system,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }, { maxTokens, signal });

  // A provider failure arrives as a normal result carrying stopReason
  // "error", so returning its empty text made an expired login look like a
  // model that simply produced nothing. Every screen then fell back to the
  // template and the benchmark read 17% without saying why.
  if (result && result.stopReason === "error") {
    const detail = String(result.errorMessage || "provider reported an error");
    const expired = /invalid_grant|refresh token/i.test(detail);
    throw new Error(expired
      ? "LLM authorisation expired; run: dsh-figma-design-lens-cat llm login " + provider
      : "LLM call failed: " + detail.slice(0, 300));
  }

  // A reply is a list of typed blocks. Text is the answer; thinking is a
  // reasoning model's working, which was dropped here before, so a model
  // still thinking when its budget ran out read as a model that said nothing.
  const blocks = typeof result === "string" ? [{ type: "text", text: result }] : (result?.content || []);
  const text = blocks.filter((c) => c.type === "text").map((c) => c.text || "").join("")
    || (typeof result === "object" && result?.text) || "";
  const thinking = blocks.filter((c) => c.type === "thinking").map((c) => c.thinking || "").join("");
  const out = { text, thinking, usage: result?.usage || null, stopReason: result?.stopReason || null };
  if (!text.trim() && requireText) {
    throw new Error(thinking.trim()
      ? "the model only got as far as thinking (" + thinking.length + " characters) before stopping ("
        + (result?.stopReason || "unknown") + "); it produced no answer text"
      : "LLM returned no content (stopReason: " + (result?.stopReason || "unknown") + ")");
  }
  return out;
}

