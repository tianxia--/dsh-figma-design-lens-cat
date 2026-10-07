// Settings page: model sign-in and the environment check.
//
// The CLI's setup and doctor were the only places that said a model was
// involved, and a user who lives in the web UI never ran either. These two
// cards put the same information, and the sign-in itself, where that user
// already is. Everything renders client-side from /api/llm and /api/doctor so
// a sign-in finishing in another tab is reflected without a reload.
import { esc } from "./layout.js";

const card = 'class="card" style="max-width:640px;margin-top:var(--s-4)"';

export function settingsCards(t) {
  return [
    "<div " + card + ' id="llm-card">',
    "<h3>" + esc(t("settings.llm.title")) + "</h3>",
    '<div class="hint" style="margin:0 0 12px">' + esc(t("settings.llm.why")) + "</div>",
    '<div id="llm-sdk"></div>',
    '<div id="llm-list"><span class="muted">' + esc(t("settings.loading")) + "</span></div>",
    '<div id="llm-login" class="lm-panel" hidden>',
    '  <div id="llm-login-msg" class="lm-msg"></div>',
    '  <div id="llm-login-link" class="hint" hidden><a target="_blank" rel="noopener" id="llm-login-a">'
      + esc(t("settings.llm.openLink")) + "</a></div>",
    '  <div id="llm-paste" hidden style="margin-top:10px">',
    '    <div class="hint" style="margin:0 0 6px">' + esc(t("settings.llm.paste")) + "</div>",
    '    <div style="display:flex;gap:8px"><input id="llm-code" autocomplete="off" spellcheck="false">',
    '    <button id="llm-submit">' + esc(t("settings.llm.submit")) + "</button></div>",
    "  </div>",
    '  <div style="margin-top:10px"><button id="llm-cancel" class="ghost">'
      + esc(t("settings.llm.cancel")) + "</button></div>",
    "</div>",
    "</div>",

    "<div " + card + ' id="doc-card">',
    "<h3>" + esc(t("settings.doctor.title")) + "</h3>",
    '<div style="display:flex;gap:9px;align-items:center;margin-bottom:6px">',
    '<button id="doc-run" class="ghost">' + esc(t("settings.doctor.run")) + "</button>",
    '<span id="doc-sum" class="muted"></span></div>',
    '<div id="doc-rows"></div>',
    '<div class="hint">' + esc(t("settings.doctor.cli")) + "</div>",
    "</div>",

    "<style>",
    ".lm-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-top:1px solid var(--line)}",
    ".lm-row:first-child{border-top:0}",
    ".lm-name{font-weight:600}.lm-sub{font-size:var(--t-xs);color:var(--ink-3);margin-top:2px}",
    ".lm-pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}",
    ".lm-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
    ".lm-act button,.lm-sdk button{padding:5px 11px;font-size:var(--t-sm)}",
    ".lm-panel{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2)}",
    ".lm-msg{font-size:var(--t-sm)}",
    ".lm-sdk{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border-radius:var(--r-md);background:var(--warn-weak)}",
    ".lm-log{font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--ink-3);white-space:pre-wrap;margin-top:6px;max-height:140px;overflow:auto}",
    ".dc-row{display:grid;grid-template-columns:150px 64px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:var(--t-sm);align-items:start}",
    ".dc-row:first-child{border-top:0}.dc-val{word-break:break-all}.dc-fix{font-size:var(--t-xs);color:var(--ink-3);margin-top:3px}",
    "</style>",
  ].join("\n");
}

