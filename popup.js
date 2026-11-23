const elements = {
  loading: document.querySelector("#loadingState"),
  empty: document.querySelector("#emptyState"),
  gallery: document.querySelector("#galleryState"),
  actionBar: document.querySelector("#actionBar"),
  grid: document.querySelector("#imageGrid"),
  title: document.querySelector("#noteTitle"),
  count: document.querySelector("#imageCount"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyMessage: document.querySelector("#emptyMessage"),
  refresh: document.querySelector("#refreshButton"),
  retry: document.querySelector("#retryButton"),
  toggleAll: document.querySelector("#toggleAllButton"),
  save: document.querySelector("#saveButton"),
  saveLabel: document.querySelector("#saveButtonLabel"),
  toast: document.querySelector("#toast"),
  destination: document.querySelector("#destinationSelect"),
  albumSettings: document.querySelector("#albumSettings"),
  album: document.querySelector("#albumSelect"),
  loadAlbums: document.querySelector("#loadAlbumsButton"),
  folderSettings: document.querySelector("#folderSettings"),
  chooseFolder: document.querySelector("#chooseFolderButton"),
  folderPath: document.querySelector("#folderPath"),
  destinationHint: document.querySelector("#destinationHint"),
  result: document.querySelector("#resultMessage"),
  retryFailed: document.querySelector("#retryFailedButton"),
  stop: document.querySelector("#stopButton"),
  history: document.querySelector("#historyList"),
  clearHistory: document.querySelector("#clearHistoryButton"),
  duplicateHint: document.querySelector("#duplicateHint")
};

let note = { title: "小红书笔记", url: "", site: "xhs", images: [] };
let selected = new Set();
let toastTimer;
const saveSession = new SaveSession();
let saveState = saveSession.view(note);
let folderPath = "";
let sourceTabId;
let session = {};
let saveHistory = [];
let historyOpen = false;
let resultDetails = "";
let previewIndex = 0;
let targetSnapshot;
const ui = Object.fromEntries(["appearanceButton", "photosTargetButton", "folderTargetButton", "historyButton", "historyPane", "contentPane", "changeTargetButton", "targetSummary", "targetDialog", "closeTargetButton", "confirmTargetButton", "themeDialog", "closeThemeButton", "previewDialog", "previewImage", "previewLabel", "closePreviewButton", "previousImageButton", "nextImageButton", "previewSelectButton", "detailsDialog", "detailTitle", "detailText", "closeDetailsButton", "sourceLink", "detailsButton", "taskProgress", "clearDialog", "cancelClearButton", "confirmClearButton"].map(id => [id, document.querySelector(`#${id}`)]));
const themeButtons = {
  coral: document.querySelector("#themeCoralButton"),
  native: document.querySelector("#themeNativeButton"),
  darkroom: document.querySelector("#themeDarkroomButton"),
  forest: document.querySelector("#themeForestButton"),
  sticker: document.querySelector("#themeStickerButton")
};
const THEMES = Object.keys(themeButtons);
const DEFAULT_THEME = "coral";
let activeTheme = DEFAULT_THEME;
function openDialog(dialog) { dialog.showModal(); }
function applyTheme(theme) {
  activeTheme = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (document.documentElement) document.documentElement.dataset.theme = activeTheme;
  for (const [name, button] of Object.entries(themeButtons)) {
    const selected = name === activeTheme;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
}
function chooseTheme(theme, { persist = true, focus = false } = {}) {
  applyTheme(theme);
  if (persist) void chrome.storage.local.set({ popupTheme: activeTheme });
  if (focus) themeButtons[activeTheme].focus();
}
function openThemeDialog() {
  ui.appearanceButton.setAttribute("aria-expanded", "true");
  openDialog(ui.themeDialog);
  themeButtons[activeTheme].focus();
}
function closeThemeDialog() {
  ui.themeDialog.close();
  ui.appearanceButton.setAttribute("aria-expanded", "false");
  ui.appearanceButton.focus();
}
function handleThemeKeydown(event) {
  const current = THEMES.indexOf(activeTheme);
  let next;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % THEMES.length;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current + THEMES.length - 1) % THEMES.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = THEMES.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  chooseTheme(THEMES[next], { focus: true });
}
applyTheme(DEFAULT_THEME);
ui.appearanceButton.setAttribute("aria-expanded", "false");
function targetSummary() {
  ui.targetSummary.textContent = elements.destination.value === "folder"
    ? `文件夹 · ${folderPath.split("/").filter(Boolean).pop() || "请选择位置"}`
    : `照片 · ${elements.album.selectedOptions[0]?.textContent || "图库"}`;
}
function switchHistory() {
  historyOpen = !historyOpen;
  ui.historyPane.classList.toggle("hidden", !historyOpen);
  ui.contentPane.classList.toggle("hidden", historyOpen);
  elements.actionBar.classList.toggle("hidden", historyOpen || !note.images.length);
  ui.historyButton.textContent = historyOpen ? "选图" : "记录";
}
const XHS_HOST = /^https?:\/\/([\w-]+\.)*xiaohongshu\.com\//i;
const X_HOST = /^https?:\/\/(?:[\w-]+\.)*(?:x|twitter)\.com\//i;
const X_STATUS_PATH = /^\/[^/]+\/status(?:es)?\/\d+/i;
const X_ARTICLE_PATH = /^\/[^/]+\/article\/\d+(?:\/|$)/i;
function siteFromUrl(url) {
  if (XHS_HOST.test(url || "")) return "xhs";
  if (X_HOST.test(url || "")) return "x";
  return "";
}
function isX(noteOrSite) {
  return (typeof noteOrSite === "string" ? noteOrSite : noteOrSite?.site) === "x";
}
function defaultTitle(site) {
  return isX(site) ? "X 帖子或文章" : "小红书笔记";
}
function kindLabel(kind) {
  return kind === "live" ? "实况" : kind === "gif" ? "GIF" : kind === "video" ? "视频" : "图片";
}
function showDetails(title, text, url = "") {
  ui.detailTitle.textContent = title;
  ui.detailText.textContent = text;
  const valid = XHS_HOST.test(url) || X_HOST.test(url);
  ui.sourceLink.classList.toggle("hidden", !valid);
  ui.sourceLink.href = valid ? url : "";
  ui.sourceLink.textContent = isX(siteFromUrl(url)) ? "打开原帖 ↗" : "打开原笔记 ↗";
  openDialog(ui.detailsDialog);
}
function renderPreview() {
  const item = note.images[previewIndex];
  ui.previewImage.src = item.previewUrl || item.url;
  ui.previewImage.referrerPolicy = "no-referrer";
  ui.previewLabel.textContent = `第 ${item.index || previewIndex + 1} 张 · ${previewIndex + 1}/${note.images.length}`;
  ui.previewSelectButton.textContent = selected.has(previewIndex) ? "✓ 已选本张" : "选择本张";
  ui.previewSelectButton.disabled = saveState.busy || Boolean(saveState.result);
}

function noteIdentity(url) {
  const site = siteFromUrl(url);
  if (!site) return "";
  const { pathname } = new URL(url);
  if (site === "x") {
    const match = pathname.match(/\/(status(?:es)?|article)\/(\d+)(?:\/|$)/i);
    return match ? `${match[1].toLowerCase() === "article" ? "article" : "status"}:${match[2]}` : "";
  }
  return pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-z]+)(?:\/|$)/i)?.[1] || "";
}

