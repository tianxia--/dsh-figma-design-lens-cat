// Design system for the management UI.
//
// The first stylesheet had 56 ad-hoc rules, zero variables, zero shadows, zero
// transitions, six radii and eight font sizes. That is why it read as cheap —
// not because there was no framework. Tokens first, then the components that
// consume them.
//
// Scales are deliberately short: 6 text sizes, 3 radii, 3 elevations. A short
// scale is what makes an interface look considered; a long one just looks
// arbitrary.
export const TOKENS = `
:root{
  --bg:#f7f7f8; --surface:#fff; --surface-2:#fafafa;
  --line:#e8e8ec; --line-strong:#d9d9e0;
  --ink:#18181b; --ink-2:#52525b; --ink-3:#8a8a94;
  --brand:#4f46e5; --brand-weak:#eef2ff; --brand-ink:#4338ca;
  --ok:#15803d; --ok-weak:#dcfce7;
  --warn:#b45309; --warn-weak:#fef3c7;
  --bad:#b91c1c; --bad-weak:#fee2e2;

  --t-xs:11px; --t-sm:12px; --t-md:13px; --t-lg:15px; --t-xl:18px; --t-2xl:22px;

  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px;

  --r-sm:8px; --r-md:12px; --r-full:999px;

  --e-1:0 1px 2px rgba(16,16,24,.04), 0 1px 3px rgba(16,16,24,.06);
  --e-2:0 2px 4px rgba(16,16,24,.04), 0 4px 12px rgba(16,16,24,.08);
  --e-3:0 8px 24px rgba(16,16,24,.12);

  --fast:120ms cubic-bezier(.2,0,.2,1);
  --med:200ms cubic-bezier(.2,0,.2,1);
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0b0b0f; --surface:#141419; --surface-2:#1a1a21;
    --line:#26262e; --line-strong:#33333d;
    --ink:#f4f4f5; --ink-2:#a1a1aa; --ink-3:#71717a;
    --brand:#818cf8; --brand-weak:#1e1b4b; --brand-ink:#a5b4fc;
    --ok-weak:#052e16; --warn-weak:#3b2503; --bad-weak:#450a0a;
    --e-1:0 1px 2px rgba(0,0,0,.4); --e-2:0 4px 12px rgba(0,0,0,.45); --e-3:0 8px 24px rgba(0,0,0,.5);
  }
}
`;

