// Wiring this tool into the agents that will call it.
//
// Every client stores its MCP servers somewhere different and in a slightly
// different shape, and doing it by hand means editing JSON by hand, which is
// how a trailing comma takes down an editor's whole config. This writes the
// entry, keeps the rest of the file untouched, and says what it changed.
//
// Clients started from a terminal (Claude Code, Codex) get the command name:
// they inherit the shell's PATH, and a name survives the package moving.
//
// Desktop apps (Claude Desktop, Cursor) get absolute paths to node and to the
// server script instead. Their PATH is not the shell's and not even stable:
// the same Claude Desktop launched the server with ~/.npm-global/bin on its
// PATH one hour and without it the next, failing with "No such file or
// directory". The script's #!/usr/bin/env node line has the same problem when
// node itself is not on that PATH. The cost is that a path can go stale
// after a Node upgrade moves the global directory; doctor checks for that.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MCP_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "mcp.mjs");

const SERVER = "dsh-figma-design-lens-cat";
const COMMAND = "dsh-figma-design-lens-cat-mcp";

/** Where each client keeps its MCP servers, and in what shape. */
export const CLIENTS = {
  claude: {
    label: "Claude Code",
    file: () => path.join(os.homedir(), ".claude.json"),
    format: "json",
    at: ["mcpServers"],
  },
  "claude-desktop": {
    label: "Claude Desktop",
    file: () => path.join(os.homedir(), "Library", "Application Support",
      "Claude", "claude_desktop_config.json"),
    format: "json",
    gui: true,
    at: ["mcpServers"],
  },
  cursor: {
    label: "Cursor",
    file: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    format: "json",
    gui: true,
    at: ["mcpServers"],
  },
  codex: {
    label: "Codex",
    file: () => path.join(os.homedir(), ".codex", "config.toml"),
    format: "toml",
  },
};

const entry = (client) => client.gui
  ? { type: "stdio", command: process.execPath, args: [MCP_SCRIPT] }
  : { type: "stdio", command: COMMAND, args: [] };

// macOS guards these folders per app. A desktop app that was never granted
// access cannot read a server script inside them and fails with EPERM, which
// is what a checkout on the Desktop does to Claude Desktop.
const PROTECTED = ["Desktop", "Documents", "Downloads"];

/** The protected folder a path sits in, on macOS, or null. */
export function protectedFolder(p) {
  if (process.platform !== "darwin" || !p) return null;
  const hit = PROTECTED.find((d) => p.startsWith(path.join(os.homedir(), d) + path.sep));
  return hit || null;
}

function onPath(cmd) {
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (dir && fs.existsSync(path.join(dir, cmd))) return path.join(dir, cmd);
  }
  return null;
}

function installJson(file, at, client) {
  let doc = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (raw) {
      // A malformed config is left alone rather than overwritten: whatever is
      // in there is someone's working setup, and replacing it loses more than
      // this tool adds.
      try { doc = JSON.parse(raw); } catch {
        return { ok: false, why: "existing file is not valid JSON; left untouched" };
      }
    }
  }
  let node = doc;
  for (const key of at) {
    if (!node[key] || typeof node[key] !== "object") node[key] = {};
    node = node[key];
  }
  const existed = Boolean(node[SERVER]);
  node[SERVER] = entry(client);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  return { ok: true, action: existed ? "updated" : "added", entry: node[SERVER] };
}

function installToml(file) {
  const block = "[mcp_servers." + SERVER.replace(/-/g, "_") + "]\n"
    + 'command = "' + COMMAND + '"\n'
    + "args = []\n";
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const header = "[mcp_servers." + SERVER.replace(/-/g, "_") + "]";
  if (text.includes(header)) {
    return { ok: true, action: "already present" };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (text.trim() ? text.trimEnd() + "\n\n" : "") + block);
  return { ok: true, action: "added" };
}

/** Add this server to one client's configuration. */
export function install(which) {
  const client = CLIENTS[which];
  if (!client) {
    throw new Error("unknown client: " + which
      + " (known: " + Object.keys(CLIENTS).join(", ") + ")");
  }
  const file = client.file();
  const r = client.format === "toml" ? installToml(file) : installJson(file, client.at, client);
  const folder = client.gui ? protectedFolder(MCP_SCRIPT) : null;
  const warning = folder
    ? "the server script is in your " + folder + " folder, which macOS blocks for " + client.label
      + " until it is granted access (System Settings → Privacy & Security → Files and Folders)."
      + " Installed from npm it lives outside these folders."
    : null;
  return { ...r, label: client.label, file, gui: !!client.gui, warning };
}

function readEntry(client) {
  const file = client.file();
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  if (client.format === "toml") {
    const header = "[mcp_servers." + SERVER.replace(/-/g, "_") + "]";
    const at = text.indexOf(header);
    if (at < 0) return null;
    const block = text.slice(at + header.length).split(/\n\[/)[0];
    const cmd = (block.match(/command\s*=\s*"([^"]+)"/) || [])[1];
    const args = [...((block.match(/args\s*=\s*\[([^\]]*)\]/) || [])[1] || "").matchAll(/"([^"]+)"/g)]
      .map((m) => m[1]);
    return cmd ? { command: cmd, args } : null;
  }
  try {
    let node = JSON.parse(text);
    for (const key of client.at) node = node && node[key];
    return (node && node[SERVER]) || null;
  } catch {
    return null;
  }
}

/**
 * Every client that has this server configured, and whether that entry will
 * start. Each: { key, label, file, ok, value, fix }.
 */
export function checkInstalled() {
  const out = [];
  for (const [key, c] of Object.entries(CLIENTS)) {
    const e = readEntry(c);
    if (!e) continue;
    const fix = "dsh-figma-design-lens-cat install " + key;
    const cmd = String(e.command || "");
    const args = Array.isArray(e.args) ? e.args : [];
    const row = (ok, value, extra) => ({ key, label: c.label, file: c.file(), ok, value, ...(ok ? {} : { fix }), ...extra });

    if (path.isAbsolute(cmd)) {
      const gone = [cmd, ...args.filter((a) => path.isAbsolute(a))].find((p) => !fs.existsSync(p));
      if (gone) out.push(row(false, "path no longer exists: " + gone));
      else {
        const script = args.find((a) => path.isAbsolute(a)) || cmd;
        const folder = c.gui ? protectedFolder(fs.realpathSync(script)) : null;
        if (folder) {
          out.push(row(false, "server is in the " + folder + " folder, which macOS blocks for " + c.label,
            { fix: "install from npm, or grant " + c.label + " access in System Settings → Privacy & Security → Files and Folders" }));
        } else out.push(row(true, "configured"));
      }
      continue;
    }
    // A bare command name. Desktop apps cannot be relied on to find it.
    if (c.gui) {
      out.push(row(false, "uses the command name, which " + c.label + " may not find on its PATH"));
      continue;
    }
    out.push(onPath(cmd) ? row(true, "configured")
      : row(false, "command not found on PATH: " + cmd,
        { fix: "add npm's global bin directory (`npm prefix -g`/bin) to PATH, then restart " + c.label }));
  }
  return out;
}

/** Which clients are present on this machine. */
export function detect() {
  return Object.entries(CLIENTS)
    .map(([key, c]) => ({ key, label: c.label, file: c.file(),
      present: fs.existsSync(c.file()) }));
}