function samePage(a, b) {
  return Boolean(noteIdentity(a)) && noteIdentity(a) === noteIdentity(b) && siteFromUrl(a) === siteFromUrl(b);
}

function mediaIdentity(item) {
  const url = new URL(item.url);
  url.hash = "";
  if (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/")) {
    url.searchParams.delete("name");
    url.searchParams.delete("format");
  } else if (/(?:^|\.)xhscdn\.(?:com|net)$/i.test(url.hostname)) {
    url.pathname = url.pathname.replace(/![^/]+$/, "");
    url.search = "";
  }
  return url.href;
}
function historyPreviewUrl(record) {
  const first = record.items[0];
  const matchingNote = samePage(record.pageUrl, note.url);
  const sourceImage = matchingNote ? note.images.find((item, index) => (item.index || index + 1) === first?.index) : null;
  const job = session.connectorJob;
  const savedImage = samePage(record.pageUrl, job?.payload?.pageUrl)
    ? job.payload.images?.find(item => item.index === first?.index) : null;
  return record.previewUrl || first?.previewUrl || first?.url
    || sourceImage?.previewUrl || sourceImage?.url || savedImage?.previewUrl || savedImage?.url;
}

async function restoreHistoryPreviews() {
  let changed = false;
  saveHistory = saveHistory.map(record => {
    if (record.previewUrl) return record;
    const previewUrl = historyPreviewUrl(record);
    if (!/^https?:\/\//i.test(previewUrl || "")) return record;
    changed = true;
    return { ...record, previewUrl };
  });
  if (changed) await chrome.storage.local.set({ saveHistory });
}

function renderHistory() {
  elements.history.replaceChildren();
  if (!saveHistory.length) elements.history.textContent = "还没有保存记录，保存成功的笔记会出现在这里。";
  let lastDay;
  for (const record of saveHistory) {
    const date = new Date(record.savedAt);
    const day = date.toLocaleDateString();
    if (day !== lastDay) {
      const heading = document.createElement("p");
      heading.className = "date-label";
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      heading.textContent = day === new Date().toLocaleDateString() ? "今天" : day === yesterday.toLocaleDateString() ? "昨天" : day;
      elements.history.append(heading); lastDay = day;
    }
    const row = document.createElement("button");
    row.type = "button"; row.className = "history-row";
    const thumb = document.createElement("span");
    thumb.className = "history-thumb"; thumb.textContent = "▧";
    const previewUrl = historyPreviewUrl(record);
    if (/^https?:\/\//i.test(previewUrl || "")) {
      const image = document.createElement("img");
      image.className = "history-thumb"; image.src = previewUrl;
      image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.replaceWith(thumb));
      row.append(image);
    } else row.append(thumb);
    const copy = document.createElement("span"); copy.className = "history-copy";
    const title = document.createElement("b"); title.textContent = record.title || defaultTitle(siteFromUrl(record.pageUrl));
    const detail = document.createElement("small");
    detail.textContent = `${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${record.items.length} 张`;
    const target = document.createElement("em");
    target.textContent = record.destination === "folder" ? `文件夹 · ${record.folderPath || "本地"}` : `照片 · ${record.albumName || "图库"}`;
    copy.append(title, detail, target); row.append(copy);
    row.addEventListener("click", () => showDetails(record.title || "保存记录", [
      date.toLocaleString(), `保存位置：${target.textContent}`,
      ...record.items.map(item => `第 ${item.index} 张 · ${kindLabel(item.kind)} · ${item.format || ""}${item.quality === "page" ? " · 页面版本" : ""}`)
    ].join("\n"), record.pageUrl));
    elements.history.append(row);
  }
  updateDuplicateHint();
}

