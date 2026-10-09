// dsh-figma-design-lens-cat web app: Home (chat) / Projects / Settings.
//
// State lives on the SERVER: an analysis keeps running when the user navigates
// away, and every page restores it, because losing a multi-minute job to a menu
// click is unacceptable.
//
// All user-facing text comes from the i18n dictionary — source, API and logs
// are English-only, and the page renders whichever language the reader picked.
// Job logs are filtered: Node's TLS and deprecation warnings are not progress
// and reading them as failures wastes the operator's attention.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { execFile } from "node:child_process";
import { Store } from "../store/store.js";
import { Settings } from "../store/settings.js";
import { JobQueue } from "../store/jobs.js";
import { shell, esc, axes, verdictPill } from "./layout.js";
import { pickLang, translator, verdictKey, renderBlocker } from "../i18n/strings.js";
import { previewCard, previewScript } from "./preview-ui.js";
import { settingsCards, settingsScript } from "./settings-ui.js";

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".md": "text/markdown; charset=utf-8" };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const NOISE = /^\(node:\d+\)|NODE_TLS_REJECT_UNAUTHORIZED|--trace-warnings|DeprecationWarning/;

export function createServer(root, opts = {}) {
  const store = new Store(root);
  const settings = new Settings(root);
  const jobs = new JobQueue(root);
  // src/web/server.mjs -> package root is two levels up. The old four-level
  // climb dated from the monorepo layout and resolved to ~/Desktop, so the CLI
  // could never be found.
  const REPO = opts.repoRoot
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

  function startAnalysis({ url, project, detectors }) {
    const job = jobs.create("analyze", (project || "auto") + " · " + url.slice(0, 60), { url, project });
    // The CLI lives in this package's own bin/, not under a monorepo packages/
    // directory. That path survived the split and broke every analysis started
    // from the web UI.
    const lens = path.join(REPO, "bin", "design-lens.mjs");
    const args = [lens, "add", url];
    if (project) args.push("--project", project);
    if (detectors) args.push("--detectors");

    const child = execFile(process.execPath, args, {
      cwd: REPO, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, LENS_HOME: root, FIGMA_API_KEY: settings.token() },
    }, (err, stdout, stderr) => {
      if (err) { jobs.fail(job.id, (stderr || err.message).slice(0, 600)); return; }
      const node = (url.match(/node-id=([0-9A-Za-z:-]+)/) || [])[1];
      const sid = node ? node.replace("-", ":").replace(":", "-") : null;
      store.reindex();
      const fk = (url.match(/(?:design|file)\/([A-Za-z0-9]{10,})/) || [])[1];
      const reg = readJson(path.join(root, "registry.json"));
      const rec = reg && fk ? reg.byFileKey[fk] : null;
      jobs.finish(job.id, { projectId: rec ? rec.id : null, screenId: sid,
        link: rec && sid ? "/s/" + rec.id + "/" + sid : null });
    });

    const feed = (d) => String(d).split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l && !NOISE.test(l))
      .forEach((l) => jobs.log(job.id, l));
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    return job;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const p = decodeURIComponent(url.pathname);
    const lang = pickLang(req);
    const t = translator(lang);
    const q = lang !== "en" ? "?lang=" + lang : "";
    const base = { "Content-Type": "text/html; charset=utf-8" };
    if (url.searchParams.get("lang")) {
      base["Set-Cookie"] = "lens_lang=" + lang + "; Path=/; Max-Age=31536000; SameSite=Lax";
    }
    const send = (code, body, type) => {
      res.writeHead(code, { ...base, "Content-Type": type || base["Content-Type"] });
      res.end(body);
    };
    const json = (o, code = 200) => send(code, JSON.stringify(o), MIME[".json"]);
    const readBody = () => new Promise((resolve) => {
      let b = ""; req.on("data", (c) => b += c);
      req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
    });
    const page = (o, body) => send(200, shell({ ...o, lang, t }, body));

    try {
      const fm = p.match(/^\/files\/(.+)$/);
      if (fm) {
        const fp = path.join(root, fm[1]);
        if (!fp.startsWith(root) || !fs.existsSync(fp)) return send(404, "not found", "text/plain");
        return send(200, fs.readFileSync(fp), MIME[path.extname(fp)] || "application/octet-stream");
      }

      if (p === "/api/settings" && req.method === "GET") return json(settings.redacted());
      if (p === "/api/settings" && req.method === "POST") {
        const b = await readBody();
        const patch = {};
        if (typeof b.figmaToken === "string" && b.figmaToken && !b.figmaToken.includes("…")) patch.figmaToken = b.figmaToken.trim();
        if (typeof b.runDetectors === "boolean") patch.runDetectors = b.runDetectors;
        settings.write(patch);
        return json(settings.redacted());
      }
      if (p === "/api/settings/test" && req.method === "POST") {
        const token = settings.token();
        if (!token) return json({ ok: false, message: t("error.needToken") });
        const r = await fetch("https://api.figma.com/v1/me", { headers: { "X-Figma-Token": token } });
        if (!r.ok) return json({ ok: false, message: "HTTP " + r.status });
        const me = await r.json();
        return json({ ok: true, message: me.email || me.handle || "connected" });
      }

      // The environment check: the same list as `doctor` in a terminal.
      if (p === "/api/doctor" && req.method === "GET") {
        const { doctorChecks, doctorOk } = await import("../env/doctor.mjs");
        const checks = doctorChecks();
        return json({ checks, ok: doctorOk(checks) });
      }

      // Model sign-in. The server listens on every interface, so these are
      // limited to this machine: they start OAuth flows, store credentials
      // and run npm. Sign-in has to happen here anyway -- the provider
      // redirects to localhost. POSTs must be JSON, which a page on another
      // site cannot send without a preflight this server never answers.
      if (p === "/api/llm" || p.startsWith("/api/llm/")) {
        const a = req.socket.remoteAddress || "";
        if (!(a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1")) {
          return json({ error: "model sign-in is only available from this machine" }, 403);
        }
        if (req.method === "POST" && !/application\/json/i.test(req.headers["content-type"] || "")) {
          return json({ error: "expected application/json" }, 415);
        }
        const client = await import("../llm/client.mjs");
        const LL = await import("./llm-login.mjs");
        const known = (pv) => LL.WEB_PROVIDERS.includes(pv);
        // Sign-in is for the two subscriptions; test, use and models also take
        // an API-key service with a saved key, or any custom provider.
        const usable = (pv) => known(pv) || Boolean(client.customProviders()[pv]) || client.isAuthorised(pv);

        if (p === "/api/llm" && req.method === "GET") {
          const st = client.llmState();
          return json({
            sdk: client.sdkInstalled(), state: st,
            providers: LL.WEB_PROVIDERS.map((id) => ({
              id, signedIn: client.isAuthorised(id), active: st.ready && st.provider === id,
              model: st.provider === id && st.model ? st.model : client.defaultModel(id),
            })),
            login: LL.view(LL.running("login")), install: LL.view(LL.running("install")),
            // Every model renders can use, grouped by provider, and the one in use.
            ...(await client.listModelGroups({ include: LL.WEB_PROVIDERS })),
            custom: client.listCustomProviders(),
            protocols: (await import("../llm/custom.mjs")).PROTOCOLS,
            // Built-in services that need only an API key, for "Add a service".
            services: await client.keyServices(),
          });
        }
        // A built-in service connected with its API key. The key goes to
        // auth.json beside the subscription logins and is never sent back.
        if (p === "/api/llm/key" && req.method === "POST") {
          const b = await readBody();
          try { return json(await client.saveProviderKey(String(b.provider || ""), b.apiKey)); }
          catch (e) { return json({ error: e.message }, 400); }
        }
        if (p === "/api/llm/key/delete" && req.method === "POST") {
          const b = await readBody();
          const pv = String(b.provider || "");
          // A subscription signs out instead; removing its entry here would
          // drop the login without telling the provider.
          if (client.PROVIDERS.some((x) => x.id === pv)) return json({ error: "sign out instead" }, 400);
          return json({ ok: await client.removeProviderKey(pv) });
        }
        // Which models an endpoint serves, asked from here: the page cannot
        // call another origin, and the key should not pass through it twice.
        if (p === "/api/llm/discover" && req.method === "POST") {
          const b = await readBody();
          try { return json(await client.discoverModels(b || {})); }
          catch (e) { return json({ error: e.message }, 400); }
        }
        if (p === "/api/llm/install" && req.method === "POST") {
          return json(LL.view(LL.startInstall(REPO)));
        }
        if (p === "/api/llm/login" && req.method === "POST") {
          const b = await readBody();
          if (!known(b.provider)) return json({ error: "unknown provider" }, 400);
          try { return json(LL.view(LL.startLogin(b.provider))); }
          catch (e) { return json({ error: e.message }, 400); }
        }
        const sm = p.match(/^\/api\/llm\/session\/([A-Za-z0-9-]+)(?:\/(input|cancel))?$/);
        if (sm) {
          const s = LL.get(sm[1]);
          if (!s) return json({ error: "no such session" }, 404);
          if (!sm[2] && req.method === "GET") return json(LL.view(s));
          if (sm[2] === "input" && req.method === "POST") {
            const b = await readBody();
            return json({ ok: LL.answer(s.id, b.value) });
          }
          if (sm[2] === "cancel" && req.method === "POST") return json({ ok: LL.cancel(s.id) });
        }
        if (p === "/api/llm/test" && req.method === "POST") {
          const b = await readBody();
          if (!usable(b.provider)) return json({ error: "unknown provider" }, 400);
          return json(await client.checkProvider(b.provider, b.model || undefined));
        }
        if (p === "/api/llm/use" && req.method === "POST") {
          const b = await readBody();
          if (!usable(b.provider)) return json({ error: "unknown provider" }, 400);
          try {
            return json(b.model ? await client.chooseModel(b.provider, b.model)
              : (client.providerReady(b.provider) ? client.chooseProvider(b.provider)
                : (() => { throw new Error("not signed in"); })()));
          } catch (e) { return json({ error: e.message }, 400); }
        }
        // Custom providers. Keys are written to settings.json (mode 600) and
        // only ever come back masked.
        if (p === "/api/llm/custom" && req.method === "POST") {
          const b = await readBody();
          try { return json(await client.saveCustomProvider(b || {})); }
          catch (e) { return json({ error: e.message }, 400); }
        }
        if (p === "/api/llm/custom/delete" && req.method === "POST") {
          const b = await readBody();
          return json({ ok: client.removeCustomProvider(String((b && b.id) || "")) });
        }
        if (p === "/api/llm/logout" && req.method === "POST") {
          const b = await readBody();
          if (!known(b.provider)) return json({ error: "unknown provider" }, 400);
          try { await client.logout(b.provider); return json({ ok: true }); }
          catch (e) { return json({ error: e.message }, 500); }
        }
        return json({ error: "not found" }, 404);
      }
      if (p === "/api/analyze" && req.method === "POST") {
        const b = await readBody();
        if (!b.url || !/node-id=/.test(b.url)) return json({ error: t("error.needNodeId") }, 400);
        if (!settings.token()) return json({ error: t("error.needToken") }, 400);
        const job = startAnalysis({ url: b.url, project: b.project || null,
          detectors: b.detectors !== undefined ? b.detectors : settings.read().runDetectors });
        return json({ jobId: job.id });
      }
      if (p.startsWith("/api/job/")) {
        const j = jobs.get(p.split("/")[3]);
        if (!j) return json({ error: "no such job" }, 404);
        const since = Number(url.searchParams.get("since") || 0);
        return json({ id: j.id, status: j.status, error: j.error, result: j.result,
          log: j.log.slice(since).map((x) => x.line), total: j.log.length });
      }
      // Fidelity preview is explicitly requested, never started by analysis.
      // The last preview for a screen, without starting one. Reopening the
      // drawer restores what is already there instead of re-rendering.
      if (p === "/api/preview-latest" && req.method === "GET") {
        const project = url.searchParams.get("project");
        const screen = url.searchParams.get("screen");
        if (!project || !screen) return json({ error: "project and screen are required" }, 400);
        const j = jobs.latestPreview(project, screen);
        if (!j) return json({ none: true });
        return json({ id: j.id, status: j.status, platforms: j.platforms || {} });
      }

      if (p === "/api/preview" && req.method === "POST") {
        const body = await readBody();
        const { project, screen, platforms } = body || {};
        if (!project || !screen) return json({ error: "project and screen are required" }, 400);
        const latest = path.join(root, "projects", project, "screens", screen, "latest");
        if (!fs.existsSync(latest)) return json({ error: "screen not analysed yet" }, 404);

        const { startPreview, PLATFORMS } = await import("../render/preview.mjs");
        const wanted = Array.isArray(platforms) && platforms.length ? platforms : PLATFORMS;
        const job = jobs.create("preview", "preview " + project + "/" + screen,
          { project, screen, platforms: wanted });

        // Per-platform state lives on the job so a late subscriber can catch
        // up instead of only seeing events from the moment it connected.
        job.result = { platforms: {} };
        for (const pl of wanted) job.result.platforms[pl] = { status: "pending" };

        const { done } = startPreview({
          latest,
          projectDir: path.join(root, "projects", project),
          screenId: screen,
          platforms: wanted,
          emit: (ev) => {
            const slot = job.result.platforms[ev.platform];
            if (slot) {
              if (ev.phase === "start") slot.status = "running";
              if (ev.phase === "done") {
                slot.status = "done"; slot.fidelity = ev.fidelity; slot.ms = ev.ms;
                slot.missingFonts = ev.missingFonts || [];
                // What the conversion could not reproduce, so the user can
                // see which part of a partly-accurate render to check.
                slot.losses = ev.losses || [];
                // Which generator drew it, and why not the model if it was
                // the template: a template render scores far lower, and the
                // user must be able to tell that apart from a bad model run.
                slot.by = ev.by || "template";
                slot.fellBackBecause = ev.fellBackBecause || null;
              }
              if (ev.phase === "failed") { slot.status = "failed"; slot.error = ev.error; }
            }
            jobs.log(job.id, JSON.stringify(ev));
          },
        });
        done.then(() => jobs.finish(job.id, job.result))
          .catch((e) => jobs.fail(job.id, e.message));
        return json({ id: job.id, platforms: wanted });
      }

      // Server-sent events: subscribe to one preview job's progress.
      if (p.startsWith("/api/preview/") && p.endsWith("/events")) {
        const id = p.split("/")[3];
        const job = jobs.get(id);
        if (!job) return json({ error: "no such job" }, 404);

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const send = (event, data) =>
          res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

        // Replay what already happened so a tab opened late is still correct.
        send("state", { status: job.status, platforms: job.result?.platforms || {} });
        for (const l of job.log) {
          try { send("progress", JSON.parse(l.line)); } catch { /* not an event line */ }
        }
        if (job.status !== "running") { send("end", { status: job.status }); res.end(); return; }

        const onLog = (e) => {
          if (e.id !== id) return;
          try { send("progress", JSON.parse(e.line)); } catch { /* ignore */ }
        };
        const onDone = (j) => {
          if (j.id !== id) return;
          send("end", { status: j.status, platforms: j.result?.platforms || {} });
          cleanup();
          res.end();
        };
        const cleanup = () => { jobs.off("log", onLog); jobs.off("done", onDone); };
        jobs.on("log", onLog);
        jobs.on("done", onDone);
        req.on("close", cleanup);
        return;
      }

      if (p.startsWith("/api/preview/")) {
        const job = jobs.get(p.split("/")[3]);
        if (!job) return json({ error: "no such job" }, 404);
        return json({ id: job.id, status: job.status, platforms: job.result?.platforms || {} });
      }

      if (p === "/api/jobs") return json(jobs.recent());
      if (p === "/api/transcript" && req.method === "DELETE") { jobs.clear(); return json({ ok: true }); }
      if (p === "/api/transcript") return json(jobs.transcript());
      if (p === "/api/running") return json(jobs.running().map((j) => ({ id: j.id, label: j.label, lines: j.log.length })));
      if (p === "/api/index") { store.reindex(); return json(readJson(path.join(root, "index.json")) || { projects: [] }); }

      // Benchmark history, so the trend is visible without the CLI.
      if (p === "/api/bench") {
        const bench = await import("../bench/run.mjs");
        return json({ set: bench.loadSet(), runs: bench.summariseHistory() });
      }

      if (p === "/") {
        const s = settings.redacted();
        const idx = readJson(path.join(root, "index.json")) || { projects: [] };
        const opts2 = idx.projects.map((x) => '<option value="' + esc(x.name) + '">').join("");
        const T = { you: t("home.you"), done: t("home.done"), view: t("home.viewResult"),
          failed: t("home.failed"), running: t("home.running"), empty: t("home.empty"),
          analyse: t("home.analyse"), analysing: t("home.analysing"), clear: t("home.clear") };
        const body = [
          '<div class="card" style="max-width:860px">',
          '  <div style="display:flex;justify-content:flex-end;margin-bottom:4px">',
          '    <button id="clr" class="ghost" style="padding:4px 10px;font-size:12px">' + esc(T.clear) + "</button></div>",
          '  <div id="feed" class="feed"></div>',
          s.figmaTokenSet ? "" : '  <div class="pill bad" style="margin-bottom:10px">' + esc(t("home.noToken"))
            + ' <a href="/settings' + q + '">' + esc(t("nav.settings")) + "</a></div>",
          '  <div style="display:flex;gap:9px;align-items:flex-start">',
          '    <input id="proj" list="projs" placeholder="' + esc(t("home.labelPlaceholder"))
            + '" title="' + esc(t("home.labelTitle")) + '" style="flex:0 0 170px">',
          '    <datalist id="projs">' + opts2 + "</datalist>",
          '    <input id="url" placeholder="' + esc(t("home.urlPlaceholder")) + '" style="flex:1">',
          '    <button id="go">' + esc(T.analyse) + "</button>",
          "  </div>",
          '  <div class="hint">' + t("home.hint") + "</div>",
          "</div>",
          "<script>",
          "var T=" + JSON.stringify(T) + ";",
          "var LQ=" + JSON.stringify(q) + ";",
          "var feed=document.getElementById('feed');",
          "var esc2=function(s){return String(s).replace(/</g,'&lt;');};",
          "function addUser(x){var d=document.createElement('div');d.className='msg-user';d.innerHTML='<b>'+T.you+'</b>'+esc2(x);feed.appendChild(d);return d;}",
          "function addLog(){var d=document.createElement('div');d.className='msg-log';feed.appendChild(d);return d;}",
          "function addNote(h){var d=document.createElement('div');d.className='msg-note';d.innerHTML=h;feed.appendChild(d);return d;}",
          "function bottom(){feed.scrollTop=feed.scrollHeight;}",
          "async function restore(){",
          "  var tr=await (await fetch('/api/transcript')).json();",
          "  feed.innerHTML='';",
          "  if(!tr.length){feed.innerHTML='<div class=empty>'+T.empty+'</div>';return;}",
          "  for(var i=0;i<tr.length;i++){var j=tr[i];",
          "    addUser((j.meta&&j.meta.url)||j.label);",
          "    var pre=addLog();pre.textContent=j.log.join('\\n');",
          "    if(j.status==='done'){var l=j.result&&j.result.link;addNote('<b>✓ '+T.done+'</b>'+(l?' <a href=\"'+l+LQ+'\">'+T.view+'</a>':''));}",
          "    else if(j.status==='failed'){addNote('<span style=\"color:var(--bad)\">✕ '+T.failed+esc2(j.error||'')+'</span>');}",
          "    else {addNote('<span style=\"color:var(--warn)\">● '+T.running+'</span>');follow(j.id,pre,j.log.length);}",
          "  } bottom();",
          "}",
          "function follow(id,pre,since){",
          "  var btn=document.getElementById('go');btn.disabled=true;btn.textContent=T.analysing;",
          "  var tick=setInterval(async function(){",
          "    var s=await (await fetch('/api/job/'+id+'?since='+since)).json();",
          "    if(s.log&&s.log.length){pre.textContent+=(pre.textContent?'\\n':'')+s.log.join('\\n');since=s.total;bottom();}",
          "    if(s.status==='done'){clearInterval(tick);var l=s.result&&s.result.link;",
          "      addNote('<b>✓ '+T.done+'</b>'+(l?' <a href=\"'+l+LQ+'\">'+T.view+'</a>':''));bottom();if(window.__lensToast)window.__lensToast(T.done);",
          "      btn.disabled=false;btn.textContent=T.analyse;}",
          "    else if(s.status==='failed'){clearInterval(tick);",
          "      addNote('<span style=\"color:var(--bad)\">✕ '+T.failed+esc2(s.error||'')+'</span>');bottom();if(window.__lensToast)window.__lensToast(T.failed);",
          "      btn.disabled=false;btn.textContent=T.analyse;}",
          "  },900);",
          "}",
          "document.getElementById('go').onclick=async function(){",
          "  var u=document.getElementById('url').value.trim();",
          "  var pj=document.getElementById('proj').value.trim();",
          "  if(!u)return; addUser(u);",
          "  var r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u,project:pj||null})});",
          "  var j=await r.json();",
          "  if(j.error){addNote('<span style=\"color:var(--bad)\">✕ '+esc2(j.error)+'</span>');bottom();return;}",
          "  document.getElementById('url').value='';",
          "  follow(j.jobId,addLog(),0);",
          "};",
          "document.getElementById('clr').onclick=async function(){",
          "  await fetch('/api/transcript',{method:'DELETE'}); restore();",
          "};",
          "document.getElementById('url').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('go').click();});",
          "restore();",
          "</scr\u0069pt>",
        ].join("\n");
        return page({ active: "home", title: t("home.title"), crumb: t("home.subtitle") }, body);
      }

      if (p === "/projects") {
        store.reindex();
        const idx = readJson(path.join(root, "index.json")) || { projects: [] };
        const reg = readJson(path.join(root, "registry.json")) || { byFileKey: {} };
        const cards = idx.projects.map((pr) => {
          const rec = Object.values(reg.byFileKey).find((x) => x.id === pr.id);
          const al = rec && rec.aliases && rec.aliases.length
            ? '<div class="muted">' + esc(t("projects.aliases")) + ": " + esc(rec.aliases.join(", ")) + "</div>" : "";
          return ['<div class="card link">',
            '<h3><a href="/p/' + pr.id + q + '">' + esc(pr.name) + "</a></h3>",
            '<div class="muted">' + pr.summary.screens + " " + esc(t("projects.screens")) + " · "
              + pr.summary.components + " " + esc(t("projects.components")) + " · "
              + pr.summary.ready + "/" + pr.summary.screens + " " + esc(t("projects.ready")) + "</div>",
            al,
            '<div class="axes">' + axes(pr.summary.readiness) + "</div>",
            '<div class="muted" style="margin-top:10px">' + esc(t("projects.updated")) + " "
              + pr.updatedAt.slice(0, 16).replace("T", " ") + "</div>",
            "</div>"].join("");
        }).join("");
        const empty = '<div class="card muted">' + t("projects.empty", { home: "/" + q }) + "</div>";
        return page({ active: "projects", title: t("projects.title"),
          crumb: idx.projects.length + " " + t("projects.count"),
          back: { href: "/", label: t("nav.home"), home: false } },
          '<div class="grid">' + (cards || empty) + "</div>");
      }

      const pm = p.match(/^\/p\/([^/]+)$/);
      if (pm) {
        const meta = readJson(path.join(root, "projects", pm[1], "project.json"));
        if (!meta) return page({ active: "projects", title: t("error.notFound") },
          '<div class="card">' + esc(t("error.projectMissing")) + "</div>");
        const rows = meta.screens.map((s) => [
          '<tr><td><a href="/s/' + pm[1] + "/" + s.screenId + q + '">' + esc(s.name) + "</a><br>",
          '<span class="muted">' + s.size.w + "×" + s.size.h + " · " + s.platform + "</span></td>",
          "<td>" + s.components + "</td>",
          '<td style="min-width:300px"><div class="axes">' + axes(s.readiness) + "</div></td>",
          "<td>" + verdictPill(s.verdict, t, verdictKey)
            + (s.blockers ? '<br><span class="muted">' + s.blockers + " " + esc(t("screens.pending")) + "</span>" : "") + "</td>",
          '<td class="muted">' + s.analysedAt.slice(0, 16).replace("T", " ") + "<br>"
            + s.versions + " " + esc(t("screens.versions")) + "</td></tr>"].join("")).join("");
        return page({ active: "projects", title: meta.name,
          crumb: '<a href="/projects' + q + '">' + esc(t("nav.projects")) + "</a> › " + esc(meta.name),
          back: { href: "/projects", label: t("nav.projects") } },
          "<table><tr><th>" + esc(t("screens.col.screen")) + "</th><th>" + esc(t("screens.col.components"))
          + "</th><th>" + esc(t("screens.col.readiness")) + "</th><th>" + esc(t("screens.col.verdict"))
          + "</th><th>" + esc(t("screens.col.analysed")) + "</th></tr>" + rows + "</table>");
      }

      const sm = p.match(/^\/s\/([^/]+)\/([^/]+)$/);
      if (sm) {
        const pid = sm[1], sid = sm[2];
        const dir = path.join(root, "projects", pid, "screens", sid, "latest");
        const man = readJson(path.join(dir, "manifest.json"));
        if (!man) return page({ active: "projects", title: t("error.notFound") },
          '<div class="card">' + esc(t("error.screenMissing")) + "</div>");
        const rel = "projects/" + pid + "/screens/" + sid + "/latest/";
        const blockers = man.readiness.blockers.map((raw) => {
          const b = renderBlocker(raw, t);
          return '<div style="padding:10px 12px;border-radius:var(--r-sm);margin-bottom:var(--s-2);font-size:var(--t-md);border:1px solid var(--line);background:'
            + (b.severity === "high" ? "var(--bad-weak)" : b.severity === "medium" ? "var(--warn-weak)" : "var(--surface-2)")
            + '"><b>' + esc(b.axis) + "</b> — " + esc(b.what)
            + '<br><span class="muted">→ ' + esc(b.fix) + "</span></div>";
        }).join("") || '<div class="muted">' + esc(t("screen.noBlockers")) + "</div>";
        const assets = (man.files.assets || []).map((a) =>
          '<div style="display:inline-block;margin:0 10px 10px 0;text-align:center">'
          + '<img src="/files/' + rel + a + '" style="max-width:150px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);box-shadow:var(--e-1)"><br>'
          + '<span class="muted">' + esc(path.basename(a)) + "</span></div>").join("")
          || '<div class="muted">' + esc(t("screen.noAssets")) + "</div>";
        const rr = man.readiness.counts.recognitionRate;
        const byRole = Object.entries(man.counts.byRole || {}).map(([k, v]) =>
          '<span class="pill tag" style="margin-right:6px">' + k + " " + v + "</span>").join("");
        const body = [
          '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">',
          '<div class="card" style="flex:0 0 400px">',
          '<div class="muted" style="margin-bottom:6px">' + esc(t("screen.annotated")) + "</div>",
          (man.files.annotated || []).map((a) => '<img src="/files/' + rel + a
            + '" style="width:100%;border-radius:var(--r-sm);margin-bottom:var(--s-2);border:1px solid var(--line)">').join(""),
          "</div>",
          '<div style="flex:1;min-width:320px;display:flex;flex-direction:column;gap:14px">',
          '<div class="card"><h3>' + esc(t("screen.readiness")) + "</h3>",
          '<div class="axes">' + axes(man.readiness.axes) + "</div>",
          '<div style="margin-top:12px">' + verdictPill(man.readiness.verdict, t, verdictKey) + "</div>",
          rr ? '<div class="muted" style="margin-top:8px">' + esc(t("screen.recognition")) + " (" + rr.detector + "): "
            + esc(t("screen.detected")) + " " + rr.detectedBoxes + " · " + esc(t("screen.explained")) + " "
            + rr.explainedPct + "% · " + esc(t("screen.uncovered")) + " " + rr.uncovered + "</div>" : "",
          "</div>",
          '<div class="card"><h3>' + esc(t("screen.composition"))
            + " · " + man.counts.components + "</h3>" + byRole,
          '<div class="muted" style="margin-top:8px">' + esc(t("screen.layouts")) + " " + man.counts.layouts
            + " · " + esc(t("screen.decorRemoved")) + " " + man.counts.excludedDecoration
            + " · " + esc(t("screen.rasterOnly")) + " " + man.counts.rasterOnly + "</div></div>",
          '<div class="card"><h3>' + esc(t("screen.blockers")) + "</h3>" + blockers + "</div>",
          '<div class="card"><h3>' + esc(t("screen.assets")) + "</h3>" + assets + "</div>",
          '<div class="card"><h3>' + esc(t("screen.artifacts")) + "</h3>",
          '<a href="/files/' + rel + 'implement.md">' + esc(t("screen.spec")) + "</a> · ",
          '<a href="/files/' + rel + 'review/index.html">' + esc(t("screen.fullReview")) + "</a> · ",
          '<a href="/files/' + rel + 'manifest.json">manifest.json</a>',
          '<div class="muted" style="margin-top:8px"><a href="' + esc(man.source.url) + '" target="_blank">'
            + esc(t("screen.openFigma")) + " · " + esc(man.source.node) + "</a></div>",
          // Re-running the pipeline is the only way to pick up extraction
          // changes: a screen analysed by an older version keeps its old data
          // and scores against it, which reads as a rendering fault.
          '<div style="margin-top:12px">',
          '<button id="re-run" class="re-run">' + esc(t("screen.reanalyse")) + "</button>",
          '<div class="muted" style="margin-top:6px">' + esc(t("screen.reanalyseHint")) + "</div>",
          '<div id="re-log" class="muted" style="margin-top:6px"></div>',
          "</div>",
          "<style>.re-run{padding:7px 12px;border:1px solid var(--line-strong);",
          "border-radius:var(--r-sm);background:var(--surface);color:var(--ink);",
          "font-size:var(--t-sm);cursor:pointer}",
          ".re-run:hover{border-color:var(--brand);color:var(--brand-ink)}",
          ".re-run[disabled]{opacity:.55;cursor:default}</style>",
          "</div>",
          previewCard(t),
          previewScript(t, pid, sid, rel),
          "<script>(function(){",
          "var btn=document.getElementById('re-run'),log=document.getElementById('re-log');",
          "if(!btn)return;",
          "var URL_=" + JSON.stringify(man.source.url) + ",PROJ=" + JSON.stringify(pid) + ";",
          "var RUN=" + JSON.stringify(t("screen.reanalyse")) + ",BUSY=" + JSON.stringify(t("screen.reanalysing")) + ";",
          "btn.onclick=function(){",
          "  btn.disabled=true;btn.textContent=BUSY;log.textContent='';",
          "  fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json'},",
          "    body:JSON.stringify({url:URL_,project:PROJ})})",
          "   .then(function(r){return r.json()})",
          "   .then(function(j){",
          "     if(!j.jobId){log.textContent=j.error||'failed';btn.disabled=false;btn.textContent=RUN;return;}",
          "     var seen=0;",
          "     var poll=setInterval(function(){",
          "       fetch('/api/job/'+j.jobId+'?since='+seen).then(function(r){return r.json()}).then(function(s){",
          "         if(s.log&&s.log.length){seen=s.total;log.textContent=s.log[s.log.length-1];}",
          "         if(s.status!=='running'){clearInterval(poll);",
          // The page is rebuilt from the new data, so a reload is the result.
          "           if(s.status==='done'){location.reload();return;}",
          "           log.textContent=s.error||'failed';btn.disabled=false;btn.textContent=RUN;}",
          "       }).catch(function(){});",
          "     },1500);",
          "   })",
          "   .catch(function(){btn.disabled=false;btn.textContent=RUN;});",
          "};",
          "})();<\/script>",
          "</div></div>"].join("");
        return page({ active: "projects", title: man.screen.name,
          crumb: '<a href="/projects' + q + '">' + esc(t("nav.projects")) + '</a> › <a href="/p/' + pid + q + '">'
            + esc(pid) + "</a> › " + esc(man.screen.name),
          back: { href: "/p/" + pid, label: t("nav.back") } }, body);
      }

      if (p === "/bench") {
        const bench = await import("../bench/run.mjs");
        const set = bench.loadSet();
        const runs = bench.summariseHistory();

        const rows = runs.slice().reverse().map((r) => {
          // A template run is not comparable to a model run; mark it so the
          // trend is read correctly rather than as a regression.
          const tone = r.source === "model" ? "ok"
            : r.source === "template" ? "bad" : "warn";
          return '<tr><td>' + esc(String(r.at).slice(0, 16)) + "</td><td>"
            + esc(r.label || "-") + "</td><td><b>" + (r.overall ?? "-")
            + "</b></td><td>" + (r.web ?? "-") + "</td><td>" + (r.ios ?? "-")
            + "</td><td>" + (r.android ?? "-") + '</td><td><span class="pill '
            + tone + '">' + esc(r.source || "?") + "</span></td></tr>";
        }).join("");

        const body = [
          '<div class="card"><h3>' + esc(t("bench.title")) + "</h3>",
          '<div class="muted">' + esc(t("bench.hint")) + "</div>",
          set
            ? '<div class="muted" style="margin-top:8px">'
              + set.screens.length + " / " + set.available + " "
              + esc(t("bench.screens")) + "</div>"
            : '<div class="muted" style="margin-top:8px">' + esc(t("bench.noSet")) + "</div>",
          "</div>",
          '<div class="card"><h3>' + esc(t("bench.history")) + "</h3>",
          runs.length
            ? '<table class="bench"><thead><tr><th>' + esc(t("bench.when"))
              + "</th><th>" + esc(t("bench.label")) + "</th><th>" + esc(t("bench.overall"))
              + "</th><th>web</th><th>iOS</th><th>Compose</th><th>"
              + esc(t("bench.source")) + "</th></tr></thead><tbody>"
              + rows + "</tbody></table>"
            : '<div class="muted">' + esc(t("bench.noRuns")) + "</div>",
          "</div>",
          "<style>table.bench{width:100%;border-collapse:collapse;font-size:var(--t-sm)}",
          "table.bench th{text-align:left;color:var(--ink-3);font-weight:500;padding:6px 8px;",
          "border-bottom:1px solid var(--line)}",
          "table.bench td{padding:6px 8px;border-bottom:1px solid var(--line)}",
          ".pill{padding:2px 7px;border-radius:var(--r-full);font-size:var(--t-xs)}",
          ".pill.ok{background:var(--ok-weak);color:var(--ok)}",
          ".pill.bad{background:var(--bad-weak);color:var(--bad)}",
          ".pill.warn{background:var(--warn-weak);color:var(--warn)}</style>",
        ].join("");
        return page({ active: "bench", title: t("bench.title") }, body);
      }

      if (p === "/settings") {
        const s = settings.redacted();
        const body = [
          '<div class="card" style="max-width:640px">',
          '<div class="field"><label>' + esc(t("settings.token")) + "</label>",
          '<input id="token" type="password" placeholder="'
            + esc(s.figmaTokenSet ? t("settings.tokenSet", { v: s.figmaToken }) : "figd_...") + '">',
          '<div class="hint">' + esc(t("settings.tokenHint", { path: root + "/settings.json" })) + "</div></div>",
          '<div class="field"><label>' + esc(t("settings.ownership")) + "</label>",
          '<div class="hint" style="margin-top:0">' + t("settings.ownershipHint") + "</div></div>",
          '<div class="field"><label><input type="checkbox" id="det" ' + (s.runDetectors ? "checked" : "")
            + ' style="width:auto;margin-right:7px">' + esc(t("settings.detectors")) + "</label>",
          '<div class="hint">' + esc(t("settings.detectorsHint")) + "</div></div>",
          '<div style="display:flex;gap:9px;align-items:center">',
          '<button id="save">' + esc(t("settings.save")) + "</button>",
          '<button id="test" class="ghost">' + esc(t("settings.test")) + "</button>",
          '<span id="msg" class="muted"></span></div></div>',
          "<script>",
          "var SV=" + JSON.stringify({ saved: t("settings.saved"), testing: t("settings.testing") }) + ";",
          "var msg=document.getElementById('msg');",
          "document.getElementById('save').onclick=async function(){",
          "  var body={runDetectors:document.getElementById('det').checked};",
          "  var tk=document.getElementById('token').value.trim(); if(tk) body.figmaToken=tk;",
          "  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});",
          "  msg.textContent=SV.saved; msg.style.color='var(--ok)'; if(window.__lensToast)window.__lensToast(SV.saved);",
          "  document.getElementById('token').value=''; setTimeout(function(){location.reload();},600);",
          "};",
          "document.getElementById('test').onclick=async function(){",
          "  msg.textContent=SV.testing; msg.style.color='var(--ink-3)';",
          "  var r=await (await fetch('/api/settings/test',{method:'POST'})).json();",
          "  msg.textContent=r.message; msg.style.color=r.ok?'var(--ok)':'var(--bad)'; if(window.__lensToast)window.__lensToast(r.message);",
          "};",
          "</scr\u0069pt>",
          settingsCards(t),
          settingsScript(t)].join("\n");
        return page({ active: "settings", title: t("settings.title"), crumb: t("settings.subtitle"),
          back: { href: "/", label: t("nav.home"), home: false } }, body);
      }

      send(404, shell({ active: "home", title: t("error.notFound"), lang, t,
        back: { href: "/", label: t("nav.home"), home: false } },
        '<div class="card">' + esc(t("error.pageMissing")) + "</div>"));
    } catch (e) {
      send(500, shell({ active: "home", title: "Error", lang, t },
        '<div class="card"><pre>' + esc(e.stack) + "</pre></div>"));
    }
  });
}
