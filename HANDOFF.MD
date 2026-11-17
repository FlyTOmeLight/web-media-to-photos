# 项目经验

## 2026-11-17：v1.8.1 工具栏检查修复

- `scripts/check_toolbar_popup.py` 曾断言 popup 宽度固定为 420。GitHub Actions macOS runner 系统默认「始终显示滚动条」，弹窗多出 15px 滚动条（实测 435），本地 overlay 滚动条不占宽度所以本地通过。断言改为 420–436，v1.8.1 发布。
- v1.8.0 的 tag 已推送但 GitHub Release 未创建：macos-latest 因上述断言失败，matrix fail-fast 取消 macos-15-intel 构建，release job 被跳过。v1.8.1 替代表层发布，不回移 v1.8.0。

## 2026-11-16：主题与设计预览

- 用户所称的 `master` 对应本仓库实际的 `main`。本轮核实 `main` 提交为 `8654481`，产品已改名为「存图夹」，仓库名为 `web-media-to-photos`；不要为对齐称呼创建 `master`。
- `design-previews/ui-explorations/index.html` 展示 10 套方案。正式 popup 接入原生轻巧、珊瑚随收（默认）、暗房精选、林间藏品和轻快贴纸的外观；其余 5 套仍是交互探索。设计稿中的完整布局和流程不等于主题切换后的正式功能。
- 主题以 `chrome.storage.local.popupTheme` 持久化，通过根元素 `data-theme` 生效。切换主题应保留媒体选择、目的地及后台任务。本轮 `node --test test_extension.cjs` 的 23 项测试通过，包含切换主题不重置选择、重开恢复主题。
- `scripts/check_popup_layout.py` 使用普通 Google Chrome 完成 360、480、600px 下共 18 项状态和高度检查；这不证明工具栏弹窗端到端重开已通过。
- `scripts/check_toolbar_popup.py` 默认使用 `/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。本轮机器缺少该应用，工具栏重开检查未完成；指定普通 Chrome 的尝试停在环境启动阶段。具备 Chrome for Testing 后再补此项。
