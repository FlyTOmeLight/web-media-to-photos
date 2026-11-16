"""Full end-to-end check: real extension, ego lite browser, and native connector.

An isolated ego lite profile loads a copy of the unpacked extension, a local
HTTPS-intercepting proxy serves fixture 小红书/X pages under their real origins,
and the native connector is installed under a temporary native messaging host
name that ego lite resolves from the user-level Chrome directory. The
unmodified popup.html/popup.js run in an extension tab and save into a
temporary folder, never into Photos.
"""
from __future__ import annotations

import argparse
import base64
import http.server
import json
import os
import shutil
import signal
import socketserver
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path

import runpy

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BROWSER = '/Applications/ego lite.app/Contents/MacOS/ego lite'
# Unique name so the test never touches a real installed connector.
E2E_HOST_NAME = 'com.local.media_photos.e2e'
NATIVE_HOSTS_DIR = Path.home() / 'Library/Application Support/Google/Chrome/NativeMessagingHosts'
XHS_URL = 'http://www.xiaohongshu.com/explore/e2e123abc'
X_URL = 'http://x.com/e2e_user/status/1234567890123456'
GIF_1X1 = base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')
TLS_HOSTS = {'www.xiaohongshu.com', 'xiaohongshu.com', 'x.com', 'www.x.com', 'pbs.twimg.com',
             'cdn.syndication.twimg.com', 'sns-img-qc.xhscdn.com'}


class FixtureSite(socketserver.ThreadingTCPServer):
    """HTTP proxy plus direct fixture server used by Chrome and the connector."""

    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, tls_context):
        super().__init__(('127.0.0.1', 0), FixtureHandler)
        self.tls_context = tls_context
        self.pages = {}
        self.media = {}
        self.requests = []
        self.lock = threading.Lock()

    def record(self, host, path, query):
        with self.lock:
            self.requests.append((host, path, query))


