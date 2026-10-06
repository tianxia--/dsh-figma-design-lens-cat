// Where this tool keeps its data.
//
// The package was renamed, and the directory name followed it. That would
// have orphaned every existing store -- 3 GB of analyses and the saved
// logins -- so the old location is still used when it is the one that exists.
//
// New installs get the new name; existing ones keep working untouched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CURRENT = ".dsh-figma-design-lens-cat";
const PREVIOUS = ".design-lens-cat";

let resolved = null;

/** The data directory, preferring an existing store over a new name. */
export function lensHome() {
  if (process.env.LENS_HOME) return process.env.LENS_HOME;
  if (resolved) return resolved;
  const home = os.homedir();
  const current = path.join(home, CURRENT);
  const previous = path.join(home, PREVIOUS);
  // Only fall back when the old one exists and the new one does not: once
  // both are present the new one is authoritative, so a half-migrated
  // machine does not silently split its data across two places.
  resolved = (!fs.existsSync(current) && fs.existsSync(previous))
    ? previous : current;
  return resolved;
}
