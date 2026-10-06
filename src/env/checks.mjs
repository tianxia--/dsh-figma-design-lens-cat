// Environment checks for every capability the tool can use.
//
// A check reports what is missing AND how to fix it: a bare "FAIL python3"
// leaves the user to guess, and the fix differs per platform and per tool.
// Capabilities degrade independently -- a missing Android toolchain must not
// stop someone from rendering web.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { lensHome } from "../store/home.mjs";

const MAC = process.platform === "darwin";

function run(cmd, args, timeout = 8000) {
  try {
    return execFileSync(cmd, args, { stdio: "pipe", timeout }).toString().trim();
  } catch {
    return null;
  }
}

function which(bin) {
  const found = run("/usr/bin/which", [bin]);
  return found && fs.existsSync(found) ? found : null;
}

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

function firstExisting(list) {
  return list.find((p) => fs.existsSync(p)) || null;
}

// Each capability lists the checks it needs, so the UI can say
// "web rendering is ready, android needs 2 things".
export const CAPABILITIES = {
  core: { label: "Core analysis", checks: ["node", "figmaToken", "store"] },
  vision: { label: "Vision cross-check", checks: ["python3", "pillow", "numpy"] },
  renderWeb: { label: "Web render", checks: ["chrome"] },
  renderIos: { label: "iOS render", checks: ["macos", "xcode", "swift"] },
  renderAndroid: { label: "Android render", checks: ["java", "androidSdk", "gradleNetwork"] },
};

// A check returns { ok, value, fix?, why?, optional? }.
// fix is a command the user can run or the UI can offer as a button.
export const CHECKS = {
  node: () => {
    const major = Number(process.version.slice(1).split(".")[0]);
    return {
      ok: major >= 20,
      value: process.version,
      fix: "install Node.js 20 or newer from https://nodejs.org",
      why: "the CLI and MCP server run on Node",
    };
  },

  store: () => {
    const home = process.env.LENS_HOME
      || lensHome();
    let writable = false;
    try {
      fs.mkdirSync(home, { recursive: true });
      const probe = path.join(home, ".write-probe");
      fs.writeFileSync(probe, "");
      fs.unlinkSync(probe);
      writable = true;
    } catch { /* reported below */ }
    return {
      ok: writable,
      value: home,
      fix: "check permissions on the store directory, or set LENS_HOME",
      why: "analysis results are written here",
    };
  },

  python3: () => {
    const bin = process.env.DESIGN_LENS_PYTHON || "python3";
    const v = run(bin, ["--version"]);
    return {
      ok: !!v,
      value: v || "not found",
      fix: MAC ? "brew install python3" : "install Python 3 from your package manager",
      why: "raster detection and fidelity scoring run in Python",
    };
  },

  pillow: () => {
    const bin = process.env.DESIGN_LENS_PYTHON || "python3";
    const v = run(bin, ["-c", "import PIL;print(PIL.__version__)"]);
    return {
      ok: !!v,
      value: v ? "Pillow " + v : "missing",
      fix: (process.env.DESIGN_LENS_PYTHON || "python3") + " -m pip install pillow",
      why: "image cropping, overlays and fidelity diffing",
    };
  },

  numpy: () => {
    const bin = process.env.DESIGN_LENS_PYTHON || "python3";
    const v = run(bin, ["-c", "import numpy;print(numpy.__version__)"]);
    return {
      ok: !!v,
      value: v ? "numpy " + v : "missing",
      fix: (process.env.DESIGN_LENS_PYTHON || "python3") + " -m pip install numpy",
      why: "per-component pixel comparison",
    };
  },

  chrome: () => {
    // An override that points nowhere must fail here rather than at render time.
    const override = process.env.DESIGN_LENS_CHROME;
    const p = override
      ? (fs.existsSync(override) ? override : null)
      : (firstExisting(CHROME_PATHS) || which("chromium"));
    return {
      ok: !!p,
      value: p || "not found",
      fix: MAC
        ? "brew install --cask google-chrome  (or set DESIGN_LENS_CHROME)"
        : "install Chrome or Chromium, or set DESIGN_LENS_CHROME",
      why: "renders the generated web page off-screen",
    };
  },

  macos: () => ({
    ok: MAC,
    value: process.platform,
    fix: "iOS rendering needs macOS; use web or android elsewhere",
    why: "SwiftUI can only be rendered on a Mac",
  }),

  xcode: () => {
    const p = run("xcrun", ["--find", "swift"]);
    return {
      ok: !!p,
      value: p || "not found",
      fix: "xcode-select --install   (or install Xcode from the App Store)",
      why: "provides the Swift toolchain used to render SwiftUI",
    };
  },

  swift: () => {
    const v = run("xcrun", ["swift", "--version"], 20000);
    return {
      ok: !!v,
      value: v ? v.split("\n")[0] : "not usable",
      fix: "sudo xcodebuild -license accept, then re-run",
      why: "renders the generated SwiftUI screen to PNG",
    };
  },
};


