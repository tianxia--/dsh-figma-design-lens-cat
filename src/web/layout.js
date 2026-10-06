// Shared shell: sidebar, language switch, breadcrumbs, back control.
//
// Interaction affordances that users expect and were missing: a toast for
// feedback instead of silent success, keyboard shortcuts for the actions people
// repeat, and a running-job chip visible from every page so navigation never
// hides work in progress.
import { LANGS } from "../i18n/strings.js";
import { TOKENS, BASE } from "./theme.js";

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const CSS = TOKENS + BASE;

const SHELL_JS = [
  "<script>(function(){",
  // Running jobs: poll from any page, so a long analysis is never invisible.
  "var el=document.getElementById('lens-running');",
  "var T=window.__lensT||{};",
  "if(el){var seen=0;",
  "  async function tick(){try{",
  "    var js=await (await fetch('/api/running')).json();",
  "    el.innerHTML=js.map(function(j){",
  "      return '<a class=\"runjob\" href=\"'+(window.__lensHome||'/')+'\"><span class=dot></span>'",
  "        +(T.running||'Analysing')+'<br><span style=\"opacity:.75\">'+j.lines+' '+(T.lines||'lines')+'</span></a>';",
  "    }).join('');",
  // When a job finishes while the user is on another page, tell them.
  "    if(seen>0 && js.length===0 && window.__lensToast) window.__lensToast(T.finished||'Analysis finished');",
  "    seen=js.length;",
  "  }catch(e){}}",
  "  tick();setInterval(tick,2000);}",
  // Toast helper, available to every page.
  "  var box=document.createElement('div');box.className='toast';document.body.appendChild(box);",
  "  var timer=null;",
  "  window.__lensToast=function(msg){box.textContent=msg;box.classList.add('show');",
  "    clearTimeout(timer);timer=setTimeout(function(){box.classList.remove('show');},2600);};",
  // Keyboard: g+h / g+p / g+s jump between sections, like every dev tool.
  "  var last=0;",
  "  document.addEventListener('keydown',function(e){",
  "    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;",
  "    var q=window.__lensQ||'';",
  "    if(e.key==='g'){last=Date.now();return;}",
  "    if(Date.now()-last<800){",
  "      if(e.key==='h'){location.href='/'+q;}",
  "      if(e.key==='p'){location.href='/projects'+q;}",
  "      if(e.key==='s'){location.href='/settings'+q;}",
  "    }",
  "  });",
  "})();</scr\u0069pt>",
].join("");

/**
 * @param opts { active, title, crumb, back:{href,label,home?}|null, lang, t }
 */
export function shell(opts, body) {
  const { active, title, crumb, back, lang, t } = opts;
  const q = lang && lang !== "en" ? "?lang=" + lang : "";
  const item = (href, key, ico, label, hint) =>
    '<a href="' + href + q + '" class="' + (active === key ? "on" : "") + '" title="' + hint + '">'
    + '<span class="ico">' + ico + "</span><span>" + label + "</span></a>";
  const langLinks = LANGS.map((l) =>
    '<a href="?lang=' + l + '" class="' + (lang === l ? "on" : "") + '">'
    + (l === "en" ? "EN" : "中文") + "</a>").join("");
  const backCtl = back
    ? '<div class="backrow"><a class="back" href="' + back.href + q + '">← ' + esc(back.label) + "</a>"
      + (back.home !== false ? '<a class="back" href="/' + q + '">⌂ ' + esc(t("nav.backHome")) + "</a>" : "")
      + "</div>"
    : "";
  return '<!doctype html><html lang="' + (lang || "en") + '"><head><meta charset="utf-8">'
    + "<title>" + esc(title) + " · dsh-figma-design-lens-cat</title>"
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="color-scheme" content="light dark">'
    + "<style>" + CSS + "</style></head><body>"
    + "<script>window.__lensT=" + JSON.stringify({
        running: t("job.running"), lines: t("job.lines"), finished: t("job.finished"),
      }) + ";window.__lensHome=" + JSON.stringify("/" + q)
    + ";window.__lensQ=" + JSON.stringify(q) + ";</scr\u0069pt>"
    + "<div class=app>"
    + '<aside class="side"><div class="brand">' + esc(t("app.name"))
    + "<small>" + esc(t("app.tagline")) + "</small></div>"
    + '<nav class="nav">'
    + item("/", "home", "◆", esc(t("nav.home")), "g h")
    + item("/projects", "projects", "▤", esc(t("nav.projects")), "g p")
    + item("/bench", "bench", "◷", esc(t("nav.bench")), "g b")
    + item("/settings", "settings", "⚙", esc(t("nav.settings")), "g s")
    + "</nav>"
    + '<div id="lens-running" style="padding:0 var(--s-2)"></div>'
    + '<div class="langbar"><span class="lbl">' + esc(t("settings.language")) + "</span>" + langLinks + "</div>"
    + '<div class="foot">' + esc(t("app.local")) + "</div></aside>"
    + '<div class="main"><div class="top">' + backCtl + "<h1>" + esc(title) + "</h1>"
    + (crumb ? '<div class="crumb">' + crumb + "</div>" : "")
    + '</div><div class="body">' + body + "</div></div></div>"
    + SHELL_JS + "</body></html>";
}
export const axColor = (v) => (v >= 90 ? "var(--ok)" : v >= 60 ? "var(--warn)" : "var(--bad)");


// A null axis means "this source cannot supply it" — shown as n/a with a muted
// track, never as a number. Rendering null as 0 would read as failure, and as
// 100 would read as a guarantee; both mislead.
export const axes = (a) => Object.entries(a).map(([k, v]) => {
  if (v === null || v === undefined) {
    return '<div class="axis"><div class="lbl"><span>' + k + '</span><b style="opacity:.6">n/a</b></div>'
      + '<div class="bar" title="not available from a static design"></div></div>';
  }
  return '<div class="axis"><div class="lbl"><span>' + k + "</span><b>" + v + "%</b></div>"
    + '<div class="bar"><i style="width:' + v + "%;background:" + axColor(v) + '"></i></div></div>';
}).join("");
export const verdictPill = (v, t, verdictKey) => {
  const key = verdictKey(v);
  const cls = key === "verdict.ready" ? "ok" : key === "verdict.risky" ? "warn" : "bad";
  const dot = key === "verdict.ready" ? "●" : key === "verdict.risky" ? "◐" : "○";
  return '<span class="pill ' + cls + '">' + dot + " " + esc(t(key)) + "</span>";
};
