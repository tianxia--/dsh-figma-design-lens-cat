// User-facing strings, keyed. Source code stays English-only; anything a person
// reads goes through here so the same build serves both languages.
//
// Language is chosen per request (?lang=), remembered in a cookie, and defaults
// to English — the code, the API and the logs are English, so an untranslated
// string degrades to something consistent rather than to a mixed-language page.
export const LANGS = ["en", "zh"];
export const DEFAULT_LANG = "en";

const S = {
  "app.name":            { en: "dsh-figma-design-lens-cat",                 zh: "dsh-figma-design-lens-cat" },
  "app.tagline":         { en: "Figma design understanding",  zh: "Figma 设计识别" },
  "app.local":           { en: "Local service · data stays on this machine", zh: "本地服务 · 数据不出机器" },

  "nav.home":            { en: "Home",      zh: "首页" },
  "nav.projects":        { en: "Projects",  zh: "项目" },
  "nav.settings":        { en: "Settings",  zh: "设置" },
  "nav.bench":           { en: "Benchmark", zh: "基准" },
  "bench.title":         { en: "Fidelity benchmark", zh: "还原度基准" },
  "bench.hint":          { en: "A fixed set of screens scored the same way every run, so a change is measurable",
                           zh: "固定的一组界面按同一方式评分，使每次改动可被衡量" },
  "bench.screens":       { en: "screens in the set", zh: "个界面入选" },
  "bench.noSet":         { en: "no set yet — run: dsh-figma-design-lens-cat bench init <figma url>",
                           zh: "尚未建立基准集 — 运行 dsh-figma-design-lens-cat bench init <figma 链接>" },
  "bench.history":       { en: "Runs", zh: "历次运行" },
  "bench.noRuns":        { en: "no runs recorded yet", zh: "尚无运行记录" },
  "bench.when":          { en: "When", zh: "时间" },
  "bench.label":         { en: "Label", zh: "标签" },
  "bench.overall":       { en: "Overall", zh: "总体" },
  "bench.source":        { en: "Source", zh: "来源" },
  "nav.back":            { en: "Back",      zh: "返回" },
  "nav.backHome":        { en: "Home",      zh: "首页" },

  "home.title":          { en: "Home",                        zh: "首页" },
  "home.subtitle":       { en: "Paste a Figma link to analyse a screen", zh: "粘贴 Figma 链接，开始识别" },
  "home.empty":          { en: "Paste a Figma design link to begin. The link must be copied <b>with a frame selected</b> (it then contains node-id).",
                           zh: "粘贴一个 Figma 设计链接开始分析。链接需在 Figma 中<b>选中画板后复制</b>（含 node-id）。" },
  "home.labelPlaceholder": { en: "Project label (optional)",   zh: "项目标签（可选）" },
  "home.labelTitle":     { en: "Leave empty to use the Figma file name. A label is recorded as an alias.",
                           zh: "留空则使用 Figma 文件名。填写的名称会记为别名。" },
  "home.urlPlaceholder": { en: "https://www.figma.com/design/.../x?node-id=5579-625967", zh: "https://www.figma.com/design/.../x?node-id=5579-625967" },
  "home.analyse":        { en: "Analyse",    zh: "分析" },
  "home.analysing":      { en: "Analysing…", zh: "分析中…" },
  "home.hint":           { en: "Takes 1–3 minutes. <b>Switching pages does not interrupt it</b> — the job runs on the server and this page restores its progress.",
                           zh: "分析约需 1–3 分钟。<b>切换页面不会中断</b>——任务在服务端运行，回到本页会自动恢复进度。" },
  "home.you":            { en: "You:",       zh: "你：" },
  "home.done":           { en: "Analysis complete.", zh: "分析完成。" },
  "home.viewResult":     { en: "View result →", zh: "查看识别结果 →" },
  "home.failed":         { en: "Failed:",     zh: "失败：" },
  "home.running":        { en: "Running…",    zh: "运行中…" },

  "home.noToken":        { en: "No Figma token configured. Go to", zh: "尚未配置 Figma token，请先到" },
  "home.clear":          { en: "Clear history", zh: "清空记录" },
  "home.noToken":        { en: "No Figma token configured. Go to", zh: "尚未配置 Figma token，请先到" },

  "projects.title":      { en: "Projects",   zh: "项目" },
  "projects.count":      { en: "projects",   zh: "个项目" },
  "projects.empty":      { en: "No projects yet. Go to <a href=\"{home}\">Home</a> and paste a Figma link.",
                           zh: "还没有项目。到 <a href=\"{home}\">首页</a> 粘贴一个 Figma 链接开始。" },
  "projects.screens":    { en: "screens",    zh: "个界面" },
  "projects.components": { en: "components", zh: "个组件" },
  "projects.ready":      { en: "ready to build", zh: "可直接实现" },
  "projects.updated":    { en: "updated",    zh: "更新于" },
  "projects.aliases":    { en: "aliases",    zh: "别名" },

  "screens.col.screen":  { en: "Screen",     zh: "界面" },
  "screens.col.components": { en: "Components", zh: "组件" },
  "screens.col.readiness":  { en: "Readiness",  zh: "完成度" },
  "screens.col.verdict":    { en: "Verdict",    zh: "结论" },
  "screens.col.analysed":   { en: "Analysed",   zh: "分析时间" },
  "screens.versions":    { en: "versions",   zh: "个版本" },
  "screens.pending":     { en: "items pending", zh: "项待补" },

  "screen.annotated":    { en: "Detection overlay (solid = file components · red dashed = pixels only)",
                           zh: "识别标注（实线=文件组件 · 红虚线=仅像素内容）" },
  "screen.readiness":    { en: "Readiness",  zh: "完成度" },
  "screen.recognition":  { en: "Recognition check", zh: "识别率验证" },
  "screen.detected":     { en: "detected",   zh: "检出" },
  "screen.explained":    { en: "explained by inventory", zh: "清单解释" },
  "screen.uncovered":    { en: "uncovered",  zh: "未覆盖" },
  "screen.composition":  { en: "Composition", zh: "组件构成" },
  "screen.layouts":      { en: "layout containers", zh: "布局容器" },
  "screen.decorRemoved": { en: "decoration excluded", zh: "已剔除装饰" },
  "screen.rasterOnly":   { en: "pixel-only regions", zh: "仅像素内容" },
  "screen.blockers":     { en: "Needs attention", zh: "待补充" },
  "screen.noBlockers":   { en: "No blockers",  zh: "无阻碍项" },
  "screen.assets":       { en: "Image assets", zh: "图片资源" },
  "screen.noAssets":     { en: "No exported assets", zh: "无导出资源" },
  "screen.artifacts":    { en: "Artifacts",   zh: "产物" },
  "screen.fullReview":   { en: "Full review page", zh: "完整评审页" },
  "screen.openFigma":    { en: "Open in Figma", zh: "在 Figma 打开" },
  "screen.reanalyse":    { en: "Re-analyse", zh: "重新分析" },
  "screen.reanalysing":  { en: "Re-analysing…", zh: "重新分析中…" },
  "screen.reanalyseHint": { en: "Fetch the design again and rebuild this screen's data",
                            zh: "重新拉取设计并重建该界面的数据" },
  "screen.spec":         { en: "Implementation spec", zh: "实现规格" },

  "preview.title":       { en: "Fidelity preview", zh: "还原度预览" },
  "preview.hint":        { en: "Render this screen on each platform and compare it with the design",
                           zh: "在各平台渲染此界面并与设计图对比" },
  "preview.run":         { en: "Preview fidelity", zh: "预览还原度" },
  "preview.running":     { en: "Rendering…",   zh: "渲染中…" },
  "preview.again":       { en: "Run again",    zh: "重新运行" },
  "preview.pending":     { en: "waiting",      zh: "等待中" },
  "preview.failed":      { en: "Failed",       zh: "失败" },
  "preview.design":      { en: "Design",       zh: "设计图" },
  "preview.rendered":    { en: "Rendered",     zh: "渲染结果" },
  "preview.pixel":       { en: "pixel",        zh: "像素" },
  "preview.colour":      { en: "colour",       zh: "颜色" },
  "preview.components":  { en: "components",   zh: "组件" },
  "preview.failing":     { en: "need attention", zh: "需关注" },
  "preview.worst":       { en: "Largest differences", zh: "差异最大的组件" },
  "preview.fontMissing": { en: "Design font not installed", zh: "设计字体未安装" },
  "preview.fontNote":    { en: "text was measured with this font; without it labels render at a different width, which limits the text scores",
                           zh: "文字按此字体测量；缺少它时标签宽度不同，文字类组件的分数因此受限" },
  "preview.unsupported": { en: "not available in this environment", zh: "当前环境不支持" },

  "verdict.ready":       { en: "Ready to build",        zh: "可直接实现" },
  "verdict.ready.raw":   { en: "Ready to build",        zh: "可直接实现" },

  // Blockers are stored as codes with parameters, so the reader's language
  // decides the wording. Prose stored at analysis time could never be switched.
  "blocker.semantics.unnamed.what": { en: "{count} non-text components have no usable name and cannot be named in code",
                                      zh: "{count} 个非文本组件没有可用名称，实现时无法命名" },
  "blocker.semantics.unnamed.fix":  { en: "run llm-enrich + merge-semantics, or name the layers in Figma",
                                      zh: "运行 llm-enrich + merge-semantics，或在 Figma 中补齐图层名" },
  "blocker.semantics.lowConfidence.what": { en: "{count} components have semantic confidence below 0.7",
                                      zh: "{count} 个组件的语义置信度低于 0.7" },
  "blocker.semantics.lowConfidence.fix":  { en: "confirm what these components are with a human",
                                      zh: "请人工确认这些组件的用途" },
  "blocker.assets.notExported.what": { en: "{count} image assets have not been exported to files",
                                      zh: "{count} 个图片资源尚未导出为文件" },
  "blocker.assets.notExported.fix":  { en: "run export-assets", zh: "运行 export-assets" },
  "blocker.interaction.noStates.what": { en: "{count} interactive elements have no state definitions (a static design contains none)",
                                      zh: "{count} 个交互元素缺少状态定义（静态设计稿不含交互态）" },
  "blocker.interaction.noStates.fix":  { en: "take them from the PRD or prototype, or ask design for hover/pressed/disabled/loading",
                                      zh: "从 PRD 或原型补充，或向设计确认 hover/pressed/disabled/loading 态" },
  "blocker.assets.rasterOnly.what": { en: "{count} regions exist only inside bitmaps and carry no structure",
                                      zh: "{count} 处内容仅存在于位图中，没有结构信息" },
  "blocker.assets.rasterOnly.fix":  { en: "if they must be interactive ask design to make them components; otherwise ship them with the image",
                                      zh: "若需要交互，请设计改为组件；否则随图片资源一起实现" },
  "blocker.coverage.uncovered.what": { en: "an independent detector found {count} regions not covered by this inventory",
                                      zh: "独立检测器发现 {count} 处未被清单覆盖的区域" },
  "blocker.coverage.uncovered.fix":  { en: "check the annotated overlay by hand", zh: "人工核对标注图" },
  "verdict.blocked":     { en: "Needs more input",      zh: "需补充后再实现" },

  "settings.title":      { en: "Settings",   zh: "设置" },
  "settings.subtitle":   { en: "Figma access and analysis options", zh: "配置 Figma 访问与分析选项" },
  "settings.token":      { en: "Figma personal access token", zh: "Figma 访问令牌" },
  "settings.tokenSet":   { en: "Configured: {v} (leave empty to keep)", zh: "已配置：{v}（留空则不修改）" },
  "settings.tokenHint":  { en: "Create it in Figma → Settings → Security → Personal access tokens. Stored only on this machine at {path} (mode 600).",
                           zh: "在 Figma → Settings → Security → Personal access tokens 生成。仅保存在本机 {path}（权限 600）。" },
  "settings.ownership":  { en: "Project ownership", zh: "项目归属" },
  "settings.ownershipHint": { en: "Projects are identified by the <b>Figma file</b>: every screen from one file belongs to one project, named after that file. This is not configurable.",
                           zh: "项目由 <b>Figma 文件</b>自动判定——同一设计文件的所有界面必然归入同一项目，使用该文件在 Figma 中的名称。无需也无法在此配置。" },
  "settings.detectors":  { en: "Run image-detector cross-check", zh: "运行图像检测器交叉验证" },
  "settings.detectorsHint": { en: "Verifies detection completeness with an independent vision model. Adds 10–20 seconds.",
                           zh: "用独立视觉模型复核识别完整性，约增加 10–20 秒。" },
  "settings.save":       { en: "Save",       zh: "保存" },
  "settings.test":       { en: "Test connection", zh: "测试连接" },
  "settings.saved":      { en: "Saved",      zh: "已保存" },
  "settings.testing":    { en: "Testing…",   zh: "测试中…" },
  "settings.language":   { en: "Language",   zh: "语言" },

  "job.lines":           { en: "lines",      zh: "行日志" },
  "job.finished":        { en: "Analysis finished", zh: "分析已完成" },
  "job.lines":           { en: "log lines",  zh: "行日志" },
  "job.autoProject":     { en: "auto-detect project", zh: "自动识别项目" },

  "error.notFound":      { en: "Not found",  zh: "未找到" },
  "error.pageMissing":   { en: "This page does not exist.", zh: "页面不存在。" },
  "error.projectMissing":{ en: "Project not found",  zh: "项目不存在" },
  "error.screenMissing": { en: "Screen not found",   zh: "界面不存在" },
  "error.needNodeId":    { en: "The link must contain node-id: select a frame in Figma, then copy the link.",
                           zh: "链接需包含 node-id：在 Figma 中选中画板后复制链接" },
  "error.needToken":     { en: "Configure a Figma token in Settings first.", zh: "请先在 Settings 中配置 Figma token" },
};