export function settingsScript(t) {
  const L = {
    loading: t("settings.loading"),
    providers: {
      anthropic: { name: "Claude", sub: t("settings.llm.subAnthropic") },
      "openai-codex": { name: "Codex", sub: t("settings.llm.subCodex") },
    },
    signedIn: t("settings.llm.signedIn"), signedOut: t("settings.llm.signedOut"),
    active: t("settings.llm.active"), model: t("settings.llm.model"),
    login: t("settings.llm.login"), relogin: t("settings.llm.relogin"),
    logout: t("settings.llm.logout"), test: t("settings.llm.test"), use: t("settings.llm.use"),
    testing: t("settings.llm.testing"), ok: t("settings.llm.ok"),
    expired: t("settings.llm.expired"), error: t("settings.llm.error"),
    starting: t("settings.llm.starting"), waiting: t("settings.llm.waiting"),
    done: t("settings.llm.done"), failed: t("settings.llm.failed"), cancelled: t("settings.llm.cancelled"),
    sdkMissing: t("settings.llm.sdkMissing"), install: t("settings.llm.install"),
    installing: t("settings.llm.installing"), installFailed: t("settings.llm.installFailed"),
    noModel: t("settings.llm.noModel"), confirmLogout: t("settings.llm.confirmLogout"),
    dOk: t("settings.doctor.ok"), dWarn: t("settings.doctor.warn"), dFail: t("settings.doctor.fail"),
    dRunning: t("settings.doctor.running"), dReady: t("settings.doctor.ready"),
    dReadyNoModel: t("settings.doctor.readyNoModel"), dFailed: t("settings.doctor.failed"),
    labels: {
      node: "Node.js", python: "Python 3", vision: "Pillow + NumPy",
      figmaToken: t("settings.doctor.figmaToken"), store: t("settings.doctor.store"),
      llmPackage: t("settings.doctor.llmPackage"), model: t("settings.doctor.model"),
    },
    // The words the check reports in; versions and paths pass through as-is.
    values: {
      available: t("settings.doctor.v.available"), missing: t("settings.doctor.v.missing"),
      installed: t("settings.doctor.v.installed"), configured: t("settings.doctor.v.configured"),
      "not connected": t("settings.doctor.v.notConnected"),
      "needs the llm package first": t("settings.doctor.v.needsPackage"),
      "not found": t("settings.doctor.v.notFound"),
    },
    fixes: {
      figmaToken: t("settings.doctor.fixToken"),
      llmPackage: t("settings.doctor.fixLlm"), model: t("settings.doctor.fixLlm"),
    },
  };
  return "<script>(function(){\n"
    + "var L=" + JSON.stringify(L) + ";\n"
    + `
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function fmt(s,v){return String(s).split('{v}').join(v);}
function pill(cls,text){return '<span class="pill '+cls+'">'+esc(text)+'</span>';}
function toast(m){if(window.__lensToast)window.__lensToast(m);}
async function api(path,body){
  var o=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  var r=await fetch(path,o);var j={};
  try{j=await r.json();}catch(e){}
  if(!r.ok&&!j.error)j.error='HTTP '+r.status;
  return j;
}

/* ---- environment check ---- */
async function runDoctor(){
  var b=$('doc-run');b.disabled=true;$('doc-sum').textContent=L.dRunning;
  var r=await api('/api/doctor');b.disabled=false;
  if(r.error){$('doc-sum').textContent=r.error;return;}
  var model=(r.checks||[]).filter(function(c){return c.id==='model';})[0];
  $('doc-sum').innerHTML=!r.ok?pill('bad',L.dFailed):(model&&!model.ok?pill('warn',L.dReadyNoModel):pill('ok',L.dReady));
  $('doc-rows').innerHTML=(r.checks||[]).map(function(c){
    var st=c.ok?pill('ok',L.dOk):(c.optional?pill('warn',L.dWarn):pill('bad',L.dFail));
    var fix=!c.ok?(L.fixes[c.id]||c.fix||''):'';
    return '<div class="dc-row"><div>'+esc(L.labels[c.id]||c.label)+'</div><div>'+st+'</div>'
      +'<div><div class="dc-val">'+esc(L.values[c.value]||c.value)+'</div>'+(fix?'<div class="dc-fix">'+esc(fix)+'</div>':'')+'</div></div>';
  }).join('');
}

/* ---- model sign-in ---- */
var state=null,poll=null,popup=null,opened=null;
async function loadLlm(){
  state=await api('/api/llm');
  if(state.error){$('llm-list').textContent=state.error;return;}
  renderLlm();
  if(state.login&&state.login.status==='running')follow(state.login.id);
  if(state.install&&state.install.status==='running')followInstall(state.install.id);
}
function renderLlm(){
  var busy=!!poll;
  $('llm-sdk').innerHTML=state.sdk?'':'<div class="lm-sdk"><div>'+esc(L.sdkMissing)
    +'<div id="llm-ilog" class="lm-log"></div></div><button id="llm-install">'+esc(L.install)+'</button></div>';
  if(!state.sdk)$('llm-install').onclick=install;
  $('llm-list').innerHTML=state.providers.map(function(p){
    var n=L.providers[p.id]||{name:p.id,sub:''};
    var pills=(p.signedIn?pill('ok',L.signedIn):pill('',L.signedOut))
      +(p.active?pill('ok',L.active):'')+'<span id="t-'+p.id+'"></span>';
    var acts='<button data-a="login" data-p="'+p.id+'"'+(state.sdk&&!busy?'':' disabled')+'>'
      +esc(p.signedIn?L.relogin:L.login)+'</button>';
    if(p.signedIn){
      acts+='<button class="ghost" data-a="test" data-p="'+p.id+'">'+esc(L.test)+'</button>';
      if(!p.active)acts+='<button class="ghost" data-a="use" data-p="'+p.id+'">'+esc(L.use)+'</button>';
      acts+='<button class="ghost" data-a="logout" data-p="'+p.id+'">'+esc(L.logout)+'</button>';
    }
    return '<div class="lm-row"><div><div class="lm-name">'+esc(n.name)+'</div>'
      +'<div class="lm-sub">'+esc(n.sub)+' · '+esc(L.model)+' '+esc(p.model||'')+'</div>'
      +'<div class="lm-pills">'+pills+'</div></div><div class="lm-act">'+acts+'</div></div>';
  }).join('')+(state.state&&state.state.ready?'':'<div class="hint">'+esc(L.noModel)+'</div>');
  document.querySelectorAll('#llm-list button[data-a]').forEach(function(b){
    b.onclick=function(){act(b.getAttribute('data-a'),b.getAttribute('data-p'));};
  });
}
async function act(a,p){
  if(a==='login')return login(p);
  if(a==='test'){
    var s=$('t-'+p);s.innerHTML=pill('',L.testing);
    var r=await api('/api/llm/test',{provider:p});
    s.innerHTML=r.state==='ok'?pill('ok',L.ok):r.state==='expired'?pill('bad',L.expired)
      :pill('bad',L.error+(r.detail?': '+r.detail:r.error?': '+r.error:''));
    return;
  }
  if(a==='use'){var u=await api('/api/llm/use',{provider:p});if(u.error)toast(u.error);return refresh();}
  if(a==='logout'){
    if(!confirm(fmt(L.confirmLogout,(L.providers[p]||{name:p}).name)))return;
    var o=await api('/api/llm/logout',{provider:p});if(o.error)toast(o.error);return refresh();
  }
}
async function login(p){
  /* Open the tab inside the click: a window opened after an await is
     treated as a popup and blocked. Its address is set once the server
     has the authorisation URL. */
  popup=window.open('about:blank','_blank');opened=null;
  var r=await api('/api/llm/login',{provider:p});
  if(r.error){if(popup)popup.close();toast(r.error);return;}
  follow(r.id);
}
function follow(id){
  $('llm-login').hidden=false;$('llm-login-msg').textContent=L.starting;
  $('llm-cancel').onclick=function(){api('/api/llm/session/'+id+'/cancel',{});};
  $('llm-submit').onclick=async function(){
    var v=$('llm-code').value.trim();if(!v)return;
    await api('/api/llm/session/'+id+'/input',{value:v});$('llm-code').value='';
  };
  if(poll)clearInterval(poll);
  poll=setInterval(tick,1000);renderLlm();tick();
  async function tick(){
    var s=await api('/api/llm/session/'+id);
    if(s.error){stop();return;}
    if(s.authUrl){
      $('llm-login-a').href=s.authUrl;$('llm-login-link').hidden=false;
      if(opened!==s.authUrl){opened=s.authUrl;if(popup&&!popup.closed)popup.location=s.authUrl;}
    }
    $('llm-paste').hidden=!s.prompt;
    if(s.status==='running'){$('llm-login-msg').textContent=s.authUrl?L.waiting:L.starting;return;}
    stop();
    if(s.status==='done'){toast(fmt(L.done,s.model||''));$('llm-login').hidden=true;}
    else{
      if(popup&&!popup.closed&&s.status==='cancelled')popup.close();
      $('llm-login-msg').innerHTML=pill('bad',s.status==='cancelled'?L.cancelled:L.failed)
        +(s.error?' <span class="muted">'+esc(s.error)+'</span>':'');
      $('llm-paste').hidden=true;$('llm-login-link').hidden=true;
      $('llm-cancel').onclick=function(){$('llm-login').hidden=true;};
    }
    refresh();
  }
  function stop(){clearInterval(poll);poll=null;}
}
async function install(){
  var r=await api('/api/llm/install',{});
  if(r.error){toast(r.error);return;}
  followInstall(r.id);
}
function followInstall(id){
  var b=$('llm-install');if(b){b.disabled=true;b.textContent=L.installing;}
  var t=setInterval(async function(){
    var s=await api('/api/llm/session/'+id);
    var lg=$('llm-ilog');if(lg)lg.textContent=(s.log||[]).slice(-6).join('\\n');
    if(s.status==='running')return;
    clearInterval(t);
    if(s.status==='done')refresh();
    else{toast(L.installFailed);if(lg)lg.textContent=s.error||'';var b2=$('llm-install');if(b2){b2.disabled=false;b2.textContent=L.install;}}
  },1200);
}
function refresh(){loadLlm();runDoctor();}

$('doc-run').onclick=runDoctor;
refresh();
` + "})();<\/script>";
}
