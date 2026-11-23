#!/usr/bin/env python3
"""Build 存图夹 using only built-in iOS Shortcuts actions (Python 3.10+)."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from copy import deepcopy
import plistlib
from pathlib import Path
import uuid


VERSION = "2.0.2"
SHARE_URL = (
    r"https?://(?:(?:www|m|mobile)\.)?"
    r"(?:xiaohongshu\.com|xhslink\.(?:com|cn)|x\.com|twitter\.com|t\.co)"
    r"/[^\s<>\"'，。！？、；：）)\]】]+"
)
X_POST = r"^https?://(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com/(?:[^/?#]+/status(?:es)?|i/web/status)/(\d+)(?:[/?#]|$)"
XHS_NOTE = r"^https?://(?:(?:www|m)\.)?xiaohongshu\.com/(?:explore|discovery/item)/([0-9a-z]+)(?:[/?#]|$)"
STATE = r"(?s)(?:window\.)?__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;?\s*</script\s*>"
# Only replace JS undefined outside double-quoted JSON strings. A quoted suffix
# has an unmatched closing quote, so it cannot satisfy this lookahead.
UNDEFINED = r'\bundefined\b(?=(?:[^"\\]|\\.|"(?:\\.|[^"\\])*")*$)'
XHS_IMAGE = r"^https?://(?:[a-z0-9-]+\.)*xhscdn\.(?:com|net)/[^\s<>\"]+$"
X_IMAGE = r"^https?://pbs\.twimg\.com/media/[^\s<>\"]+$"
X_VIDEO = r"^https?://video\.twimg\.com/[^\s<>\"]+\.mp4(?:\?[^\s<>\"]*)?$"
X_POSTER = r"^https://pbs\.twimg\.com/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)/[^\s<>\"]+$"
MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"


def attachment(value: dict) -> dict:
    return {"Value": value, "WFSerializationType": "WFTextTokenAttachment"}


def variable(name: str) -> dict:
    return attachment({"Type": "Variable", "VariableName": name})


def text(*parts: str | dict) -> str | dict:
    """Encode interpolated text; Shortcuts offsets count UTF-16 code units."""
    if all(isinstance(part, str) for part in parts):
        return "".join(parts)
    result = ""
    tokens = {}
    for part in parts:
        if isinstance(part, str):
            result += part
        else:
            offset = len(result.encode("utf-16-le")) // 2
            tokens[f"{{{offset}, 1}}"] = part["Value"]
            result += "\ufffc"
    return {"Value": {"string": result, "attachmentsByRange": tokens},
            "WFSerializationType": "WFTextTokenString"}


def dictionary_fields(values: dict[str, str]) -> dict:
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": text(key), "WFValue": {
            "Value": {"string": value}, "WFSerializationType": "WFTextTokenString"}}
        for key, value in values.items()
    ]}, "WFSerializationType": "WFDictionaryFieldValue"}


class WorkflowBuilder:
    def __init__(self) -> None:
        self.actions: list[dict] = []
        self.repeat_depth = 0

    def add(self, name: str, **parameters) -> dict:
        action_uuid = str(uuid.uuid4()).upper()
        self.actions.append({
            "WFWorkflowActionIdentifier": "is.workflow.actions." + name,
            "WFWorkflowActionParameters": {"UUID": action_uuid, **parameters},
        })
        return attachment({"Type": "ActionOutput", "OutputUUID": action_uuid,
                           "OutputName": name})

    def set(self, name: str, value: dict) -> dict:
        self.add("setvariable", WFVariableName=name, WFInput=value)
        return variable(name)

    def literal(self, value: str | int) -> dict:
        if isinstance(value, int):
            return self.add("number", WFNumberActionNumber=value)
        return self.add("gettext", WFTextActionText=value)

    def get(self, source: dict, key: str | dict) -> dict:
        return self.add("getvalueforkey", WFInput=source,
                        WFGetDictionaryValueType="Value", WFDictionaryKey=text(key))

    def match(self, source: dict, pattern: str) -> dict:
        return self.add("text.match", text=text(source),
                        WFMatchTextPattern=pattern, WFMatchTextCaseSensitive=False)

    def first(self, source: dict) -> dict:
        return self.add("getitemfromlist", WFInput=source, WFItemSpecifier="First Item")

    def at(self, source: dict, position: dict) -> dict:
        return self.add("getitemfromlist", WFInput=source, WFItemSpecifier="Item At Index",
                        WFItemIndex=position)

    def repeat_results(self) -> dict:
        return attachment({"Type": "ActionOutput", "OutputUUID": self.actions[-1]["WFWorkflowActionParameters"]["UUID"],
                           "OutputName": "Repeat Results"})

    def group(self, matches: dict) -> dict:
        return self.add("text.match.getgroup", matches=matches,
                        WFGetGroupType="Group At Index", WFGroupIndex=1)

    def replace(self, source: dict, pattern: str, replacement: str) -> dict:
        return self.add("text.replace", WFInput=text(source), WFReplaceTextFind=pattern,
                        WFReplaceTextReplace=replacement, WFReplaceTextRegularExpression=True,
                        WFReplaceTextCaseSensitive=True)

    def download(self, source: dict, headers: dict[str, str] | None = None) -> dict:
        parameters = {"WFURL": text(source), "WFHTTPMethod": "GET"}
        if headers:
            parameters.update(ShowHeaders=True, WFHTTPHeaders=dictionary_fields(headers))
        return self.add("downloadurl", **parameters)

    @contextmanager
    def condition(self, source: dict, operation: int = 100,
                  value: str | int | bool | dict | None = None):
        group = str(uuid.uuid4()).upper()
        source = deepcopy(source)
        # Dictionary outputs have a union type. Shortcuts must know the subject
        # type to activate its string/number/bool comparison parameter.
        if value is not None:
            item_class = ("WFBooleanContentItem" if isinstance(value, bool) else
                          "WFNumberContentItem" if isinstance(value, int) or operation in (0, 1, 2, 3)
                          else "WFStringContentItem")
            source["Value"].setdefault("Aggrandizements", []).append({
                "Type": "WFCoercionVariableAggrandizement", "CoercionItemClass": item_class})
        parameters = {"GroupingIdentifier": group, "WFControlFlowMode": 0,
                      "WFInput": {"Type": "Variable", "Variable": source},
                      "WFCondition": operation}
        if value is not None:
            if isinstance(value, bool):
                parameters["WFBooleanValue"] = value
            elif isinstance(value, int) or operation in (0, 1, 2, 3):
                parameters["WFNumberValue"] = value
            else:
                parameters["WFConditionalActionString"] = text(value)
        self.add("conditional", **parameters)
        yield group
        self.add("conditional", GroupingIdentifier=group, WFControlFlowMode=2)

    def otherwise(self, group: str) -> None:
        self.add("conditional", GroupingIdentifier=group, WFControlFlowMode=1)

    @contextmanager
    def repeat(self, source: dict):
        group = str(uuid.uuid4()).upper()
        self.add("repeat.each", GroupingIdentifier=group, WFControlFlowMode=0, WFInput=source)
        self.repeat_depth += 1
        suffix = f" {self.repeat_depth}" if self.repeat_depth > 1 else ""
        yield variable("Repeat Item" + suffix), variable("Repeat Index" + suffix)
        self.repeat_depth -= 1
        self.add("repeat.each", GroupingIdentifier=group, WFControlFlowMode=2)

    def stop(self, message: str) -> None:
        self.add("alert", WFAlertActionTitle="存图夹", WFAlertActionMessage=message,
                 WFAlertActionCancelButtonShown=False)
        self.add("exit")

    def require(self, value: dict, message: str) -> None:
        with self.condition(value, 101):
            self.stop(message)

    def media(self, url: dict, pattern: str, index: dict, kind: str | dict) -> None:
        url = self.replace(url, r"^http://", "https://")
        with self.condition(self.match(url, pattern)):
            label = self.add("gettext", WFTextActionText=text(index, " · ", kind))
            updated = self.add("setvalueforkey", WFDictionary=variable("媒体"),
                               WFDictionaryKey=text(label), WFDictionaryValue=text(url))
            self.set("媒体", updated)


def build_x(w: WorkflowBuilder, matches: dict) -> None:
    post_id = w.group(w.first(matches))
    endpoint = w.add("gettext", WFTextActionText=text(
        "https://cdn.syndication.twimg.com/tweet-result?id=", post_id, "&lang=en&token=0"))
    data = w.download(endpoint)
    # Keep snowflake ids as text, never convert them to floating point numbers.
    returned_id = w.add("detect.text", WFInput=w.get(data, "id_str"))
    with w.condition(returned_id, 4, post_id) as branch:
        media = w.get(data, "mediaDetails")
        with w.repeat(media) as (item, index):
            kind = w.get(item, "type")
            with w.condition(kind, 4, "photo") as photo:
                url = w.get(item, "media_url_https")
                # Use the verified /media/<id>?format=<format>&name=orig form.
                # Query format takes precedence over the legacy file extension.
                format = w.set("图片格式", w.literal("jpg"))
                for pattern in (r"\.(jpe?g|png|webp)(?:[?#]|$)",
                                r"[?&]format=(jpe?g|png|webp)(?:&|$)"):
                    match = w.match(url, pattern)
                    with w.condition(match):
                        w.set("图片格式", w.group(w.first(match)))
                with w.condition(w.match(format, r"^(?:webp|jpeg)$")):
                    w.set("图片格式", w.literal("jpg"))
                base = w.replace(url, r"[?#].*$", "")
                base = w.replace(base, r"\.(?:jpe?g|png|webp)$", "")
                original = w.add("gettext", WFTextActionText=text(base, "?format=", format, "&name=orig"))
                w.media(original, X_IMAGE, index, "图片")
                w.otherwise(photo)
                supported = w.match(kind, r"^(?:video|animated_gif)$")
                with w.condition(supported):
                    best = w.set("视频地址", w.literal(""))
                    bitrate = w.set("最高码率", w.literal(-1))
                    variants = w.get(item, "video_info.variants")
                    with w.repeat(variants) as (variant, _):
                        mime = w.get(variant, "content_type")
                        with w.condition(mime, 4, "video/mp4"):
                            candidate = w.get(variant, "url")
                            with w.condition(w.match(candidate, X_VIDEO)):
                                rate = w.get(variant, "bitrate")
                                with w.condition(rate, 101):
                                    rate_zero = w.literal(0)
                                    w.set("当前码率", rate_zero)
                                with w.condition(rate):
                                    w.set("当前码率", rate)
                                with w.condition(variable("当前码率"), 2, bitrate):
                                    w.set("视频地址", candidate)
                                    w.set("最高码率", variable("当前码率"))
                    with w.condition(kind, 4, "animated_gif") as gif:
                        label = w.set("视频类型", w.literal("GIF（保存为视频）"))
                        w.otherwise(gif)
                        w.set("视频类型", w.literal("视频"))
                    w.media(best, X_VIDEO, index, label)
                    poster = w.get(item, "media_url_https")
                    with w.condition(w.match(poster, X_POSTER)):
                        w.set("视频封面", w.add("setvalueforkey", WFDictionary=variable("视频封面"),
                                               WFDictionaryKey=text(index), WFDictionaryValue=text(poster)))
                    with w.condition(best, 101):
                        w.set("有跳过项", w.literal(1))
        w.otherwise(branch)
        w.stop("X 未返回这条帖子的公开数据。帖子可能受限、已删除或暂时无法访问，请稍后重试。")


def build_xhs(w: WorkflowBuilder, matches: dict, source: dict) -> None:
    note_id = w.group(w.first(matches))
    page = w.download(source, {"User-Agent": MOBILE_UA})
    # Get the downloaded data as a text file, rather than regenerating HTML from
    # rich text (which can discard the embedded state scripts).
    raw = w.add("gettypeaction", WFInput=page, WFFileType="public.data")
    file = w.add("setitemname", WFInput=raw, WFName="note.txt", WFDontIncludeFileExtension=False)
    html = w.add("detect.text", WFInput=file)
    state_match = w.match(html, STATE)
    w.require(state_match, "小红书未返回可解析的笔记数据。请重新复制完整分享链接；需要登录或验证的页面无法读取。")
    payload = w.group(w.first(state_match))
    payload = w.replace(payload, UNDEFINED, "null")
    state = w.add("detect.dictionary", WFInput=payload)
    mobile = w.get(state, "noteData")
    with w.condition(mobile) as layout:
        note = w.set("当前笔记", w.get(mobile, "data.noteData"))
        w.otherwise(layout)
        desktop = w.get(state, "note.noteDetailMap")
        current = w.get(desktop, note_id)
        w.set("当前笔记", w.get(current, "note"))
    returned_id = w.get(note, "noteId")
    with w.condition(returned_id, 4, note_id) as identity:
        images = w.get(note, "imageList")
        with w.repeat(images) as (item, index):
            url = w.set("图片地址", w.get(item, "urlDefault"))
            for key in ("url", "urlPre"):
                with w.condition(w.match(url, XHS_IMAGE), 101):
                    w.set("图片地址", w.get(item, key))
            with w.condition(w.get(item, "livePhoto"), 4, True) as live:
                kind = w.set("图片类型", w.literal("实况封面（静态）"))
                w.otherwise(live)
                w.set("图片类型", w.literal("图片 / GIF"))
            w.media(url, XHS_IMAGE, index, kind)
        w.otherwise(identity)
        w.stop("小红书返回的内容与分享链接不一致，已停止保存。请重新复制这篇笔记的完整分享链接。")


def choose_and_save(w: WorkflowBuilder, keys: dict) -> None:
    positions = w.set("编号位置", w.add("dictionary", WFItems=dictionary_fields({})))
    files = variable("预览源文件")
    with w.repeat(keys) as (label, position):
        number = w.first(w.match(label, r"^\d+"))
        w.set("编号位置", w.add("setvalueforkey", WFDictionary=positions,
                               WFDictionaryKey=text(number), WFDictionaryValue=text(position)))
        url = w.get(variable("媒体"), label)
        preview_url = w.set("预览地址", url)
        with w.condition(w.match(url, X_VIDEO)):
            w.set("预览地址", w.get(variable("视频封面"), number))
        display_label = w.add("gettext", WFTextActionText=text(label))
        file = w.set("预览源", display_label)
        with w.condition(w.match(preview_url, f"(?:{XHS_IMAGE})|(?:{X_POSTER})")):
            w.set("预览源", w.download(preview_url))
        w.add("appendvariable", WFVariableName="预览源文件", WFInput=file)
        w.add("setitemname", WFInput=file, WFName=text(w.replace(label, "/", "／")),
              WFDontIncludeFileExtension=True)
    items = w.repeat_results()
    prompt = w.set("选图提示", w.literal("选择要保存到「照片」的媒体"))
    with w.condition(variable("有跳过项"), 4, 1):
        w.set("选图提示", w.literal("选择要保存的媒体（已跳过没有 MP4 的视频）"))
    chosen = w.add("choosefromlist", WFInput=items, WFChooseFromListActionPrompt=text(prompt),
                   WFChooseFromListActionSelectMultiple=True, WFChooseFromListActionSelectAll=True)
    with w.condition(chosen, 101):
        w.add("exit")
    with w.repeat(chosen) as (item, _):
        name = w.add("getitemname", WFInput=item)
        position = w.get(positions, w.first(w.match(name, r"^\d+")))
        url = w.get(variable("媒体"), w.at(keys, position))
        with w.condition(w.match(url, X_VIDEO)) as video:
            w.download(url)
            w.otherwise(video)
            w.at(files, position)
    w.add("savetocameraroll", WFInput=w.repeat_results())
    w.add("nothing")


def build_workflow(*, diagnostic: bool = False) -> dict:
    w = WorkflowBuilder()
    w.add("comment", WFCommentActionText=f"存图夹 · 双平台快捷指令 {VERSION}\n小红书图片 / GIF / 实况封面，X 图片 / GIF / MP4。分享输入优先，无输入时读取剪贴板。")
    share = attachment({"Type": "ExtensionInput"})
    with w.condition(share) as entry:
        source = w.set("分享内容", share)
        w.otherwise(entry)
        w.set("分享内容", w.add("getclipboard"))
    urls = w.match(source, SHARE_URL)
    w.require(urls, "没有找到小红书或 X 链接。请分享一篇笔记或帖子，或复制完整分享文案后再运行。")
    url = w.set("页面链接", w.replace(w.first(urls), r"^http://", "https://"))
    short = w.match(url, r"^https?://(?:xhslink\.(?:com|cn)|t\.co)/")
    with w.condition(short):
        w.set("页面链接", w.add("url.expand", URL=text(url)))
    x = w.match(url, X_POST)
    xhs = w.match(url, XHS_NOTE)
    w.set("媒体", w.add("dictionary", WFItems=dictionary_fields({})))
    w.set("视频封面", w.add("dictionary", WFItems=dictionary_fields({})))
    w.set("有跳过项", w.literal(0))
    with w.condition(x) as site:
        build_x(w, x)
        w.otherwise(site)
        with w.condition(xhs) as supported:
            build_xhs(w, xhs, url)
            w.otherwise(supported)
            w.stop("请提供小红书笔记或 X 帖子详情链接。主页、搜索页和 X 文章暂不支持；短链若被平台拦截，请重新复制分享链接。")
    keys = w.add("getvalueforkey", WFInput=variable("媒体"), WFGetDictionaryValueType="All Keys")
    w.require(keys, "没有找到可保存的媒体。页面可能受限或没有图片和直接 MP4；X 的引用帖媒体与 HLS 视频不会作为本帖媒体保存。")
    if diagnostic:
        # Inspect resolved labels and URLs without a picker, downloads or Photos.
        w.add("getvariable", WFVariable=variable("媒体"))
    else:
        choose_and_save(w, keys)
    return {
        "WFWorkflowActions": w.actions,
        "WFWorkflowName": "存图夹-纯快捷指令",
        "WFQuickActionSurfaces": [],
        "WFWorkflowClientVersion": "4018.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowInputContentItemClasses": ["WFURLContentItem", "WFStringContentItem"],
        "WFWorkflowOutputContentItemClasses": ["WFDictionaryContentItem"] if diagnostic else [],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowImportQuestions": [],
        "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 59511, "WFWorkflowIconStartColor": 3980825855},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path,
                        default=Path(__file__).with_name("存图夹-纯快捷指令.unsigned.shortcut"))
    parser.add_argument("--diagnostic", action="store_true", help="只输出解析结果，不下载媒体或写入照片")
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as handle:
        plistlib.dump(build_workflow(diagnostic=args.diagnostic), handle,
                      fmt=plistlib.FMT_BINARY, sort_keys=False)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
