const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const tick = () => new Promise(setImmediate);
async function until(condition) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await tick();
  }
  assert.fail("Timed out waiting for extension state");
}

class Control {
  constructor(text = "", value = "") {
    this.textContent = text;
    this.value = value;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.disabled = false;
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  add(option) { this.children.push(option); }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  focus() {}
  get options() { return this.children; }
  get selectedOptions() { return this.children.filter((option) => option.value === this.value); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { return this.disabled ? undefined : this.handlers.click ? this.handlers.click() : this.children[0]?.click(); }
}

function extension({ statusResult = { ok: true, protocolVersion: 4 }, fetchImpl = globalThis.fetch,
  scriptingImpl = null } = {}) {
  const data = {};
  const localData = {};
  const listeners = new Set();
  const ports = [];
  const requests = [];
  let handleMessage;
  const storage = {
    local: {
      get: async () => structuredClone(localData),
      set: async (values) => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: localData[key], newValue: structuredClone(value) };
          localData[key] = structuredClone(value);
        }
        for (const listener of listeners) listener(changes, "local");
      }
    },
    session: {
      get: async () => structuredClone(data),
      set: async (values) => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: data[key], newValue: structuredClone(value) };
          data[key] = structuredClone(value);
        }
        for (const listener of listeners) listener(changes, "session");
      }
    },
    onChanged: { addListener: (listener) => listeners.add(listener) }
  };
  const runtime = {
    onMessage: { addListener: (handler) => { handleMessage = handler; } },
    connectNative: () => {
      let onMessage, onDisconnect;
      const port = {
        onMessage: { addListener: (handler) => { onMessage = handler; } },
        onDisconnect: { addListener: (handler) => { onDisconnect = handler; } },
        postMessage: (payload) => {
          port.payload = payload;
          requests.push(payload);
          if (payload.action === "status") queueMicrotask(() => port.reply(statusResult));
          else ports.push(port);
        },
        disconnect: () => onDisconnect(),
        reply: (result) => onMessage(result),
        fail: (message) => {
          runtime.lastError = { message };
          onDisconnect();
          delete runtime.lastError;
        }
      };
      return port;
    }
  };
  function restartWorker() {
    vm.runInNewContext(read("background.js"), {
      chrome: { runtime, storage, scripting: { executeScript: scriptingImpl } },
      URL, crypto: require("node:crypto").webcrypto, fetch: (...args) => fetchImpl(...args)
    });
  }
  restartWorker();
  const note = {
    title: "Test note", url: "https://www.xiaohongshu.com/explore/current123",
    images: [{ url: "https://sns-img-bd.xhscdn.com/a" }, { url: "https://sns-img-bd.xhscdn.com/b" }]
  };
  function openPopup({ contentReady = true } = {}) {
    const controls = Object.fromEntries([...read("popup.html").matchAll(/id="([^"]+)"/g)]
      .map((match) => [match[1], new Control()]));
    const documentElement = { dataset: {} };
    controls.destinationSelect.value = "photos";
    controls.albumSelect.add(new Control("图库（不指定相簿）", ""));
    const subscriptions = [];
    const collectionMessages = [];
    const injections = [];
    let closed = false;
    const chrome = {
      storage: { session: storage.session, local: storage.local, onChanged: { addListener: (listener) => {
        subscriptions.push(listener); listeners.add(listener);
      } } },
      runtime: { sendMessage: (message) => new Promise((resolve) => {
        handleMessage(message, {}, (result) => { if (!closed) resolve(result); });
      }) },
      tabs: {
        query: async () => [{ id: 42, url: note.url }],
        get: async (id) => { assert.equal(id, 42); return { id, url: note.url }; },
        sendMessage: async (id, message) => {
          assert.equal(id, 42);
          collectionMessages.push(message);
          if (!contentReady) throw new Error("No receiver");
          return note;
        }
      },
      scripting: { executeScript: async (options) => {
        injections.push(options);
        contentReady = true;
        return [];
      } }
    };
    vm.runInNewContext(read("save-session.js") + "\n" + read("popup.js"), {
      chrome, window: { addEventListener: () => {} },
      document: { documentElement, querySelector: (selector) => controls[selector.slice(1)], createElement: () => new Control() },
      URL, Option: Control, clearTimeout: () => {}, setTimeout: () => 1
    });
    return { controls, documentElement, collectionMessages, injections, close: () => {
      closed = true;
      subscriptions.forEach((listener) => listeners.delete(listener));
    } };
  }
  return { data, localData, storage, ports, openPopup, note, requests, restartWorker,
    message: (message) => new Promise((resolve) => handleMessage(message, {}, resolve)),
    messageFrom: (message, sender) => new Promise((resolve) => handleMessage(message, sender, resolve)) };
}