class FixtureHandler(socketserver.StreamRequestHandler):
    timeout = 20

    def handle(self):
        try:
            request = self.read_request()
            if not request:
                return
            method, target, headers = request
            if method == 'CONNECT':
                self.serve_connect(target)
                return
            self.serve_target(target, headers)
        except (OSError, ValueError, ssl.SSLError):
            return

    def read_request(self):
        line = self.rfile.readline(65536)
        if not line:
            return None
        parts = line.decode('latin-1').strip().split(' ')
        if len(parts) != 3:
            raise ValueError('bad request line')
        headers = {}
        while True:
            header = self.rfile.readline(65536)
            if not header or header in {b'\r\n', b'\n'}:
                break
            key, _, value = header.decode('latin-1').partition(':')
            headers[key.strip().lower()] = value.strip()
        return parts[0], parts[1], headers

    def serve_connect(self, target):
        host = target.rsplit(':', 1)[0].strip('[]').lower()
        if host not in TLS_HOSTS:
            self.respond(b'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            return
        self.wfile.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
        self.wfile.flush()
        secure = self.server.tls_context.wrap_socket(self.connection, server_side=True)
        self.connection = secure
        self.rfile = secure.makefile('rb')
        self.wfile = secure.makefile('wb')
        request = self.read_request()
        if request:
            method, inner_target, headers = request
            self.serve_target(inner_target, headers)

    def serve_target(self, target, headers):
        if '://' in target:
            url = urllib.parse.urlsplit(target)
        else:
            url = urllib.parse.urlsplit(f'http://{headers.get("host", "")}{target}')
        host = (url.hostname or '').lower()
        path = url.path or '/'
        self.server.record(host, path, url.query)
        if path in self.server.pages:
            body = self.server.pages[path].encode('utf-8')
            self.reply(200, 'text/html; charset=utf-8', body)
        elif path.startswith('/media/') and path[len('/media/'):] in self.server.media:
            content_type, body = self.server.media[path[len('/media/'):]]
            self.reply(200, content_type, body)
        else:
            self.reply(404, 'text/plain; charset=utf-8', b'not found')

    def reply(self, status, content_type, body):
        reason = 'OK' if status == 200 else 'Not Found'
        header = (f'HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\n'
                  f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n').encode('latin-1')
        self.respond(header + body)

    def respond(self, data):
        self.wfile.write(data)
        self.wfile.flush()


class ReportServer(http.server.ThreadingHTTPServer):
    def __init__(self, reports):
        super().__init__(('127.0.0.1', 0), ReportHandler)
        self.reports = reports


class ReportHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length') or 0)
        try:
            report = json.loads(self.rfile.read(length) or b'{}')
        except json.JSONDecodeError:
            report = {'event': 'invalid-json'}
        print(f'E2E report: {report.get("event")} {report.get("name", "")}'.rstrip(), flush=True)
        self.server.reports.append(report)
        self.send_response(200)
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *_):
        pass


def build_fixtures(work):
    """Compile the Swift Live Photo fixture and derive the other media samples."""
    fixtures = work / 'fixtures'
    fixtures.mkdir()
    compiler = subprocess.check_output(
        ['/usr/bin/xcrun', '--sdk', 'macosx', '--find', 'swiftc'], text=True).strip()
    sdk = subprocess.check_output(
        ['/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path'], text=True).strip()
    binary = work / 'live-photo-fixture'
    subprocess.run([compiler, '-sdk', sdk, str(ROOT / 'scripts/live-photo-fixture.swift'),
                    '-o', str(binary)], check=True, capture_output=True, timeout=300)
    subprocess.run([str(binary), str(fixtures)], check=True, capture_output=True, timeout=120)
    subprocess.run(['/usr/bin/sips', '-s', 'format', 'png',
                    str(fixtures / 'image.jpg'), '--out', str(fixtures / '02.png')],
                   check=True, capture_output=True, timeout=60)
    photo = (fixtures / 'image.jpg').read_bytes()
    media = {
        '01.jpg': ('image/jpeg', photo),
        '02.png': ('image/png', (fixtures / '02.png').read_bytes()),
        '03.gif': ('image/gif', GIF_1X1),
        '04.jpg': ('image/jpeg', photo),
        '04.mov': ('video/quicktime', (fixtures / 'video.mov').read_bytes()),
        'x1.jpg': ('image/jpeg', photo),
        'x2.jpg': ('image/jpeg', photo),
    }
    return media


def xhs_page(port):
    def url(name):
        return f'http://127.0.0.1:{port}/media/{name}'

    images = [
        {'urlDefault': url('01.jpg'), 'width': 64, 'height': 64,
         'infoList': [{'imageScene': 'WB_PRV', 'url': url('01.jpg')},
                      {'imageScene': 'WB_DFT', 'url': url('01.jpg')}]},
        {'urlDefault': url('02.png'), 'width': 64, 'height': 64,
         'infoList': [{'imageScene': 'WB_DFT', 'url': url('02.png')}]},
        {'urlDefault': url('03.gif'), 'imageType': 'gif', 'width': 64, 'height': 64},
        {'urlDefault': url('04.jpg'), 'width': 64, 'height': 64, 'livePhoto': True,
         'stream': {'h264': [{'masterUrl': url('04.mov')}]}},
        {'urlDefault': url('05.jpg'), 'width': 64, 'height': 64},
    ]
    state = json.dumps({'note': {'noteDetailMap': {'e2e123abc': {
        'noteId': 'e2e123abc', 'title': 'E2E 笔记标题', 'imageList': images}}}}, ensure_ascii=False)
    return f'''<!doctype html><meta charset="utf-8"><title>E2E 笔记标题 - 小红书</title>
<h1 id="detail-title">E2E 笔记标题</h1>
<div class="note-detail-mask"><div class="media-container"></div></div>
<script>window.__INITIAL_STATE__={state};</script>'''


def x_page():
    return '''<!doctype html><meta charset="utf-8"><title>E2E X post / X</title>
<article data-testid="tweet">
  <div data-testid="tweetText">E2E X post</div>
  <img src="https://pbs.twimg.com/media/x1.jpg" alt="media">
  <img src="https://pbs.twimg.com/media/x2.jpg" alt="media">
  <a href="/e2e_user/status/1234567890123456"><time datetime="2026-01-01T00:00:00Z">0:00</time></a>
</article>'''


def make_certificate(work):
    key, cert, config = work / 'proxy.key', work / 'proxy.crt', work / 'proxy.cnf'
    config.write_text(f'''[req]
distinguished_name = dn
prompt = no
x509_extensions = v3
[dn]
CN = localhost
[v3]
subjectAltName = @names
basicConstraints = CA:FALSE
[names]
{chr(10).join(f'DNS.{index} = {host}' for index, host in enumerate(sorted(TLS_HOSTS), start=1))}
''')
    subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                    '-days', '2', '-keyout', str(key), '-out', str(cert),
                    '-config', str(config)], check=True, capture_output=True, timeout=120)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(str(cert), str(key))
    return context