function updateDuplicateHint() {
  const id = noteIdentity(note.url);
  const saved = new Set(saveHistory.filter((record) => id && samePage(record.pageUrl, note.url))
    .flatMap((record) => record.items.map((item) => item.index)));
  const count = note.images.filter((item, index) => selected.has(index) && saved.has(item.index || index + 1)).length;
  elements.duplicateHint.textContent = count ? `已选图片中有 ${count} 张曾保存。继续保存会再导出一次。` : "";
  elements.duplicateHint.classList.toggle("hidden", !count);
}

function rememberDraft() {
  return chrome.storage.session.set({ popupDraft: {
    pageUrl: note.url,
    selectedMedia: note.images.filter((_, index) => selected.has(index)).map(mediaIdentity),
    dismissedJobId: saveSession.dismissedJobId,
    destination: elements.destination.value,
    albumId: elements.album.value, targetDraft: targetSnapshot ? { destination: elements.destination.value, albumId: elements.album.value } : null, targetSnapshot
  } });
}

function rememberDestination() {
  return chrome.storage.local.set({ destinationPreferences: {
    destination: elements.destination.value, albumId: elements.album.value,
    albumName: elements.album.selectedOptions[0]?.textContent || ""
  } });
}

async function sendToConnector(payload) {
  payload = { pageUrl: note.url, albumName: elements.album.selectedOptions[0]?.textContent || "", ...payload };
  if (!saveSession.begin(payload)) return;
  renderSaveSession();
  try {
    await rememberDraft();
    const result = saveSession.stopping
      ? { ok: false, cancelled: true, error: "任务已停止，未开始保存", saved: 0,
        failed: payload.images.length, failedIndices: payload.images.map(item => item.index) }
      : await chrome.runtime.sendMessage({ type: "CONNECTOR_REQUEST", payload });
    saveSession.finish(result);
    return result;
  } catch (error) {
    const result = { ok: false, error: error.message || "连接器通信失败" };
    saveSession.finish(result);
    return result;
  } finally {
    renderSaveSession();
  }
}