test("toolbar opens the anchored popup with a fixed compact width", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.match(read("popup.css"), /body\s*\{[^}]*width: 420px/s);
});

test("X video resolution returns the best MP4 variants", async () => {
  const requested = [];
  const app = extension({ fetchImpl: async (url) => {
    requested.push(url);
    return { ok: true, json: async () => ({ mediaDetails: [{
      type: "video",
      media_url_https: "https://pbs.twimg.com/amplify_video_thumb/123/img/poster.jpg",
      video_info: { variants: [
        { content_type: "application/x-mpegURL", url: "https://video.twimg.com/pl/list.m3u8" },
        { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/lo.mp4" },
        { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/hi.mp4" },
      ] },
    }] }) };
  } });
  const result = await app.message({ type: "RESOLVE_X_MEDIA", statusId: "2119380630018613658" });
  assert.equal(result.ok, true);
  assert.match(requested[0],
    /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=2119380630018613658&lang=en&token=/);
  assert.deepEqual([...result.media[0].videoUrls],
    ["https://video.twimg.com/hi.mp4", "https://video.twimg.com/lo.mp4"]);
});

test("X media resolution also returns tweet photos", async () => {
  const app = extension({ fetchImpl: async () => ({ ok: true, json: async () => ({
    mediaDetails: [{
      type: "photo",
      media_url_https: "https://pbs.twimg.com/media/detail?format=jpg&name=small",
      original_info: { width: 1200, height: 800 },
    }],
    photos: [
      { url: "https://pbs.twimg.com/media/detail?format=jpg&name=large", width: 1200, height: 800 },
      { url: "https://pbs.twimg.com/media/photo-only?format=jpg&name=small", width: 900, height: 1600 },
    ],
  }) }) });
  const result = await app.message({ type: "RESOLVE_X_MEDIA", statusId: "2119381338956734824" });
  assert.equal(result.ok, true);
  assert.deepEqual([...result.media].map((entry) => entry.type), ["photo", "photo"]);
  assert.deepEqual([...result.media].map((entry) => entry.url), [
    "https://pbs.twimg.com/media/detail?format=jpg&name=small",
    "https://pbs.twimg.com/media/photo-only?format=jpg&name=small",
  ]);
  assert.deepEqual([result.media[1].width, result.media[1].height], [900, 1600]);
});

test("X video resolution rejects invalid ids without a request", async () => {
  let called = false;
  const app = extension({ fetchImpl: async () => { called = true; } });
  const result = await app.message({ type: "RESOLVE_X_MEDIA", statusId: "../bad" });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("the page-world parser runs for supported tabs and rejects other senders", async () => {
  const pageNote = { noteId: "20", title: "main world", url: "https://x.com/jack/status/20",
    images: [{ url: "https://pbs.twimg.com/media/main?format=jpg&name=orig" }] };
  const calls = [];
  const app = extension({ scriptingImpl: async (options) => {
    calls.push(options);
    return options.files ? [] : [{ result: pageNote }];
  } });
  const result = await app.messageFrom({ type: "PARSE_PAGE_MEDIA" },
    { tab: { id: 42, url: "https://x.com/jack/status/20" } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), pageNote);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.map((call) =>
    [call.target.tabId, call.world, call.files || null]))),
  [[42, "MAIN", ["note-parser.js"]], [42, "MAIN", null]]);
  const rejected = await app.messageFrom({ type: "PARSE_PAGE_MEDIA" },
    { tab: { id: 42, url: "https://example.com/post" } });
  assert.equal(rejected, null);
  assert.equal(await app.message({ type: "PARSE_PAGE_MEDIA" }), null);
  await app.messageFrom({ type: "PARSE_PAGE_MEDIA" },
    { tab: { id: 43, url: "https://www.xiaohongshu.com/explore/current123" } });
  assert.equal(calls.length, 4);
  assert.equal(calls[2].target.tabId, 43);
});

test("an unavailable page-world parser returns no candidate", async () => {
  const app = extension({ scriptingImpl: async () => { throw new Error("Page unavailable"); } });
  const result = await app.messageFrom({ type: "PARSE_PAGE_MEDIA" },
    { tab: { id: 42, url: "https://x.com/jack/status/20" } });
  assert.equal(result, null);
});

for (const contentReady of [true, false]) {
  test(`popup uses the collection result with content script ${contentReady ? 'ready' : 'missing'}`, async () => {
    const app = extension();
    app.note.url = "https://x.com/jack/status/20";
    app.note.images = [{ index: 3, kind: "image", url: "https://pbs.twimg.com/media/current.jpg" }];
    const popup = app.openPopup({ contentReady });
    await until(() => popup.controls.imageGrid.children.length === 1);
    assert.deepEqual(JSON.parse(JSON.stringify(popup.collectionMessages)),
      Array.from({ length: contentReady ? 1 : 2 }, () => ({ type: "COLLECT_NOTE_IMAGES" })));
    assert.deepEqual(JSON.parse(JSON.stringify(popup.injections)),
      contentReady ? [] : [{ target: { tabId: 42 }, files: ["note-parser.js", "content.js"] }]);
  });
}

test("folder selection survives popup closure and restores selected images", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  popup.controls.imageGrid.children[1].click();
  popup.controls.destinationSelect.value = "folder";
  popup.controls.destinationSelect.handlers.change();
  void popup.controls.chooseFolderButton.click();
  await until(() => app.ports.length === 1);
  popup.close();
  app.ports[0].reply({ ok: true, path: "/tmp/chosen" });
  await until(() => app.data.folderPath === "/tmp/chosen");
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.destinationSelect.value, "folder");
  assert.equal(popup.controls.folderPath.textContent, "/tmp/chosen");
  assert.equal(popup.controls.imageCount.textContent, "已选 1 / 2 张");
  assert.equal(popup.controls.saveButton.disabled, false);
  void popup.controls.chooseFolderButton.click();
  await until(() => app.ports.length === 2);
  app.ports[1].reply({ ok: true, cancelled: true, path: "" });
  await until(() => !popup.controls.chooseFolderButton.disabled);
  assert.equal(app.data.folderPath, "/tmp/chosen");
});

