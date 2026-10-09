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
    // The model renders use, chosen from every usable provider, grouped.
    '<div id="llm-pick"></div>',
    '<div id="llm-list"><span class="muted">' + esc(t("settings.loading")) + "</span></div>",
    // More services: a built-in one needs only its API key; any other
    // endpoint needs an address and a key, and its models are fetched.
    '<div class="lm-sec">',
    '<div class="lm-sec-h"><b>' + esc(t("settings.llm.moreTitle")) + '</b><button id="cp-add" class="ghost">'
      + esc(t("settings.llm.addService")) + "</button></div>",
    '<div class="hint" style="margin:0 0 6px">' + esc(t("settings.llm.moreHint")) + "</div>",
    '<div id="cp-list"></div>',
    '<div id="cp-form" class="lm-panel" hidden>',
    '  <div class="cp-tabs"><button class="cp-tab" data-tab="svc">' + esc(t("settings.llm.tabSvc"))
      + '</button><button class="cp-tab" data-tab="url">' + esc(t("settings.llm.tabUrl")) + "</button></div>",
    // 1. A built-in service: pick it, paste the key.
    '  <div data-pane="svc">',
    '    <div class="field"><label>' + esc(t("settings.llm.svcPick")) + '</label><select id="sv-id"></select>',
    '      <div class="hint" id="sv-hint"></div></div>',
    '    <div class="field"><label>API Key</label><input id="sv-key" type="password" autocomplete="new-password">',
    '      <div class="hint">' + esc(t("settings.llm.svcKeyHint")) + "</div></div>",
    '    <div id="sv-err" class="cp-err"></div>',
    '    <div class="cp-btns"><button id="sv-save">' + esc(t("settings.llm.save")) + '</button><button class="ghost cp-close">'
      + esc(t("settings.llm.cancel")) + "</button></div>",
    "  </div>",
    // 2. Any other endpoint: address and key, then fetch its models.
    '  <div data-pane="url" hidden>',
    '    <div class="cp-grid">',
    '      <div class="field"><label>' + esc(t("settings.llm.fName")) + '</label><input id="cp-name" autocomplete="off" placeholder="'
      + esc(t("settings.llm.fNamePh")) + '"></div>',
    '      <div class="field"><label>' + esc(t("settings.llm.fUrl")) + '</label><input id="cp-url" autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"></div>',
    "    </div>",
    '    <div class="field"><label>API Key</label><input id="cp-key" type="password" autocomplete="new-password">',
    '      <div class="hint">' + esc(t("settings.llm.fKeyHint")) + "</div>",
    '      <div id="cp-clear-wrap" hidden class="cp-check"><input type="checkbox" id="cp-clear"><span>'
      + esc(t("settings.llm.fClear")) + "</span></div></div>",
    '    <div class="cp-btns" style="margin-bottom:10px"><button id="cp-fetch" class="ghost">' + esc(t("settings.llm.fetch"))
      + '</button><span id="cp-fetch-msg" class="muted"></span></div>',
    '    <div id="cp-found" hidden><div class="cp-found-h"><b>' + esc(t("settings.llm.found")) + '</b> '
      + '<a href="#" id="cp-all">' + esc(t("settings.llm.all")) + '</a> · <a href="#" id="cp-none">' + esc(t("settings.llm.none")) + "</a></div>",
    '      <div id="cp-found-list" class="cp-found-list"></div></div>',
    '    <details id="cp-manual"><summary>' + esc(t("settings.llm.manual")) + "</summary>",
    '      <div class="field"><div class="hint" style="margin:4px 0 6px">' + esc(t("settings.llm.fModels")) + "</div>",
    '      <textarea id="cp-models" rows="3" spellcheck="false" placeholder="deepseek-chat | DeepSeek Chat"></textarea></div></details>',
    '    <details id="cp-adv"><summary>' + esc(t("settings.llm.advanced")) + "</summary>",
    '      <div class="cp-grid" style="margin-top:8px">',
    '        <div class="field"><label>' + esc(t("settings.llm.fApi")) + '</label><select id="cp-api"></select></div>',
    '        <div class="field"><label>ID</label><input id="cp-id" autocomplete="off" spellcheck="false" placeholder="'
      + esc(t("settings.llm.fIdAuto")) + '"></div>',
    "      </div>",
    '      <div class="field"><label>' + esc(t("settings.llm.fEnv")) + '</label><input id="cp-env" autocomplete="off" spellcheck="false" placeholder="MY_GATEWAY_API_KEY">',
    '        <div class="hint">' + esc(t("settings.llm.fEnvHint")) + "</div></div></details>",
    '    <div id="cp-err" class="cp-err"></div>',
    '    <div class="cp-btns"><button id="cp-save">' + esc(t("settings.llm.save")) + '</button><button class="ghost cp-close">'
      + esc(t("settings.llm.cancel")) + "</button></div>",
    "  </div>",
    "</div>",
    "</div>",
    '<div id="llm-login" class="lm-panel" hidden>',
    '  <div id="llm-login-msg" class="lm-msg"></div>',
    // A real link the user clicks: opening a blank tab first and pointing it
    // at the sign-in page later left it blank in some browsers.
    '  <div id="llm-login-link" class="lm-go" hidden><a target="_blank" rel="noopener" id="llm-login-a" class="lm-go-btn">'
      + esc(t("settings.llm.openAuth")) + ' ↗</a><button class="ghost" id="llm-login-copy">' + esc(t("settings.llm.copyLink")) + "</button>"
      + '<div class="hint" style="margin:6px 0 0">' + esc(t("settings.llm.copyHint")) + "</div></div>",
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
    ".lm-go{margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".lm-go .hint{flex-basis:100%}",
    ".lm-go-btn{display:inline-block;padding:8px 16px;border-radius:var(--r-md);background:var(--ink);color:var(--surface);font-weight:600;font-size:var(--t-sm);text-decoration:none}",
    ".lm-go-btn:hover{opacity:.9}",
    ".lm-go button{padding:7px 12px;font-size:var(--t-sm)}",
    ".lm-sdk{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border-radius:var(--r-md);background:var(--warn-weak)}",
    ".lm-log{font:12px/1.5 ui-monospace,Menlo,monospace;color:var(--ink-3);white-space:pre-wrap;margin-top:6px;max-height:140px;overflow:auto}",
    ".dc-row{display:grid;grid-template-columns:150px 64px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:var(--t-sm);align-items:start}",
    ".dc-row:first-child{border-top:0}.dc-val{word-break:break-all}.dc-fix{font-size:var(--t-xs);color:var(--ink-3);margin-top:3px}",
    // .field label sets display:block, which beats the hidden attribute's UA rule.
    "#llm-card [hidden]{display:none!important}",
    ".lm-pick-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:6px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2)}",
    ".lm-pick-row label{font-weight:600;font-size:var(--t-sm)}",
    ".lm-pick-row select{flex:1;min-width:220px;width:auto}",
    ".lm-pick-row button,.lm-sec-h button{padding:5px 11px;font-size:var(--t-sm)}",
    ".lm-sec{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}",
    ".lm-sec-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}",
    ".cp-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}",
    ".cp-check{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:var(--t-sm)}",
    ".cp-check input{width:auto;margin:0}",
    ".cp-err{color:var(--bad);font-size:var(--t-sm);margin-bottom:8px}",
    "#cp-models{width:100%;box-sizing:border-box;font:12px/1.5 ui-monospace,Menlo,monospace}",
    ".cp-tabs{display:flex;gap:4px;margin-bottom:12px;border-bottom:1px solid var(--line)}",
    ".cp-tab{background:none;border:0;border-bottom:2px solid transparent;border-radius:0;padding:6px 12px;color:var(--ink-3);font-size:var(--t-sm)}",
    ".cp-tab.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:600}",
    ".cp-btns{display:flex;gap:8px;align-items:center}",
    // A long message beside a button must wrap itself, not squeeze the button
    // into a column of single characters.
    "#llm-card button{flex-shrink:0;white-space:nowrap}",
    "#cp-fetch-msg{min-width:0;overflow-wrap:anywhere}",
    ".cp-found-h{font-size:var(--t-sm);margin-bottom:6px}",
    ".cp-found-list{max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:var(--r-md);padding:6px 10px;margin-bottom:10px;background:var(--surface)}",
    ".cp-found-list label{display:flex;align-items:center;gap:8px;font-size:var(--t-sm);padding:3px 0;font-weight:400;margin:0}",
    ".cp-found-list input{width:auto;margin:0}",
    "#llm-card details{margin-bottom:10px;font-size:var(--t-sm)}",
    "#llm-card summary{cursor:pointer;color:var(--ink-2)}",
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
    copyLink: t("settings.llm.copyLink"), copied: t("settings.llm.copied"),
    done: t("settings.llm.done"), failed: t("settings.llm.failed"), cancelled: t("settings.llm.cancelled"),
    sdkMissing: t("settings.llm.sdkMissing"), install: t("settings.llm.install"),
    installing: t("settings.llm.installing"), installFailed: t("settings.llm.installFailed"),
    noModel: t("settings.llm.noModel"), confirmLogout: t("settings.llm.confirmLogout"),
    pick: t("settings.llm.pick"), pickNone: t("settings.llm.pickNone"), pickLocked: t("settings.llm.pickLocked"),
    testModel: t("settings.llm.testModel"), switched: t("settings.llm.switched"), unusable: t("settings.llm.unusable"),
    models: t("settings.llm.models"), customEmpty: t("settings.llm.customEmpty"),
    edit: t("settings.llm.edit"), del: t("settings.llm.del"), confirmDelete: t("settings.llm.confirmDelete"),
    savedCustom: t("settings.llm.savedCustom"), keySaved: t("settings.llm.keySaved"),
    keyEnv: t("settings.llm.keyEnv"), keyNone: t("settings.llm.keyNone"), keyKeep: t("settings.llm.keyKeep"),
    modelCount: t("settings.llm.modelCount"), svcAdded: t("settings.llm.svcAdded"), svcHint: t("settings.llm.svcHint"),
    svcSaved: t("settings.llm.svcSaved"), keyStored: t("settings.llm.keyStored"), remove: t("settings.llm.remove"),
    confirmRemove: t("settings.llm.confirmRemove"), fetching: t("settings.llm.fetching"), fetched: t("settings.llm.fetched"),
    needUrl: t("settings.llm.needUrl"), needModels: t("settings.llm.needModels"), needKey: t("settings.llm.needKey"),
    custom: t("settings.llm.customTag"),
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
var state=null,poll=null;
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
  renderPick();renderCustom();
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
  var r=await api('/api/llm/login',{provider:p});
  if(r.error){toast(r.error);return;}
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
      $('llm-login-copy').onclick=function(){
        var done=function(){toast(L.copied);};
        if(navigator.clipboard)navigator.clipboard.writeText(s.authUrl).then(done,function(){window.prompt(L.copyLink,s.authUrl);});
        else window.prompt(L.copyLink,s.authUrl);
      };
    }
    $('llm-paste').hidden=!s.prompt;
    if(s.status==='running'){$('llm-login-msg').textContent=s.authUrl?L.waiting:L.starting;return;}
    stop();
    if(s.status==='done'){toast(fmt(L.done,s.model||''));$('llm-login').hidden=true;}
    else{
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
/* ---- the model renders use, grouped by provider ---- */
var pickList=[];
function renderPick(){
  var groups=state.groups||[],cur=state.current,opts='';pickList=[];
  if(!cur)opts+='<option value="" selected disabled>'+esc(L.pickNone)+'</option>';
  groups.forEach(function(g){
    var lab=g.label+(g.ready?'':' — '+(g.kind==='subscription'?L.signedOut:(g.why||L.unusable)));
    opts+='<optgroup label="'+esc(lab)+'">';
    if(!g.ready&&g.kind==='subscription'){
      opts+='<option disabled>'+esc(fmt(L.pickLocked,g.models.length))+'</option>';
    }else{
      g.models.forEach(function(m){
        var i=pickList.push({provider:g.id,model:m.id})-1;
        var on=cur&&cur.provider===g.id&&cur.model===m.id;
        opts+='<option value="'+i+'"'+(on?' selected':'')+(g.ready?'':' disabled')+'>'
          +esc(m.name&&m.name!==m.id?m.name+'  ('+m.id+')':m.id)+'</option>';
      });
    }
    opts+='</optgroup>';
  });
  $('llm-pick').innerHTML='<div class="lm-pick-row"><label for="llm-model">'+esc(L.pick)+'</label>'
    +'<select id="llm-model">'+opts+'</select>'
    +'<button class="ghost" id="llm-model-test"'+(cur?'':' disabled')+'>'+esc(L.testModel)+'</button>'
    +'<span id="llm-model-t"></span></div>';
  $('llm-model').onchange=async function(){
    var c=pickList[Number(this.value)];if(!c)return;
    var r=await api('/api/llm/use',{provider:c.provider,model:c.model});
    if(r.error){toast(r.error);return refresh();}
    toast(fmt(L.switched,r.provider+' / '+r.model));refresh();
  };
  $('llm-model-test').onclick=async function(){
    var c=pickList[Number($('llm-model').value)]||cur;if(!c)return;
    var s=$('llm-model-t');s.innerHTML=pill('',L.testing);
    var r=await api('/api/llm/test',{provider:c.provider,model:c.model});
    s.innerHTML=r.state==='ok'?pill('ok',L.ok):r.state==='expired'?pill('bad',L.expired)
      :pill('bad',L.error+(r.detail?': '+r.detail:r.error?': '+r.error:''));
  };
}

/* ---- more services: API-key services and custom endpoints ---- */
function keyText(c){return c.apiKeySet?fmt(L.keySaved,c.apiKey):c.apiKeyEnv?fmt(L.keyEnv,'$'+c.apiKeyEnv):L.keyNone;}
function renderCustom(){
  var cur=state.current;
  var keyed=(state.groups||[]).filter(function(g){return g.kind==='api-key';});
  var rows=keyed.map(function(g){
    var on=cur&&cur.provider===g.id,id=esc(g.id);
    var acts='<button class="ghost" data-c="test" data-p="'+id+'">'+esc(L.test)+'</button>'
      +(on?'':'<button class="ghost" data-c="use" data-p="'+id+'">'+esc(L.use)+'</button>')
      +'<button class="ghost" data-c="unkey" data-p="'+id+'">'+esc(L.remove)+'</button>';
    return '<div class="lm-row"><div><div class="lm-name">'+esc(g.label)+'</div>'
      +'<div class="lm-sub">'+esc(fmt(L.modelCount,g.models.length))+'</div>'
      +'<div class="lm-pills">'+pill('ok',L.keyStored)+(on?pill('ok',L.active):'')+'<span id="t-'+id+'"></span></div></div>'
      +'<div class="lm-act">'+acts+'</div></div>';
  });
  (state.custom||[]).forEach(function(c){
    var on=cur&&cur.provider===c.id,id=esc(c.id);
    var pills=(c.ready?pill('ok',keyText(c)):pill('bad',c.why||L.unusable))+(on?pill('ok',L.active):'')
      +'<span id="t-'+id+'"></span>';
    var acts='<button class="ghost" data-c="edit" data-p="'+id+'">'+esc(L.edit)+'</button>'
      +(c.ready?'<button class="ghost" data-c="test" data-p="'+id+'">'+esc(L.test)+'</button>':'')
      +(c.ready&&!on?'<button class="ghost" data-c="use" data-p="'+id+'">'+esc(L.use)+'</button>':'')
      +'<button class="ghost" data-c="del" data-p="'+id+'">'+esc(L.del)+'</button>';
    rows.push('<div class="lm-row"><div><div class="lm-name">'+esc(c.displayName)+' <span class="muted">'+esc(L.custom)+'</span></div>'
      +'<div class="lm-sub">'+esc(c.baseURL)+' · '+esc(fmt(L.modelCount,c.models.length))+'</div>'
      +'<div class="lm-pills">'+pills+'</div></div><div class="lm-act">'+acts+'</div></div>');
  });
  $('cp-list').innerHTML=rows.length?rows.join(''):'<div class="muted" style="padding:6px 0">'+esc(L.customEmpty)+'</div>';
  document.querySelectorAll('#cp-list button[data-c]').forEach(function(b){
    b.onclick=function(){customAct(b.getAttribute('data-c'),b.getAttribute('data-p'));};
  });
}
async function customAct(a,id){
  var c=(state.custom||[]).filter(function(x){return x.id===id;})[0];
  var g=(state.groups||[]).filter(function(x){return x.id===id;})[0];
  var name=c?c.displayName:g?g.label:id;
  if(a==='edit')return openForm('url',c);
  if(a==='test')return act('test',id);
  if(a==='use'){var u=await api('/api/llm/use',{provider:id});if(u.error)toast(u.error);return refresh();}
  if(a==='unkey'){
    if(!confirm(fmt(L.confirmRemove,name)))return;
    await api('/api/llm/key/delete',{provider:id});return refresh();
  }
  if(a==='del'){
    if(!confirm(fmt(L.confirmDelete,name)))return;
    await api('/api/llm/custom/delete',{id:id});return refresh();
  }
}

var editing=null,found=[];
function tab(name){
  document.querySelectorAll('#cp-form .cp-tab').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-tab')===name);});
  document.querySelectorAll('#cp-form [data-pane]').forEach(function(p){p.hidden=p.getAttribute('data-pane')!==name;});
}
function svcHint(){
  var s=(state.services||[]).filter(function(x){return x.id===$('sv-id').value;})[0];
  $('sv-hint').textContent=s?fmt(L.svcHint,s.models):'';
}
function openForm(which,c){
  editing=c||null;found=[];
  $('cp-form').hidden=false;$('cp-err').textContent='';$('sv-err').textContent='';
  tab(which);
  // A built-in service: the list, each with its catalog size.
  $('sv-id').innerHTML=(state.services||[]).map(function(s){
    return '<option value="'+esc(s.id)+'">'+esc(s.name+'  ('+fmt(L.modelCount,s.models)+')'+(s.added?' · '+L.svcAdded:''))+'</option>';
  }).join('');
  // Start on the first service not added yet; re-adding one only replaces its key.
  var fresh=(state.services||[]).filter(function(s){return !s.added;})[0];
  if(fresh)$('sv-id').value=fresh.id;
  $('sv-key').value='';svcHint();
  // Another endpoint: blank to add, filled to edit.
  $('cp-name').value=c?c.displayName:'';$('cp-url').value=c?c.baseURL:'';
  $('cp-key').value='';$('cp-key').placeholder=c&&c.apiKeySet?fmt(L.keyKeep,c.apiKey):'sk-...';
  $('cp-clear-wrap').hidden=!(c&&c.apiKeySet);$('cp-clear').checked=false;
  $('cp-api').innerHTML=(state.protocols||['openai-completions']).map(function(p){
    return '<option'+(c&&c.api===p?' selected':'')+'>'+esc(p)+'</option>';}).join('');
  $('cp-id').value=c?c.id:'';$('cp-id').disabled=!!c;
  $('cp-env').value=c&&c.apiKeyEnv?c.apiKeyEnv:'';
  $('cp-models').value=c?c.models.map(function(m){return m.name&&m.name!==m.id?m.id+' | '+m.name:m.id;}).join('\\n'):'';
  $('cp-manual').open=!!c;$('cp-adv').open=false;
  $('cp-found').hidden=true;$('cp-found-list').innerHTML='';$('cp-fetch-msg').textContent='';
}
function parseModels(text){
  return text.split(/\\r?\\n/).map(function(l){return l.trim();}).filter(Boolean).map(function(l){
    var i=l.indexOf('|');return i<0?{id:l}:{id:l.slice(0,i).trim(),name:l.slice(i+1).trim()};
  });
}
function renderFound(){
  var keep=editing?editing.models.map(function(m){return m.id;}):null;
  $('cp-found-list').innerHTML=found.map(function(m,i){
    var on=!keep||keep.indexOf(m.id)>=0;
    return '<label><input type="checkbox" data-i="'+i+'"'+(on?' checked':'')+'><span>'+esc(m.id)
      +(m.name&&m.name!==m.id?' <span class="muted">'+esc(m.name)+'</span>':'')+'</span></label>';
  }).join('');
  $('cp-found').hidden=!found.length;
}
function checked(){
  var out=[];
  document.querySelectorAll('#cp-found-list input[data-i]').forEach(function(x){if(x.checked)out.push(found[Number(x.getAttribute('data-i'))]);});
  return out;
}
document.querySelectorAll('#cp-form .cp-tab').forEach(function(b){b.onclick=function(){tab(b.getAttribute('data-tab'));};});
document.querySelectorAll('#cp-form .cp-close').forEach(function(b){b.onclick=function(){$('cp-form').hidden=true;};});
$('cp-add').onclick=function(){openForm('svc',null);};
$('sv-id').onchange=svcHint;
$('sv-save').onclick=async function(){
  var key=$('sv-key').value.trim();if(!key){$('sv-err').textContent=L.needKey;return;}
  var b=$('sv-save');b.disabled=true;
  var r=await api('/api/llm/key',{provider:$('sv-id').value,apiKey:key});b.disabled=false;
  if(r.error){$('sv-err').textContent=r.error;return;}
  $('cp-form').hidden=true;$('sv-key').value='';toast(fmt(L.svcSaved,r.name+' / '+r.model));refresh();
};
$('cp-fetch').onclick=async function(){
  var url=$('cp-url').value.trim();if(!url&&!editing){$('cp-fetch-msg').textContent=L.needUrl;return;}
  var b=$('cp-fetch');b.disabled=true;$('cp-fetch-msg').textContent=L.fetching;
  var r=await api('/api/llm/discover',{baseURL:url,apiKey:$('cp-key').value.trim(),apiKeyEnv:$('cp-env').value.trim(),
    api:$('cp-api').value,id:editing?editing.id:undefined});
  b.disabled=false;
  if(r.error){$('cp-fetch-msg').textContent=r.error;$('cp-manual').open=true;return;}
  found=r.models||[];renderFound();$('cp-fetch-msg').textContent=fmt(L.fetched,found.length);
  // The checkboxes now own every listed model; leave only the extras typed by
  // hand, or unticking a model would not remove it.
  var ids={};found.forEach(function(m){ids[m.id]=1;});
  $('cp-models').value=parseModels($('cp-models').value).filter(function(m){return !ids[m.id];})
    .map(function(m){return m.name&&m.name!==m.id?m.id+' | '+m.name:m.id;}).join('\\n');
};
$('cp-all').onclick=function(e){e.preventDefault();document.querySelectorAll('#cp-found-list input').forEach(function(x){x.checked=true;});};
$('cp-none').onclick=function(e){e.preventDefault();document.querySelectorAll('#cp-found-list input').forEach(function(x){x.checked=false;});};
$('cp-save').onclick=async function(){
  var models=checked().concat(parseModels($('cp-models').value)),seen={},uniq=[];
  models.forEach(function(m){if(m&&m.id&&!seen[m.id]){seen[m.id]=1;uniq.push(m);}});
  if(!$('cp-url').value.trim()){$('cp-err').textContent=L.needUrl;return;}
  if(!uniq.length){$('cp-err').textContent=L.needModels;return;}
  var body={id:editing?editing.id:$('cp-id').value.trim(),displayName:$('cp-name').value.trim(),
    api:$('cp-api').value,baseURL:$('cp-url').value.trim(),apiKey:$('cp-key').value.trim(),
    apiKeyEnv:$('cp-env').value.trim(),clearApiKey:$('cp-clear').checked,models:uniq};
  var b=$('cp-save');b.disabled=true;
  var r=await api('/api/llm/custom',body);b.disabled=false;
  if(r.error){$('cp-err').textContent=r.error;return;}
  $('cp-form').hidden=true;$('cp-key').value='';toast(fmt(L.savedCustom,r.displayName));refresh();
};

function refresh(){loadLlm();runDoctor();}

$('doc-run').onclick=runDoctor;
refresh();
` + "})();<\/script>";
}
