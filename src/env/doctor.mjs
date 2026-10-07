// The everyday health check, shared by `doctor` and the web Settings page.
//
// Two copies of this list drifted before: the CLI learned about the model and
// the page did not, so the place a user was most likely to look said nothing
// about why renders came out as a template. One list, two front ends.
import { execFileSync } from "node:child_process";
import { Settings } from "../store/settings.js";
import { lensHome } from "../store/home.mjs";
import { pythonBin, detectorsAvailable } from "../ir/pipeline.mjs";
import { sdkInstalled, llmState } from "../llm/client.mjs";
import { checkInstalled } from "../mcp/install.mjs";

const SETUP = "dsh-figma-design-lens-cat setup";

/**
 * Each check: { id, label, value, ok, optional, fix }.
 * optional checks warn instead of failing: the tool works without them, but
 * the result is worse, and the user should know why.
 */
export function doctorChecks() {
  const home = lensHome();
  const out = [];

  const major = Number(process.version.slice(1).split(".")[0]);
  out.push({ id: "node", label: "node", value: process.version, ok: major >= 20,
    fix: "install Node.js 20 or newer from https://nodejs.org" });

  let pyv = "not found";
  try {
    pyv = execFileSync(pythonBin(), ["--version"], { stdio: "pipe" }).toString().trim();
  } catch { /* reported below */ }
  out.push({ id: "python", label: "python3", value: pyv, ok: pyv !== "not found",
    fix: process.platform === "darwin" ? "brew install python3" : "install Python 3" });

  const vision = detectorsAvailable();
  out.push({ id: "vision", label: "pillow + numpy", value: vision ? "available" : "missing",
    ok: vision, fix: "pip install pillow numpy" });

  let token = "";
  try { token = new Settings(home).token(); } catch { /* store unreadable */ }
  out.push({ id: "figmaToken", label: "figma token", value: token ? "configured" : "missing",
    ok: !!token, fix: SETUP });

  out.push({ id: "store", label: "store", value: home, ok: true });

  // The model is optional, so it warns rather than fails -- but it decides
  // whether a render is the model's code or a template, so it is reported.
  const sdk = sdkInstalled();
  out.push({ id: "llmPackage", label: "llm package", value: sdk ? "installed" : "missing",
    ok: sdk, optional: true, fix: SETUP });
  const st = llmState();
  out.push({ id: "model", label: "model",
    value: st.ready ? st.message : (sdk ? "not connected" : "needs the llm package first"),
    ok: st.ready, optional: true, fix: SETUP });

  // Each agent this server is wired into, and whether that entry will start.
  // Claude Desktop failed for hours with nothing on this side saying so: its
  // entry pointed at a checkout in a folder macOS blocks for that app.
  try {
    for (const c of checkInstalled()) {
      out.push({ id: "mcp:" + c.key, label: "mcp " + c.key, value: c.value, ok: c.ok,
        optional: true, ...(c.fix ? { fix: c.fix } : {}) });
    }
  } catch { /* an unreadable client config is that client's business */ }

  return out;
}

/** true when nothing required is missing; optional checks may still warn. */
export function doctorOk(checks) {
  return checks.every((c) => c.ok || c.optional);
}
