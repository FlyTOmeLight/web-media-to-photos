# 存图夹（纯快捷指令版 2.0.0）

一个快捷指令处理小红书笔记和 X（Twitter）帖子，无需额外 App、Mac 连接器或自建服务器。分享链接给快捷指令，或复制完整分享文案后运行；按原帖编号多选媒体，再下载并保存到 iPhone「照片」。列表显示编号与媒体类型，不提前下载全部大图和视频，也不提供缩略图预览。

## 安装与使用

1. 把本目录的 [`存图夹-纯快捷指令.shortcut`](存图夹-纯快捷指令.shortcut) 发到 iPhone（隔空投送或 iCloud Drive），点开并添加。
2. 在小红书或 X 的系统分享菜单选择「存图夹-纯快捷指令」。如果 App 没有显示系统分享入口，先选择「复制链接」，再从「快捷指令」App、主屏幕或小组件运行。
3. 首次使用允许访问相应平台和媒体域名，以及添加照片。分享输入优先；只有没有分享输入时才读取剪贴板。
4. 勾选编号与类型后确认。图片保存为图片；X GIF 保存为 MP4 视频。出现「保存完成」后到「照片」查看。

支持分享文案、完整网页链接、`xhslink.com` / `xhslink.cn` 和 `t.co` 短链。保留小红书 `xsec_token` 等分享参数，不要手动删掉。短链被平台拦截时需要重新从原 App 复制有效链接。

## 支持范围

| 来源 | 处理方式 |
| --- | --- |
| 小红书图文笔记 | 从当前笔记的结构化数据读取图片，兼容手机页和桌面页字段；保留平台提供的图片格式和清晰度 |
| 小红书 GIF | 下载页面提供的资源；只有资源本身是 GIF 时才保留动画 |
| 小红书实况照片 | 保存静态封面，并在列表标明；此版本不配对导入 Live Photo |
| X 图片 | 请求原图尺寸，保留 PNG/JPEG；WebP 预览改请求 JPEG |
| X GIF、普通视频 | 取直接 MP4 中码率最高的一档，GIF 也保存为视频 |
| X 仅 HLS 视频 | 跳过；仍有其他媒体时先提示，再列出可保存项；全部不可保存时提示无媒体 |

不支持 X 文章、主页、搜索页、引用帖或父帖里的媒体，以及小红书独立视频笔记。只保存分享链接对应帖子的媒体，不从引用内容或推荐列表补图。私密、删除、登录或验证限制、平台限流可能导致失败。

链接无效、返回的帖子身份不一致、无可保存媒体都有明确提示。下载或「照片」写入失败时，系统快捷指令会显示动作错误并停止，不会继续显示成功。选择后先完成全部下载，再批量写入「照片」；系统保存动作如发生部分写入错误，请先检查图库再决定是否重试。

## 验证状态

14 项离线夹具回归通过，覆盖双平台解析、身份校验、短链、GIF、MP4 选择、HLS 跳过、选择后下载及失败停止。实测发现系统 If 动作需要为动态字典值明确指定文本、数字或布尔类型，现已修复并加入回归。

2026-11-17 已安装到 macOS「快捷指令」，用正式版通过真实小红书笔记保存 2 张图片，并分别保存 X 图片、GIF MP4 和普通 MP4 各 1 项；系统保存动作均返回成功。`public.data → note.txt → 文本 → __INITIAL_STATE__` 已在这次 Mac 原生运行中验证。安装应直接打开签名 `.shortcut` 文件；File > Import 的灰色按钮不代表文件无效。

已通过 iPhone 镜像确认正式版同步到了手机；用户在手机确认打开、权限及选择后，反馈 X 图片保存完成。手机「照片」内容未由代理独立核验；iPhone 的小红书、GIF/视频、系统分享菜单、剪贴板入口和短链仍未逐项实测。离线回归不写图库，以上授权原生验收会实际添加测试媒体。两个临时快捷指令副本已获用户授权并清理，正式版和原有旧版保留。

X 使用平台自己的公开嵌入数据地址 `cdn.syndication.twimg.com/tweet-result`，当前样例验证 `token=0` 可用；这是未公开保证的接口行为，平台变化可能需要更新。参考 [react-tweet 的上游实现](https://github.com/vercel/react-tweet/blob/main/packages/react-tweet/src/api/fetch-tweet.ts)。动作参数依据系统导出的 [Shortcuts 动作定义与文件格式](https://github.com/frontboat/shortcutkit/blob/main/docs/shortcut-file-format.md) 核对。

## 重新构建

在仓库根目录运行（Python 3.10+，签名需要 macOS 的 `shortcuts` 命令）：

```sh
python3 -B -m unittest discover -s ios-shortcut -p 'test_*.py' -v
python3 -B ios-shortcut/build_shortcut.py
shortcuts sign --mode anyone \
  --input ios-shortcut/存图夹-纯快捷指令.unsigned.shortcut \
  --output ios-shortcut/存图夹-纯快捷指令.shortcut
```

Apple 的签名命令会把快捷指令副本发送给 Apple 校验，见[官方命令行说明](https://support.apple.com/en-gb/guide/shortcuts-mac/apd455c82f02/mac)。构建不读取剪贴板、登录信息或照片，生成的指令也不包含测试链接。

要排查解析结果，可生成不下载媒体、不写照片的诊断版：

```sh
python3 -B ios-shortcut/build_shortcut.py /tmp/存图夹-诊断.unsigned.shortcut --diagnostic
shortcuts sign --mode anyone \
  --input /tmp/存图夹-诊断.unsigned.shortcut \
  --output /tmp/存图夹-诊断.shortcut
```

导入诊断版后，运行结果为「编号与类型 → 下载地址」的字典。快捷指令版本独立于 Mac 扩展版本；旧名称的安装文件已移除，升级请使用上面的新文件。
