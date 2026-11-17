const concepts = window.CONCEPTS.sort((first, second) => first.id.localeCompare(second.id));
const main = document.querySelector("#main");
const modal = document.querySelector("#modal");
const announcement = document.querySelector("#announcement");
const assetRoot = "../interaction-prototype/assets/";
const media = [
  { file: "sea.jpg", title: "海边的傍晚", kind: "image", format: "JPEG", size: "3024 × 4032" },
  { file: "forest.jpg", title: "森林里的风", kind: "live", format: "照片 + MOV", size: "实况配对" },
  { file: "coffee.jpg", title: "一杯慢下来的时间", kind: "image", format: "JPEG", size: "4032 × 3024" },
  { file: "trail.jpg", title: "沿着小路走", kind: "video", format: "MP4", size: "00:08" },
  { file: "light.jpg", title: "树隙之间的光", kind: "image", format: "JPEG", size: "3024 × 4032" },
  { file: "sunset.jpg", title: "落日的最后一刻", kind: "gif", format: "GIF", size: "动图" }
];
const labels = { image: "图片", live: "实况", gif: "GIF", video: "视频" };
const paths = {
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  folder: '<path d="M3 7V5h6l2 2h10v12H3z"/>',
  photos: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m4 16 5-5 4 4 3-3 4 4"/><circle cx="15" cy="9" r="1"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6m3-4v6l4 2"/>',
  refresh: '<path d="M20 6v5h-5M4 18v-5h5M18 8A7 7 0 0 0 6 6L3 10m18 4-3 4A7 7 0 0 1 6 16"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  zoom: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  leaf: '<path d="M19 3C8 2 2 8 5 15s15 3 14-12ZM5 20 15 8"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 9-13h-7z"/>',
  heart: '<path d="M12 20S2 14 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 6-10 12-10 12Z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.photos}</svg>`;
const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const freshState = () => ({
  selected: new Set([0, 1, 2, 3, 4, 5]), focus: 0, step: 1, filter: "all",
  target: "photos", album: "旅行灵感", folder: "下载 / 存图夹", status: "idle",
  source: "xhs", scene: "ready", failure: false, progress: 0, pending: [],
  succeeded: new Set(), failed: new Set(), stopped: false, history: [], narrow: false
});
let state = freshState();
let current;
let saveTimer;
let toastTimer;
let destinationDraft;
let modalKind;
let returnFocus;

function getMedia(index) {
  const item = media[index];
  if (state.source === "x" && item.kind === "live") return { ...item, kind: "gif", format: "MP4", size: "X 动图" };
  if (state.source === "x" && item.kind === "gif") return { ...item, format: "MP4", size: "X 动图" };
  return item;
}

function targetText() {
  return state.target === "photos" ? `照片 · ${state.album}` : `文件夹 · ${state.folder}`;
}

function makeApi() {
  return {
    state, count: state.selected.size, icon,
    header: () => `<header class="p-header"><div class="brand"><span class="brand-symbol">${icon("photos")}</span><span>存图夹</span></div><button class="quiet" data-action="refresh" aria-label="重新读取当前页面" ${state.status === "saving" ? "disabled" : ""}>${icon("refresh")}</button><button class="quiet" data-action="history" aria-label="查看保存记录">${icon("history")}<span>记录</span></button></header>`,
    source: () => `<section class="p-source"><h3>${state.source === "xhs" ? "周末，去有风的地方" : "A few moments worth keeping."}</h3><div class="source-meta"><span class="source-dot"></span><span>${state.source === "xhs" ? "小红书 · 小林的周末" : "X · @weekendnotes"}</span><span>· 6 个媒体</span><button class="quiet" data-action="source" ${state.status === "saving" ? "disabled" : ""} aria-label="切换小红书或 X 演示">切换</button></div></section>`,
    tools: () => `<div class="p-tools"><div class="selection-row"><span>已选 <strong>${state.selected.size}</strong> / 6</span><button class="quiet" data-action="all" ${state.status !== "idle" ? "disabled" : ""}>${state.selected.size === 6 ? "取消全选" : "全选"}</button></div><div class="filter-row" aria-label="按媒体类型筛选">${[["all","全部"],["image","图片"],["live",state.source === "x" ? "动图" : "实况"],["video","视频"]].map(([value,label]) => `<button data-action="filter" data-value="${value}" aria-pressed="${state.filter === value}">${label}</button>`).join("")}</div></div>`,
    gallery: (options = {}) => renderGallery(options),
    destination: () => `<button class="p-destination" data-action="target" ${state.status !== "idle" ? "disabled" : ""}>${icon(state.target === "photos" ? "photos" : "folder")}<span><small>保存位置</small><b>${escapeHtml(targetText())}</b></span><em>更改</em>${icon("arrow")}</button>`,
    action: () => renderAction(),
    hero: () => `<button class="hero-media" data-action="preview" data-index="${state.focus}" aria-label="放大查看${media[state.focus].title}"><img src="${assetRoot}${media[state.focus].file}" alt="${media[state.focus].title}"><span>${labels[getMedia(state.focus).kind]} · 点击放大</span></button>`,
    filmstrip: () => `<div class="filmstrip" aria-label="切换当前预览">${media.map((item,index) => `<button data-action="focus" data-index="${index}" aria-pressed="${state.focus === index}" aria-label="预览第 ${index + 1} 项：${item.title}"><img src="${assetRoot}${item.file}" alt=""></button>`).join("")}</div>`,
    detail: () => `<div class="p-detail"><strong>${state.focus + 1}. ${media[state.focus].title}</strong><small>${getMedia(state.focus).format} · ${getMedia(state.focus).size}</small></div>`,
    steps: () => `<nav class="p-steps" aria-label="保存步骤">${["选择媒体","保存位置","确认保存"].map((label,index) => `<button data-action="set-step" data-value="${index + 1}" ${state.step === index + 1 ? 'aria-current="step"' : ""} ${state.status === "saving" ? "disabled" : ""}><span>${index + 1}</span>${label}</button>`).join("")}</nav>`
  };
}

function renderGallery({ layout = "grid", columns = 3, limit = 6 } = {}) {
  const visible = media.map((item,index) => index).filter(index => state.filter === "all" || getMedia(index).kind === state.filter || state.filter === "live" && state.source === "x" && getMedia(index).kind === "gif").slice(0,limit);
  return `<div class="p-gallery" data-layout="${layout}" style="--columns:${columns}">${visible.map(index => {
    const item = getMedia(index);
    const result = state.succeeded.has(index) ? '<span class="media-result">已保存</span>' : state.failed.has(index) ? '<span class="media-result failed">保存失败</span>' : "";
    return `<div class="media-card"><button class="media-pick" data-action="toggle" data-index="${index}" aria-label="选择第 ${index + 1} 项：${item.title}" aria-pressed="${state.selected.has(index)}" ${state.status !== "idle" ? "disabled" : ""}><img class="media-image" src="${assetRoot}${item.file}" alt="${item.title}" loading="lazy"><span class="media-check">${icon("check")}</span><span class="media-index">${String(index + 1).padStart(2,"0")}</span><span class="media-badge">${labels[item.kind]}</span></button>${layout === "list" ? `<div class="media-row-copy"><strong>${item.title}</strong><small>${item.format} · ${item.size}</small></div>` : ""}${result}<button class="media-zoom" data-action="preview" data-index="${index}" aria-label="放大第 ${index + 1} 项">${icon("zoom")}</button></div>`;
  }).join("")}</div>`;
}

function renderAction() {
  if (state.status === "saving") {
    return `<div class="p-action"><div class="progress-line"><strong>正在保存</strong><span>${state.progress} / ${state.pending.length}</span></div><progress aria-label="保存进度" max="${state.pending.length}" value="${state.progress}"></progress><div class="saving-footer"><small>演示进度 · 不写入真实照片</small><button class="quiet" data-action="stop">停止任务</button></div></div>`;
  }
  if (state.status === "result") {
    return `<div class="p-action"><div class="p-result" role="status"><strong>${state.stopped ? "任务已停止" : state.failed.size ? "部分媒体尚未保存" : "已经收好了"}${!state.stopped && !state.failed.size ? " ✓" : ""}</strong><small>成功 ${state.succeeded.size} 项${state.failed.size ? `，失败 ${state.failed.size} 项` : ""}${state.stopped ? `，未处理 ${state.pending.length - state.progress} 项` : ""}<br>${escapeHtml(targetText())}</small><div class="result-actions"><button class="quiet" data-action="details">查看逐项结果</button>${state.failed.size ? '<button class="quiet" data-action="retry">重试失败项</button>' : ""}<button class="quiet" data-action="history">保存记录</button></div></div><button class="primary" data-action="continue">继续选图${icon("arrow")}</button></div>`;
  }
  return `<div class="p-action"><button class="primary" data-action="save" ${!state.selected.size ? "disabled" : ""}>${icon(state.target === "photos" ? "photos" : "folder")}${state.selected.size ? `${state.target === "photos" ? "导入照片" : "导出到文件夹"} · ${state.selected.size} 项` : "请先选择媒体"}</button><p class="p-action-hint">保留原文件 · ${state.target === "photos" ? "实况配对导入" : "实况保存为照片与 MOV"}</p></div>`;
}

function prototypeHtml(concept) {
  const api = makeApi();
  let content;
  if (state.scene === "empty") {
    content = `${api.header()}<section class="empty-panel"><span class="empty-symbol">${icon("photos")}</span><h2>这一页还没有媒体</h2><p>请先打开小红书笔记或 X 帖子，<br>等图片加载后再重新读取。</p><button class="primary" data-action="refresh">重新读取演示页面</button></section>`;
  } else if (state.scene === "connector") {
    content = `${api.header()}<section class="empty-panel"><span class="empty-symbol">${icon("bolt")}</span><h2>连接照片之前，还差一步</h2><p>安装本机连接器后，就能把媒体<br>保存到 Mac 照片或本地文件夹。</p><button class="primary" data-action="setup">查看安装步骤</button><button class="quiet" data-action="refresh">模拟连接成功</button></section>`;
  } else {
    content = concept.render(api);
  }
  return `<div class="prototype" data-concept="${concept.id}">${content}</div>`;
}

function renderOverview() {
  main.innerHTML = `<div class="overview"><section class="overview-intro"><div><div class="intro-kicker">同一个存图夹，十种可能</div><h1>喜欢的瞬间，<br>用喜欢的方式收藏。</h1><p class="intro-copy">为存图夹设计的 10 套外观与交互方案。<br>收藏小红书与 X 的图片、动图和视频，存入 Mac 照片或本地文件夹。点开一套，亲手试试。</p></div><aside class="intro-side"><strong>10 套里，5 套已经能直接用。</strong>01、02、03、06、10 已作为正式扩展的外观主题；其余 5 套保留为浏览、快捷操作、清单或独立工作台方向。正式扩展顶部已有调色盘入口。</aside></section><details class="theme-guide"><summary>这 10 套如何成为存图夹的主题？</summary><p>10 套中有 5 套已经作为外观主题接入正式扩展：01 原生轻巧、02 珊瑚随收（默认）、03 暗房精选、06 林间藏品、10 轻快贴纸。主题切换只改变颜色、字体、圆角、材质和阴影，不会重置已选媒体、保存位置或正在进行的任务。</p><p><b>交互单独选择：</b>04 生活剪报、05 快捷收纳、07 工作清单、08 逐步引导、09 双栏工作保留为交互方向。它们会改变浏览密度、步骤或页面形态，不是单纯换肤；09 需要独立工作台入口。</p><p>正式扩展顶部已有调色盘入口，选择保存在本机。这个 HTML 页面用于比较 10 套完整交互，不是正式扩展的一部分。</p></details><div class="collection-toolbar"><b>方案总览 <span> / 10 种收藏方式</span></b><span>5 套已接入主题 · 5 套交互方向 · 1 套需独立页面</span></div><section class="concept-grid" aria-label="10 套设计方案">${concepts.map(concept => `<article class="concept-card"><a class="concept-cover" href="#${concept.id}" aria-label="体验 ${concept.id} ${concept.name}" style="--cover:${concept.colors[0] === "#25262b" ? "#d8dce5" : concept.colors[0]};--preview-width:${concept.width}px;--preview-scale:${concept.kind === "workspace" ? ".43" : ".71"}"><span class="concept-number">${concept.id}</span><div class="concept-mini" inert aria-hidden="true">${prototypeHtml(concept)}</div></a><div class="concept-copy"><div class="concept-heading"><h2><a href="#${concept.id}">${concept.name}</a></h2><a href="#${concept.id}">体验方案 ${icon("arrow")}</a></div><div class="concept-english">${concept.english}</div><p>${concept.subtitle}</p><div class="concept-tags"><span class="type-tag">${concept.kind === "workspace" ? "独立工作台" : `${concept.width}px 弹窗`}</span>${concept.themeId ? `<span class="status-tag theme-tag">已接入主题</span>${concept.defaultTheme ? '<span class="status-tag default-tag">默认主题</span>' : ""}` : '<span class="status-tag interaction-tag">交互方案</span>'}${concept.colors.map(color => `<span class="swatch" style="background:${color}" aria-hidden="true"></span>`).join("")}</div></div></article>`).join("")}</section><footer class="overview-foot"><span>基于存图夹 v1.8.0 的媒体选择、双目的地保存、后台任务与逐项重试流程设计。<br>正式扩展已接入 5 套外观主题；其余 5 套为交互探索。图片复用项目已有预览素材，署名见 <a href="../interaction-prototype/sources.md">素材来源</a>。</span><span>纯 HTML / CSS / JavaScript<br>本地可打开，无需安装依赖。</span></footer></div>`;
}

function formalExtensionSection(concept) {
  const copy = concept.themeId
    ? `已作为「${concept.name}」外观主题接入${concept.defaultTheme ? "，并设为默认外观" : ""}；正式版统一使用当前弹窗布局。`
    : `保留为「${concept.interaction}」交互方向，尚未接入正式扩展；需要改动浏览密度、步骤或页面形态。`;
  const tokens = concept.themeTokens
    ? `<div class="formal-tokens" aria-label="${concept.name}正式主题色">${concept.themeTokens.map(color => `<span style="background:${color}" title="${color}"></span>`).join("")}</div>`
    : "";
  return `<section class="detail-section extension-state"><h2>正式扩展</h2><p>${copy}</p>${tokens}</section>`;
}

function renderStudio() {
  const active = document.activeElement;
  const focused = active?.dataset.action ? { action: active.dataset.action, index: active.dataset.index, value: active.dataset.value } : null;
  const currentIndex = concepts.indexOf(current);
  main.innerHTML = `<div class="workbench"><nav class="concept-nav" aria-label="选择设计方案"><div class="nav-top">十种收藏方式</div>${concepts.map(concept => `<a href="#${concept.id}" ${current === concept ? 'aria-current="page"' : ""}><span class="nav-number">${concept.id}</span><span><b>${concept.name}</b><small>${concept.english}</small></span></a>`).join("")}</nav><section class="stage" aria-label="可交互预览"><div class="stage-toolbar"><span>${current.kind === "workspace" ? "独立页面概念" : "浏览器弹窗概念"} · ${state.narrow ? "360" : current.width}px</span><div class="stage-toolbar-actions"><button class="studio-button" data-action="narrow" aria-pressed="${state.narrow}">窄屏 360</button><select aria-label="演示场景" data-control="scene"><option value="ready" ${state.scene === "ready" ? "selected" : ""}>正常选图</option><option value="empty" ${state.scene === "empty" ? "selected" : ""}>未发现媒体</option><option value="connector" ${state.scene === "connector" ? "selected" : ""}>未连接照片</option></select><button class="studio-button" data-action="failure" aria-pressed="${state.failure}" ${state.status !== "idle" ? "disabled" : ""}>含 1 项失败</button><button class="studio-button" data-action="reset" aria-label="重置当前方案">${icon("refresh")}</button></div></div><div class="stage-canvas"><div class="frame" style="--frame-width:${state.narrow ? 360 : current.width}px"><div class="browser-chrome"><span class="browser-dots"><i></i><i></i><i></i></span><span>${state.source === "xhs" ? "xiaohongshu.com" : "x.com"} / ${current.kind === "workspace" ? "独立收藏工作台" : "当前页面"}</span><span>预览</span></div>${prototypeHtml(current)}</div><p class="stage-note">演示数据，不会下载文件或写入你的照片图库。<br>${current.kind === "workspace" ? "此方案需要新增独立页面入口，当前扩展尚无这一工作台。" : "外框用于方案预览；实际弹窗的可用高度随浏览器而变。"}${current.id === "03" ? "<br>视频与实况在此使用静态封面演示。" : ""}</p></div></section><aside class="design-details"><div class="detail-number">${current.id}</div><h1>${current.name}</h1><p class="english">${current.english}</p><p class="design-subtitle">${current.subtitle}</p><section class="detail-section"><h2>适合谁</h2><p>${current.audience}</p></section><section class="detail-section"><h2>交互路径</h2><ol class="flow-list">${current.flow.map((step,index) => `<li><span>${index + 1}</span>${step}</li>`).join("")}</ol></section><section class="detail-section"><h2>设计意图</h2><p>${current.rationale}</p><div class="color-tokens">${current.colors.map(color => `<span style="background:${color}" title="${color}"></span>`).join("")}</div></section><section class="detail-section"><h2>取舍</h2><p>${current.tradeoff}</p></section><div class="design-pagination"><a class="studio-button" href="#${concepts[(currentIndex + 9) % 10].id}">${icon("back")}上一套</a><a class="studio-button" href="#${concepts[(currentIndex + 1) % 10].id}">下一套${icon("arrow")}</a></div></aside></div>`;
  main.querySelector(".design-subtitle")?.insertAdjacentHTML("afterend", formalExtensionSection(current));
  if (focused && !modal.open) {
    const candidates = [...main.querySelectorAll("[data-action]")];
    const replacement = candidates.find(button => button.dataset.action === focused.action && button.dataset.index === focused.index && button.dataset.value === focused.value);
    replacement?.focus({ preventScroll: true });
  }
}

function notify(message) {
  announcement.textContent = message;
  announcement.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => announcement.classList.remove("visible"),2800);
}

