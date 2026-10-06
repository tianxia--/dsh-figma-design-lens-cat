// Fidelity preview: a floating button that opens a drawer from the right.
//
// The drawer is a view onto a render that lives on the server, not a thing it
// owns: closing and reopening it shows the existing result, and only the
// explicit re-render button starts new work.
export function previewCard(t) {
  const PLATFORMS = [["web", "Web"], ["ios", "iOS"], ["android", "Compose"]];
  const tabs = PLATFORMS.map(([id, label], i) =>
    '<button class="pv-tab' + (i === 0 ? " on" : "") + '" data-tab="' + id + '">'
    + label + '<span class="pv-dot" data-dot="' + id + '"></span></button>').join("");
  const panes = PLATFORMS.map(([id], i) =>
    '<div class="pv-pane" data-pane="' + id + '"' + (i === 0 ? "" : " hidden") + '>'
    + '<div class="muted pv-status" data-status="' + id + '">—</div>'
    + '<div data-body="' + id + '"></div></div>').join("");

  return [
    '<button id="pv-fab" title="' + t("preview.title") + '">',
    '<span class="pv-fab-ico">◱</span><span>' + t("preview.title") + "</span>",
    "</button>",
    '<div id="pv-scrim" hidden></div>',
    '<aside id="pv-drawer" hidden aria-hidden="true">',
    '<header class="pv-head">',
    "<div><b>" + t("preview.title") + "</b>",
    '<div class="muted pv-sub">' + t("preview.hint") + "</div></div>",
    '<div class="pv-actions">',
    '<button id="pv-run" class="pv-run">' + t("preview.run") + "</button>",
    '<button id="pv-close" class="pv-close" aria-label="close">✕</button>',
    "</div></header>",
    '<div class="pv-tabs">' + tabs + "</div>",
    '<div class="pv-panes">' + panes + "</div>",
    "</aside>",
    "<style>",
    "#pv-fab{position:fixed;top:14px;right:16px;z-index:40;display:flex;align-items:center;gap:7px;",
    "padding:8px 13px;border:1px solid var(--line-strong);border-radius:var(--r-full);",
    "background:var(--surface);color:var(--ink);font-size:var(--t-md);cursor:pointer;box-shadow:var(--e-1)}",
    "#pv-fab:hover{border-color:var(--brand);color:var(--brand-ink)}",
    ".pv-fab-ico{color:var(--brand)}",
    "#pv-scrim{position:fixed;inset:0;background:rgba(16,16,24,.28);z-index:45}",
    "#pv-drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,94vw);z-index:46;",
    "background:var(--surface);border-left:1px solid var(--line);box-shadow:-8px 0 24px rgba(16,16,24,.10);",
    "display:flex;flex-direction:column;overflow:hidden}",
    // display:flex outranks the hidden attribute, so state it explicitly.
    "#pv-drawer[hidden],#pv-scrim[hidden]{display:none}",
    ".pv-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;",
    "padding:16px 18px;border-bottom:1px solid var(--line)}",
    ".pv-sub{margin-top:3px;font-size:var(--t-sm)}",
    ".pv-actions{display:flex;align-items:center;gap:8px;flex:none}",
    ".pv-run{padding:7px 12px;border:0;border-radius:var(--r-sm);background:var(--brand);",
    "color:#fff;font-size:var(--t-sm);cursor:pointer}",
    ".pv-run[disabled]{opacity:.55;cursor:default}",
    ".pv-close{border:0;background:none;font-size:15px;color:var(--ink-3);cursor:pointer;padding:4px}",
    ".pv-tabs{display:flex;gap:4px;padding:0 18px;border-bottom:1px solid var(--line)}",
    ".pv-tab{padding:9px 12px;border:0;background:none;cursor:pointer;font-size:var(--t-md);",
    "color:var(--ink-2);border-bottom:2px solid transparent}",
    ".pv-tab.on{color:var(--brand-ink);border-bottom-color:var(--brand)}",
    ".pv-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-left:6px;",
    "background:var(--line-strong);vertical-align:middle}",
    ".pv-dot.run{background:var(--warn)}.pv-dot.ok{background:var(--ok)}.pv-dot.bad{background:var(--bad)}",
    ".pv-panes{flex:1;overflow:auto;padding:16px 18px}",
    ".pv-imgs{display:flex;gap:10px;flex-wrap:wrap}",
    ".pv-imgs figure{margin:0;flex:1;min-width:150px}",
    ".pv-imgs img{width:100%;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2)}",
    ".pv-imgs figcaption{font-size:var(--t-xs);color:var(--ink-3);margin-top:4px}",
    ".pv-axes{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;font-size:var(--t-sm)}",
    ".pv-row{display:flex;justify-content:space-between;gap:10px;padding:5px 0;",
    "border-top:1px solid var(--line);font-size:var(--t-sm)}",
    ".pv-warn{margin:10px 0;padding:8px 10px;border-radius:var(--r-sm);",
    "background:var(--warn-weak);color:var(--warn);font-size:var(--t-sm)}",
    ".pv-warn .muted{margin-top:3px;font-size:var(--t-xs)}",
    "@media(max-width:560px){#pv-fab span:last-child{display:none}}",
    "</style>",
  ].join("");
}

