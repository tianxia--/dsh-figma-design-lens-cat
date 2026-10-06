// Build a Java trust store that accepts a TLS-inspecting corporate proxy.
//
// Written next to the store instead of modifying the JDK: editing the system
// cacerts needs root, affects every Java process on the machine and is easy
// to forget about. A file the generated project points at is reversible by
// deleting it.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { lensHome } from "../store/home.mjs";

export function storeDir() {
  return lensHome();
}

export function trustStorePath() {
  return path.join(storeDir(), "truststore.jks");
}

function run(cmd, args, timeout = 60000) {
  return execFileSync(cmd, args, { stdio: "pipe", timeout }).toString();
}

function javaHome() {
  try {
    return run("/usr/libexec/java_home", [], 15000).trim();
  } catch {
    return null;
  }
}

// Certificates a TLS-inspecting proxy presents, taken from the system
// keychain where the corporate MDM installs them.
function exportRoots(pemFile) {
  const names = ["Zscaler", "Netskope", "Blue Coat", "Palo Alto", "Forcepoint", "McAfee"];
  let found = 0;
  const chunks = [];
  for (const n of names) {
    try {
      const pem = run("security",
        ["find-certificate", "-a", "-c", n, "-p", "/Library/Keychains/System.keychain"], 20000);
      const count = (pem.match(/BEGIN CERTIFICATE/g) || []).length;
      if (count) { chunks.push(pem); found += count; }
    } catch { /* absent is normal */ }
  }
  if (!found) return 0;
  fs.writeFileSync(pemFile, chunks.join("\n"));
  return found;
}

export function installProxyRoot() {
  if (process.platform !== "darwin") {
    return { ok: false, error: "only supported on macOS; import the root into the JDK manually" };
  }
  const home = javaHome();
  if (!home) return { ok: false, error: "no JDK found (install one, then re-run)" };

  const src = path.join(home, "lib", "security", "cacerts");
  if (!fs.existsSync(src)) return { ok: false, error: "cannot find the JDK trust store at " + src };

  fs.mkdirSync(storeDir(), { recursive: true });
  const pem = path.join(storeDir(), "proxy-roots.pem");
  const count = exportRoots(pem);
  if (!count) {
    return { ok: false, error: "no interception root found in the system keychain" };
  }

  const out = trustStorePath();
  try {
    fs.copyFileSync(src, out);
    fs.chmodSync(out, 0o644);
    // Each certificate needs its own alias.
    const blocks = fs.readFileSync(pem, "utf8")
      .split(/(?=-----BEGIN CERTIFICATE-----)/).filter((b) => b.includes("BEGIN"));
    blocks.forEach((b, i) => {
      const one = path.join(storeDir(), "root-" + i + ".pem");
      fs.writeFileSync(one, b);
      try {
        run("keytool", ["-importcert", "-noprompt", "-alias", "dlc-proxy-" + i,
          "-file", one, "-keystore", out, "-storepass", "changeit"]);
      } catch { /* duplicate alias is fine */ }
      fs.unlinkSync(one);
    });
    return { ok: true, path: out, certificates: count };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}