POPUP_DRIVER = r'''(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const send = (message) => chrome.runtime.sendMessage({ type: "E2E_POPUP", ...message }).catch(() => {});
  const { e2eStage } = await chrome.storage.session.get("e2eStage");
  const name = e2eStage?.name || "";
  const heartbeat = setInterval(() => send({ stage: "heartbeat", name }), 3000);
  try {
    let save = null;
    let label = "";
    const readyDeadline = Date.now() + 45000;
    while (Date.now() < readyDeadline) {
      save = document.querySelector("#saveButton");
      label = document.querySelector("#saveButtonLabel")?.textContent || "";
      const gallery = document.querySelector("#galleryState");
      const empty = document.querySelector("#emptyState");
      if (empty && !empty.classList.contains("hidden")) {
        throw new Error("弹窗没有读到媒体：" + (document.querySelector("#emptyMessage")?.textContent || ""));
      }
      if (gallery && !gallery.classList.contains("hidden") && save && !save.classList.contains("hidden")
          && !save.disabled && /^保存 \d+ 张$/.test(label)) break;
      await sleep(100);
    }
    if (!save || save.disabled) throw new Error("保存按钮未就绪：" + label);
    await send({ stage: "ready", name,
      title: document.querySelector("#noteTitle").textContent,
      images: document.querySelectorAll("#imageGrid .image-item").length, label,
      badges: [...document.querySelectorAll("#imageGrid .media-badge")].map((node) => node.textContent) });
    save.click();
    const savedDeadline = Date.now() + 90000;
    while (Date.now() < savedDeadline) {
      const result = document.querySelector("#resultMessage");
      const text = result?.textContent || "";
      if (result && !result.classList.contains("hidden") && text) {
        clearInterval(heartbeat);
        await send({ stage: "saved", name, text,
          markers: [...document.querySelectorAll("#imageGrid .result-marker")].map((node) => node.textContent) });
        window.close();
        return;
      }
      await sleep(100);
    }
    throw new Error("保存结果超时");
  } catch (error) {
    clearInterval(heartbeat);
    await send({ stage: "error", name, error: String(error?.message || error) });
    window.close();
  }
})();'''