// Client script. Kept as a string because the server has no bundler.
export function previewScript(t, project, screen, rel) {
  const L = {
    running: t("preview.running"), again: t("preview.again"),
    pending: t("preview.pending"), failed: t("preview.failed"),
    design: t("preview.design"), rendered: t("preview.rendered"),
    pixel: t("preview.pixel"), colour: t("preview.colour"),
    components: t("preview.components"), failing: t("preview.failing"),
    worst: t("preview.worst"), run: t("preview.run"),
    fontMissing: t("preview.fontMissing"), fontNote: t("preview.fontNote"),
  };
  return "<script>(function(){\n"
    + "var L=" + JSON.stringify(L) + ",PROJ=" + JSON.stringify(project)
    + ",SCR=" + JSON.stringify(screen) + ",REL=" + JSON.stringify(rel) + ";\n"
    + `
var fab=document.getElementById('pv-fab'),drawer=document.getElementById('pv-drawer'),
    scrim=document.getElementById('pv-scrim'),run=document.getElementById('pv-run'),
    close=document.getElementById('pv-close');
if(fab&&drawer){
  var stream=null, loaded=false, active=null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function dot(p,cls){var d=document.querySelector('[data-dot="'+p+'"]');if(d)d.className='pv-dot '+cls;}
  function status(p,s){var e=document.querySelector('[data-status="'+p+'"]');if(e)e.textContent=s||'';}

  document.querySelectorAll('.pv-tab').forEach(function(b){
    b.onclick=function(){
      document.querySelectorAll('.pv-tab').forEach(function(x){x.classList.remove('on')});
      b.classList.add('on');
      document.querySelectorAll('.pv-pane').forEach(function(p){
        p.hidden=p.getAttribute('data-pane')!==b.getAttribute('data-tab');
      });
    };
  });

  function renderResult(p,f,fonts){
    var el=document.querySelector('[data-body="'+p+'"]');
    if(!el)return;
    var png='/files/projects/'+PROJ+'/render/'+p+'/'+SCR+'/render.png?t='+Date.now();
    var design='/files/'+REL+'review/design.png';
    var ax=f.axes||{};
    var h='<div class="pv-imgs">'
      +'<figure><img src="'+design+'"><figcaption>'+esc(L.design)+'</figcaption></figure>'
      +'<figure><img src="'+png+'"><figcaption>'+esc(L.rendered)+'</figcaption></figure></div>'
      +'<div class="pv-axes"><span><b>'+esc(L.pixel)+'</b> '+(ax.pixel==null?'—':ax.pixel+'%')+'</span>'
      +'<span><b>'+esc(L.colour)+'</b> '+(ax.colour==null?'—':ax.colour+'%')+'</span>'
      +'<span>'+f.components+' '+esc(L.components)+'</span>'
      +'<span>'+f.failing+' '+esc(L.failing)+'</span></div>';
    if(fonts&&fonts.length){
      h+='<div class="pv-warn"><b>'+esc(L.fontMissing)+'</b>: '
        +fonts.map(function(x){return esc(x.family)}).join(', ')
        +'<div class="muted">'+esc(L.fontNote)+'</div></div>';
    }
    if(f.worst&&f.worst.length){
      h+='<div class="muted">'+esc(L.worst)+'</div>';
      f.worst.slice(0,8).forEach(function(w){
        h+='<div class="pv-row"><span>'+esc(w.name||w.id)+'</span><span>'
          +w.pixel+'%'+(w.deltaE!=null?' · ΔE '+w.deltaE:'')+'</span></div>';
      });
    }
    el.innerHTML=h;
  }

  function apply(p,st){
    if(!st)return;
    if(st.status==='running'){dot(p,'run');status(p,L.running);}
    else if(st.status==='done'){dot(p,'ok');
      status(p,st.ms?(st.ms/1000).toFixed(1)+'s':'');
      if(st.fidelity)renderResult(p,st.fidelity,st.missingFonts);}
    else if(st.status==='failed'){dot(p,'bad');status(p,L.failed+': '+(st.error||''));}
    else{dot(p,'');status(p,L.pending);}
  }

  function busy(on){run.disabled=on;run.textContent=on?L.running:(loaded?L.again:L.run);}

  // One stream per job. Reopening the drawer reuses the running one instead
  // of opening a second subscription to the same work.
  function subscribe(id){
    if(stream){stream.close();stream=null;}
    active=id; busy(true); loaded=true;
    var es=new EventSource('/api/preview/'+id+'/events');
    stream=es;
    es.addEventListener('state',function(e){
      var d=JSON.parse(e.data);
      Object.keys(d.platforms||{}).forEach(function(p){apply(p,d.platforms[p])});
      if(d.status&&d.status!=='running')busy(false);
    });
    es.addEventListener('progress',function(e){
      var d=JSON.parse(e.data);
      if(d.phase==='start')apply(d.platform,{status:'running'});
      else if(d.phase==='log')status(d.platform,d.line);
      else if(d.phase==='done')apply(d.platform,{status:'done',fidelity:d.fidelity,ms:d.ms,missingFonts:d.missingFonts});
      else if(d.phase==='failed')apply(d.platform,{status:'failed',error:d.error});
    });
    es.addEventListener('end',function(){es.close();stream=null;busy(false);});
    es.onerror=function(){es.close();stream=null;busy(false);};
  }

  // Restore whatever the server already has for this screen.
  function restore(){
    if(loaded)return;
    fetch('/api/preview-latest?project='+encodeURIComponent(PROJ)+'&screen='+encodeURIComponent(SCR))
      .then(function(r){return r.json()})
      .then(function(j){
        if(j.none||!j.id){busy(false);return;}
        loaded=true;
        Object.keys(j.platforms||{}).forEach(function(p){apply(p,j.platforms[p])});
        if(j.status==='running')subscribe(j.id); else busy(false);
      })
      .catch(function(){busy(false)});
  }

  function start(){
    ['web','ios','android'].forEach(function(p){
      apply(p,{status:'pending'});
      var el=document.querySelector('[data-body="'+p+'"]');
      if(el)el.innerHTML='';
    });
    busy(true);
    fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({project:PROJ,screen:SCR})})
      .then(function(r){return r.json()})
      .then(function(j){ if(j.id)subscribe(j.id); else busy(false); })
      .catch(function(){busy(false)});
  }

  function open(){
    drawer.hidden=false;scrim.hidden=false;drawer.setAttribute('aria-hidden','false');
    restore();
  }
  // Closing hides the view; the render keeps going on the server.
  function shut(){
    drawer.hidden=true;scrim.hidden=true;drawer.setAttribute('aria-hidden','true');
  }

  fab.onclick=open; close.onclick=shut; scrim.onclick=shut;
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!drawer.hidden)shut()});
  run.onclick=start;

  // ?preview=open restores the last result without rendering; ?preview=1
  // also starts a fresh render. Both are useful for a shared link.
  var want=(location.search.match(/[?&]preview=([a-z0-9]+)/)||[])[1];
  if(want==='open')open();
  else if(want==='1'){open();start();}
}
` + "})();<\/script>";
}

