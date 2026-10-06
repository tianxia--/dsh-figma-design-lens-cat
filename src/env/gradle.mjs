// Install the Gradle wrapper the Android renderer uses.
//
// The wrapper lives in the store rather than in a user project: the renderer
// must not depend on an app repository, and a wrapper borrowed from one ties
// rendering to that repo's Gradle version.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { lensHome } from "../store/home.mjs";

const GRADLE_VERSION = "8.13";

export function gradleDir() {
  const home = lensHome();
  return path.join(home, "gradle");
}

function findExistingWrapper() {
  // Reuse a wrapper already on this machine before downloading one.
  const roots = [path.join(os.homedir(), "Desktop"), os.homedir()];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const w = path.join(root, e.name, "gradlew");
      const jar = path.join(root, e.name, "gradle", "wrapper", "gradle-wrapper.jar");
      if (fs.existsSync(w) && fs.existsSync(jar)) return path.join(root, e.name);
    }
  }
  return null;
}

export function installWrapper() {
  const dir = gradleDir();
  const target = path.join(dir, "gradlew");
  if (fs.existsSync(target)) return { ok: true, path: target, reused: true };

  const src = findExistingWrapper();
  if (!src) {
    return { ok: false, error: "no Gradle wrapper found to copy; open any Android project once, or set DESIGN_LENS_GRADLEW" };
  }
  try {
    fs.mkdirSync(path.join(dir, "gradle", "wrapper"), { recursive: true });
    fs.copyFileSync(path.join(src, "gradlew"), target);
    fs.chmodSync(target, 0o755);
    for (const f of ["gradle-wrapper.jar", "gradle-wrapper.properties"]) {
      fs.copyFileSync(
        path.join(src, "gradle", "wrapper", f),
        path.join(dir, "gradle", "wrapper", f));
    }
    // Pin the distribution so the renderer does not inherit a project's.
    const props = path.join(dir, "gradle", "wrapper", "gradle-wrapper.properties");
    const text = fs.readFileSync(props, "utf8").replace(
      /distributionUrl=.*/,
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-" + GRADLE_VERSION + "-bin.zip");
    fs.writeFileSync(props, text);
    return { ok: true, path: target, from: src };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}