function modalHeader(title) {
  return `<div class="modal-heading"><h2 id="modal-title">${title}</h2><button data-action="close-modal" aria-label="关闭">${icon("close")}</button></div>`;
}

function showModal(kind) {
  if (!modal.open) returnFocus = document.activeElement;
  modalKind = kind;
  renderModal();
  if (!modal.open) modal.showModal();
}

function renderModal() {
  if (modalKind === "target") {
    modal.innerHTML = `${modalHeader("保存到哪里")}<p class="modal-note">选择此次保存的位置。确认后才应用更改。</p><div class="modal-tabs"><button data-action="draft-target" data-value="photos" aria-pressed="${destinationDraft.target === "photos"}">${icon("photos")}Mac 照片</button><button data-action="draft-target" data-value="folder" aria-pressed="${destinationDraft.target === "folder"}">${icon("folder")}本地文件夹</button></div>${destinationDraft.target === "photos" ? `<label class="modal-field" for="album">目标相簿</label><select id="album" data-control="album">${["图库","旅行灵感","日常收藏","设计参考"].map(name => `<option ${destinationDraft.album === name ? "selected" : ""}>${name}</option>`).join("")}</select><p class="modal-note">演示相簿。实况以照片与视频配对导入。</p>` : `<label class="modal-field" for="folder">演示文件夹</label><select id="folder" data-control="folder">${["下载 / 存图夹","桌面 / 灵感素材","图片 / 周末旅行"].map(name => `<option ${destinationDraft.folder === name ? "selected" : ""}>${name}</option>`).join("")}</select><p class="modal-note">正式版会打开系统文件夹选择器。每篇笔记独立建目录；实况保存为照片 + MOV 配对文件。</p>`}<button class="primary" data-action="confirm-target">使用这个位置</button><button class="quiet" data-action="close-modal">取消</button>`;
  } else if (modalKind === "preview") {
    const item = getMedia(state.focus);
    modal.innerHTML = `${modalHeader(`${state.focus + 1} / 6 · ${item.title}`)}<img class="preview-full" src="${assetRoot}${item.file}" alt="${item.title}"><p class="modal-note">${labels[item.kind]} · ${item.format} · ${item.size}${item.kind !== "image" ? "<br>此原型只展示静态封面，不模拟媒体播放。" : ""}</p><div class="preview-controls"><button data-action="previous-image" aria-label="上一项">${icon("back")}</button><button data-action="preview-toggle" aria-pressed="${state.selected.has(state.focus)}" ${state.status !== "idle" ? "disabled" : ""}>${state.selected.has(state.focus) ? "✓ 已选择" : "选择此项"}</button><button data-action="next-image" aria-label="下一项">${icon("arrow")}</button></div>`;
  } else if (modalKind === "history") {
    modal.innerHTML = `${modalHeader("保存记录")}<p class="modal-note">本次方案体验中的成功记录。切换方案或刷新页面后重置。</p>${state.history.length ? state.history.map(record => `<article class="history-entry"><img src="${assetRoot}${media[record.index].file}" alt=""><div><strong>${escapeHtml(record.title)}</strong><p>${record.time} · 成功 ${record.count} 项<br>${escapeHtml(record.target)}<br>媒体编号：${record.indices.join("、")}</p></div></article>`).join("") : '<div class="empty-panel"><span class="empty-symbol">' + icon("history") + '</span><h2>还没有保存记录</h2><p>试着保存几张图片，成功记录就会出现在这里。</p></div>'}<button class="primary" data-action="close-modal">返回选图</button>${state.history.length ? '<button class="quiet" data-action="clear-history">清除演示记录</button>' : ""}`;
  } else if (modalKind === "clear-history") {
    modal.innerHTML = `${modalHeader("清除演示记录？")}<p class="modal-note">只清除本次体验中的记录，不影响真实照片和文件。</p><button class="primary" data-action="confirm-clear">清除记录</button><button class="quiet" data-action="history">取消</button>`;
  } else if (modalKind === "details") {
    modal.innerHTML = `${modalHeader("逐项保存结果")}${[...state.selected].map(index => `<div class="detail-row">${index + 1}. ${media[index].title}<small>${state.succeeded.has(index) ? `已保存 · ${getMedia(index).format}` : state.failed.has(index) ? "下载超时（演示） · 可重试这一项" : "尚未处理"}<br>${escapeHtml(targetText())}</small></div>`).join("")}${state.failed.size ? '<button class="primary" data-action="retry">只重试失败项</button>' : '<button class="primary" data-action="close-modal">完成</button>'}`;
  } else if (modalKind === "setup") {
    modal.innerHTML = `${modalHeader("连接到你的 Mac")}<ol class="modal-note"><li>运行项目中的 native-host/install.command。</li><li>在 Chrome 加载扩展，再重新打开弹窗。</li><li>系统询问时，允许 Chrome 控制「照片」。</li></ol><p class="modal-note">这里只演示引导界面。下面的按钮会回到模拟选图状态。</p><button class="primary" data-action="connected">模拟已完成连接</button>`;
  }
}

