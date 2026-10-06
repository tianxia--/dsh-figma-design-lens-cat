// Background service management via launchd (macOS), with an honest error
// elsewhere.
//
// The review UI is only useful if it is running when someone clicks a link,
// and remembering to start a server is exactly the chore that makes a tool
// feel broken. So it can run in the background — but anything that starts
// automatically must be just as easy to stop, inspect and remove, or it turns
// into something the user resents.
//
// Every operation is a subcommand of this CLI rather than a raw launchctl
// invocation: nobody should have to learn a second tool to switch off the
// first one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const LABEL = "com.dsh-figma-design-lens-cat.server";

const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", LABEL + ".plist");
const logDir = () => path.join(os.homedir(), ".dsh-figma-design-lens-cat", "logs");
const isMac = () => process.platform === "darwin";
const domain = () => "gui/" + process.getuid();

function plist(o) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key><string>" + LABEL + "</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>" + o.nodeBin + "</string>",
    "    <string>" + o.cliPath + "</string>",
    "    <string>serve</string>",
    "    <string>--port</string>",
    "    <string>" + o.port + "</string>",
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>LENS_HOME</key><string>" + o.lensHome + "</string>",
    "    <key>PATH</key><string>" + path.dirname(o.nodeBin) + ":/usr/bin:/bin:/usr/sbin:/sbin</string>",
    "  </dict>",
    "  <key>RunAtLoad</key><true/>",
    "  <key>KeepAlive</key>",
    "  <dict><key>SuccessfulExit</key><false/></dict>",
    "  <key>StandardOutPath</key><string>" + path.join(logDir(), "server.log") + "</string>",
    "  <key>StandardErrorPath</key><string>" + path.join(logDir(), "server.err.log") + "</string>",
    "  <key>ProcessType</key><string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ];
  return lines.join("\n");
}

const launchctl = (...args) => {
  try {
    return { ok: true, out: execFileSync("launchctl", args, { stdio: "pipe" }).toString() };
  } catch (e) {
    return { ok: false, out: (e.stderr ? e.stderr.toString() : e.message).trim() };
  }
};

export function install(o) {
  if (!isMac()) {
    throw new Error("automatic startup is implemented for macOS only; run `dsh-figma-design-lens-cat serve` or use your own supervisor");
  }
  fs.mkdirSync(path.dirname(plistPath()), { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
  fs.writeFileSync(plistPath(), plist(o));
  // Tear down first, so reinstalling actually picks up a changed plist.
  launchctl("bootout", domain() + "/" + LABEL);
  const r = launchctl("bootstrap", domain(), plistPath());
  if (!r.ok && !/already bootstrapped/i.test(r.out)) {
    const legacy = launchctl("load", "-w", plistPath());   // older macOS
    if (!legacy.ok) throw new Error("launchctl refused to load the agent: " + r.out);
  }
  return plistPath();
}

/** Stop now. The agent stays installed and comes back at next login. */
export function stop() {
  if (!isMac()) return { ok: false, out: "not macOS" };
  const r = launchctl("bootout", domain() + "/" + LABEL);
  if (!r.ok) launchctl("unload", plistPath());
  return { ok: true };
}

/** Start again without reinstalling. */
export function start() {
  if (!isMac()) return { ok: false, out: "not macOS" };
  const r = launchctl("bootstrap", domain(), plistPath());
  if (!r.ok) launchctl("load", "-w", plistPath());
  return { ok: true };
}

/** Remove entirely: stop it and delete the agent file. */
export function uninstall() {
  stop();
  if (fs.existsSync(plistPath())) fs.unlinkSync(plistPath());
  return plistPath();
}

export function status(port) {
  const installed = fs.existsSync(plistPath());
  let loaded = false;
  if (isMac() && installed) {
    loaded = launchctl("print", domain() + "/" + LABEL).ok;
  }
  let listening = false;
  try {
    execFileSync("lsof", ["-ti:" + port], { stdio: "pipe" });
    listening = true;
  } catch { /* nothing on the port */ }
  return { installed, loaded, listening, plist: plistPath(), logs: logDir() };
}
