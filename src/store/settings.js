// Settings live in the store, not in env vars.
//
// A "default project name" used to live here, which was a design error: project
// membership is decided by the Figma fileKey, so a configured name would file a
// brand-new design (Beacon) under whatever was typed last (Community
// Responder). Naming is not a preference — it is a property of the file.
//
// The token is stored owner-only and never echoed back in full.
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = {
  figmaToken: "",
  runDetectors: true,
  runLlm: false,
  port: 7420,
};

export class Settings {
  constructor(root) {
    this.file = path.join(root, "settings.json");
    fs.mkdirSync(root, { recursive: true });
  }
  read() {
    try {
      const raw = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, "utf8")) };
      delete raw.defaultProject;   // migrate away from the old field
      return raw;
    } catch { return { ...DEFAULTS }; }
  }
  write(patch) {
    const next = { ...this.read(), ...patch };
    delete next.defaultProject;
    fs.writeFileSync(this.file, JSON.stringify(next, null, 1), { mode: 0o600 });
    return next;
  }
  redacted() {
    const s = this.read();
    return { ...s, figmaToken: s.figmaToken
      ? s.figmaToken.slice(0, 4) + "…" + s.figmaToken.slice(-4) : "",
      figmaTokenSet: !!s.figmaToken };
  }
  token() {
    return this.read().figmaToken || process.env.FIGMA_API_KEY || "";
  }
}