function closeModal() {
  modal.close();
  const action = returnFocus?.dataset.action;
  const index = returnFocus?.dataset.index;
  const control = [...main.querySelectorAll("[data-action]")].find(button => button.dataset.action === action && button.dataset.index === index);
  control?.focus({ preventScroll: true });
}

function finishSave() {
  clearInterval(saveTimer);
  state.status = "result";
  const completed = state.pending.slice(0,state.progress).filter(index => state.succeeded.has(index));
  if (completed.length) {
    state.history.unshift({
      index: completed[0], count: completed.length, indices: completed.map(index => index + 1),
      title: state.source === "xhs" ? "周末，去有风的地方" : "A few moments worth keeping.",
      target: targetText(), time: new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})
    });
  }
  renderStudio();
  notify(state.stopped ? "任务已停止，已完成的媒体保留。" : state.failed.size ? "有 1 项保存失败，可单独重试。" : `已完成 ${state.succeeded.size} 项演示保存。`);
}

function startSave(retry = false) {
  if (state.status === "saving" || (!retry && state.status !== "idle")) return;
  if (!state.selected.size) return notify("请先选择至少一个媒体。");
  const pending = retry ? [...state.failed] : [...state.selected];
  if (!pending.length) return;
  if (!retry) {
    state.succeeded.clear();
    state.failed.clear();
  } else {
    state.failed.clear();
  }
  state.pending = pending;
  state.progress = 0;
  state.stopped = false;
  state.status = "saving";
  state.step = 3;
  if (modal.open) closeModal();
  renderStudio();
  const failedIndex = state.failure && !retry ? pending[pending.length - 1] : -1;
  saveTimer = setInterval(() => {
    const index = state.pending[state.progress];
    if (index === failedIndex) state.failed.add(index);
    else state.succeeded.add(index);
    state.progress += 1;
    if (state.progress >= state.pending.length) finishSave();
    else renderStudio();
  },550);
}