test("reopened popup shows a running save and its eventual result", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.galleryState.classList.contains("hidden"), false);
  assert.equal(popup.controls.saveButton.disabled, true);
  assert.equal(popup.controls.imageGrid.children[0].disabled, true);
  popup.controls.saveButton.click();
  assert.equal(app.ports.length, 1);
  app.ports[0].reply({ ok: true, saved: 2 });
  await until(() => !popup.controls.saveButton.disabled);
  assert.match(popup.controls.resultMessage.textContent, /已导入 2 张/);
  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.match(popup.controls.resultMessage.textContent, /已导入 2 张/);
});

test("appearance changes preserve selection and survive reopening", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  popup.controls.imageGrid.children[1].click();
  assert.equal(popup.controls.imageCount.textContent, "已选 1 / 2 张");

  popup.controls.appearanceButton.click();
  assert.equal(popup.controls.themeDialog.open, true);
  popup.controls.themeDarkroomButton.click();
  assert.equal(popup.documentElement.dataset.theme, "darkroom");
  assert.equal(popup.controls.themeDarkroomButton.attributes["aria-checked"], "true");
  assert.equal(popup.controls.imageCount.textContent, "已选 1 / 2 张");
  await until(() => app.localData.popupTheme === "darkroom");

  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.documentElement.dataset.theme, "darkroom");
  assert.equal(popup.controls.themeDarkroomButton.attributes["aria-checked"], "true");
  assert.equal(popup.controls.imageCount.textContent, "已选 1 / 2 张");
});