export const BASE = `
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
body{margin:0;background:var(--bg);color:var(--ink);
  font:var(--t-md)/1.6 -apple-system,BlinkMacSystemFont,"Inter","Segoe UI","PingFang SC",sans-serif}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
::selection{background:var(--brand-weak);color:var(--brand-ink)}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px;border-radius:var(--r-sm)}

.app{display:flex;min-height:100vh}

/* ---------- sidebar ---------- */
.side{width:224px;flex:0 0 224px;background:var(--surface);border-right:1px solid var(--line);
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{padding:var(--s-5) var(--s-4) var(--s-3);font-weight:650;font-size:var(--t-lg);letter-spacing:-.01em}
.brand small{display:block;font-weight:400;color:var(--ink-3);font-size:var(--t-xs);letter-spacing:0;margin-top:2px}
.nav{padding:var(--s-1) var(--s-2);display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:var(--r-sm);
  color:var(--ink-2);font-size:var(--t-md);transition:background var(--fast),color var(--fast)}
.nav a:hover{background:var(--surface-2);color:var(--ink);text-decoration:none}
.nav a.on{background:var(--brand-weak);color:var(--brand-ink);font-weight:600}
.nav .ico{width:18px;text-align:center;opacity:.8;font-size:var(--t-md)}
.side .foot{padding:var(--s-3) var(--s-4);border-top:1px solid var(--line);
  font-size:var(--t-xs);color:var(--ink-3)}
.langbar{margin-top:auto;padding:var(--s-3) var(--s-4);border-top:1px solid var(--line);
  display:flex;gap:6px;align-items:center}
.langbar .lbl{font-size:var(--t-xs);color:var(--ink-3);margin-right:auto}
.langbar a{font-size:var(--t-xs);padding:4px 10px;border-radius:var(--r-sm);color:var(--ink-2);
  border:1px solid var(--line);transition:all var(--fast)}
.langbar a:hover{border-color:var(--line-strong);text-decoration:none}
.langbar a.on{background:var(--ink);color:var(--surface);border-color:var(--ink)}

/* ---------- running job chip ---------- */
.runjob{display:block;padding:9px 11px;margin:var(--s-1) 0;border-radius:var(--r-sm);
  background:var(--warn-weak);border:1px solid transparent;font-size:var(--t-xs);
  color:var(--warn);transition:all var(--fast)}
.runjob:hover{text-decoration:none;box-shadow:var(--e-1)}
.runjob .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;
  margin-right:7px;animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

/* ---------- main ---------- */
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{background:var(--surface);border-bottom:1px solid var(--line);
  padding:var(--s-3) var(--s-5) var(--s-4);position:sticky;top:0;z-index:5}
.top h1{margin:0;font-size:var(--t-xl);font-weight:650;letter-spacing:-.01em}
.top .crumb{color:var(--ink-3);font-size:var(--t-sm);margin-top:3px}
.backrow{display:flex;align-items:center;gap:var(--s-2);margin-bottom:var(--s-2)}
.back{display:inline-flex;align-items:center;gap:5px;font-size:var(--t-sm);color:var(--ink-2);
  padding:4px 11px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface);
  transition:all var(--fast)}
.back:hover{background:var(--surface-2);border-color:var(--line-strong);text-decoration:none;color:var(--ink)}
.body{padding:var(--s-5);max-width:1320px;width:100%}

/* ---------- surfaces ---------- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  padding:var(--s-4) var(--s-4);box-shadow:var(--e-1)}
.card h3{margin:0 0 var(--s-3);font-size:var(--t-md);font-weight:650;letter-spacing:-.005em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:var(--s-4)}
.card.link{transition:transform var(--fast),box-shadow var(--fast),border-color var(--fast)}
.card.link:hover{transform:translateY(-2px);box-shadow:var(--e-2);border-color:var(--line-strong)}
.muted{color:var(--ink-3);font-size:var(--t-sm)}

/* ---------- readiness bars ---------- */
.axes{display:flex;gap:var(--s-3);margin-top:var(--s-3);flex-wrap:wrap}
.axis{flex:1;min-width:84px}
.axis .lbl{font-size:var(--t-xs);color:var(--ink-3);display:flex;justify-content:space-between;
  text-transform:capitalize}
.axis .lbl b{color:var(--ink-2);font-weight:600;font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:var(--r-full);background:var(--line);margin-top:5px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:var(--r-full);
  transition:width var(--med);animation:grow var(--med) both}
@keyframes grow{from{transform:scaleX(0);transform-origin:left}to{transform:scaleX(1)}}

/* ---------- table ---------- */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:var(--t-md);
  background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  overflow:hidden;box-shadow:var(--e-1)}
th,td{text-align:left;padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--surface-2);color:var(--ink-3);font-weight:600;font-size:var(--t-xs);
  text-transform:uppercase;letter-spacing:.04em}
tbody tr{transition:background var(--fast)}
tbody tr:hover{background:var(--surface-2)}
tr:last-child td{border-bottom:none}

/* ---------- pills ---------- */
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--r-full);
  font-size:var(--t-xs);font-weight:600;line-height:1.5}
.ok{background:var(--ok-weak);color:var(--ok)}
.warn{background:var(--warn-weak);color:var(--warn)}
.bad{background:var(--bad-weak);color:var(--bad)}
.tag{background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line)}

/* ---------- forms ---------- */
input,select,textarea{font:inherit;padding:10px 12px;border:1px solid var(--line-strong);
  border-radius:var(--r-sm);width:100%;background:var(--surface);color:var(--ink);
  transition:border-color var(--fast),box-shadow var(--fast)}
input::placeholder{color:var(--ink-3)}
input:focus,textarea:focus{outline:none;border-color:var(--brand);
  box-shadow:0 0 0 3px var(--brand-weak)}
button{font:inherit;font-weight:550;padding:10px 18px;border-radius:var(--r-sm);
  border:1px solid var(--ink);background:var(--ink);color:var(--surface);cursor:pointer;
  transition:all var(--fast)}
button:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--e-2)}
button:active:not(:disabled){transform:translateY(0);box-shadow:none}
button.ghost{background:var(--surface);color:var(--ink);border-color:var(--line-strong)}
button.ghost:hover:not(:disabled){background:var(--surface-2)}
button:disabled{opacity:.45;cursor:not-allowed}
.field{margin-bottom:var(--s-4)}
.field label{display:block;font-size:var(--t-sm);color:var(--ink-2);margin-bottom:6px;font-weight:550}
.hint{font-size:var(--t-xs);color:var(--ink-3);margin-top:6px;line-height:1.5}

/* ---------- chat feed ---------- */
.feed{min-height:260px;max-height:54vh;overflow:auto;padding:var(--s-1) var(--s-1) var(--s-3);
  scroll-behavior:smooth}
.msg-user{margin:var(--s-3) 0 var(--s-1);font-size:var(--t-md);word-break:break-all}
.msg-user b{color:var(--ink-3);font-weight:550;margin-right:6px}
.msg-log{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--t-xs);
  white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--line);
  border-radius:var(--r-sm);padding:10px 12px;margin:var(--s-1) 0;color:var(--ink-2);
  max-height:260px;overflow:auto}
.msg-note{margin:var(--s-1) 0 var(--s-3);font-size:var(--t-md)}
.empty{color:var(--ink-3);font-size:var(--t-sm);text-align:center;padding:var(--s-6) var(--s-4)}

/* ---------- toast ---------- */
.toast{position:fixed;bottom:var(--s-5);left:50%;transform:translateX(-50%) translateY(16px);
  background:var(--ink);color:var(--surface);padding:10px 18px;border-radius:var(--r-sm);
  font-size:var(--t-sm);box-shadow:var(--e-3);opacity:0;pointer-events:none;
  transition:opacity var(--med),transform var(--med);z-index:50}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ---------- skeleton ---------- */
.skel{background:linear-gradient(90deg,var(--line) 25%,var(--surface-2) 50%,var(--line) 75%);
  background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:var(--r-sm)}
@keyframes shimmer{to{background-position:-200% 0}}

@media (max-width:860px){
  .side{width:64px;flex:0 0 64px}
  .brand small,.nav a span:not(.ico),.langbar .lbl,.side .foot{display:none}
  .nav a{justify-content:center}
  .body{padding:var(--s-4)}
}
`;