function updateDestinationUi() {
  targetSummary();
  const local = elements.destination.value === "folder";
  ui.photosTargetButton.setAttribute("aria-pressed", String(!local));
  ui.folderTargetButton.setAttribute("aria-pressed", String(local));
  elements.albumSettings.classList.toggle("hidden", local);
  elements.folderSettings.classList.toggle("hidden", !local);
  elements.destinationHint.textContent = local
    ? "选择文件夹后若弹窗关闭，再点扩展即可继续"
    : "原图、GIF、实况、视频 · 可同步 iCloud";
}

function renderSaveSession() {
  saveState = saveSession.view(note);
  const { busy, saving, result, progress, canRetry } = saveState;
  ui.taskProgress.classList.toggle("hidden", !saving);
  ui.taskProgress.value = progress;
  ui.changeTargetButton.disabled = busy;
  ui.confirmTargetButton.disabled = busy;
  ui.closeTargetButton.disabled = busy;
  elements.stop.classList.toggle("hidden", !saving);
  elements.retryFailed.classList.toggle("hidden", !canRetry);
  elements.result.classList.toggle("hidden", !result);
  elements.result.textContent = result?.summary || "";
  elements.result.classList.toggle("warning", Boolean(result?.warning));
  resultDetails = result?.details || "";
  ui.detailsButton.classList.toggle("hidden", !result);
  ui.changeTargetButton.classList.toggle("hidden", Boolean(result));
  elements.save.classList.remove("hidden");
  [...elements.grid.children].forEach((tile, index) => {
    const status = result?.markers[index];
    const marker = tile.children[tile.children.length - 1];
    marker.textContent = status?.text || "";
    marker.classList.toggle("hidden", !marker.textContent);
    marker.classList.toggle("warning", Boolean(status?.warning));
    tile.classList.toggle("has-result", Boolean(marker.textContent));
  });
  updateSelectionUi();
}

function applySession() {
  folderPath = session.folderPath || "";
  elements.folderPath.textContent = folderPath || "尚未选择文件夹";
  elements.folderPath.title = folderPath;
  elements.chooseFolder.textContent = folderPath ? "更改文件夹…" : "选择文件夹…";
  if (Array.isArray(session.albums)) {
    const previous = elements.album.value;
    elements.album.replaceChildren(new Option("图库（不指定相簿）", ""));
    session.albums.forEach((album) => elements.album.add(new Option(album.name, album.id)));
    elements.album.value = [...elements.album.options].some((option) => option.value === previous) ? previous : "";
    elements.loadAlbums.textContent = "刷新相簿";
  }
  targetSummary();
  renderSaveSession();
}

