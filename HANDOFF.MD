# 项目经验

## 2026-11-17：双平台快捷指令原生安装实测

- 直接 `open -a Shortcuts <签名文件>` 可打开安装预览，添加/替换后须用 `shortcuts list --show-identifiers` 核对新标识。替换时若旧编辑器仍打开，旧记录可能被重命名为带 `2` 的副本；不要继续执行旧 ID。File > Import 的灰色按钮并非签名无效，本次已经完成真实安装。
- 首次原生运行失败为 `ConditionalAction Code=1`，日志给出 `WFActionIndex=37`；失败动作是 Dictionary Value 的 `type == photo`，不是 Photos 缺相簿。字典输出为联合类型，If subject 必须通过 `WFCoercionVariableAggrandizement` 指定 `WFStringContentItem`、`WFNumberContentItem` 或 `WFBooleanContentItem`，否则比较参数可能被系统视为未填写。已修复生成器并补回归，总计 14 项通过。
- 可用 `/usr/bin/log show` 筛选 `com.apple.shortcuts` 的 RunningLifecycle / WorkflowExecution，确认真实动作及 WFActionIndex。`shortcuts run` 退出 0 也可能来自显式停止，不能据此判保存成功；本次另核对了 `WFSaveToCameraRollAction` 的成功及返回项目数。它在此 Mac 上省略相簿参数可正常导入默认图库。
- 正式安装版已实测 X 图片、GIF MP4、普通 MP4 各保存 1 项，小红书有效手机页笔记保存 2 项。小红书原始数据经 `public.data → note.txt → detect.text` 保留状态脚本并成功解析；此前这一必要验证现已补齐。原生测试实际写入了 5 项 Mac 照片媒体，未擅自删除图库内容。
- iPhone 镜像已连接，并在手机 Shortcuts 列表观察到正式版同步。用户手动点开 URL scheme、允许联网并确认选择后反馈 X 图片保存完成；代理未独立检查手机图库，其他 iPhone 媒体/平台及分享、剪贴板、短链入口仍未逐项实测。镜像 `click` 返回 noWindowsAvailable，键盘与截图可用；Safari 地址框分步聚焦后 typeText 可正确输入完整本地调用 URL，首次打开仍需用户点确认。不要以手机安装同步代替运行验收。
- 「存图夹-纯快捷指令 2」和「存图夹-原生诊断」两个测试副本的删除最初被自动审批拒绝，因会同步到全部 iCloud 设备；用户明确授权后已删除并核对正式版及原有旧版均保留。

## 2026-11-17：双平台纯快捷指令 2.0.0

- `ios-shortcut/build_shortcut.py` 现在生成同一个小红书/X 指令；版本独立于 Mac 扩展，未修改扩展 manifest。分享输入优先、无输入才读剪贴板，按原帖编号和类型选择后才下载。小红书保留分享参数，手机页读取 `noteData.data.noteData`，桌面页读取当前 ID 的 `note.noteDetailMap`；两者均校验 noteId。X 只读顶层 mediaDetails 并校验 id_str，不遍历引用/父帖。
- X syndication 的 `token=0` 已对公开图片、GIF、视频样例返回正确数据，但不属于官方稳定契约。GIF 的 MP4 bitrate 可为 0，最高码率初值必须低于 0；只提供 HLS 时不得用封面冒充视频。原图规范为 `/media/<id>?format=<jpg或png>&name=orig`，WebP 改 JPEG。
- 原生 If 的输入是特殊 Variable 包装；数字、布尔比较分别写 WFNumberValue、WFBooleanValue。内层循环使用命名变量 Repeat Item 2 / Repeat Index 2，不能拿循环开始的 UUID 假装当前项。UTF-16 文本变量偏移、字典参数和动作定义已核对。`shortcuts sign` 会把生成文件交 Apple 校验；签名成功不等于动作已运行。
- 13 项离线测试直接解释生成动作，覆盖双平台、身份、短链、URL 格式、MP4/GIF/HLS、选择后下载、失败停止及 undefined 字符串保护；已接入 check.command。非浏览器完整检查通过，最后的 URL 修正后重跑 13 项及 Python 3.10 语法检查。浏览器检查此次未运行。沙箱内再次出现旧的 osacompile 第 13 行错误，沙箱外检查通过。
- 此初版构建阶段尚未完成原生安装和保存；后续已补齐 Mac 真实链路及 iPhone 安装同步，发现并修复 If 类型问题，详见上方原生安装实测记录。初版离线回放不证明 ContentKit 转换；该转换的 Mac 实际运行证据已在后续取得。

## 2026-11-17：浏览器校验统一使用 ego lite

