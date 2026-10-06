// Generate a standalone Compose render project.
//
// Every version here was pinned by running the build, not by reading docs:
// Roborazzi 1.74.0 is compiled against Kotlin 2.3, which in turn needs
// Compose 1.9.x -- pairing it with 1.7.x compiles but dies at run time with
// NoSuchMethodError on Composer.shouldExecute. Robolectric only draws for
// real under an explicit recent sdk, and silently produces a blank image
// otherwise, so the sdk is pinned too.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { trustStorePath } from "../env/truststore.mjs";
import { canvasColour, composeColour } from "./canvas.mjs";
import { loadBackgrounds } from "./web.mjs";

export const VERSIONS = {
  agp: "8.13.2",
  kotlin: "2.3.21",
  roborazzi: "1.74.0",
  compose: "1.9.5",
  material3: "1.4.0",
  robolectric: "4.14.1",
  sdk: 34,
  compileSdk: 35,
};

function hexToCompose(hex) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length < 6) return null;
  return "0xFF" + h.slice(0, 6).toUpperCase();
}

function weight(w) {
  const n = Number(w) || 400;
  if (n >= 700) return "FontWeight.Bold";
  if (n >= 600) return "FontWeight.SemiBold";
  if (n >= 500) return "FontWeight.Medium";
  if (n <= 300) return "FontWeight.Light";
  return "FontWeight.Normal";
}

function kstr(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    .replace(/\n/g, "\\n").replace(/\$/g, "\\$");
}

function composeBody(comps) {
  return comps.map((c) => {
    const m = c.measured, b = m.box, f = m.font || {};
    const off = `.offset(x = ${b.x}.dp, y = ${b.y}.dp).size(${b.w}.dp, ${b.h}.dp)`;
    if (m.text) {
      const col = hexToCompose(f.color) || "0xFFFFFFFF";
      const align = String(f.align || "LEFT").toUpperCase();
      const ta = align === "CENTER" ? "TextAlign.Center"
        : align === "RIGHT" ? "TextAlign.End" : "TextAlign.Start";
      return `      Text(
        text = "${kstr(m.text)}",
        color = Color(${col}),
        fontSize = ${f.size || 14}.sp,
        fontWeight = ${weight(f.weight)},
        textAlign = ${ta},
        modifier = Modifier${off}
      )`;
    }
    const base = hexToCompose(m.fill);
    if (!base) return null;
    // hexToCompose yields "0xFFRRGGBB" and line 77 wraps it in Color(...), so
    // only the alpha byte is swapped here. Emitting "Color(0x.." produced
    // Color(Color(0xCC)) and failed compilation for the whole screen.
    const fill = (m.fillOpacity != null && m.fillOpacity < 1)
      ? "0x" + Math.round(m.fillOpacity * 255).toString(16).padStart(2, "0").toUpperCase()
        + base.slice(4)
      : base;
    const shape = m.radius
      ? `.clip(RoundedCornerShape(${m.radius}.dp))` : "";
    return `      Box(Modifier${off}${shape}.background(Color(${fill})))`;
  }).filter(Boolean).join("\n");
}

// When the model supplies a composable the harness calls it instead of the
// generated body: the test file owns capture, the model owns the screen.
// Kotlin rejects a file that imports the same name twice, so the model's
// imports are merged with the harness's rather than appended after them.
function splitKotlin(code) {
  const imports = [];
  const rest = [];
  for (const line of String(code).split("\n")) {
    const t = line.trim();
    if (t.startsWith("import ")) imports.push(t);
    else if (t.startsWith("package ")) continue;
    else rest.push(line);
  }
  return { imports, body: rest.join("\n").trim() };
}

