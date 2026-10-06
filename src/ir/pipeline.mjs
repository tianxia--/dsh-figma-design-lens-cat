// One command, the whole chain.
//
// Stages are separate processes because the vision work is Python and the rest
// is Node. Each stage reports its own failure rather than the run dying
// silently — an earlier version swallowed stage errors and produced bundles
// that looked complete but were missing exports.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(HERE, "..", "..");
const PY = path.join(PKG_ROOT, "python");
const IR = path.join(PKG_ROOT, "src", "ir");

// "node" resolves to the binary running this process. A bare "node" is looked
// up on PATH, which is not set for a GUI-launched MCP server or a launchd job
// under a version manager, and the stage dies with spawnSync node ENOENT.
export function nodeBin() {
  return process.execPath || "node";
}

function run(cmd, args, env = {}, cwd = PKG_ROOT) {
  const bin = cmd === "node" ? nodeBin() : cmd;
  try {
    return { ok: true, out: execFileSync(bin, args, { cwd, stdio: "pipe",
      env: { ...process.env, ...env } }).toString() };
  } catch (e) {
    return { ok: false, out: (e.stderr ? e.stderr.toString() : e.message).slice(0, 400) };
  }
}

// Pick an interpreter that actually has the imaging stack.
//
// A GUI-launched server inherits a bare PATH where "python3" resolves to the
// system interpreter, which has no numpy, while the one on the user's shell
// PATH does. Resolving by name alone therefore works in a terminal and fails
// under launchd, so candidates are probed and the result cached.
let cachedPython = null;

function pythonCandidates() {
  const fixed = [
    "python3",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
  ];
  // Framework installs keep each minor version in its own directory and the
  // "Current" symlink may point at one without the imaging stack, so every
  // installed version is offered, newest first.
  const framework = "/Library/Frameworks/Python.framework/Versions";
  let versioned = [];
  try {
    versioned = fs.readdirSync(framework)
      .filter((v) => /^\d+\.\d+$/.test(v))
      .sort((a, b) => parseFloat(b) - parseFloat(a))
      .map((v) => framework + "/" + v + "/bin/python3");
  } catch { /* no framework install */ }
  return [...fixed, ...versioned, "/usr/bin/python3"];
}

export function pythonBin() {
  if (process.env.DESIGN_LENS_PYTHON) return process.env.DESIGN_LENS_PYTHON;
  if (cachedPython) return cachedPython;
  for (const bin of pythonCandidates()) {
    try {
      execFileSync(bin, ["-c", "import PIL, numpy"], { stdio: "pipe", timeout: 15000 });
      cachedPython = bin;
      return bin;
    } catch { /* try the next candidate */ }
  }
  // Nothing complete was found; the caller reports the import error.
  cachedPython = "python3";
  return cachedPython;
}

/** Is the optional vision stack available? */
export function detectorsAvailable() {
  const r = run(pythonBin(), ["-c", "import PIL, numpy; print('ok')"]);
  return r.ok;
}

/**
 * @param o {{ url, node, fileKey, workDir, withDetectors }}
 */
export function analyseScreen(o, log = () => {}) {
  const base = o.node.replace(":", "-");
  const A = o.workDir;
  fs.mkdirSync(A, { recursive: true });
  const py = pythonBin();
  const env = { DESIGN_LENS_WORK: A, LENS_HOME: o.lensHome || "" };
  const errors = [];
  const stage = (name, fn) => {
    log("  " + name);
    const r = fn();
    if (!r.ok) errors.push(name + ": " + r.out.split("\n").filter(Boolean).slice(-1)[0]);
    return r;
  };
  // Stage 1 produces the IR every later stage reads. If it fails there is
  // nothing to classify, crop or report, and continuing just buries the real
  // cause under six ENOENT errors. Stop here and say why.
  const first = stage("[1/7] fetch Figma node and build IR", () =>
    run("node", [path.join(IR, "analyze.mjs"), o.url], env));
  if (!first.ok) return { base, workDir: A, errors, aborted: true };

  stage("[2/7] classify components and name them", () =>
    run("node", [path.join(IR, "classify-inventory.mjs"), path.join(A, base + ".inventory.json")], env));

  stage("[3/7] export background image assets", () =>
    run("node", [path.join(IR, "export-assets.mjs"), o.node, o.fileKey], env));

  stage("[4/7] raster content detection", () => {
    const a = run(py, [path.join(PY, "cross-check.py"), path.join(A, base + ".png"),
      path.join(A, base + ".inventory.json"), path.join(A, base + ".cross.json")], env);
    const b = run(py, [path.join(PY, "raster-detect.py"), path.join(A, base + ".png"),
      path.join(A, base + ".ir.json"), path.join(A, base + ".inventory.json"),
      path.join(A, base + ".raster.json")], env);
    return a.ok && b.ok ? a : (a.ok ? b : a);
  });

  if (o.withDetectors) {
    stage("[5/7] independent image-detector cross-check", () => {
      const inv = JSON.parse(fs.readFileSync(path.join(A, base + ".inventory.json"), "utf8"));
      return run(py, [path.join(PY, "run-detectors.py"), path.join(A, base + ".png"),
        String(inv.screen.size.w), String(inv.screen.size.h),
        path.join(A, base + ".detectors.json")],
        { ...env, YOLO_CONFIG_DIR: "/tmp/dsh-figma-design-lens-cat-yolo" });
    });
  } else log("  [5/7] image detectors skipped");

  stage("[6/7] component crops and overlay", () => {
    const a = run(py, [path.join(PY, "crop-components.py"), path.join(A, base + ".png"),
      path.join(A, base + ".inventory.json"), path.join(A, "crops-" + base)], env);
    const b = run(py, [path.join(PY, "overlay.py"), path.join(A, base + ".png"),
      path.join(A, base + ".inventory.json"), path.join(A, base + ".overlay.png")], env);
    const c = run(py, [path.join(PY, "slice-overlay.py"),
      path.join(A, base + ".overlay.png"), path.join(A, base + ".overlay")], env);
    return [a, b, c].find((r) => !r.ok) || a;
  });

  stage("[7/7] generate reports", () =>
    run("node", [path.join(IR, "report.mjs"), o.node, o.url], env));

  return { base, workDir: A, errors };
}

export function packBundle(node, url, workDir, outDir) {
  return run("node", [path.join(IR, "pack.mjs"), node, url, workDir, outDir]);
}