test("album results and native errors remain visible after reopening", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.loadAlbumsButton.click();
  await until(() => app.ports.length === 1);
  popup.close();
  app.ports[0].reply({ ok: true, albums: [{ id: "album-a", name: "旅行" }] });
  await until(() => app.data.albums?.length === 1);
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  popup.controls.albumSelect.value = "album-a";
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 2);
  assert.equal(app.ports[1].payload.albumId, "album-a");
  popup.close();
  app.ports[1].fail("Native host has exited.");
  await until(() => app.data.connectorJob.result?.ok === false);
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.match(popup.controls.resultMessage.textContent, /Native host has exited/);
  assert.equal(popup.controls.saveButton.disabled, false);
});


test("sparse selections retain note indices and oversized selections cannot save", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  popup.controls.imageGrid.children[0].click();
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  assert.equal(app.ports[0].payload.images[0].index, 2);
  app.ports[0].reply({ ok: true, saved: 1 });
  await until(() => !popup.controls.saveButton.disabled);
  popup.close();
  app.note.url += "-other";
  app.note.images = Array.from({ length: 31 }, () => ({ url: "https://ci.xiaohongshu.com/a" }));
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 31);
  assert.equal(popup.controls.saveButton.disabled, true);
  assert.equal(popup.controls.saveButtonLabel.textContent, "最多选择 30 张");
  popup.controls.imageGrid.children[0].click();
  assert.equal(popup.controls.saveButton.disabled, false);
});


test("an old connector is rejected before any save operation is sent", async () => {
  const app = extension({ statusResult: { ok: false, error: "缺少图片列表" } });
  const popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.data.connectorJob?.result);
  assert.deepEqual(app.requests.map((request) => request.action), ["status"]);
  assert.match(popup.controls.resultMessage.textContent, /install.command/);
  assert.equal(popup.controls.saveButton.disabled, false);
});

test("a restarted worker marks unfinished work interrupted without repeating it", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  popup.close();
  app.restartWorker();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.saveButton.disabled, false);
  assert.match(popup.controls.resultMessage.textContent, /中断/);
  assert.equal(app.requests.filter((request) => request.action === "save").length, 1);
});

test("progress messages keep the native port open and survive reopening", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  app.ports[0].reply({ event: "progress", phase: "download", completed: 1, total: 2 });
  await until(() => app.data.connectorJob?.progress);
  assert.equal(app.data.connectorJob.busy, true);
  assert.equal(popup.controls.saveButton.disabled, true);
  assert.match(popup.controls.saveButtonLabel.textContent, /1\/2/);
  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.match(popup.controls.saveButtonLabel.textContent, /1\/2/);
  app.ports[0].reply({ event: "progress", phase: "import", completed: 0, total: 2 });
  app.ports[0].reply({ ok: true, saved: 2 });
  await until(() => !popup.controls.saveButton.disabled);
  assert.equal(app.data.connectorJob.busy, false);
  assert.match(popup.controls.resultMessage.textContent, /已导入 2 张/);
});

for (const allFailed of [false, true]) {
  test(`retry ${allFailed ? 'all' : 'partial'} failures preserves target and original indices`, async () => {
    const app = extension();
    app.note.images[0].index = 3;
    app.note.images[1].index = 7;
    let popup = app.openPopup();
    await until(() => popup.controls.imageGrid.children.length === 2);
    void popup.controls.saveButton.click();
    await until(() => app.ports.length === 1);
    const original = app.ports[0].payload;
    app.ports[0].reply({ ok: !allFailed, saved: allFailed ? 0 : 1,
      failedIndices: allFailed ? [3, 7] : [7], error: '下载失败' });
    await until(() => !popup.controls.saveButton.disabled);
    popup.close();
    popup = app.openPopup();
    await until(() => popup.controls.imageGrid.children.length === 2);
    assert.equal(popup.controls.retryFailedButton.classList.contains('hidden'), false);
    void popup.controls.retryFailedButton.click();
    await until(() => app.ports.length === 2);
    const retry = app.ports[1].payload;
    assert.deepEqual(Array.from(retry.images, (item) => item.index), allFailed ? [3, 7] : [7]);
    assert.equal(retry.destination, original.destination);
    assert.equal(retry.albumId, original.albumId);
    app.ports[1].reply({ ok: true, saved: retry.images.length, failedIndices: [] });
    await until(() => !app.data.connectorJob.busy);
    assert.equal(popup.controls.retryFailedButton.classList.contains('hidden'), true);
  });
}