export function renderTest(manifest, comps, modelCode, latest, drawables) {
  const size = manifest?.screen?.size || { w: 390, h: 844 };
  const model = modelCode ? splitKotlin(modelCode) : null;
  // The template backdrop was white regardless of the design, which hides a
  // translucent card completely; the colour is sampled from the render.
  const backdrop = composeColour(latest ? canvasColour(latest) : null);
  // Exported artwork carries every icon and illustration. The template drew
  // only boxes and text, so a warning triangle rebuilt as a plain red dot
  // while web and iOS placed the real shape.
  const art = (drawables || []).map((d) => {
    const g = d.group || {};
    const box = g.box || {};
    const size = g.rendered || { w: box.w, h: box.h };
    const x = Math.round((box.x + ((box.w || 0) - size.w) / 2) * 100) / 100;
    const y = Math.round((box.y + ((box.h || 0) - size.h) / 2) * 100) / 100;
    return "        Image(painter = painterResource(id = R.drawable." + d.id + "),"
      + " contentDescription = null,"
      + " modifier = Modifier.offset(x = " + x + ".dp, y = " + y + ".dp)"
      + ".size(" + size.w + ".dp, " + size.h + ".dp))";
  }).join("\n");

  const body = model
    ? "      GeneratedScreen()"
    : "      Box(Modifier.fillMaxSize().background(" + backdrop + ")) {\n"
      + (art ? art + "\n" : "") + composeBody(comps) + "\n      }";

  const harnessImports = [
    "androidx.compose.foundation.Image",
    "androidx.compose.ui.res.painterResource",
    "androidx.compose.foundation.background",
    "androidx.compose.foundation.layout.Box",
    "androidx.compose.foundation.layout.fillMaxSize",
    "androidx.compose.foundation.layout.offset",
    "androidx.compose.foundation.layout.size",
    "androidx.compose.foundation.shape.RoundedCornerShape",
    "androidx.compose.material3.Text",
    "androidx.compose.ui.Modifier",
    "androidx.compose.ui.draw.clip",
    "androidx.compose.ui.graphics.Color",
    "androidx.compose.ui.text.font.FontWeight",
    "androidx.compose.ui.text.style.TextAlign",
    "androidx.compose.ui.unit.dp",
    "androidx.compose.ui.unit.sp",
    "com.github.takahirom.roborazzi.ExperimentalRoborazziApi",
    "com.github.takahirom.roborazzi.RoborazziComposeOptions",
    "com.github.takahirom.roborazzi.captureRoboImage",
    "com.github.takahirom.roborazzi.size",
    "org.junit.Test",
    "org.junit.runner.RunWith",
    "org.robolectric.RobolectricTestRunner",
    "org.robolectric.annotation.Config",
    "org.robolectric.annotation.GraphicsMode",
  ].map((i) => "import " + i);

  // The harness only needs its own imports when it draws the fallback body.
  const base = model ? harnessImports.filter((i) => !i.startsWith("import androidx")) : harnessImports;
  const imports = [...new Set([...base, ...(model ? model.imports : [])])].sort().join("\n");
  return `package render

${imports}

// sdk is pinned: under the default Robolectric sdk the native canvas stays
// blank and the test still passes, which looks like a successful render.
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w${size.w}dp-h${size.h}dp-xhdpi", sdk = [${VERSIONS.sdk}])
@OptIn(ExperimentalRoborazziApi::class)
class ScreenRenderTest {
  @Test
  fun render() {
    captureRoboImage(
      // Relative to the Gradle module, so this lands beside the other
      // platforms' output rather than one directory deeper.
      filePath = "../render.png",
      roborazziComposeOptions = RoborazziComposeOptions { size(${size.w}, ${size.h}) },
    ) {
${body}
    }
  }
}
`+ (model ? "\n" + model.body + "\n" : "");
}


// Mirrors are listed before the canonical hosts: on a network that inspects
// TLS the default host may be unreachable from the JVM while a mirror works.
function settingsGradle() {
  return `pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
    maven { url = uri("https://maven.aliyun.com/repository/public") }
  }
}
dependencyResolutionManagement {
  repositories {
    google()
    mavenCentral()
    maven { url = uri("https://maven.aliyun.com/repository/public") }
  }
}
rootProject.name = "dlc-render"
include(":screen")
`;
}

