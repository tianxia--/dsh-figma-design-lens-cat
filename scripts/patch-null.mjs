import fs from "node:fs";
// A null axis must print as "n/a", not "null%". Percentages are for measured
// values; an axis a static design cannot supply is not a measurement.
const f = "bin/design-lens.mjs";
let s = fs.readFileSync(f, "utf8");
s = s.split("\n").filter((l) => !/^\[Showing lines/.test(l.trim())).join("\n");
const from = 'k + " " + v + "%"';
const to = 'k + " " + (v === null || v === undefined ? "n/a" : v + "%")';
let n = 0;
while (s.includes(from)) { s = s.replace(from, to); n++; }
fs.writeFileSync(f, s);
console.log("patched " + n + " sites");