function toggleSelection(index) {
  if (state.status !== "idle") return;
  if (state.selected.has(index)) state.selected.delete(index);
  else state.selected.add(index);
  renderStudio();
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled || !current) return;
  const action = button.dataset.action;
  const index = Number(button.dataset.index);
  const value = button.dataset.value;
  if (action === "toggle") toggleSelection(index);
  else if (action === "focus") { state.focus = index; renderStudio(); }
  else if (action === "all" && state.status === "idle") { state.selected = state.selected.size === 6 ? new Set() : new Set([0,1,2,3,4,5]); renderStudio(); }
  else if (action === "filter") { state.filter = value; renderStudio(); }
  else if (action === "target" && state.status === "idle") { destinationDraft = { target: state.target, album: state.album, folder: state.folder }; showModal("target"); }
  else if (action === "draft-target") { destinationDraft.target = value; renderModal(); modal.querySelector(`[data-value="${value}"]`)?.focus(); }
  else if (action === "confirm-target") { Object.assign(state,destinationDraft); renderStudio(); closeModal(); notify(`保存位置已改为${targetText()}`); }
  else if (action === "shortcut-target" && state.status === "idle") { state.target = "photos"; state.album = value; renderStudio(); notify(`已选择相簿：${value}`); }
  else if (action === "preview") { state.focus = index; showModal("preview"); }
  else if (action === "previous-image" || action === "next-image") { state.focus = (state.focus + (action === "next-image" ? 1 : 5)) % 6; renderModal(); renderStudio(); modal.querySelector(`[data-action="${action}"]`)?.focus(); }
  else if (action === "preview-toggle") { toggleSelection(state.focus); renderModal(); modal.querySelector('[data-action="preview-toggle"]')?.focus(); }
  else if (action === "close-modal") closeModal();
  else if (action === "save") startSave();
  else if (action === "retry") startSave(true);
  else if (action === "stop" && state.status === "saving") { state.stopped = true; finishSave(); }
  else if (action === "continue") { state.status = "idle"; state.succeeded.clear(); state.failed.clear(); state.step = 1; renderStudio(); }
  else if (["history","details","setup","clear-history"].includes(action)) showModal(action);
  else if (action === "confirm-clear") { state.history = []; showModal("history"); notify("演示记录已清除。"); }
  else if (action === "connected") { state.scene = "ready"; renderStudio(); closeModal(); }
  else if (action === "source" && state.status === "idle") { state.source = state.source === "xhs" ? "x" : "xhs"; state.filter = "all"; renderStudio(); }
  else if (action === "refresh" && state.status !== "saving") { state.scene = "ready"; renderStudio(); notify("已重新读取演示页面，找到 6 个媒体。"); }
  else if (["next-step","prev-step","set-step"].includes(action) && state.status !== "saving") {
    const step = action === "set-step" ? Number(value) : state.step + (action === "next-step" ? 1 : -1);
    if (step > 1 && !state.selected.size) return notify("先选至少一个媒体，再继续。");
    state.step = Math.max(1,Math.min(3,step)); renderStudio();
  } else if (action === "narrow") { state.narrow = !state.narrow; renderStudio(); }
  else if (action === "failure") { state.failure = !state.failure; renderStudio(); }
  else if (action === "reset") { clearInterval(saveTimer); state = freshState(); renderStudio(); notify("当前方案已重置。"); }
});