function rootBuild() {
  return `plugins {
  id("com.android.library") version "${VERSIONS.agp}" apply false
  id("org.jetbrains.kotlin.android") version "${VERSIONS.kotlin}" apply false
  id("org.jetbrains.kotlin.plugin.compose") version "${VERSIONS.kotlin}" apply false
  id("io.github.takahirom.roborazzi") version "${VERSIONS.roborazzi}" apply false
}
`;
}

function moduleBuild() {
  return `plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("io.github.takahirom.roborazzi")
}
android {
  namespace = "render"
  compileSdk = ${VERSIONS.compileSdk}
  defaultConfig { minSdk = 24 }
  buildFeatures { compose = true }
  testOptions { unitTests { isIncludeAndroidResources = true } }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}
kotlin {
  compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies {
  implementation("androidx.compose.ui:ui:${VERSIONS.compose}")
  implementation("androidx.compose.foundation:foundation:${VERSIONS.compose}")
  implementation("androidx.compose.material3:material3:${VERSIONS.material3}")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:${VERSIONS.robolectric}")
  testImplementation("io.github.takahirom.roborazzi:roborazzi:${VERSIONS.roborazzi}")
  testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:${VERSIONS.roborazzi}")
}
`;
}

function gradleProperties() {
  const trust = trustStorePath();
  const tls = fs.existsSync(trust)
    ? ` -Djavax.net.ssl.trustStore=${trust} -Djavax.net.ssl.trustStorePassword=changeit`
    : "";
  return `org.gradle.jvmargs=-Xmx3g${tls}
android.useAndroidX=true
org.gradle.parallel=true
org.gradle.caching=true
`;
}

export function generateProject(dir, manifest, comps, modelCode, assetsDir) {
  // assetsDir is <latest>/assets, so its parent is the screen's latest dir.
  const latestDir = assetsDir ? path.dirname(assetsDir) : null;
  const mod = path.join(dir, "screen");
  const testDir = path.join(mod, "src", "test", "java", "render");
  fs.mkdirSync(testDir, { recursive: true });
  fs.mkdirSync(path.join(mod, "src", "main"), { recursive: true });

  // Exported artwork has to live in res/drawable to be reachable as an R id,
  // and the id is the file name: Android resource names allow only lowercase
  // letters, digits and underscore.
  // Each drawable keeps the group it came from, so the template can place it
  // where the design has it rather than only make it available by name.
  const groups = latestDir ? loadBackgrounds(latestDir) : [];
  const byFile = new Map(groups.map((g) => [g.file, g]));
  const drawables = [];
  if (assetsDir && fs.existsSync(assetsDir)) {
    const res = path.join(mod, "src", "main", "res", "drawable");
    fs.mkdirSync(res, { recursive: true });
    for (const f of fs.readdirSync(assetsDir)) {
      if (!/\.(png|jpg|webp)$/i.test(f)) continue;
      const id = f.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]/g, "_");
      fs.copyFileSync(path.join(assetsDir, f), path.join(res, id + path.extname(f).toLowerCase()));
      drawables.push({ file: f, id, group: byFile.get(f) || null });
    }
  }

  fs.writeFileSync(path.join(dir, "settings.gradle.kts"), settingsGradle());
  fs.writeFileSync(path.join(dir, "build.gradle.kts"), rootBuild());
  fs.writeFileSync(path.join(dir, "gradle.properties"), gradleProperties());

  // The Android plugin locates the SDK through local.properties or
  // ANDROID_HOME; a GUI-launched server has neither, so it is written here.
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || path.join(os.homedir(), "Library", "Android", "sdk");
  if (fs.existsSync(sdk)) {
    fs.writeFileSync(path.join(dir, "local.properties"), "sdk.dir=" + sdk + "\n");
  }
  fs.writeFileSync(path.join(mod, "build.gradle.kts"), moduleBuild());
  fs.writeFileSync(path.join(mod, "src", "main", "AndroidManifest.xml"), "<manifest/>\n");
  fs.writeFileSync(path.join(testDir, "ScreenRenderTest.kt"),
    renderTest(manifest, comps, modelCode, latestDir, drawables));
  return { dir, module: mod, png: path.join(dir, "render.png"), drawables };
}