WORKER_DRIVER = r'''importScripts("background.js");

const E2E = __E2E__;
console.log("E2E_WORKER_LOADED", E2E.report);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (value) => fetch(E2E.report, { method: "POST", body: JSON.stringify(value) })
  .catch((error) => console.error("E2E_REPORT_FAILED", value.event, String(error?.message || error)));
let started = false;

async function waitForTab(tabId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.status === "complete") return tab;
    await sleep(100);
  }
  throw new Error("页面加载超时");
}


function waitForPopup(name) {
  return new Promise((resolve, reject) => {
    let ready = null;
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("工具栏弹窗没有完成保存（90 秒）"));
    }, 90000);
    function listener(message, sender, reply) {
      if (message?.type !== "E2E_POPUP" || message.name !== name) return;
      console.log("E2E_POPUP_MESSAGE", message.stage, message.name);
      reply({ ok: true });
      if (message.stage === "heartbeat") {
        post({ event: "heartbeat", ...message });
        return;
      }
      if (message.stage === "ready") {
        ready = message;
        post({ event: "ready", ...message });
        return;
      }
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(listener);
      if (message.stage === "error") reject(new Error(message.error || "弹窗执行失败"));
      else resolve({ ...(ready || {}), ...message });
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function activeTab(windowId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [tab] = await chrome.tabs.query({ windowId, active: true });
    if (tab?.id) return tab;
    await sleep(100);
  }
  throw new Error("新窗口没有创建标签页");
}

async function runScenario(index) {
  const scenario = E2E.scenarios[index];
  console.log("E2E_SCENARIO", scenario.name);
  await chrome.storage.session.clear();
  const window = await chrome.windows.create(
    { url: scenario.url, focused: true, width: 1000, height: 850, type: "normal" });
  const tab = await activeTab(window.id);
  const loaded = await waitForTab(tab.id);
  console.log("E2E_TAB_READY", loaded.status);
  await sleep(700);
  await chrome.storage.session.set({
    e2eStage: { index, name: scenario.name },
    e2eActiveTab: { id: tab.id, url: scenario.url, windowId: window.id }
  });
  const completion = waitForPopup(scenario.name);
  const popupTab = await chrome.tabs.create({
    windowId: window.id, url: chrome.runtime.getURL("popup.html"), active: true });
  console.log("E2E_POPUP_OPENED", popupTab.id);
  const popup = await completion;
  console.log("E2E_POPUP_DONE", popup.stage);
  const session = await chrome.storage.session.get(["connectorJob", "folderPath"]);
  const local = await chrome.storage.local.get(["saveHistory"]);
  post({ event: "scenario", name: scenario.name, popup, job: session.connectorJob,
         folderPath: session.folderPath, history: local.saveHistory });
  await chrome.tabs.remove(popupTab.id).catch(() => {});
  await chrome.windows.remove(window.id).catch(() => {});
  await sleep(800);
}

async function run() {
  if (started) return;
  started = true;
  console.log("E2E_RUN_START");
  try {
    // Extension API calls reset the service worker idle timer during the save.
    setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
    await chrome.storage.local.set({
      folderPath: E2E.folder,
      destinationPreferences: { destination: "folder", albumId: "" },
      saveHistory: []
    });
    console.log("E2E_STORAGE_READY");
    post({ event: "start" });
    await runScenario(0);
    await runScenario(1);
    post({ event: "done" });
  } catch (error) {
    post({ event: "fatal", error: String(error?.stack || error?.message || error) });
  }
}

setTimeout(run, 1200);'''


HOST_WRAPPER = r'''"""Test wrapper: same connector, media hosts rewritten to the local fixture server."""
import importlib.util
import sys
import urllib.parse
from pathlib import Path

spec = importlib.util.spec_from_file_location("e2e_host_impl", Path(__file__).with_name("e2e_host_impl.py"))
host = importlib.util.module_from_spec(spec)
sys.modules["e2e_host_impl"] = host
spec.loader.exec_module(host)
host.ALLOWED_HOST_SUFFIXES = (*host.ALLOWED_HOST_SUFFIXES, "127.0.0.1")
_local = "127.0.0.1:__PORT__"
_original = host.open_download


def _open(url, accept):
    parsed = urllib.parse.urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if hostname == "127.0.0.1":
        url = urllib.parse.urlunsplit(("http", parsed.netloc, parsed.path, parsed.query, ""))
    elif hostname == "pbs.twimg.com":
        url = urllib.parse.urlunsplit(("http", _local, parsed.path, parsed.query, ""))
    return _original(url, accept)


host.open_download = _open
host.main()'''


ACTIVE_TAB_SHIM = r'''(() => {
  // The popup runs as a normal extension window here, so it cannot see the
  // fixture tab as its own active tab; the driver tells it which tab to read.
  const actualQuery = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (info = {}) => {
    if (info.active && info.currentWindow) {
      const stored = await chrome.storage.session.get("e2eActiveTab");
      if (stored?.e2eActiveTab?.id) return [stored.e2eActiveTab];
    }
    return actualQuery(info);
  };
})();'''


