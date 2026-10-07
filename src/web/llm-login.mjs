// Model sign-in and package install, driven from the web Settings page.
//
// The OAuth flows run inside the server process: each one listens on a fixed
// local port for the browser's redirect (Claude 53692, Codex 1455), and the
// browser the user signs in with is on the same machine. The page only needs
// the authorisation URL, and -- as a fallback when the redirect cannot reach
// this machine -- a box to paste the code into. Both travel through a small
// session object the page polls.
//
// One login at a time: two flows for the same provider would fight over its
// port, and an abandoned flow is cancelled rather than left holding it.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { login, chooseProvider, sdkInstalled } from "../llm/client.mjs";

// The providers offered on the page. The CLI also knows GitHub Copilot.
export const WEB_PROVIDERS = ["anthropic", "openai-codex"];

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const sessions = new Map();
let seq = 0;

const newId = (kind) => kind + "-" + (++seq) + "-" + Date.now().toString(36);
const push = (s, line) => {
  s.log.push(String(line).slice(0, 300));
  if (s.log.length > 40) s.log.shift();
};

/** What the page sees; never the credential, never the resolver functions. */
export function view(s) {
  if (!s) return null;
  return {
    id: s.id, kind: s.kind, provider: s.provider || null, status: s.status,
    authUrl: s.authUrl || null,
    prompt: s.prompt ? { message: s.prompt.message, placeholder: s.prompt.placeholder } : null,
    log: s.log.slice(-12), error: s.error || null,
    model: s.chosen ? s.chosen.model : null,
  };
}

export function get(id) { return sessions.get(id) || null; }

/** The login or install still in progress, so a reloaded page can resume it. */
export function running(kind) {
  for (const s of sessions.values()) if (s.kind === kind && s.status === "running") return s;
  return null;
}

export function startLogin(provider) {
  if (!WEB_PROVIDERS.includes(provider)) throw new Error("unsupported provider: " + provider);
  if (!sdkInstalled()) throw new Error("the LLM package is not installed");
  const prev = running("login");
  if (prev && prev.provider === provider) return prev;
  if (prev) cancel(prev.id, "replaced by a new sign-in");

  const s = { id: newId("login"), kind: "login", provider, status: "running",
    authUrl: null, prompt: null, log: [], error: null, ac: new AbortController() };
  sessions.set(s.id, s);

  login(provider, {
    signal: s.ac.signal,
    notify: (e) => {
      if (e.type === "auth_url") { s.authUrl = e.url; push(s, "authorisation page ready"); }
      else if (e.type === "device_code") push(s, "code " + e.userCode + " at " + e.verificationUri);
      else if (e.message) push(s, e.message);
    },
    prompt: (p) => {
      // Codex asks how to sign in. The page is a browser on this machine,
      // so browser login is the right answer and asking would only add a step.
      if (p.type === "select" && Array.isArray(p.options) && p.options.length) {
        const browser = p.options.find((o) => /browser/i.test(o.id + " " + o.label)) || p.options[0];
        return Promise.resolve(browser.id);
      }
      // The paste box. It races the redirect: when the redirect wins, the
      // flow aborts this prompt through its signal and the box disappears.
      //
      // It must also end when the whole sign-in is cancelled. The flow
      // closes its callback server only after this prompt settles; a prompt
      // that waited for its own signal alone never settled on cancel, the
      // flow never reached its cleanup, and the port stayed bound, so the
      // next sign-in failed with EADDRINUSE.
      return new Promise((resolve, reject) => {
        const pr = { message: p.message, placeholder: p.placeholder || "", resolve, reject };
        s.prompt = pr;
        const signals = [p.signal, s.ac.signal].filter(Boolean);
        const onAbort = () => {
          if (s.prompt === pr) s.prompt = null;
          const fired = signals.find((x) => x.aborted);
          reject((fired && fired.reason) || new Error("aborted"));
        };
        for (const sig of signals) {
          if (sig.aborted) return onAbort();
          sig.addEventListener("abort", onAbort, { once: true });
        }
      });
    },
  }).then(() => {
    s.chosen = chooseProvider(provider);
    s.status = "done";
    push(s, "signed in; renders will use " + s.chosen.provider + " / " + s.chosen.model);
  }).catch((e) => {
    s.status = s.ac.signal.aborted ? "cancelled" : "failed";
    s.error = s.cancelReason || String((e && e.message) || e).slice(0, 300);
  }).finally(() => {
    s.prompt = null;
    clearTimeout(s.timer);
  });

  s.timer = setTimeout(() => {
    if (s.status === "running") cancel(s.id, "timed out after 10 minutes");
  }, LOGIN_TIMEOUT_MS);
  if (s.timer.unref) s.timer.unref();
  return s;
}

/** The pasted authorisation code or redirect URL. */
export function answer(id, value) {
  const s = sessions.get(id);
  if (!s || !s.prompt) return false;
  const pr = s.prompt;
  s.prompt = null;
  pr.resolve(String(value || "").trim());
  return true;
}

export function cancel(id, reason = "cancelled") {
  const s = sessions.get(id);
  if (!s || s.status !== "running") return false;
  s.cancelReason = reason;
  s.ac.abort(new Error(reason));
  return true;
}

/**
 * Install the optional package into this checkout. npm is looked up beside
 * the running node first: a server started by launchd has a bare PATH.
 */
export function startInstall(pkgRoot) {
  const prev = running("install");
  if (prev) return prev;
  const s = { id: newId("install"), kind: "install", status: "running", log: [], error: null };
  sessions.set(s.id, s);

  const win = process.platform === "win32";
  const beside = path.join(path.dirname(process.execPath), win ? "npm.cmd" : "npm");
  const npm = fs.existsSync(beside) ? beside : (win ? "npm.cmd" : "npm");
  push(s, "npm install --include=optional  (in " + pkgRoot + ")");
  let child;
  try {
    child = spawn(npm, ["install", "--include=optional"], { cwd: pkgRoot, env: process.env });
  } catch (e) {
    s.status = "failed"; s.error = String(e.message || e);
    return s;
  }
  const feed = (d) => String(d).split("\n").map((l) => l.trim())
    .filter((l) => l && !/NODE_TLS_REJECT_UNAUTHORIZED|trace-warnings/.test(l))
    .forEach((l) => push(s, l));
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  child.on("error", (e) => { s.status = "failed"; s.error = String(e.message || e); });
  child.on("close", (code) => {
    if (s.status !== "running") return;
    if (sdkInstalled()) { s.status = "done"; push(s, "installed"); }
    else {
      s.status = "failed";
      s.error = "npm exited with " + code + "; run by hand: cd " + pkgRoot + " && npm install --include=optional";
    }
  });
  return s;
}
