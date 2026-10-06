// On-demand fidelity preview for one screen.
//
// Never started automatically: rendering costs real time (Android compiles a
// Gradle project on first use) and most screens are never previewed. The user
// asks for it, and the three platforms run independently so a slow one does
// not hold back the others -- each tab fills in as its own render lands.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { generate } from "./project.mjs";
import { renderWeb, renderIos, score } from "./run.mjs";
import { generateProject } from "./android.mjs";
import { loadComponents } from "./web.mjs";
import { trustStorePath } from "../env/truststore.mjs";
import { isAuthorised } from "../llm/client.mjs";
import { stalenessNote } from "../ir/staleness.mjs";
import { lensHome } from "../store/home.mjs";

export const PLATFORMS = ["web", "ios", "android"];

function readManifest(latest) {
  return JSON.parse(fs.readFileSync(path.join(latest, "manifest.json"), "utf8"));
}

// Gradle resolves its plugins in the launcher JVM, which does not read
// org.gradle.jvmargs, so the trust store has to ride GRADLE_OPTS as well.
function gradleEnv() {
  const trust = trustStorePath();
  if (!fs.existsSync(trust)) return { ...process.env };
  const opt = `-Djavax.net.ssl.trustStore=${trust} -Djavax.net.ssl.trustStorePassword=changeit`;
  return {
    ...process.env,
    GRADLE_OPTS: (process.env.GRADLE_OPTS ? process.env.GRADLE_OPTS + " " : "") + opt,
  };
}

// The Gradle wrapper is kept in the store so the Android renderer works
// without pointing at a user project: borrowing a wrapper from an app repo
// ties rendering to that repo's Gradle version and plugin set.
export function storeGradlew() {
  const home = process.env.LENS_HOME
    || lensHome();
  return path.join(home, "gradle", "gradlew");
}