test('destination preferences survive a browser session reset and another note', async () => {
  const app = extension();
  app.localData.destinationPreferences = { destination: 'photos', albumId: 'album-a', albumName: '旅行' };
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.albumSelect.value, 'album-a');
  popup.controls.destinationSelect.value = 'folder';
  popup.controls.destinationSelect.handlers.change();
  void popup.controls.chooseFolderButton.click();
  await until(() => app.ports.length === 1);
  app.ports[0].reply({ ok: true, path: '/tmp/persistent-folder' });
  await until(() => app.localData.folderPath);
  popup.close();
  Object.keys(app.data).forEach((key) => delete app.data[key]);
  app.note.url += '-another';
  app.restartWorker();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.destinationSelect.value, 'folder');
  assert.equal(popup.controls.folderPath.textContent, '/tmp/persistent-folder');
  assert.equal(popup.controls.imageCount.textContent, '已选 2 / 2 张');
});

test('a reopened popup can stop a running native save without disconnecting it', async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.stopButton.classList.contains('hidden'), false);
  void popup.controls.stopButton.click();
  await until(() => app.requests.some((request) => request.action === 'cancel'));
  assert.equal(app.data.connectorJob.busy, true);
  app.ports[0].reply({ ok: true, saved: 1, cancelled: true, failedIndices: [2] });
  await until(() => !app.data.connectorJob.busy);
  assert.match(popup.controls.resultMessage.textContent, /已保留/);
});

test('successful history is bounded, detects repeated indices, and can be cleared', async () => {
  const app = extension();
  app.localData.saveHistory = Array.from({ length: 100 }, () => ({ savedAt: new Date().toISOString(),
    pageUrl: 'https://www.xiaohongshu.com/explore/other', title: 'Old', items: [] }));
  const popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  app.ports[0].reply({ ok: true, saved: 1, failedIndices: [2], items: [{ index: 1, kind: 'image', format: 'jpg' }] });
  await until(() => !app.data.connectorJob.busy);
  assert.equal(app.localData.saveHistory.length, 100);
  assert.equal(app.localData.saveHistory[0].pageUrl, app.note.url);
  assert.deepEqual(Array.from(app.localData.saveHistory[0].items, (item) => item.index), [1]);
  assert.match(popup.controls.duplicateHint.textContent, /1 张曾保存/);
  assert.equal(popup.controls.historyList.children.filter(row => row.className === "history-row").length, 100);
  assert.equal(app.localData.saveHistory.length, 100);
  await popup.controls.clearHistoryButton.click();
  await popup.controls.confirmClearButton.click();
  assert.equal(app.localData.saveHistory.length, 0);
  assert.equal(popup.controls.duplicateHint.classList.contains('hidden'), true);
});


test("target edits require confirmation, cancel restores preferences, and zoom preserves selection", async () => {
  const app = extension(); const popup = app.openPopup(); const c = popup.controls;
  await until(() => c.imageGrid.children.length === 2);
  c.changeTargetButton.click();
  assert.equal(c.targetDialog.open, true);
  c.destinationSelect.value = "folder"; c.destinationSelect.handlers.change();
  await tick();
  assert.equal(app.localData.destinationPreferences, undefined);
  c.closeTargetButton.click();
  assert.equal(c.destinationSelect.value, "photos");
  c.imageGrid.children[0].children[1].click();
  assert.equal(c.previewDialog.open, true);
  assert.equal(c.imageCount.textContent, "已选 2 / 2 张");
  c.previewSelectButton.click();
  assert.equal(c.imageCount.textContent, "已选 1 / 2 张");
  c.historyButton.click(); c.historyButton.click();
  assert.equal(c.imageCount.textContent, "已选 1 / 2 张");
  c.clearHistoryButton.click();
  assert.equal(c.clearDialog.open, true);
  c.cancelClearButton.click();
  assert.equal(c.clearDialog.open, false);
});

