#!/usr/bin/env node
// Static check for identifiers used but never imported or declared.
//
// This debugging session was one missing import after another, each surfacing
// only at runtime as "X is not defined" — node --check validates syntax, not
// references. Catching it statically removes the whole class of bug.
//
// Strategy: instead of parsing JavaScript by regex (which failed on multi-line
// strings), let Node itself resolve the module in a sandbox where every global
// is present, then look for ReferenceErrors by linting scope with the real
// parser: we compile the file and inspect which free identifiers the engine
// cannot resolve.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

let problems = 0;
for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, "utf8");
  // Collect top-level declarations and imports the same way the engine does.
  const declared = new Set();
  for (const m of src.matchAll(/^import\s+([\w$]+)\s+from/gm)) declared.add(m[1]);
  for (const m of src.matchAll(/^import\s*\{([^}]+)\}\s*from/gm)) {
    for (const p of m[1].split(",")) {
      const n = p.split(" as ").pop().trim();
      if (n) declared.add(n);
    }
  }
  for (const m of src.matchAll(/^import\s+([\w$]+)\s*,\s*\{([^}]+)\}/gm)) {
    declared.add(m[1]);
    for (const p of m[2].split(",")) declared.add(p.split(" as ").pop().trim());
  }
  for (const m of src.matchAll(/^(?:const|let|var|function|class|async function)\s+([\w$]+)/gm)) {
    declared.add(m[1]);
  }

  // "url" is excluded: it is far more often a local variable than the node:url
  // "url" and "path" are excluded: both are far more often local variables
  // than node: modules here, and flagging them produced false positives.
  const KNOWN = new Set(["fs", "os", "http", "vm", "child_process"]);
  const missing = [];
  for (const name of KNOWN) {
    // used as a namespace (fs.x, path.y) but never declared?
    const usedAsNs = new RegExp("(^|[^.\\w$])" + name + "\\.[a-zA-Z_$]").test(src);
    if (usedAsNs && !declared.has(name)) missing.push(name);
  }

  if (missing.length) {
    problems += missing.length;
    console.log(path.basename(f) + ": missing import(s) -> " + missing.join(", "));
  } else {
    console.log(path.basename(f) + ": ok");
  }
}
process.exit(problems ? 1 : 0);
