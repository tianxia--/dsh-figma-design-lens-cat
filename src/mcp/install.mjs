// Wiring this tool into the agents that will call it.
//
// Every client stores its MCP servers somewhere different and in a slightly
// different shape, and doing it by hand means editing JSON by hand, which is
// how a trailing comma takes down an editor's whole config. This writes the
// entry, keeps the rest of the file untouched, and says what it changed.
//
// The server is addressed by command name rather than by a path into
// node_modules: a global install puts it on PATH, and a path breaks the next
// time the package moves.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    at: ["mcpServers"],
  },
  cursor: {
    label: "Cursor",
    file: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    format: "json",
    at: ["mcpServers"],
  },
  codex: {
    label: "Codex",
    file: () => path.join(os.homedir(), ".codex", "config.toml"),
    format: "toml",
  },
};

const entry = () => ({ type: "stdio", command: COMMAND, args: [] });

function installJson(file, at) {
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
  node[SERVER] = entry();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  return { ok: true, action: existed ? "updated" : "added" };
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
  const r = client.format === "toml" ? installToml(file) : installJson(file, client.at);
  return { ...r, label: client.label, file };
}

/** Which clients are present on this machine. */
export function detect() {
  return Object.entries(CLIENTS)
    .map(([key, c]) => ({ key, label: c.label, file: c.file(),
      present: fs.existsSync(c.file()) }));
}