export function pickLang(req) {
  try {
    const u = new URL(req.url, "http://localhost");
    const q = u.searchParams.get("lang");
    if (q && LANGS.includes(q)) return q;
    const cookie = String(req.headers.cookie || "");
    const m = cookie.match(/lens_lang=(\w+)/);
    if (m && LANGS.includes(m[1])) return m[1];
  } catch { /* fall through */ }
  return DEFAULT_LANG;
}

export function translator(lang) {
  const L = LANGS.includes(lang) ? lang : DEFAULT_LANG;
  return (key, vars) => {
    const entry = S[key];
    let out = entry ? (entry[L] || entry.en || key) : key;
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split("{" + k + "}").join(String(v));
    return out;
  };
}

/**
 * Render a blocker in the reader's language.
 * Manifests written before blockers became coded still carry prose in `what`
 * and `fix`; those are passed through unchanged rather than dropped, so old
 * analyses stay readable until they are re-run.
 */
export function renderBlocker(b, t) {
  if (b.code) {
    return {
      axis: b.axis, severity: b.severity,
      what: t("blocker." + b.code + ".what", b.params || {}),
      fix: t("blocker." + b.code + ".fix", b.params || {}),
    };
  }
  return { axis: b.axis, severity: b.severity, what: b.what || "", fix: b.fix || "" };
}

export function verdictKey(v) {
  // Accept both the coded verdicts and the legacy Chinese ones.
  if (v === "ready" || v === "可直接实现") return "verdict.ready";
  if (v === "risky" || v === "可实现，注意已列风险") return "verdict.risky";
  return "verdict.blocked";
}