test("retry results retain successful image markers and history stores only newly saved images", async () => {
  const app = extension(); app.note.images[0].previewUrl = "https://sns-img-bd.xhscdn.com/preview";
  const popup = app.openPopup(); const c = popup.controls;
  await until(() => c.imageGrid.children.length === 2);
  void c.saveButton.click(); await until(() => app.ports.length === 1);
  app.ports[0].reply({ ok: true, saved: 1, failed: 1, failedIndices: [2], items: [{ index: 1, kind: "image", format: "jpg" }] });
  await until(() => !app.data.connectorJob.busy);
  assert.equal(app.localData.saveHistory[0].previewUrl, app.note.images[0].previewUrl);
  assert.equal(c.imageGrid.children[0].children[2].textContent, "已保存");
  assert.equal(c.imageGrid.children[1].children[2].textContent, "保存失败");
  void c.retryFailedButton.click(); await until(() => app.ports.length === 2);
  app.ports[1].reply({ ok: true, saved: 1, failed: 0, failedIndices: [], items: [{ index: 2, kind: "image", format: "jpg", quality: "page" }] });
  await until(() => !app.data.connectorJob.busy);
  assert.equal(c.imageGrid.children[0].children[2].textContent, "已保存");
  assert.equal(c.imageGrid.children[1].children[2].textContent, "已保存 · 页面版本");
  assert.match(c.resultMessage.textContent, /已导入 2 张/);
  assert.equal(app.localData.saveHistory[0].items.length, 1);
});

test("folder sheet resumes after popup closure and applies only after confirmation", async () => {
  const app = extension(); let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  popup.controls.changeTargetButton.click();
  popup.controls.folderTargetButton.click();
  void popup.controls.chooseFolderButton.click();
  await until(() => app.ports.length === 1);
  popup.close(); app.ports[0].reply({ ok: true, path: "/tmp/new-folder" });
  await until(() => !app.data.connectorJob.busy);
  popup = app.openPopup();
  await until(() => popup.controls.targetDialog.open);
  assert.equal(popup.controls.destinationSelect.value, "folder");
  assert.equal(popup.controls.folderPath.textContent, "/tmp/new-folder");
  assert.equal(app.localData.destinationPreferences, undefined);
  await popup.controls.confirmTargetButton.click();
  assert.equal(app.localData.destinationPreferences.destination, "folder");
  assert.equal(popup.controls.targetDialog.open, false);
});

test("history displays the first saved preview when the CDN URL uses HTTP", async () => {
  const app = extension();
  app.localData.saveHistory = [{ savedAt: new Date().toISOString(), title: "HTTP preview", pageUrl: app.note.url,
    previewUrl: "http://sns-webpic-qc.xhscdn.com/preview.jpg", items: [{ index: 1, kind: "image", format: "jpg" }] }];
  const popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  const row = popup.controls.historyList.children.find(child => child.className === "history-row");
  assert.equal(row.children[0].src, "http://sns-webpic-qc.xhscdn.com/preview.jpg");
});

test("an old record without a preview recovers its first saved image from the current note", async () => {
  const app = extension(); app.note.images[0].index = 3; app.note.images[1].index = 8;
  app.localData.saveHistory = [{ savedAt: new Date().toISOString(), pageUrl: app.note.url, title: "Old record",
    items: [{ index: 8, kind: "image", format: "jpg" }] }];
  const popup = app.openPopup();
  await until(() => app.localData.saveHistory[0].previewUrl);
  assert.equal(app.localData.saveHistory[0].previewUrl, app.note.images[1].url);
  const row = popup.controls.historyList.children.find(child => child.className === "history-row");
  assert.equal(row.children[0].src, app.note.images[1].url);
});

