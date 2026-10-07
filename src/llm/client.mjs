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
  return p ? p.model : undefined;
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
  const chosen = s.llmProvider && isAuthorised(s.llmProvider) ? s.llmProvider : null;
  const provider = chosen || (PROVIDERS.find((p) => isAuthorised(p.id)) || {}).id || null;
  if (!provider) {
    return { ready: false, reason: "login", provider: s.llmProvider || null, model: null,
      message: "no model is connected" };
  }
  const model = (s.llmProvider === provider && s.llmModel) || defaultModel(provider);
  return { ready: true, reason: null, provider, model, message: provider + " / " + model };
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
  const sdk = await loadSdk();
  const all = await import("@earendil-works/pi-ai/providers/all");
  const { builtinModels } = all;
  return builtinModels({ credentials: fileCredentialStore(authFile()) });
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
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("unknown provider: " + provider);
  const settings = new Settings(storeDir());
  const s = settings.read();
  const model = (s.llmProvider === provider && s.llmModel) || defaultModel(provider);
  settings.write({ llmProvider: provider, llmModel: model });
  return { provider, model };
}

/**
 * Does a stored login still work? One tiny request with the model renders use.
 * Presence of a credential is not the same as a working one: an expired
 * refresh token sat in the file for days while status said "ok".
 */
export async function checkProvider(provider) {
  if (!isAuthorised(provider)) return { state: "signed-out" };
  const cur = llmState();
  const model = cur.provider === provider && cur.model ? cur.model : defaultModel(provider);
  try {
    await complete({ provider, model, system: "Reply with one word.", prompt: "ok", maxTokens: 5 });
    return { state: "ok", model };
  } catch (e) {
    const detail = String(e.message || e).slice(0, 200);
    return { state: /expired|invalid_grant/i.test(detail) ? "expired" : "error", model, detail };
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
export async function complete({ provider, model, system, prompt, maxTokens = 8000, signal }) {
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

  const text = typeof result === "string" ? result
    : (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("")
      || result?.text || "";
  if (!text.trim()) {
    throw new Error("LLM returned no content (stopReason: "
      + (result?.stopReason || "unknown") + ")");
  }
  return { text, usage: result?.usage || null, stopReason: result?.stopReason || null };
}

