// Figma REST access, self-contained.
//
// Extracted from the host project so this package has no cross-repo imports.
// Two behaviours are preserved because they were learned the hard way:
//   - the token can come from settings, env, or a Claude config, in that order,
//     so a user who configured it in the UI never has to export a shell var
//   - node fetches are cached on disk, because the API is rate limited per file
//     and a 429 can lock a file for hours
import fs from "node:fs";
import path from "node:path";
import { lensHome } from "../store/home.mjs";

export function parseFigmaUrl(u) {
  const fileKey = (String(u).match(/(?:design|file|board|proto)\/([A-Za-z0-9]{10,})/) || [])[1] || null;
  const raw = (String(u).match(/node-id=([0-9A-Za-z%:-]+)/) || [])[1] || null;
  const node = raw ? decodeURIComponent(raw).replace("-", ":") : null;
  return { fileKey, node };
}

export function resolveToken(explicit, lensHome) {
  if (explicit) return explicit;
  const home = lensHome || process.env.LENS_HOME
    || (process.env.HOME ? lensHome() : null);
  if (home) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8"));
      if (s.figmaToken) return s.figmaToken;
    } catch { /* not configured yet */ }
  }
  if (process.env.FIGMA_API_KEY) return process.env.FIGMA_API_KEY;
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  return "";
}

async function call(url, token) {
  const r = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (r.status === 429) {
    const retry = r.headers.get("retry-after");
    throw new Error("Figma rate limit reached" + (retry ? " (retry after " + retry + "s)" : ""));
  }
  if (!r.ok) throw new Error("Figma API " + r.status + ": " + (await r.text()).slice(0, 200));
  return r.json();
}

export async function fetchFileTitle(fileKey, token) {
  try {
    const j = await call("https://api.figma.com/v1/files/" + fileKey + "?depth=1", token);
    return j.name || null;
  } catch { return null; }
}

/** Fetch nodes, caching each one so a rate limit cannot erase earlier work. */
export async function ingestNodes({ token, fileKey, ids, cacheDir }) {
  const raw = path.join(cacheDir, "raw");
  fs.mkdirSync(raw, { recursive: true });
  const out = {};
  const missing = [];
  for (const id of ids) {
    const f = path.join(raw, id.replace(":", "-") + ".json");
    if (fs.existsSync(f)) out[id] = JSON.parse(fs.readFileSync(f, "utf8"));
    else missing.push(id);
  }
  if (missing.length) {
    const data = await call("https://api.figma.com/v1/files/" + fileKey
      + "?ids=" + encodeURIComponent(missing.join(",")), token);
    const walk = (n) => {
      if (missing.includes(n.id)) {
        out[n.id] = n;
        fs.writeFileSync(path.join(raw, n.id.replace(":", "-") + ".json"), JSON.stringify(n));
      }
      for (const c of n.children || []) walk(c);
    };
    walk(data.document);
  }
  return out;
}

export async function renderNode({ token, fileKey, id, dest, scale = 1 }) {
  const j = await call("https://api.figma.com/v1/images/" + fileKey
    + "?ids=" + encodeURIComponent(id) + "&format=png&scale=" + scale, token);
  const link = j.images && j.images[id];
  if (!link) throw new Error("no render returned for " + id);
  const im = await fetch(link);
  fs.writeFileSync(dest, Buffer.from(await im.arrayBuffer()));
  return dest;
}

export async function renderNodes({ token, fileKey, ids, scale = 2 }) {
  return call("https://api.figma.com/v1/images/" + fileKey
    + "?ids=" + encodeURIComponent(ids.join(",")) + "&format=png&scale=" + scale, token);
}
