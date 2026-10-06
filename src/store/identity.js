// Project identity is decided by the Figma file, not by what anyone calls it.
//
// Under MCP an AI supplies the project name, and it is an unreliable namer: the
// same design file arrives as "Acme Rescue", then a translated name,
// "CR", producing three projects that each hold a fragment of one design. The
// user then cannot answer "which screens have we analysed".
//
// The link always carries a fileKey, which Figma guarantees is unique per file.
// So:
//   identity   fileKey        machine-owned, never changes
//   title      the file's own name from the Figma API (what the designer chose)
//   aliases    every label a human or model has used, recorded for lookup
//
// Lookup accepts any of them, so a request naming "CR" still lands in the right
// place, and a project can be renamed without splitting its history.
import fs from "node:fs";
import path from "node:path";

export const slugOf = (s) => String(s || "").toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "untitled";

export function parseFigmaUrl(u) {
  const fileKey = (String(u).match(/(?:design|file|board|proto)\/([A-Za-z0-9]{10,})/) || [])[1] || null;
  const raw = (String(u).match(/node-id=([0-9A-Za-z%:-]+)/) || [])[1] || null;
  const node = raw ? decodeURIComponent(raw).replace("-", ":") : null;
  return { fileKey, node };
}

/** Ask Figma what this file is actually called. */
export async function fetchFileTitle(fileKey, token) {
  try {
    const r = await fetch("https://api.figma.com/v1/files/" + fileKey + "?depth=1",
      { headers: { "X-Figma-Token": token } });
    if (!r.ok) return null;
    const j = await r.json();
    return j.name || null;
  } catch { return null; }
}

/** registry.json maps fileKey -> project record; aliases are searchable labels. */
export class Registry {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "registry.json");
    fs.mkdirSync(root, { recursive: true });
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch { return { schema: "dsh-figma-design-lens-cat-registry/1", byFileKey: {} }; }
  }
  write(reg) { fs.writeFileSync(this.file, JSON.stringify(reg, null, 1)); }

  /**
   * Resolve (or create) the project for a file key.
   * @param fileKey  from the link — the identity
   * @param title    the file's real name from Figma, when known
   * @param alias    whatever the caller called it (AI or human), recorded
   */
  resolve(fileKey, { title = null, alias = null } = {}) {
    const reg = this.read();
    let rec = reg.byFileKey[fileKey];
    if (!rec) {
      const name = title || alias || fileKey.slice(0, 8);
      rec = { id: slugOf(name), fileKey, name, title: title || null,
        aliases: [], createdAt: new Date().toISOString() };
      // guard against two different files slugging to the same id
      const taken = new Set(Object.values(reg.byFileKey).map((r) => r.id));
      if (taken.has(rec.id)) rec.id = rec.id + "-" + fileKey.slice(0, 4).toLowerCase();
      reg.byFileKey[fileKey] = rec;
    }
    if (title && !rec.title) { rec.title = title; rec.name = title; }
    for (const a of [alias].filter(Boolean)) {
      if (a !== rec.name && !rec.aliases.includes(a)) rec.aliases.push(a);
    }
    rec.updatedAt = new Date().toISOString();
    this.write(reg);
    return rec;
  }

  /** Find a project by id, name, alias, or file key — callers use any of them. */
  find(label) {
    if (!label) return null;
    const reg = this.read();
    const l = String(label).trim();
    const ls = slugOf(l);
    for (const rec of Object.values(reg.byFileKey)) {
      if (rec.fileKey === l || rec.id === ls || rec.name === l
        || rec.aliases.includes(l) || rec.aliases.map(slugOf).includes(ls)) return rec;
    }
    return null;
  }

  all() { return Object.values(this.read().byFileKey); }
}