CHECKS.java = () => {
  const v = run("java", ["-version"], 15000) || run("/usr/bin/java", ["-version"], 15000);
  // java -version prints to stderr, so a null here can still mean present
  let out = v;
  if (!out) {
    try {
      execFileSync("java", ["-version"], { stdio: "pipe", timeout: 15000 });
      out = "present";
    } catch (e) {
      out = e.stderr && e.stderr.toString().includes("version")
        ? e.stderr.toString().split("\n")[0].trim() : null;
    }
  }
  return {
    ok: !!out,
    value: out || "not found",
    fix: MAC ? "brew install --cask temurin@17" : "install a JDK (17 or newer)",
    why: "Gradle needs a JDK to build the Android render project",
  };
};

CHECKS.androidSdk = () => {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || path.join(os.homedir(), "Library", "Android", "sdk");
  const ok = fs.existsSync(path.join(home, "platforms"));
  return {
    ok,
    value: ok ? home : "not found",
    fix: "install Android Studio, or set ANDROID_HOME to an existing SDK",
    why: "supplies the Android platform the renderer compiles against",
  };
};

// Gradle resolves dependencies through the JVM, which uses its own trust
// store rather than the system keychain. Behind a TLS-inspecting proxy the
// JVM rejects the re-signed certificate while curl accepts it, so probing
// with curl reports success and the build then fails anyway. The probe runs
// on the JVM for that reason, and reports the corporate root as a fixable
// condition instead of a mysterious handshake error.
CHECKS.gradleNetwork = () => {
  const probe = "https://repo1.maven.org/maven2/";
  const src = path.join(os.tmpdir(), "dlc-tls-probe.java");
  const body = [
    "import javax.net.ssl.HttpsURLConnection;",
    "import java.net.URL;",
    "public class DlcTlsProbe {",
    "  public static void main(String[] a) throws Exception {",
    "    try {",
    "      HttpsURLConnection c = (HttpsURLConnection) new URL(a[0]).openConnection();",
    "      c.setRequestMethod(\"HEAD\");",
    "      c.setConnectTimeout(15000); c.setReadTimeout(15000);",
    "      System.out.println(\"OK \" + c.getResponseCode());",
    "    } catch (Exception e) {",
    "      System.out.println(\"FAIL \" + e.getMessage());",
    "    }",
    "  }",
    "}",
  ].join("\n");
  let out = null;
  try {
    fs.writeFileSync(src, body);
    out = run("java", [src, probe], 60000);
  } catch { /* reported below */ }

  const ok = !!out && out.includes("OK ");
  const intercepted = !!out && /PKIX|certification path|certificate_unknown/i.test(out);
  return {
    ok,
    value: ok ? "maven reachable from the JVM"
      : intercepted ? "TLS intercepted: the JVM does not trust the proxy root"
      : "maven unreachable (" + (out || "no response") + ")",
    fix: intercepted
      ? "dsh-figma-design-lens-cat env --trust-proxy   (adds the corporate root to a project trust store)"
      : "check network access to repo1.maven.org, or configure a mirror",
    why: "the Android render project downloads its toolchain on first use",
    optional: true,
  };
};

export function runCheck(name) {
  const fn = CHECKS[name];
  if (!fn) return { ok: false, value: "unknown check", fix: null };
  try {
    return fn();
  } catch (e) {
    return { ok: false, value: "check failed: " + e.message.slice(0, 80), fix: null };
  }
}

export function inspect() {
  const results = {};
  for (const name of Object.keys(CHECKS)) results[name] = runCheck(name);

  const capabilities = {};
  for (const [key, cap] of Object.entries(CAPABILITIES)) {
    const missing = cap.checks.filter((c) => results[c] && !results[c].ok);
    const blocking = missing.filter((c) => !results[c].optional);
    capabilities[key] = {
      label: cap.label,
      ready: blocking.length === 0,
      missing,
      checks: cap.checks,
    };
  }
  return { results, capabilities };
}

