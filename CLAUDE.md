# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「存图夹」：Chrome MV3 扩展 + macOS Native Messaging 连接器，把小红书和 X（原 Twitter）网页版帖子中的原图、GIF、实况照片、视频保存到 macOS「照片」或本地文件夹。无远程服务器、无构建步骤——扩展就是根目录下的纯 JS/HTML/CSS，直接用「加载已解压的扩展程序」调试。

用户界面和文档均为中文；代码注释中英混用。README.md 是权威的用户文档，改动用户可见行为时中英文两部分都要同步更新。

## 常用命令

本机完整检查（需要 Node.js 22+、Python 3.10+、ego lite、Apple 命令行工具；只在 macOS 上运行）：

```sh
./scripts/check.command
```

单独运行某一部分：

```sh
node --test test_extension.cjs test_content.cjs        # 扩展 JS 回归测试
node --test test_extension.cjs                          # 单个测试文件
python3 -B -m unittest discover -s native-host -p 'test_*.py' -v   # 连接器 Python 测试
python3 -B -m unittest native-host.test_host -v         # 单个 Python 测试模块（注意路径写法）
python3 -B scripts/check_popup_layout.py               # ego lite 弹窗 18 个布局场景（360/480/600px）
python3 -B scripts/check_toolbar_popup.py              # ego lite 真实工具栏弹窗启动/重开测试
python3 -B scripts/check_e2e.py                        # ego lite 全链路 E2E：真实扩展 + Native Messaging + 连接器写临时文件夹
python3 -B scripts/check_ego_browser.py                # ego-browser 真实 X 页面媒体 smoke test
```

浏览器校验固定使用 ego lite。`check.command` 默认使用 `/Applications/ego lite.app/Contents/MacOS/ego lite`；其他位置用 `EGO_BROWSER=<路径>` 指定，该路径会传给布局、工具栏和 E2E 三个脚本。设置 `SKIP_BROWSER_CHECKS=1` 会跳过这三项，并在最后输出 `非浏览器检查通过；ego lite 浏览器检查已跳过。`

`check_e2e.py` 使用隔离的 ego lite 配置、活动标签页适配层和本地媒体服务，连接器以临时标识注册到 ego lite 读取的 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` 并在结束后删除。`check_ego_browser.py` 单独运行，检查真实 X 页面和媒体 DOM，但不加载本地扩展，也不验证 Native Messaging；没有可见媒体时会报告 skipped。

构建发布包（先提交代码，脚本从 HEAD 打包并编译 arm64+x86_64 通用二进制）：

```sh
python3 -B scripts/build_release.py /目标目录
```

## 架构

```
popup.js ──chrome.runtime.onMessage──▶ background.js ──Native Messaging──▶ host.py ──▶ Photos.app / 本地文件夹
   ▲                                        │                                 │
   └──── chrome.storage.session 状态 ◀──────┘                    live-photo-helper.swift（实况配对）
```

- **`note-parser.js`** 同时被两处使用：作为 content script 注入（隔离世界），也被 `content.js` 注入页面主世界读取页面状态。它保留小红书 `__INITIAL_STATE__` 解析，并按 URL 中的笔记/帖子 ID 过滤；X 帖子还支持嵌入状态和 DOM 回退。改它要同时跑 `test_extension.cjs` 和 `test_content.cjs`。
- **`background.js`**（service worker）：保存任务的唯一入口。任务状态存 `chrome.storage.session` 的 `connectorJob`，弹窗关闭后任务继续、重开可恢复；worker 重启时会把中断任务标记为失败。每次保存前先做 `status` 握手并校验 `PROTOCOL_VERSION`——**这个常量必须与 `native-host/host.py` 的 `PROTOCOL_VERSION` 保持一致**（当前为 4）。X 的 MSE `blob:` 视频没有直接 MP4 地址，由这里请求公开 syndication 接口后把 MP4 variants 交回内容脚本。取消通过向 save 端口发 `{action: "cancel"}` 实现。历史记录（最近 100 条成功）存 `chrome.storage.local`。
- **`save-session.js`**：集中管理弹窗保存会话的恢复、停止、结果呈现和失败重试。`connectorJob.id` 标识一次任务；「继续选图」把已关闭结果的任务 ID 写入草稿，重开弹窗时不会重新展示旧结果。Photos 未确认项单独保留在 `unconfirmedIndices`，不进入失败重试或成功历史。
- **`native-host/host.py`**：独立校验域名白名单（小红书 CDN 和 `x.com`/`twitter.com`/`twimg.com`），按平台处理原图 URL，按文件真实字节嗅探格式。媒体用 256 KB 分块写入临时文件，图片上限 80 MB、视频上限 512 MB，读取间检查取消请求。普通 X 视频独立保存为 MP4；小红书 Live Photo 仍走配对逻辑。导入「照片」走内嵌 AppleScript（`IMPORT_SCRIPT` 等，check.command 会用 osacompile 验证可编译）。
- **`native-host/live-photo-helper.swift`**：给静态帧和 MOV 写入同一 Apple Content Identifier 后配对导入。安装时编译（发布包带预编译通用二进制）。
- **`native-host/install.py`**：`install.command` 的实际逻辑。先在临时目录完成全部准备，成功后才替换 `~/Library/Application Support/存图夹/`——失败不覆盖已有安装。测试直接调用它的 `install()` 函数。
- **`manifest.json` 的 `key` 字段固定了扩展 ID**（`doklnnbjpnipnicbiecefbchkhmckcbm`），连接器只接受这个 ID 的消息；不要改 key。

## 测试约束

- 测试不会写入真实照片图库；Live Photo 验证用 `scripts/live-photo-fixture.swift` 生成真实 JPEG/H.264 样本。
- Python 代码要求兼容 3.10（check.command 用 `ast.parse(feature_version=(3, 10))` 验证），运行测试用 `python3 -B` 避免产生 `__pycache__`。
- CI（`.github/workflows/check.yml`）在 macos-latest 和 macos-15-intel 上设置 `SKIP_BROWSER_CHECKS=1`，只跑 `check.command` 的非浏览器部分和 `build_release.py`；runner 未配置 ego lite，因此布局、工具栏和 E2E 浏览器检查不运行。推 `v*` 标签自动发 Release，发布说明取自 `docs/releases/<标签>.md`，发版前要先写好该文件。

## 其他目录

- `ios-shortcut/`：独立的纯快捷指令版本（iPhone），`build_shortcut.py` 生成 `.shortcut` 文件；与扩展无代码共享，但共享笔记解析思路。
- `design-previews/`：弹窗交互设计稿（静态 HTML 原型，演示数据）。