function setView(view) {
  elements.loading.classList.toggle("hidden", view !== "loading");
  elements.empty.classList.toggle("hidden", view !== "empty");
  elements.gallery.classList.toggle("hidden", view !== "gallery");
  elements.actionBar.classList.toggle("hidden", view !== "gallery" || historyOpen);
}

function showToast(message, duration = 2400) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), duration);
}

function setEmpty(title, message) {
  elements.emptyTitle.textContent = title;
  elements.emptyMessage.textContent = message;
  setView("empty");
}

function updateSelectionUi() {
  const busy = saveState.busy;
  const resultMode = Boolean(saveState.result);
  updateDuplicateHint();
  const count = selected.size;
  elements.count.textContent = `已选 ${count} / ${note.images.length} 张`;
  elements.toggleAll.textContent = count === note.images.length ? "取消全选" : "全部选择";
  const local = elements.destination.value === "folder";
  elements.save.disabled = busy || (!resultMode && (count === 0 || count > 30 || (local && !folderPath)));
  elements.saveLabel.textContent = busy ? saveState.label : resultMode ? "继续选图" : count > 30 ? "最多选择 30 张" : count ? `${local ? "保存" : "导入"} ${count} 张` : "请选择图片";
  [elements.refresh, elements.retry, elements.destination,
    elements.album, elements.loadAlbums, elements.chooseFolder].forEach((control) => {
    control.disabled = busy;
  });
  elements.toggleAll.disabled = busy || resultMode;
  elements.actionBar.setAttribute("aria-busy", String(busy));
  [...elements.grid.children].forEach((button, index) => {
    button.disabled = busy || resultMode;
    button.children[0].disabled = busy || resultMode;
    button.children[0].setAttribute("aria-pressed", String(selected.has(index)));
    button.setAttribute("aria-pressed", String(selected.has(index)));
  });
}

function renderGallery() {
  elements.title.textContent = note.title;
  elements.title.title = note.title;
  elements.grid.replaceChildren();

  note.images.forEach((item, index) => {
    const button = document.createElement("div");
    const pick = document.createElement("button");
    pick.type = "button"; pick.className = "pick";
    button.className = "image-item";
    pick.setAttribute("aria-label", `选择第 ${item.index || index + 1} 张图片`);
    button.setAttribute("aria-pressed", "true");

    const image = document.createElement("img");
    image.src = item.previewUrl || item.url;
    image.alt = `${isX(note) ? "帖子媒体" : "笔记图片"} ${item.index || index + 1}`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";

    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    const number = document.createElement("span");
    number.className = "image-number";
    number.textContent = String(item.index || index + 1).padStart(2, "0");

    const badge = document.createElement("span");
    badge.className = "media-badge";
    badge.textContent = item.kind === "live" ? "LIVE" : item.kind === "gif" ? "GIF" : item.kind === "video" ? "视频" : "";
    badge.classList.toggle("hidden", !badge.textContent);

    pick.append(image, check, number, badge);
    const zoom = document.createElement("button"); zoom.type = "button"; zoom.className = "zoom";
    zoom.textContent = "⤢"; zoom.setAttribute("aria-label", `放大第 ${item.index || index + 1} 张`);
    zoom.addEventListener("click", () => { previewIndex = index; renderPreview(); openDialog(ui.previewDialog); });
    const marker = document.createElement("span"); marker.className = "result-marker hidden";
    button.append(pick, zoom, marker);
    pick.addEventListener("click", () => {
      if (saveState.busy || saveState.result) return;
      selected.has(index) ? selected.delete(index) : selected.add(index);
      updateSelectionUi();
      void rememberDraft();
    });
    elements.grid.append(button);
  });

  updateSelectionUi();
  setView("gallery");
}

async function getSourceTab() {
  if (sourceTabId) return chrome.tabs.get(sourceTabId);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  sourceTabId = tab?.id;
  return tab;
}

