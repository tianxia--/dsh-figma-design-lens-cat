#!/usr/bin/env node
// A deadline for exploratory work.
//
// Some tasks have no visible bottom: each fix reveals the next missing piece,
// and there is no way to tell from inside whether one more attempt finishes
// it or starts another hour. Getting a third-party monorepo to build was one
// of those -- four undeclared dependencies in a row, each found only by
// trying.
//
// This runs a command under a wall-clock limit. On expiry it stops, writes
// what was reached, and says so plainly rather than leaving a background job
// running unattended.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function runWithDeadline({ command, hours = 3, label, logFile }) {
  const limitMs = hours * 3600 * 1000;
  const started = Date.now();
  const log = logFile || path.join("/tmp", "deadline-" + Date.now() + ".log");
  const out = fs.createWriteStream(log, { flags: "a" });

  return new Promise((resolve) => {
    // Not a login shell: -lc re-runs the user's profile, which here put a
    // different Python first and made every scoring call fail while the same
    // script succeeded when run directly. The caller's environment is the one
    // that was tested.
    const child = spawn("bash", ["-c", command],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    child.stdout.pipe(out);
    child.stderr.pipe(out);

    const timer = setTimeout(() => {
      // SIGTERM first: a build that is mid-write should get the chance to
      // finish the file rather than leave it truncated.
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10000);
    }, limitMs);

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      const elapsed = Math.round((Date.now() - started) / 1000);
      const timedOut = elapsed * 1000 >= limitMs - 5000;
      resolve({
        label: label || command.slice(0, 40),
        timedOut,
        exitCode: code,
        signal,
        seconds: elapsed,
        log,
        tail: (() => {
          try {
            const t = fs.readFileSync(log, "utf8");
            return t.slice(-1200);
          } catch { return ""; }
        })(),
      });
    });
  });
}

if (import.meta.url === "file://" + process.argv[1]) {
  const hours = Number(process.env.DEADLINE_HOURS || 3);
  const command = process.argv.slice(2).join(" ");
  if (!command) {
    console.log("usage: DEADLINE_HOURS=3 node tools/with-deadline.mjs <command>");
    process.exit(2);
  }
  const r = await runWithDeadline({ command, hours });
  console.log(r.timedOut
    ? "STOPPED at the " + hours + "h limit after " + r.seconds + "s"
    : "finished in " + r.seconds + "s with exit " + r.exitCode);
  console.log("log: " + r.log);
  console.log(r.tail);
  process.exit(r.timedOut ? 124 : (r.exitCode ?? 1));
}
