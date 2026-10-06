// Job queue for analysis runs — server-owned, survives navigation.
//
// The first version kept the log only in the page that started the run. A
// person who switched to Projects and came back found an empty chat and
// assumed their analysis had been lost, while it was in fact still running.
// State belongs to the server: the page renders it, never owns it.
//
// History is persisted to disk so a restart does not erase the record of what
// was analysed and whether it succeeded.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

let seq = 0;
const MAX_KEEP = 50;

export class JobQueue extends EventEmitter {
  constructor(root) {
    super();
    this.jobs = new Map();
    this.file = root ? path.join(root, "jobs.json") : null;
    this.load();
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const j of saved) {
        // a job that was running when the process died cannot be resumed
        if (j.status === "running") { j.status = "failed"; j.error = "server restarted; job interrupted"; }
        this.jobs.set(j.id, j);
      }
      seq = Math.max(seq, ...saved.map((j) => Number((j.id.match(/^job-(\d+)/) || [])[1] || 0)));
    } catch { /* corrupt history is not worth failing over */ }
  }

  persist() {
    if (!this.file) return;
    const all = [...this.jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_KEEP);
    try { fs.writeFileSync(this.file, JSON.stringify(all)); } catch { /* best effort */ }
  }

  create(kind, label, meta = {}) {
    const id = "job-" + (++seq) + "-" + Date.now().toString(36);
    const job = { id, kind, label, meta, status: "running", log: [],
      startedAt: Date.now(), finishedAt: null, result: null, error: null };
    this.jobs.set(id, job);
    this.persist();
    return job;
  }

  log(id, line) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.log.push({ t: Date.now(), line: String(line) });
    this.emit("log", { id, line });
  }

  finish(id, result) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.status = "done"; j.result = result; j.finishedAt = Date.now();
    this.persist();
    this.emit("done", j);
  }

  fail(id, error) {
    const j = this.jobs.get(id);
    if (!j) return;
    j.status = "failed"; j.error = String(error); j.finishedAt = Date.now();
    this.persist();
    this.emit("done", j);
  }

  /** Drop finished history, keeping anything still running. */
  clear() {
    for (const [id, j] of this.jobs) if (j.status !== "running") this.jobs.delete(id);
    this.persist();
  }
  get(id) { return this.jobs.get(id) || null; }

  /** Latest preview state for one screen, merged per platform.
   *
   *  Re-rendering a single platform creates a job that knows nothing about
   *  the others, so returning only the newest job would blank the tabs that
   *  were not part of it. Each platform keeps its own most recent result. */
  latestPreview(project, screen) {
    const runs = [...this.jobs.values()]
      .filter((j) => j.kind === "preview"
        && j.meta && j.meta.project === project && j.meta.screen === screen)
      .sort((a, b) => a.startedAt - b.startedAt);
    if (!runs.length) return null;

    const platforms = {};
    for (const j of runs) {
      for (const [name, state] of Object.entries(j.result?.platforms || {})) {
        // A pending slot from a newer job must not replace a real result.
        if (state && state.status === "pending" && platforms[name]) continue;
        platforms[name] = state;
      }
    }
    const newest = runs[runs.length - 1];
    return { id: newest.id, status: newest.status, startedAt: newest.startedAt, platforms };
  }
  running() { return [...this.jobs.values()].filter((j) => j.status === "running"); }

  recent(n = 20) {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, n)
      .map((j) => ({ id: j.id, kind: j.kind, label: j.label, meta: j.meta, status: j.status,
        startedAt: j.startedAt, finishedAt: j.finishedAt,
        lines: j.log.length, error: j.error, result: j.result }));
  }

  /** Full log for restoring a conversation view. */
  transcript(n = 8) {
    return [...this.jobs.values()].sort((a, b) => a.startedAt - b.startedAt).slice(-n)
      .map((j) => ({ id: j.id, label: j.label, meta: j.meta, status: j.status,
        startedAt: j.startedAt, error: j.error, result: j.result,
        log: j.log.map((x) => x.line) }));
  }
}