async function collect() {
  elements.result.classList.add("hidden");
  setView("loading");
  elements.refresh.disabled = true;
  let site = "";
  let supported = false;
  try {
    const tab = await getSourceTab();
    site = siteFromUrl(tab?.url);
    supported = site === "x"
      ? (X_STATUS_PATH.test(new URL(tab.url).pathname) || X_ARTICLE_PATH.test(new URL(tab.url).pathname))
      : site === "xhs";
    if (!tab?.id || !supported) {
      if (site === "x") setEmpty("这不是 X 帖子或文章页面", "请在 X 打开一条帖子或文章的详情页（地址含 /status/ 或 /article/），然后再试一次。");
      else setEmpty("这不是支持的页面", "请先在网页版小红书或 X 打开一篇笔记或帖子，然后再试一次。");
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_NOTE_IMAGES" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["note-parser.js", "content.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "COLLECT_NOTE_IMAGES" });
    }

    if (!response?.images?.length) {
      setEmpty("没有找到可保存的图片", site === "x"
        ? "试试展开帖子或文章里的图片、等待加载完成，再重新读取。"
        : "试试先点开笔记详情、等待图片加载完成，再重新读取。");
      return;
    }

    note = {
      title: response.title || defaultTitle(site),
      url: response.url || tab.url || "",
      site: site || "xhs",
      images: response.images
    };
    selected = new Set(note.images.map((_, index) => index));
    const draft = session.popupDraft;
    const matchingDraft = draft && (draft.pageUrl === note.url || samePage(draft.pageUrl, note.url));
    if (matchingDraft) {
      const media = new Set(draft.selectedMedia);
      selected = new Set(note.images.flatMap((item, index) => media.has(mediaIdentity(item)) ? [index] : []));
      elements.destination.value = draft.targetSnapshot?.destination || draft.destination;
      if ([...elements.album.options].some((option) => option.value === draft.albumId)) {
        elements.album.value = draft.albumId;
      }
    }
    updateDestinationUi();
    renderGallery();
    await restoreHistoryPreviews().catch(error => showToast(`首图已恢复，但记录更新失败：${error.message}`, 6000));
    renderHistory();
    applySession();
    if (matchingDraft && draft.targetDraft) {
      targetSnapshot = draft.targetSnapshot;
      elements.destination.value = draft.targetDraft.destination;
      elements.album.value = draft.targetDraft.albumId;
      updateDestinationUi(); openDialog(ui.targetDialog);
    }
  } catch (error) {
    setEmpty("读取失败", error?.message || (site === "x" ? "请刷新 X 页面后重试。" : "请刷新小红书页面后重试。"));
  } finally {
    elements.refresh.disabled = saveState.busy;
  }
}

