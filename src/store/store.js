// dsh-figma-design-lens-cat storage: projects -> screens -> versions.
//
// The analysis pipeline produced one flat directory per screen, which is fine
// for one design and unusable for a team: you cannot answer "which screens of
// Acme Rescue have we analysed" or "did this screen change since last
// week". Both questions are the point of the product, so they shape the layout:
//
//   <root>/projects/<project>/screens/<screenId>/versions/<ts>/   immutable
//   <root>/projects/<project>/screens/<screenId>/latest           -> versions/<ts>
//   <root>/projects/<project>/project.json                        index
//   <root>/index.json                                             all projects
//
// Versions are immutable so a re-analysis never destroys the evidence a review
// was based on; "latest" is just a pointer. Ids are slugs of the Figma file key
// and node id, so the same design always lands in the same place.
import fs from "node:fs";
import path from "node:path";

export const slug = (s) => String(s).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export const screenIdOf = (node) => String(node).replace(":", "-");

export class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  projectDir(project) { return path.join(this.root, "projects", slug(project)); }
  screenDir(project, node) {
    return path.join(this.projectDir(project), "screens", screenIdOf(node));
  }
  versionDir(project, node, stamp) {
    return path.join(this.screenDir(project, node), "versions", stamp);
  }
  latestDir(project, node) { return path.join(this.screenDir(project, node), "latest"); }

  /** Allocate a fresh version directory for an analysis run. */
  newVersion(project, node) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = this.versionDir(project, node, stamp);
    fs.mkdirSync(dir, { recursive: true });
    return { stamp, dir };
  }

  /** Point "latest" at a version (copy, not symlink — portable across zips). */
  promote(project, node, stamp) {
    const src = this.versionDir(project, node, stamp);
    const dst = this.latestDir(project, node);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    fs.writeFileSync(path.join(this.screenDir(project, node), "HEAD"), stamp);
    return dst;
  }

  listVersions(project, node) {
    const d = path.join(this.screenDir(project, node), "versions");
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).sort().reverse();
  }

  readManifest(project, node, stamp) {
    const dir = stamp ? this.versionDir(project, node, stamp) : this.latestDir(project, node);
    const f = path.join(dir, "manifest.json");
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  }

  listScreens(project) {
    const d = path.join(this.projectDir(project), "screens");
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((s) => fs.existsSync(path.join(d, s, "latest", "manifest.json")));
  }

  listProjects() {
    const d = path.join(this.root, "projects");
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((p) => fs.existsSync(path.join(d, p, "project.json")));
  }

  /** Rebuild project.json and index.json from what is on disk. */
  reindex() {
    const projects = [];
    for (const p of this.listProjects()) {
      const meta = JSON.parse(fs.readFileSync(path.join(this.projectDir(p), "project.json"), "utf8"));
      const screens = [];
      for (const s of this.listScreens(p)) {
        const m = this.readManifest(p, s.replace("-", ":"));
        if (!m) continue;
        screens.push({
          screenId: s,
          node: m.source.node,
          name: m.screen.name,
          size: m.screen.size,
          platform: m.screen.platform,
          analysedAt: m.source.analysedAt,
          readiness: m.readiness.axes,
          verdict: m.readiness.verdict,
          components: m.counts.components,
          blockers: m.readiness.blockers.length,
          versions: this.listVersions(p, s.replace("-", ":")).length,
        });
      }
      // Averaging must ignore axes that report null, otherwise "not available"
      // silently becomes a zero and drags a project's summary down.
      const avg = (k) => {
        const vals = screens.map((s) => s.readiness[k]).filter((v) => typeof v === "number");
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      };
      const projectIndex = { ...meta, screens,
        summary: {
          screens: screens.length,
          components: screens.reduce((n, s) => n + s.components, 0),
          readiness: { structure: avg("structure"), semantics: avg("semantics"),
            styling: avg("styling"), assets: avg("assets"), interaction: avg("interaction") },
          ready: screens.filter((s) => s.verdict === "ready to build").length,
          needsWork: screens.filter((s) => s.verdict !== "ready to build").length,
        },
        updatedAt: new Date().toISOString() };
      fs.writeFileSync(path.join(this.projectDir(p), "project.json"), JSON.stringify(projectIndex, null, 1));
      projects.push({ id: p, name: meta.name, fileKey: meta.fileKey,
        screens: screens.length, summary: projectIndex.summary, updatedAt: projectIndex.updatedAt });
    }
    const index = { schema: "dsh-figma-design-lens-cat/1", projects, updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.root, "index.json"), JSON.stringify(index, null, 1));
    return index;
  }

  ensureProject(project, meta = {}) {
    const dir = this.projectDir(project);
    fs.mkdirSync(path.join(dir, "screens"), { recursive: true });
    const f = path.join(dir, "project.json");
    if (!fs.existsSync(f)) {
      fs.writeFileSync(f, JSON.stringify({ id: slug(project), name: project,
        fileKey: meta.fileKey || null, createdAt: new Date().toISOString(), screens: [] }, null, 1));
    }
    return dir;
  }
}
