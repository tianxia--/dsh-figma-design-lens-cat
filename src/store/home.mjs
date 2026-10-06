// Where this tool keeps its data.
//
// One location, used by a checkout and by an installed copy alike: a
// development build writing somewhere else makes every test a test of
// something the user never runs.
//
// LENS_HOME overrides it, which is what the test suite uses to work in a
// temporary directory without touching the real store.
import os from "node:os";
import path from "node:path";

const DIR = ".dsh-figma-design-lens-cat";

/** The data directory. */
export function lensHome() {
  return process.env.LENS_HOME || path.join(os.homedir(), DIR);
}