function findGradlew() {
  const candidates = [process.env.DESIGN_LENS_GRADLEW, storeGradlew()];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

function renderAndroid(dir, latest, onLog, modelCode) {
  return new Promise((resolve) => {
    const manifest = readManifest(latest);
    const gen = generateProject(dir, manifest, loadComponents(latest), modelCode,
      path.join(latest, "assets"));
    const gradlew = findGradlew();
    if (!gradlew || !fs.existsSync(gradlew)) {
      resolve({ ok: false, error: "no Gradle wrapper configured (set DESIGN_LENS_GRADLEW)" });
      return;
    }
    onLog("compiling the Compose project (first run downloads the toolchain)");
    // Gradle prints the failure on stdout, so a tail is kept for the report.
    // Compiler diagnostics are kept separately: they appear well before the
    // closing summary and scrolled out of a plain tail, leaving "Compilation
    // error. See log for more details" as the entire explanation.
    // When this run began, so a PNG left by an earlier one is not mistaken
    // for its output.
    const startedAt = Date.now();
    const lastLines = [];
    const diagnostics = [];
    const keep = (text) => {
      for (const line of String(text).split("\n")) {
        if (!line.trim()) continue;
        if (/^e: /.test(line) && diagnostics.length < 12) diagnostics.push(line);
        lastLines.push(line);
        if (lastLines.length > 40) lastLines.shift();
      }
    };
    const child = execFile(gradlew, [
      "-p", dir, ":screen:testDebugUnitTest",
      "-Proborazzi.test.record=true", "--console=plain",
      // The sources are rewritten every run but Gradle sees the same inputs
      // and skips the test, leaving the previous PNG in place and reporting
      // a stale render as the new result.
      "--rerun-tasks",
    ], { env: gradleEnv(), maxBuffer: 32 * 1024 * 1024, timeout: 1800000 },
    (err) => {
      if (err && !fs.existsSync(gen.png)) {
        // err.message is only the command line plus a JVM warning, which
        // explains nothing; the tail of Gradle's own output does.
        // A compiler diagnostic says what to fix; the Gradle summary does not.
        const detail = diagnostics.length
          ? diagnostics.join("\n")
          : (lastLines.join("\n") || String(err.message)).trim();
        resolve({ ok: false, error: detail.slice(0, 600) });
        return;
      }
      // Existence is not success. A failed compile leaves the previous PNG
      // in place, and reporting that as the new render hid a broken Android
      // build across three runs: the score sat unchanged at 51 while nothing
      // said the build had failed.
      const fresh = fs.existsSync(gen.png)
        && fs.statSync(gen.png).mtimeMs >= startedAt;
      if (!fresh) {
        resolve({ ok: false, error: fs.existsSync(gen.png)
          ? "the build produced no new image; the previous one is still in place"
            + (diagnostics.length ? "\n" + diagnostics.join("\n") : "")
          : "no image was produced" });
        return;
      }
      resolve({ ok: true, png: gen.png });
    });
    child.stdout?.on("data", (d) => {
      keep(d);
      const line = String(d).trim().split("\n").pop();
      if (line && /Task |BUILD|Download/.test(line)) onLog(line.slice(0, 120));
    });
    child.stderr?.on("data", keep);
  });
}

// One platform's run. Resolves rather than rejects so a failing platform
// reports its own error in its own tab instead of cancelling the others.
async function runPlatform(platform, latest, projectDir, screenId, emit, opts = {}) {
  const started = Date.now();
  emit({ platform, phase: "start" });

  // An analysis made before the paint list existed leaves the renderer with
  // nothing to draw from, and the result reads as a broken tool rather than
  // stale data: one screen scored 4.5 until it was re-analysed, then 71.1.
  const note = stalenessNote(latest, screenId);
  if (note) emit({ platform, phase: "log", line: note });
  try {
    let out;
    // Why the model could not be used, if it could not. Declared here rather
    // than inside the Android branch: the web and iOS paths set and read it
    // too, and having it scoped to one branch made them throw on every run.
    let fellBack = null;

    if (platform === "android") {
      const dir = path.join(projectDir, "render", "android", screenId);
      fs.mkdirSync(dir, { recursive: true });
      let modelCode = null;
      if (opts.llm !== false && isAuthorised(opts.provider || "anthropic")) {
        emit({ platform, phase: "log", line: "asking the model for an implementation" });
        try {
          const { generate: gen } = await import("./codegen.mjs");
          const r = await gen({
            latest, target: "android",
            provider: opts.provider || "anthropic",
            model: opts.model || "claude-sonnet-4-5",
            signal: opts.signal,
          });
          if (r.code && r.code.length > 40) modelCode = r.code;
          // Falling back silently made a template render look like a model
          // one; say so, because the two produce very different results.
          else emit({ platform, phase: "log",
            line: "model returned no usable code; using the template" });
        } catch (e) {
          // Kept for the manifest: a benchmark that silently scores the
          // template reads as a regression in the model, and the log line
          // alone is gone by the time anyone looks at the numbers.
          fellBack = String(e.message).slice(0, 200);
          emit({ platform, phase: "log",
            line: "model generation failed: " + fellBack.slice(0, 120) });
        }
      }
      out = await renderAndroid(dir, latest,
        (line) => emit({ platform, phase: "log", line }), modelCode);
      if (out.ok) { out.dir = dir; out.by = modelCode ? "model" : "template"; }
    } else {
      const llm = opts.llm !== false && isAuthorised(opts.provider || "anthropic");
      if (llm) emit({ platform, phase: "log", line: "asking the model for an implementation" });
      const gen = await generate(platform, latest, projectDir, screenId, {
        llm,
        provider: opts.provider,
        model: opts.model,
        onLog: (line) => emit({ platform, phase: "log", line }),
      });
      emit({ platform, phase: "log", line: "rendering (" + (gen.by || "template") + ")" });
      const r = platform === "web" ? renderWeb(gen, latest) : renderIos(gen);
      out = { ...r, dir: gen.dir, png: gen.png, by: gen.by };
      // generate() reports why it could not use the model; without this the
      // manifest says "template" and nothing says why.
      if (gen.fellBackBecause) fellBack = gen.fellBackBecause;
    }

    if (!out.ok) {
      emit({ platform, phase: "failed", error: out.error });
      return { platform, ok: false, error: out.error, ms: Date.now() - started };
    }

    emit({ platform, phase: "log", line: "scoring against the design" });
    const dir = out.dir;
    const s = score(latest, out.png, path.join(dir, "fidelity.json"));
    if (!s.ok) {
      emit({ platform, phase: "failed", error: s.error });
      return { platform, ok: false, error: s.error, ms: Date.now() - started };
    }

    // A missing design font caps what any implementation can score on text,
    // so the gap is reported alongside the result rather than left to look
    // like a defect in the generated code.
    let fonts = [];
    try {
      const { auditFonts } = await import("./fonts.mjs");
      const paint = JSON.parse(
        fs.readFileSync(path.join(latest, "raw", "paint.json"), "utf8"));
      fonts = auditFonts(paint.items).filter((f) => !f.present);
    } catch { /* paint list absent on older analyses */ }

    // What the conversion could not reproduce, counted by kind. A render that
    // is 75% accurate is only trustworthy if the user can see which quarter
    // to check, and counting across screens ranks the backlog instead of
    // leaving it to be found one render at a time.
    let losses = [];
    try {
      const bgFile = path.join(latest, "raw", "bg-assets.json");
      if (fs.existsSync(bgFile)) {
        const groups = JSON.parse(fs.readFileSync(bgFile, "utf8")).groups || [];
        const byKind = new Map();
        for (const g of groups) {
          const k = g.kind || "exported";
          byKind.set(k, (byKind.get(k) || 0) + 1);
        }
        losses = [...byKind].map(([kind, count]) => ({ kind, count }))
          .sort((a, b) => b.count - a.count);
      }
    } catch { /* an older analysis has no kinds */ }

    // Which generator produced this render is written beside it. The template
    // also draws boxes and text, so a run that silently fell back to it looks
    // merely inaccurate rather than unauthorised: a whole benchmark was
    // recorded as a baseline that way, with no trace of why it scored 17%.
    try {
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
        generator: out.by || "template",
        ...(fellBack ? { fellBackBecause: fellBack } : {}),
        at: new Date().toISOString(),
        ms: Date.now() - started,
      }, null, 1));
    } catch { /* the score still stands without it */ }

    const res = {
      platform, ok: true, dir, png: out.png,
      fidelity: s.result, ms: Date.now() - started,
      missingFonts: fonts, losses, by: out.by || "template",
      // Carried into the result so a score can be read with the caveat
      // attached, rather than only appearing in a log line.
      stale: note || null,
    };
    emit({ platform, phase: "done", fidelity: s.result, ms: res.ms,
      missingFonts: fonts, losses });
    return res;
  } catch (e) {
    const error = String(e.message || e).slice(0, 300);
    emit({ platform, phase: "failed", error });
    return { platform, ok: false, error, ms: Date.now() - started };
  }
}

// Start every platform at once and report each as it lands. The returned
// promise settles when all of them have, but subscribers see partial results
// long before that.
export function startPreview(opts) {
  const { latest, projectDir, screenId, platforms = PLATFORMS, emit = () => {} } = opts;
  const results = {};
  const runs = platforms.map((p) =>
    runPlatform(p, latest, projectDir, screenId, emit, opts)
      .then((r) => { results[r.platform] = r; return r; }));
  return { results, done: Promise.all(runs) };
}