def prepare_extension(work):
    extension = work / 'extension'
    extension.mkdir()
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    manifest['host_permissions'] = list(dict.fromkeys(
        manifest['host_permissions'] + ['http://127.0.0.1/*']))
    manifest['name'] = '存图夹 · E2E'
    manifest['background'] = {'service_worker': 'e2e-worker.js'}
    (extension / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    for name in ('popup.css', 'popup.js', 'content.js', 'note-parser.js'):
        shutil.copyfile(ROOT / name, extension / name)
    worker = (ROOT / 'background.js').read_text()
    production_host = 'const NATIVE_HOST = "com.local.media_photos";'
    if production_host not in worker:
        raise RuntimeError('background.js 的连接器标识与 E2E 预期不一致')
    (extension / 'background.js').write_text(
        worker.replace(production_host, f'const NATIVE_HOST = "{E2E_HOST_NAME}";'))
    html = (ROOT / 'popup.html').read_text().replace(
        '<script src="popup.js"></script>',
        '<script src="e2e-active-tab.js"></script><script src="popup.js"></script>'
        '<script src="e2e-popup.js"></script>')
    (extension / 'popup.html').write_text(html)
    (extension / 'e2e-active-tab.js').write_text(ACTIVE_TAB_SHIM)
    (extension / 'e2e-popup.js').write_text(POPUP_DRIVER)
    return extension


def prepare_connector(work, port):
    support = work / 'connector'
    manifest = NATIVE_HOSTS_DIR / f'{E2E_HOST_NAME}.json'
    if manifest.exists():
        try:
            previous = json.loads(manifest.read_text()).get('path', '')
        except (OSError, json.JSONDecodeError):
            previous = ''
        if 'rednote-e2e-' not in previous:
            raise RuntimeError(f'{manifest} 已存在且不是 E2E 连接器，请先移除')
        manifest.unlink()
    installer = runpy.run_path(str(ROOT / 'native-host/install.py'))
    installer['install'](ROOT / 'native-host', support, manifest, Path(sys.executable))
    config = json.loads(manifest.read_text())
    config['name'] = E2E_HOST_NAME
    manifest.write_text(json.dumps(config, ensure_ascii=False, indent=2))
    shutil.copyfile(support / 'host.py', support / 'e2e_host_impl.py')
    (support / 'host.py').write_text(HOST_WRAPPER.replace('__PORT__', str(port)))
    return manifest


def run_browser(browser, extension, profile, port, log_path):
    command = [
        browser, '--headless=new', f'--user-data-dir={profile}', '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps', '--disable-component-update', '--disable-background-networking',
        '--disable-sync', '--no-pings', '--metrics-recording-only',
        '--enable-logging=stderr', '--v=0',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion',
        f'--load-extension={extension}', f'--disable-extensions-except={extension}',
        f'--proxy-server=http://127.0.0.1:{port}', '--ignore-certificate-errors',
        '--window-size=1000,850', 'about:blank',
    ]
    log = log_path.open('w')
    try:
        process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
    except FileNotFoundError as error:
        log.close()
        raise RuntimeError(f'ego lite executable not found: {browser}') from error
    return process, log


def stop_browser(process):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for target in (lambda: os.killpg(process.pid, sig), lambda: process.send_signal(sig)):
            try:
                target()
                break
            except (ProcessLookupError, PermissionError):
                continue
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            continue


def wait_for_reports(reports, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        events = {report.get('event') for report in reports}
        if 'done' in events or 'fatal' in events:
            return
        time.sleep(0.2)


def assert_bytes(path, expected, label):
    data = path.read_bytes()
    if data != expected:
        raise AssertionError(f'{label}: {path} does not match the fixture bytes ({len(data)} bytes)')


def same_page(actual, expected):
    actual_url = urllib.parse.urlsplit(actual)
    expected_url = urllib.parse.urlsplit(expected)
    return (actual_url.hostname, actual_url.path) == (expected_url.hostname, expected_url.path)


def check_xhs(report):
    result = report['job']['result']
    if not result.get('ok') or result.get('saved') != 4 or result.get('failed') != 1:
        raise AssertionError(f'小红书保存结果异常：{result}')
    if result.get('failedIndices') != [5]:
        raise AssertionError(f'小红书失败编号异常：{result.get("failedIndices")}')
    items = [(item['index'], item['kind'], item['format']) for item in result['items']]
    if items != [(1, 'image', 'jpg'), (2, 'image', 'png'), (3, 'gif', 'gif'), (4, 'live', 'jpg')]:
        raise AssertionError(f'小红书条目异常：{items}')
    popup = report['popup']
    if popup['images'] != 5 or popup['title'] != 'E2E 笔记标题':
        raise AssertionError(f'弹窗读取的笔记异常：{popup}')
    if popup['badges'] != ['', '', 'GIF', 'LIVE', '']:
        raise AssertionError(f'媒体角标异常：{popup["badges"]}')
    if popup['markers'] != ['已保存', '已保存', '已保存', '已保存', '保存失败']:
        raise AssertionError(f'结果标记异常：{popup["markers"]}')
    if popup['text'] != '已保存 4 张到本地文件夹，1 张失败':
        raise AssertionError(f'保存结果文案异常：{popup["text"]}')
    rows = report['history']
    if len(rows) != 1 or not same_page(rows[0]['pageUrl'], XHS_URL) or rows[0]['destination'] != 'folder':
        raise AssertionError(f'保存历史异常：{rows}')
    return result['folderPath']


def check_xhs_files(folder, media):
    export = Path(folder)
    names = sorted(path.name for path in export.iterdir())
    if names != ['01.jpg', '02.png', '03.gif', '04.jpg', '04.mov', 'source.json']:
        raise AssertionError(f'小红书导出文件异常：{names}')
    assert_bytes(export / '01.jpg', media['01.jpg'][1], '第 1 张')
    assert_bytes(export / '02.png', media['02.png'][1], '第 2 张')
    assert_bytes(export / '03.gif', media['03.gif'][1], '第 3 张')
    image = (export / '04.jpg').read_bytes()
    if not image.startswith(b'\xff\xd8\xff'):
        raise AssertionError('实况照片静态图不是 JPEG')
    video = (export / '04.mov').read_bytes()
    if len(video) < 12 or video[4:8] != b'ftyp' or video[8:12] != b'qt  ':
        raise AssertionError('实况照片视频不是 QuickTime MOV')
    source = json.loads((export / 'source.json').read_text())
    if source['title'] != 'E2E 笔记标题' or not same_page(source['pageUrl'], XHS_URL):
        raise AssertionError(f'source.json 元数据异常：{source}')
    if source['failedIndices'] != [5]:
        raise AssertionError(f'source.json 失败编号异常：{source["failedIndices"]}')
    live = source['items'][3]
    if live['kind'] != 'live' or live['files'] != ['04.jpg', '04.mov']:
        raise AssertionError(f'source.json 实况条目异常：{live}')


def check_x(report):
    result = report['job']['result']
    if not result.get('ok') or result.get('saved') != 2 or result.get('failed') != 0:
        raise AssertionError(f'X 保存结果异常：{result}')
    popup = report['popup']
    if popup['images'] != 2 or popup['title'] != 'E2E X post':
        raise AssertionError(f'X 弹窗内容异常：{popup}')
    if popup['markers'] != ['已保存', '已保存']:
        raise AssertionError(f'X 结果标记异常：{popup["markers"]}')
    if popup['text'] != '已保存 2 张到本地文件夹':
        raise AssertionError(f'X 保存结果文案异常：{popup["text"]}')
    if [(item['index'], item['format']) for item in result['items']] != [(1, 'jpg'), (2, 'jpg')]:
        raise AssertionError(f'X 条目异常：{result["items"]}')
    rows = report['history']
    if (len(rows) != 2 or not same_page(rows[0]['pageUrl'], X_URL)
            or not same_page(rows[1]['pageUrl'], XHS_URL)):
        raise AssertionError(f'X 保存历史异常：{rows}')
    return result['folderPath']


def check_x_files(folder, media):
    export = Path(folder)
    names = sorted(path.name for path in export.iterdir())
    if names != ['01.jpg', '02.jpg', 'source.json']:
        raise AssertionError(f'X 导出文件异常：{names}')
    assert_bytes(export / '01.jpg', media['x1.jpg'][1], 'X 第 1 张')
    assert_bytes(export / '02.jpg', media['x2.jpg'][1], 'X 第 2 张')
    source = json.loads((export / 'source.json').read_text())
    if source['title'] != 'E2E X post' or not same_page(source['pageUrl'], X_URL):
        raise AssertionError(f'X source.json 异常：{source}')


def check_requests(requests):
    seen = {(host, path, query) for host, path, query in requests}
    for name in ('01.jpg', '02.png', '03.gif', '04.jpg', '04.mov'):
        if ('127.0.0.1', f'/media/{name}', '') not in seen:
            raise AssertionError(f'连接器没有直接下载 {name}：{sorted(seen)}')
    for name in ('x1.jpg', 'x2.jpg'):
        if ('127.0.0.1', f'/media/{name}', 'name=orig') not in seen:
            raise AssertionError(f'X 原图请求没有带上 name=orig：{sorted(seen)}')
    if not any(host == 'pbs.twimg.com' and path == '/media/x1.jpg' for host, path, _ in requests):
        raise AssertionError('弹窗没有通过代理加载 X 预览图')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', '--chrome', dest='browser', default=DEFAULT_BROWSER)
    parser.add_argument('--timeout', type=int, default=150)
    args = parser.parse_args()
    reports = []
    report_server = ReportServer(reports)
    threading.Thread(target=report_server.serve_forever, daemon=True).start()
    report_url = f'http://127.0.0.1:{report_server.server_port}/report'

    work = Path(tempfile.mkdtemp(prefix='rednote-e2e-'))
    browser_process = None
    browser_log = work / 'browser.log'
    host_manifest = None
    site = None
    try:
        media = build_fixtures(work)
        site = FixtureSite(make_certificate(work))
        site.media = media
        site.pages = {
            urllib.parse.urlsplit(XHS_URL).path: xhs_page(site.server_address[1]),
            urllib.parse.urlsplit(X_URL).path: x_page(),
        }
        threading.Thread(target=site.serve_forever, daemon=True).start()

        profile = work / 'profile'
        extension = prepare_extension(work)
        host_manifest = prepare_connector(work, site.server_address[1])
        scenarios = [
            {'name': 'xhs', 'url': XHS_URL},
            {'name': 'x', 'url': X_URL},
        ]
        config = {'folder': str(work / 'exports'), 'report': report_url, 'scenarios': scenarios}
        Path(work / 'exports').mkdir()
        (extension / 'e2e-worker.js').write_text(
            WORKER_DRIVER.replace('__E2E__', json.dumps(config, ensure_ascii=False)))

        browser_process, log = run_browser(args.browser, extension, profile,
                                           site.server_address[1], browser_log)
        try:
            wait_for_reports(reports, args.timeout)
            log.flush()
        finally:
            stop_browser(browser_process)
            browser_process = None
            log.close()

        failures = [report for report in reports if report.get('event') in {'fatal', 'invalid-json'}]
        events = {report.get('event') for report in reports}
        if failures or 'done' not in events:
            detail = json.dumps(reports, ensure_ascii=False, indent=2)
            tail = browser_log.read_text(errors='replace')[-4000:]
            raise AssertionError(f'E2E 没有跑完：{detail}\nego lite 日志：\n{tail}')
        scenarios_done = {report['name']: report for report in reports
                          if report.get('event') == 'scenario'}
        if set(scenarios_done) != {'xhs', 'x'}:
            raise AssertionError(f'场景报告不完整：{scenarios_done.keys()}')

        xhs_folder = check_xhs(scenarios_done['xhs'])
        check_xhs_files(xhs_folder, media)
        x_folder = check_x(scenarios_done['x'])
        check_x_files(x_folder, media)
        check_requests(site.requests)
        print('ego lite 全链路 E2E：小红书 4/5 张（含实况）与 X 2 张均经真实扩展、Native Messaging 连接器写入本地文件夹。')
        print('  小红书导出：' + xhs_folder)
        print('  X 导出：' + x_folder)
    finally:
        if browser_process is not None:
            stop_browser(browser_process)
        if host_manifest is not None:
            host_manifest.unlink(missing_ok=True)
        if site is not None:
            site.shutdown()
            site.server_close()
        report_server.shutdown()
        report_server.server_close()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    try:
        main()
    except AssertionError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