ui.appearanceButton.addEventListener("click", openThemeDialog);
ui.closeThemeButton.addEventListener("click", closeThemeDialog);
ui.themeDialog.addEventListener("close", () => {
  ui.appearanceButton.setAttribute("aria-expanded", "false");
  ui.appearanceButton.focus();
});
for (const [theme, button] of Object.entries(themeButtons)) {
  button.addEventListener("click", () => chooseTheme(theme, { focus: true }));
  button.addEventListener("keydown", handleThemeKeydown);
}
elements.refresh.addEventListener("click", collect);
elements.clearHistory.addEventListener("click", () => openDialog(ui.clearDialog));
ui.confirmClearButton.addEventListener("click", async () => { await chrome.storage.local.set({ saveHistory: [] }); ui.clearDialog.close(); });
ui.cancelClearButton.addEventListener("click", () => ui.clearDialog.close());
ui.historyButton.addEventListener("click", switchHistory);
ui.changeTargetButton.addEventListener("click", () => {
  targetSnapshot = { destination: elements.destination.value, albumId: elements.album.value, folderPath };
  openDialog(ui.targetDialog);
});
function cancelTarget() {
  if (targetSnapshot) {
    elements.destination.value = targetSnapshot.destination; elements.album.value = targetSnapshot.albumId;
    folderPath = targetSnapshot.folderPath || "";
    session.folderPath = folderPath;
    elements.folderPath.textContent = folderPath || "尚未选择文件夹";
    void chrome.storage.session.set({ folderPath });
    void chrome.storage.local.set({ folderPath });
  }
  targetSnapshot = undefined;
  updateDestinationUi(); updateSelectionUi(); void rememberDraft();
}
ui.closeTargetButton.addEventListener("click", () => { cancelTarget(); ui.targetDialog.close(); });
ui.targetDialog.addEventListener("cancel", (event) => { if (saveState.busy) event.preventDefault(); else cancelTarget(); });
ui.confirmTargetButton.addEventListener("click", async () => {
  if (elements.destination.value === "folder" && !folderPath) { showToast("请先选择文件夹"); return; }
  targetSnapshot = undefined; await rememberDraft(); await rememberDestination();
  targetSummary(); ui.targetDialog.close(); updateSelectionUi();
});
ui.closePreviewButton.addEventListener("click", () => ui.previewDialog.close());
ui.previousImageButton.addEventListener("click", () => { previewIndex = (previewIndex + note.images.length - 1) % note.images.length; renderPreview(); });
ui.nextImageButton.addEventListener("click", () => { previewIndex = (previewIndex + 1) % note.images.length; renderPreview(); });
ui.previewSelectButton.addEventListener("click", () => {
  if (saveState.busy || saveState.result) return;
  selected.has(previewIndex) ? selected.delete(previewIndex) : selected.add(previewIndex);
  updateSelectionUi(); renderPreview(); void rememberDraft();
});
ui.detailsButton.addEventListener("click", () => showDetails("保存详情", resultDetails));
ui.closeDetailsButton.addEventListener("click", () => ui.detailsDialog.close());
function continueSelection() {
  saveSession.continueSelection();
  renderSaveSession();
  void rememberDraft();
}
elements.stop.addEventListener("click", async () => {
  if (!saveSession.stop()) return;
  renderSaveSession();
  await chrome.runtime.sendMessage({ type: "CONNECTOR_CANCEL" });
});
elements.retryFailed.addEventListener("click", async () => {
  const payload = saveSession.retryPayload(note.url);
  if (payload) await sendToConnector(payload);
});
elements.retry.addEventListener("click", collect);
elements.toggleAll.addEventListener("click", () => {
  if (saveState.busy || saveState.result) return;
  selected = selected.size === note.images.length
    ? new Set()
    : new Set(note.images.map((_, index) => index));
  updateSelectionUi();
  void rememberDraft();
});

function changeDestination() {
  updateDestinationUi();
  elements.result.classList.add("hidden");
  updateSelectionUi();
  void rememberDraft();
  if (!targetSnapshot) void rememberDestination();
}
elements.destination.addEventListener("change", changeDestination);
ui.photosTargetButton.addEventListener("click", () => { elements.destination.value = "photos"; changeDestination(); });
ui.folderTargetButton.addEventListener("click", () => { elements.destination.value = "folder"; changeDestination(); });
elements.album.addEventListener("change", () => { void rememberDraft(); if (!targetSnapshot) void rememberDestination(); });

elements.loadAlbums.addEventListener("click", async () => {
  if (saveState.busy) return;
  elements.loadAlbums.textContent = "正在读取…";
  try {
    const result = await sendToConnector({ action: "listAlbums" });
    if (!result.ok) throw new Error(result.error || "无法读取相簿");
    if (!Array.isArray(result.albums)) throw new Error("请重新运行 install.command 更新连接器");
    const previous = elements.album.value;
    elements.album.replaceChildren(new Option("图库（不指定相簿）", ""));
    result.albums.forEach((album) => elements.album.add(new Option(album.name, album.id)));
    elements.album.value = [...elements.album.options].some((option) => option.value === previous) ? previous : "";
    if (!targetSnapshot) await rememberDestination();
    if (!result.albums.length) showToast("还没有可选相簿，请先在“照片”中创建相簿");
  } catch (error) {
    showToast(error.message, 6000);
  } finally {
    elements.loadAlbums.textContent = "刷新相簿";
    updateSelectionUi();
  }
});

