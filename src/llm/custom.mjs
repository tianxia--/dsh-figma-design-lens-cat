// Custom model providers: endpoints the SDK's catalog does not describe.
//
// The shape is the DSH harness's llm-pi-ai route, so a provider declared there
// reads the same here:
//
//   llmProviders: {
//     acme: {
//       displayName: "Acme Gateway",
//       api: "openai-completions",          // or openai-responses, anthropic-messages
//       baseURL: "https://gateway.acme.example/v1",
//       apiKey: "sk-...",                   // stored here, mode 600 ...
//       apiKeyEnv: "ACME_API_KEY",          // ... or read from the environment
//       models: [{ id: "acme-think", name: "Acme Think" }]
//     }
//   }
//
// Neither key field is required: a local server (Ollama, LM Studio) takes
// none. A provider that names an environment variable which is empty is not
// usable, and says so, rather than sending a request that will be refused.

export const PROTOCOLS = ["openai-completions", "openai-responses", "anthropic-messages"];

// The SDK's lazy protocol modules and the factory each one exports.
const FACTORIES = {
  "openai-completions": ["@earendil-works/pi-ai/api/openai-completions.lazy", "openAICompletionsApi"],
  "openai-responses": ["@earendil-works/pi-ai/api/openai-responses.lazy", "openAIResponsesApi"],
  "anthropic-messages": ["@earendil-works/pi-ai/api/anthropic-messages.lazy", "anthropicMessagesApi"],
};

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;
// Endpoints rarely bill through this tool and the SDK needs a number.
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// Some OpenAI-compatible servers take no key, but the client library still
// sends an Authorization header; a placeholder keeps it well-formed.
const KEYLESS = "not-needed";

const MASK = (k) => (k.length > 8 ? k.slice(0, 4) + "…" + k.slice(-4) : "…");

/** The API key a provider resolves to right now, or "" for none. */
export function keyOf(spec) {
  if (spec.apiKey) return spec.apiKey;
  if (spec.apiKeyEnv) return String(process.env[spec.apiKeyEnv] || "");
  return "";
}

/**
 * Whether the provider can be called, and if not, why.
 * @returns {{ ok: boolean, why?: string, source: string }}
 */
export function readiness(spec) {
  if (spec.apiKey) return { ok: true, source: "saved key" };
  if (spec.apiKeyEnv) {
    return process.env[spec.apiKeyEnv]
      ? { ok: true, source: "$" + spec.apiKeyEnv }
      : { ok: false, why: "environment variable " + spec.apiKeyEnv + " is not set", source: "$" + spec.apiKeyEnv };
  }
  return { ok: true, source: "no key" };
}

/** A spec safe to show: the key is masked, never returned. */
export function redact(id, spec) {
  const r = readiness(spec);
  return {
    id, displayName: spec.displayName || id, api: spec.api, baseURL: spec.baseURL,
    apiKeyEnv: spec.apiKeyEnv || null,
    apiKeySet: Boolean(spec.apiKey),
    apiKey: spec.apiKey ? MASK(spec.apiKey) : null,
    models: (spec.models || []).map((m) => ({ id: m.id, name: m.name || m.id })),
    ready: r.ok, keySource: r.source, ...(r.why ? { why: r.why } : {}),
  };
}

/**
 * Validate and normalise one provider from user input.
 * A blank or masked apiKey keeps the one already saved, so editing a provider
 * does not require typing the key again. `builtinIds` are names the SDK's
 * catalog already owns; reusing one would replace that provider.
 * @throws Error with a message fit to show the user.
 */
export function normalise(input, existing, builtinIds = []) {
  const bad = (msg) => { throw new Error(msg); };
  const id = String(input.id || "").trim().toLowerCase();
  if (!ID.test(id)) bad("id must be lowercase letters, digits and dashes, starting with a letter or digit");
  if (builtinIds.includes(id)) bad("\"" + id + "\" is a built-in provider; choose another id");

  const api = String(input.api || "openai-completions");
  if (!PROTOCOLS.includes(api)) bad("api must be one of " + PROTOCOLS.join(", "));

  const baseURL = String(input.baseURL || "").trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(baseURL); } catch { bad("baseURL is not a valid URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") bad("baseURL must start with http:// or https://");

  const typed = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const apiKey = typed && !typed.includes("…") ? typed : (input.clearApiKey ? "" : (existing && existing.apiKey) || "");
  const apiKeyEnv = String(input.apiKeyEnv || "").trim();
  if (apiKeyEnv && !ENV.test(apiKeyEnv)) bad("apiKeyEnv must be an environment variable name");

  const raw = Array.isArray(input.models) ? input.models : [];
  const models = [];
  for (const m of raw) {
    const mid = String((m && m.id) || "").trim();
    if (!mid) continue;
    if (models.some((x) => x.id === mid)) bad("model \"" + mid + "\" is listed twice");
    const entry = { id: mid, name: String((m && m.name) || "").trim() || mid };
    for (const k of ["contextWindow", "maxTokens"]) {
      if (m && m[k] != null && m[k] !== "") {
        const n = Number(m[k]);
        if (!Number.isInteger(n) || n <= 0) bad("model \"" + mid + "\" " + k + " must be a positive whole number");
        entry[k] = n;
      }
    }
    models.push(entry);
  }
  if (!models.length) bad("add at least one model id");

  const spec = { displayName: String(input.displayName || "").trim() || id, api, baseURL, models };
  if (apiKey) spec.apiKey = apiKey;
  if (apiKeyEnv) spec.apiKeyEnv = apiKeyEnv;
  return { id, spec };
}

/** Parse "id" or "id=Display name" from the CLI into a model entry. */
export function parseModelArg(s) {
  const i = s.indexOf("=");
  return i < 0 ? { id: s.trim() } : { id: s.slice(0, i).trim(), name: s.slice(i + 1).trim() };
}

/** The SDK provider for one custom spec. Imports the SDK lazily. */
export async function buildProvider(id, spec) {
  const [mod, name] = FACTORIES[spec.api] || [];
  if (!mod) throw new Error("provider " + id + " names unsupported api " + spec.api);
  const { createProvider } = await import("@earendil-works/pi-ai");
  const factory = (await import(mod))[name];
  const models = spec.models.map((m) => ({
    id: m.id, name: m.name || m.id, api: spec.api, provider: id, baseUrl: spec.baseURL,
    reasoning: false, input: ["text"], cost: ZERO_COST,
    contextWindow: m.contextWindow || DEFAULT_CONTEXT_WINDOW,
    maxTokens: m.maxTokens || DEFAULT_MAX_TOKENS,
  }));
  return createProvider({
    id, name: spec.displayName || id, baseUrl: spec.baseURL, models, api: factory(),
    auth: {
      apiKey: {
        name: (spec.displayName || id) + " API key",
        // Read at request time, so a key saved or an environment variable set
        // after the server started is used by the next render.
        resolve: async () => {
          const r = readiness(spec);
          if (!r.ok) return undefined;
          return { auth: { apiKey: keyOf(spec) || KEYLESS }, source: r.source };
        },
      },
    },
  });
}