- 用户明确要求以后不再用 Chrome 或 Chrome for Testing 做浏览器校验。布局、工具栏及全链路 E2E 脚本均默认使用 ego lite，`--browser` / `EGO_BROWSER` 只用于指定 ego lite 可执行文件；没有 Chrome 回退。产品 Chrome MV3、安装说明和 Native Messaging 目录不受影响。
- 已用隔离 ego lite 验证 18 个布局场景（360/480/600px），真实工具栏弹窗首次打开及结果恢复重开均为 420×600，原有断言全部通过。ego lite 支持现有 headless / dump-dom 布局夹具及 `chrome.action.openPopup` 工具栏夹具。
- 本地完整检查缺少 ego lite 时失败。CI 未配置 ego lite，显式设置 `SKIP_BROWSER_CHECKS=1` 并报告跳过的三项浏览器检查；非浏览器检查通过不代表浏览器检查通过。需要浏览器证据时在安装 ego lite 的 macOS 上运行完整入口。
- `./scripts/check.command` 已完整通过：70 项 JS、54 项 Python、ego lite 布局/工具栏/E2E、语法、AppleScript、临时安装/协议 4 握手及实况夹具。`SKIP_BROWSER_CHECKS=1 ./scripts/check.command` 也已通过；GitHub Actions 尚未运行。受限沙箱内曾报 `IMPORT_SCRIPT` 第 13 行 `Expected end of line but found property`，同一源码在沙箱外两条检查入口均编译通过，遇到此错误先核对执行环境。

## 2026-11-17：媒体收集与保存任务重构

- 当前页媒体收集统一由 `content.js` 返回结果，Popup 只消费结果；主世界读取由后台执行。合并候选前核对帖子身份，异步读取期间切换帖子时放弃旧结果。X 视频须取得可保存的直接视频地址；筛除不可保存条目后保留媒体原编号。
- `save-session.js` 管理恢复、停止、结果及失败重试。后台每次任务生成独立 ID，「继续选图」将已关闭结果的任务 ID 存入草稿；不能再用对象引用判断结果是否已关闭，Chrome 存储更新会复制对象。提交前等待草稿写入期间的停止意图也须检查，否则 UI 显示停止但仍会发出保存请求；延迟写入回归用例已验证原生请求数为 0。
- 每个 worker 有自己的 `ExitStack`，下载文件和实况配对目录创建后立即登记；保存任务等待线程池退出后统一释放。不能依赖主线程收取 Future 结果后才登记清理：进度回调异常会留下未收取的资源。回归覆盖进度异常、成功、失败和取消后的清理。
- Photos 导入仅在返回条目数与预期媒体条目数一致时确认成功，实况配对的两个文件算一个条目。部分数量、无效返回、超时及 AppleScript 非零退出均保留为 `unconfirmedIndices`，不计入成功历史或失败重试，也不逐项补导。重试其他失败项时须保留已有未确认提示。扩展与连接器协议已同步至 4，旧连接器须重新安装。
- 本轮通过 70 项 JS、54 项 Python，以及隔离 ego lite E2E、AppleScript 编译、临时真实安装/协议握手和实况夹具检查。E2E 验证小红书 4/5 项（含实况及一个明确失败）、X 2 项写入临时文件夹；未写入真实照片图库。布局和工具栏检查的 ego lite 验证见上方记录。

## 2026-11-17：v1.8.1 工具栏检查修复

- `scripts/check_toolbar_popup.py` 曾断言 popup 宽度固定为 420。GitHub Actions macOS runner 系统默认「始终显示滚动条」，弹窗多出 15px 滚动条（实测 435），本地 overlay 滚动条不占宽度所以本地通过。断言改为 420–436，v1.8.1 发布。
- v1.8.0 的 tag 已推送但 GitHub Release 未创建：macos-latest 因上述断言失败，matrix fail-fast 取消 macos-15-intel 构建，release job 被跳过。v1.8.1 替代表层发布，不回移 v1.8.0。

## 2026-11-16：主题与设计预览

- 用户所称的 `master` 对应本仓库实际的 `main`。本轮核实 `main` 提交为 `8654481`，产品已改名为「存图夹」，仓库名为 `web-media-to-photos`；不要为对齐称呼创建 `master`。
- `design-previews/ui-explorations/index.html` 展示 10 套方案。正式 popup 接入原生轻巧、珊瑚随收（默认）、暗房精选、林间藏品和轻快贴纸的外观；其余 5 套仍是交互探索。设计稿中的完整布局和流程不等于主题切换后的正式功能。
- 主题以 `chrome.storage.local.popupTheme` 持久化，通过根元素 `data-theme` 生效。切换主题应保留媒体选择、目的地及后台任务。本轮 `node --test test_extension.cjs` 的 23 项测试通过，包含切换主题不重置选择、重开恢复主题。
- 当时的布局检查使用 Chrome，工具栏检查因缺少测试浏览器未完成。此记录仅描述历史结果；2026-11-17 已改为 ego lite 并补齐布局及工具栏重开验证，不再安装或使用 Chrome 做校验。
