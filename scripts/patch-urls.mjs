import fs from "node:fs";
// The review UI may not be listening (port taken, or start refused). Links are
// therefore optional: pass undefined rather than a URL that 404s, and let the
// formatter omit the section entirely.
const f = "src/mcp/server.mjs";
let s = fs.readFileSync(f, "utf8");
const M = [
  ["{ home: U.home }", "U.available ? { home: U.home() } : null"],
  ["{ project: U.project(projSlug(a.project)) }", "U.available ? { project: U.project(projSlug(a.project)) } : null"],
  ["const link = U.screen(projSlug(a.project), a.screen);", "const link = U.available ? U.screen(projSlug(a.project), a.screen) : null;"],
  ["const link = U.screen(pid, sid);", "const link = U.available ? U.screen(pid, sid) : null;"],
  ["if (a.open || name === \"open_review\") openBrowser(link);", "if (link && (a.open || name === \"open_review\")) openBrowser(link);"],
  ['if (name === "open_review") return text("opened in browser: " + link);',
   'if (name === "open_review") {\n      return text(link ? "opened in browser: " + link\n        : "the review UI is not running. Start it with: dsh-figma-design-lens-cat serve");\n    }'],
  ["if (a.open) openBrowser(link);", "if (link && a.open) openBrowser(link);"],
  ["return text(formatScreen(man, { screen: link }));", "return text(formatScreen(man, link ? { screen: link } : null));"],
];
let n = 0;
for (const [a, b] of M) if (s.includes(a)) { s = s.split(a).join(b); n++; }
fs.writeFileSync(f, s);
console.log("patched " + n + "/" + M.length);