document.addEventListener("change", event => {
  const control = event.target.dataset.control;
  if (control === "scene") {
    clearInterval(saveTimer);
    state.scene = event.target.value;
    state.status = "idle";
    state.succeeded.clear(); state.failed.clear();
    renderStudio();
  } else if (control === "album") destinationDraft.album = event.target.value;
  else if (control === "folder") destinationDraft.folder = event.target.value;
});

document.addEventListener("keydown", event => {
  if (!current || current.id !== "05" || modal.open || event.ctrlKey || event.metaKey || event.altKey || ["INPUT","SELECT","TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (state.status !== "idle") return;
  if (/^[1-6]$/.test(event.key)) { event.preventDefault(); toggleSelection(Number(event.key) - 1); }
  else if (event.key.toLowerCase() === "a") { event.preventDefault(); state.selected = state.selected.size === 6 ? new Set() : new Set([0,1,2,3,4,5]); renderStudio(); }
  else if (event.key.toLowerCase() === "p") { event.preventDefault(); destinationDraft = { target: state.target, album: state.album, folder: state.folder }; showModal("target"); }
  else if (event.key === "Enter" && !["BUTTON","A"].includes(document.activeElement.tagName)) { event.preventDefault(); startSave(); }
});

modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
function route() {
  clearInterval(saveTimer);
  if (modal.open) closeModal();
  state = freshState();
  current = concepts.find(concept => concept.id === location.hash.slice(1));
  if (current) renderStudio();
  else renderOverview();
  document.title = current ? `${current.id} ${current.name} · 存图夹` : "存图夹 · 十种收藏方式";
  window.scrollTo(0,0);
}
window.addEventListener("hashchange",route);
route();