test("the visible primary button returns from a saved result without downloading again", async () => {
  const app = extension(); const popup = app.openPopup(); const c = popup.controls;
  await until(() => c.imageGrid.children.length === 2);
  void c.saveButton.click(); await until(() => app.ports.length === 1);
  app.ports[0].reply({ ok: true, saved: 2, failedIndices: [], items: [{ index: 1 }, { index: 2 }] });
  await until(() => !app.data.connectorJob.busy);
  assert.equal(c.saveButton.classList.contains("hidden"), false);
  assert.equal(c.saveButtonLabel.textContent, "继续选图");
  await c.saveButton.click();
  assert.equal(c.saveButtonLabel.textContent, "导入 2 张");
  assert.equal(app.ports.length, 1);
  assert.equal(c.imageGrid.children[0].children[0].disabled, false);
});

test("continuing selection survives cloned session updates and reopening, then a new save shows its result", async () => {
  const app = extension();
  let popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  await tick();
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 1);
  app.ports[0].reply({ ok: true, saved: 1, failed: 1, failedIndices: [2], items: [{ index: 1 }] });
  await until(() => popup.controls.saveButtonLabel.textContent === "继续选图");
  const firstJobId = app.data.connectorJob.id;
  await popup.controls.saveButton.click();
  popup.close();
  popup = app.openPopup();
  await until(() => popup.controls.imageGrid.children.length === 2);
  assert.equal(popup.controls.saveButtonLabel.textContent, "导入 2 张");
  assert.equal(popup.controls.resultMessage.classList.contains("hidden"), true);
  assert.equal(popup.controls.retryFailedButton.classList.contains("hidden"), true);
  void popup.controls.saveButton.click();
  await until(() => app.ports.length === 2);
  assert.notEqual(app.data.connectorJob.id, firstJobId);
  app.ports[1].reply({ ok: true, saved: 2, items: [{ index: 1 }, { index: 2 }] });
  await until(() => popup.controls.saveButtonLabel.textContent === "继续选图");
  assert.match(popup.controls.resultMessage.textContent, /已导入 2 张/);
});

test("save session keeps a stopped request locked through late progress and response delivery", () => {
  const Session = vm.runInNewContext(read("save-session.js") + "\nSaveSession");
  const session = new Session();
  const note = { url: "https://x.com/example/status/42", images: [{ index: 3 }, { index: 7 }] };
  const payload = { action: "save", pageUrl: note.url, destination: "photos", images: note.images };
  assert.equal(session.begin(payload), true);
  session.restore({ id: "first", busy: true, payload });
  assert.equal(session.stop(), true);
  session.restore({ id: "first", busy: true, payload, progress: { phase: "download", completed: 1, total: 2 } });
  assert.equal(session.view(note).label, "正在停止…");
  const result = { ok: true, saved: 1, cancelled: true, failedIndices: [7], items: [{ index: 3 }] };
  session.restore({ id: "first", busy: false, payload, result });
  assert.equal(session.begin(payload), false);
  session.finish(result);
  assert.equal(session.view(note).busy, false);
  assert.match(session.view(note).result.summary, /任务已停止/);
  assert.equal(session.retryPayload("https://x.com/example/status/43"), null);
  const retry = session.retryPayload(note.url);
  assert.deepEqual(Array.from(retry.images, item => item.index), [7]);
  session.continueSelection();
  session.restore(structuredClone({ id: "first", busy: false, payload, result }));
  assert.equal(session.view(note).result, null);
  assert.equal(session.retryPayload(note.url), null);
});

test("save session preserves previous successes and a retry communication error", () => {
  const Session = vm.runInNewContext(read("save-session.js") + "\nSaveSession");
  const session = new Session();
  const note = { url: "https://x.com/example/status/42", images: [{ index: 3 }, { index: 7 }] };
  session.begin({ action: "save", pageUrl: note.url, destination: "folder",
    images: [{ index: 7 }], uiSavedItems: [{ index: 3 }] });
  session.finish({ ok: false, error: "连接已断开" });
  assert.match(session.view(note).result.details, /已保存 1 张/);
  assert.match(session.view(note).result.details, /连接已断开/);
  assert.equal(session.view(note).result.warning, true);
  session.continueSelection();
  assert.equal(session.view(note).result, null);
});