elements.chooseFolder.addEventListener("click", async () => {
  if (saveState.busy) return;
  elements.chooseFolder.textContent = "正在选择…";
  try {
    const result = await sendToConnector({ action: "chooseFolder" });
    if (!result.ok) throw new Error(result.error || "无法选择文件夹");
    if (!result.cancelled) {
      if (!result.path) throw new Error("请重新运行 install.command 更新连接器");
      folderPath = result.path;
      elements.folderPath.textContent = folderPath;
      elements.folderPath.title = folderPath;
    }
  } catch (error) {
    showToast(error.message, 6000);
  } finally {
    elements.chooseFolder.textContent = folderPath ? "更改文件夹…" : "选择文件夹…";
    updateSelectionUi();
  }
});

elements.save.addEventListener("click", async () => {
  if (saveState.busy) return;
  if (saveState.result) { continueSelection(); return; }
  const images = note.images.filter((_, index) => selected.has(index));
  if (!images.length || images.length > 30) return;
  const local = elements.destination.value === "folder";
  if (local && !folderPath) return;

  await sendToConnector({
      action: "save",
      destination: elements.destination.value,
      albumId: elements.album.value,
      folderPath,
      title: note.title,
      pageUrl: note.url,
      site: note.site || siteFromUrl(note.url) || "xhs",
      images: note.images.flatMap((item, index) => selected.has(index) ? [{
        index: item.index || index + 1,
        url: item.url,
        previewUrl: item.previewUrl || item.url,
        kind: item.kind,
        videoUrl: item.videoUrl || "",
        videoUrls: Array.isArray(item.videoUrls) ? item.videoUrls : []
      }] : [])
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.saveHistory) {
      saveHistory = changes.saveHistory.newValue || [];
      renderHistory();
    }
    if (changes.popupTheme) applyTheme(changes.popupTheme.newValue);
    return;
  }
  if (area !== "session") return;
  for (const [key, change] of Object.entries(changes)) session[key] = change.newValue;
  if (changes.connectorJob) saveSession.restore(changes.connectorJob.newValue);
  if (changes.connectorJob || changes.folderPath || changes.albums) applySession();
});

async function initialize() {
  const local = await chrome.storage.local.get(["destinationPreferences", "folderPath", "saveHistory", "popupTheme"]);
  applyTheme(local.popupTheme);
  const state = await chrome.runtime.sendMessage({ type: "CONNECTOR_STATE" });
  if (!state?.ok) throw new Error(state?.error || "无法读取后台任务状态");
  session = await chrome.storage.session.get(["popupDraft", "folderPath", "albums", "connectorJob"]);
  saveSession.restore(session.connectorJob, session.popupDraft?.dismissedJobId);
  saveHistory = local.saveHistory || [];
  renderHistory();
  if (!session.folderPath) session.folderPath = local.folderPath || "";
  const preferences = local.destinationPreferences;
  if (preferences) {
    elements.destination.value = preferences.destination === "folder" ? "folder" : "photos";
    if (preferences.albumId) {
      elements.album.add(new Option(preferences.albumName || "上次使用的相簿", preferences.albumId));
      elements.album.value = preferences.albumId;
    }
  }
  applySession();
  await collect();
}

initialize().catch((error) => setEmpty("读取失败", error.message || "请重新打开扩展"));

// Start with an intrinsic size. Chrome constrains the actual toolbar viewport
// afterward; viewport-based CSS during startup creates a sizing feedback loop.
window.addEventListener("resize", () => {
  document.body.style.width = `${Math.min(420, window.innerWidth)}px`;
  document.body.style.height = `${Math.min(600, window.innerHeight)}px`;
});