test("closing a local unsent task keeps the previous result dismissed after reopening", () => {
  const Session = vm.runInNewContext(read("save-session.js") + "\nSaveSession");
  const session = new Session();
  const note = { url: "https://x.com/example/status/42", images: [{ index: 3 }, { index: 7 }] };
  const payload = { action: "save", pageUrl: note.url, destination: "photos", images: note.images };
  const firstResult = { ok: true, saved: 1, failed: 1, failedIndices: [7], items: [{ index: 3 }] };
  session.restore({ id: "first", busy: false, payload, result: firstResult });
  session.continueSelection();
  assert.equal(session.view(note).result, null);

  session.begin({ ...payload, albumId: "album" });
  const stoppedResult = { ok: false, cancelled: true, error: "任务已停止，未开始保存", saved: 0,
    failed: 2, failedIndices: [3, 7] };
  session.finish(stoppedResult);
  session.continueSelection();
  session.restore(structuredClone({ id: "first", busy: false, payload, result: firstResult }));

  assert.equal(session.view(note).result, null);
  assert.equal(session.retryPayload(note.url), null);
});

test("stopping while the save draft is pending prevents native submission", async () => {
  const app = extension();
  const popup = app.openPopup();
  const c = popup.controls;
  await until(() => c.imageGrid.children.length === 2);
  await tick();
  const setSession = app.storage.session.set;
  let releaseDraft;
  app.storage.session.set = async (values) => {
    if (values.popupDraft) await new Promise(resolve => { releaseDraft = resolve; });
    return setSession(values);
  };
  const saving = c.saveButton.click();
  await until(() => releaseDraft);
  await c.stopButton.click();
  assert.equal(c.saveButtonLabel.textContent, "正在停止…");
  releaseDraft();
  await until(() => app.requests.length || !c.resultMessage.classList.contains("hidden"));
  assert.equal(app.requests.length, 0);
  await saving;
  assert.equal(app.data.connectorJob, undefined);
  assert.equal(c.saveButton.disabled, false);
  assert.equal(c.stopButton.classList.contains("hidden"), true);
  assert.match(c.resultMessage.textContent, /任务已停止/);
});

test("unconfirmed Photos imports warn before retrying and retry only confirmed failures", async () => {
  const app = extension();
  app.note.images = [
    { index: 1, url: "https://sns-img-bd.xhscdn.com/a" },
    { index: 2, url: "https://sns-img-bd.xhscdn.com/b" },
    { index: 3, url: "https://sns-img-bd.xhscdn.com/c" }
  ];
  const popup = app.openPopup();
  const c = popup.controls;
  await until(() => c.imageGrid.children.length === 3);
  void c.saveButton.click();
  await until(() => app.ports.length === 1);
  app.ports[0].reply({
    ok: true, saved: 1, failed: 1, failedIndices: [2], failureDetails: ["第 2 张：下载超时"],
    unconfirmedIndices: [3], unconfirmedDetails: ["第 3 张：Photos 返回 0 之外的不完整数量"],
    items: [{ index: 1, kind: "image", format: "jpg" }]
  });
  await until(() => !app.data.connectorJob.busy);
  assert.deepEqual(Array.from(app.localData.saveHistory[0].items, item => item.index), [1]);
  assert.equal(c.imageGrid.children[0].children[2].textContent, "已保存");
  assert.equal(c.imageGrid.children[1].children[2].textContent, "保存失败");
  assert.equal(c.imageGrid.children[2].children[2].textContent, "导入未确认");
  assert.match(c.resultMessage.textContent, /1 张结果未确认/);
  void c.retryFailedButton.click();
  await until(() => app.ports.length === 2);
  assert.deepEqual(Array.from(app.ports[1].payload.images, item => item.index), [2]);
  app.ports[1].reply({ ok: true, saved: 1, failed: 0, failedIndices: [], items: [{ index: 2, kind: "image", format: "jpg" }] });
  await until(() => !app.data.connectorJob.busy);
  assert.equal(c.imageGrid.children[2].children[2].textContent, "导入未确认");
  assert.equal(c.retryFailedButton.classList.contains("hidden"), true);
});
