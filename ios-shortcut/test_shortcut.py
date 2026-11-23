"""Execute generated actions against offline fixtures; this is not an iOS runtime."""

import copy
import json
import plistlib
import re
import subprocess
import sys
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from build_shortcut import UNDEFINED, build_workflow, text, variable


class Stopped(Exception):
    pass


@dataclass(frozen=True)
class ImagePreview:
    source: bytes


@dataclass(frozen=True)
class NamedItem:
    name: str
    content: object


class WorkflowFixture:
    """Small fixture runner for the built-in actions emitted by our generator.

    HTTP, the picker and Photos are explicit boundaries. Regex/JSON/branching
    execute the generated parameters, so tests exercise the distributable flow.
    ContentKit coercion, ICU and device permissions still need a device check.
    """

    def __init__(self, responses, *, share="", clipboard="", redirects=None, choose=None):
        self.responses = responses
        self.share = share
        self.clipboard = clipboard
        self.redirects = redirects or {}
        self.choose = choose
        self.variables = {}
        self.outputs = {}
        self.requests = []
        self.requests_at_picker = None
        self.picker_items = []
        self.saved = []
        self.save_calls = 0
        self.alerts = []

    def value(self, value):
        if not isinstance(value, dict):
            return value
        kind = value.get("WFSerializationType")
        if kind == "WFTextTokenAttachment":
            value = value["Value"]
            if value["Type"] == "ActionOutput":
                return self.outputs[value["OutputUUID"]]
            if value["Type"] == "ExtensionInput":
                return self.share
            return self.variables.get(value["VariableName"], "")
        if kind == "WFTextTokenString":
            result = value["Value"]["string"]
            for position, ref in sorted(value["Value"].get("attachmentsByRange", {}).items(),
                                        key=lambda item: int(item[0][1:].split(",")[0]), reverse=True):
                offset = int(position[1:].split(",")[0]) * 2
                encoded = result.encode("utf-16-le")
                result = (encoded[:offset].decode("utf-16-le") + self.as_text(self.value({
                    "Value": ref, "WFSerializationType": "WFTextTokenAttachment"})) +
                    encoded[offset + 2:].decode("utf-16-le"))
            return result
        return value

    @staticmethod
    def as_text(value):
        if isinstance(value, NamedItem):
            return WorkflowFixture.as_text(value.content)
        if isinstance(value, ImagePreview):
            return WorkflowFixture.as_text(value.source)
        if isinstance(value, list):
            return "\n".join(WorkflowFixture.as_text(item) for item in value)
        if isinstance(value, re.Match):
            return value[0]
        return str(value)

    @staticmethod
    def has_value(value):
        return value is not None and value != "" and value != [] and value != {}

    @classmethod
    def as_items(cls, value):
        if isinstance(value, list):
            return value
        return [value] if cls.has_value(value) else []

    def run(self, *, diagnostic=True):
        self.actions = build_workflow(diagnostic=diagnostic)["WFWorkflowActions"]
        for action_index, action in enumerate(self.actions):
            self.outputs[action["WFWorkflowActionParameters"]["UUID"]] = f"action {action_index}"
        self.blocks = {}
        opened = {}
        for i, action in enumerate(self.actions):
            params = action["WFWorkflowActionParameters"]
            if "GroupingIdentifier" in params:
                group = params["GroupingIdentifier"]
                mode = params["WFControlFlowMode"]
                if mode == 0:
                    opened[group] = [i, None]
                elif mode == 1:
                    opened[group][1] = i
                else:
                    start, middle = opened.pop(group)
                    self.blocks[start] = (middle, i)
        try:
            return self.execute(0, len(self.actions), 0)
        except Stopped:
            return None

    def execute(self, start, end, depth):
        last = None
        i = start
        while i < end:
            action = self.actions[i]
            name = action["WFWorkflowActionIdentifier"].removeprefix("is.workflow.actions.")
            p = action["WFWorkflowActionParameters"]
            uid = p["UUID"]
            if name in ("conditional", "repeat.each"):
                middle, closing = self.blocks[i]
                if name == "conditional":
                    value = self.value(p["WFInput"]["Variable"])
                    expected = self.value(p.get("WFBooleanValue", p.get("WFNumberValue", p.get("WFConditionalActionString"))))
                    operator = p["WFCondition"]
                    if operator in (100, 101):
                        yes = self.has_value(value) == (operator == 100)
                    elif operator == 4:
                        yes = value == expected if "WFNumberValue" in p or "WFBooleanValue" in p else self.as_text(value) == expected
                    elif operator == 2:
                        yes = float(value) > float(expected)
                    else:
                        raise AssertionError(f"Unsupported condition {operator}")
                    last = self.execute(i + 1, middle or closing, depth) if yes else (
                        self.execute(middle + 1, closing, depth) if middle else None)
                else:
                    items = self.as_items(self.value(p["WFInput"]))
                    suffix = f" {depth + 1}" if depth else ""
                    last = []
                    for number, item in enumerate(items, 1):
                        self.variables["Repeat Item" + suffix] = item
                        self.variables["Repeat Index" + suffix] = number
                        last.extend(self.as_items(self.execute(i + 1, closing, depth + 1)))
                self.outputs[self.actions[closing]["WFWorkflowActionParameters"]["UUID"]] = last
                i = closing + 1
                continue
            if name == "getclipboard":
                last = self.clipboard
            elif name in ("gettext", "number"):
                last = self.value(p.get("WFTextActionText", p.get("WFNumberActionNumber")))
            elif name == "setvariable":
                last = self.value(p["WFInput"])
                self.variables[p["WFVariableName"]] = last
            elif name == "appendvariable":
                last = self.value(p["WFInput"])
                variable_name = p["WFVariableName"]
                self.variables[variable_name] = [
                    *self.as_items(self.variables.get(variable_name)), *self.as_items(last),
                ]
            elif name == "getvariable":
                last = self.value(p["WFVariable"])
            elif name == "dictionary":
                last = {}
            elif name == "list":
                last = []
            elif name == "getvalueforkey":
                last = self.value(p["WFInput"])
                if p["WFGetDictionaryValueType"] == "All Keys":
                    last = list(last)
                else:
                    for key in self.value(p["WFDictionaryKey"]).split("."):
                        last = last.get(key, "") if isinstance(last, dict) else ""
            elif name == "setvalueforkey":
                last = dict(self.value(p["WFDictionary"]))
                key = self.value(p["WFDictionaryKey"])
                if not isinstance(key, str):
                    raise AssertionError(f"Dictionary key is not text: {key!r}")
                value = self.value(p["WFDictionaryValue"])
                if not isinstance(value, str) or not value:
                    raise AssertionError(f"No text value provided for dictionary key {key!r}")
                last[key] = value
            elif name == "text.match":
                flags = 0 if p["WFMatchTextCaseSensitive"] else re.I
                last = list(re.finditer(p["WFMatchTextPattern"], self.as_text(self.value(p["text"])), flags))
            elif name == "text.match.getgroup":
                matches = self.value(p["matches"])
                last = matches.group(p["WFGroupIndex"])
            elif name == "getitemfromlist":
                items = self.as_items(self.value(p["WFInput"]))
                specifier = p["WFItemSpecifier"]
                if specifier == "First Item":
                    last = items[0]
                elif specifier == "Item At Index":
                    index = int(self.as_text(self.value(p["WFItemIndex"])))
                    if not 1 <= index <= len(items):
                        raise IndexError(index)
                    last = items[index - 1]
                else:
                    raise AssertionError(f"Unsupported item specifier {specifier}")
            elif name == "text.replace":
                replacement = re.sub(r"\$(\d+)", r"\\g<\1>", p["WFReplaceTextReplace"])
                last = re.sub(p["WFReplaceTextFind"], replacement,
                              self.as_text(self.value(p["WFInput"])))
            elif name == "url.expand":
                last = self.redirects[self.value(p["URL"])]
            elif name == "downloadurl":
                url = self.value(p["WFURL"])
                if not isinstance(url, str) or not url:
                    raise AssertionError(f"Unsupported WFURL input: {p['WFURL']!r}")
                self.requests.append(url)
                response = self.responses[url]
                if isinstance(response, Exception):
                    raise response
                last = copy.deepcopy(response)
            elif name == "detect.dictionary":
                last = json.loads(self.value(p["WFInput"]))
            elif name == "detect.text":
                last = self.as_text(self.value(p["WFInput"]))
            elif name == "gettypeaction":
                last = self.value(p["WFInput"])
            elif name == "detect.images":
                items = self.as_items(self.value(p["WFInput"]))
                last = [ImagePreview(item) if isinstance(item, bytes) else item
                        for item in items]
            elif name == "setitemname":
                item_name = self.as_text(self.value(p["WFName"]))
                last = [NamedItem(item_name, item) for item in self.as_items(self.value(p["WFInput"]))]
            elif name == "getitemname":
                item_names = [item.name for item in self.as_items(self.value(p["WFInput"]))]
                last = item_names[0] if len(item_names) == 1 else item_names
            elif name == "choosefromlist":
                self.requests_at_picker = self.requests.copy()
                self.picker_items = self.as_items(self.value(p["WFInput"]))
                if self.choose is None:
                    last = self.picker_items if p.get("WFChooseFromListActionSelectAll") else []
                else:
                    if any(not 1 <= position <= len(self.picker_items) for position in self.choose):
                        raise AssertionError(f"Invalid picker positions: {self.choose}")
                    last = [self.picker_items[position - 1] for position in self.choose]
            elif name == "savetocameraroll":
                self.save_calls += 1
                self.saved = self.as_items(self.value(p["WFInput"]))
                last = self.saved
            elif name == "nothing":
                last = None
            elif name == "alert":
                self.alerts.append(p["WFAlertActionMessage"])
            elif name == "exit":
                raise Stopped()
            elif name != "comment":
                raise AssertionError(f"Unsupported action {name}")
            self.outputs[uid] = last
            i += 1
        return last


POST_ID = "2119380630018613658"
POST = f"https://x.com/example/status/{POST_ID}"
API = f"https://cdn.syndication.twimg.com/tweet-result?id={POST_ID}&lang=en&token=0"
NOTE_ID = "6af842480000000009021f34"
NOTE = f"https://www.xiaohongshu.com/discovery/item/{NOTE_ID}?xsec_token=keep_me=&xsec_source=app_share"
PHOTO = "https://pbs.twimg.com/media/example.jpg"
ORIGINAL = "https://pbs.twimg.com/media/example?format=jpg&name=orig"
COVER = "https://pbs.twimg.com/ext_tw_video_thumb/123/img/cover.jpg"
VIDEO = "https://video.twimg.com/ext_tw_video/example/vid/1280x720/a.mp4?tag=1"
GIF_MP4 = "https://video.twimg.com/tweet_video/animation.mp4"


def x_fixture(media, **extras):
    return {API: {"id_str": POST_ID, "mediaDetails": media, **extras}}


def video(kind="video", bitrate=100, *, url=VIDEO, cover=COVER):
    media = {"type": kind, "video_info": {"variants": [
        {"content_type": "application/x-mpegURL", "url": "https://video.twimg.com/stream.m3u8"},
        {"content_type": "video/mp4", "url": url, "bitrate": bitrate},
        {"content_type": "video/mp4", "url": VIDEO.replace("a.mp4", "low.mp4"), "bitrate": -1},
    ]}}
    if cover is not None:
        media["media_url_https"] = cover
    return media


def xhs_html(images, *, desktop=False, identity=NOTE_ID):
    note = {"noteId": identity, "imageList": images, "title": '"undefined" remains text'}
    state = {"note": {"noteDetailMap": {NOTE_ID: {"note": note}}}} if desktop else {
        "noteData": {"data": {"noteData": note}}}
    payload = json.dumps(state, ensure_ascii=False)[:-1] + ',"unused":undefined}'
    return '<html><script>window.__INITIAL_STATE__ = ' + payload + ';</script></html>'


class ShortcutTests(unittest.TestCase):
    def test_x_mixed_order_identity_and_best_mp4(self):
        fixture = x_fixture([{"type": "photo", "media_url_https": PHOTO}, video(),
                             video("animated_gif", 0)],
                            quoted_tweet={"mediaDetails": [{"type": "photo", "media_url_https": PHOTO + "wrong"}]})
        run = WorkflowFixture(fixture, share=POST, clipboard="unsupported")
        result = run.run()
        self.assertEqual(result, {"1 · 图片": ORIGINAL, "2 · 视频": VIDEO,
                                  "3 · GIF（保存为视频）": VIDEO})
        self.assertEqual(run.requests, [API])
        self.assertFalse(run.saved)

    def test_x_query_format_and_https(self):
        for source, expected in [
            (PHOTO + "?name=small&format=png", "https://pbs.twimg.com/media/example?format=png&name=orig"),
            ("https://pbs.twimg.com/media/example.png", "https://pbs.twimg.com/media/example?format=png&name=orig"),
            ("http://pbs.twimg.com/media/a?format=webp&name=small", "https://pbs.twimg.com/media/a?format=jpg&name=orig"),
        ]:
            with self.subTest(source=source):
                run = WorkflowFixture(x_fixture([{"type": "photo", "media_url_https": source}]), share=POST)
                self.assertEqual(run.run(), {"1 · 图片": expected})

    def test_x_hls_only_is_skipped_without_saving_cover(self):
        hls = video()
        hls["video_info"]["variants"] = hls["video_info"]["variants"][:1]
        run = WorkflowFixture(x_fixture([hls, {"type": "photo", "media_url_https": PHOTO}]), share=POST)
        self.assertEqual(run.run(), {"2 · 图片": ORIGINAL})
        self.assertEqual(run.requests, [API])

    def test_wrong_post_and_empty_data_stop(self):
        for data in ({}, {"id_str": "2119380630018613659"}, {"id_str": POST_ID, "mediaDetails": []}):
            with self.subTest(data=data):
                run = WorkflowFixture({API: data}, share=POST)
                self.assertIsNone(run.run())
                self.assertTrue(run.alerts)
                self.assertFalse(run.saved)

    def test_xhs_mobile_and_desktop_structured_images(self):
        image = "http://sns-webpic-qc.xhscdn.com/a!h5_1080jpg"
        gif = "https://sns-img-bd.xhscdn.net/b.gif"
        for desktop in (False, True):
            with self.subTest(desktop=desktop):
                html = xhs_html([{"url": image, "livePhoto": True}, {"urlDefault": gif}], desktop=desktop)
                run = WorkflowFixture({NOTE: html}, share=NOTE)
                self.assertEqual(run.run(), {"1 · 实况封面（静态）": image.replace("http:", "https:"),
                                             "2 · 图片 / GIF": gif})
                self.assertEqual(run.requests, [NOTE])

    def test_xhs_image_url_fallback_and_priority(self):
        invalid = "https://xhscdn.com.attacker.test/invalid.jpg"
        images = [
            {
                "urlDefault": "https://sns-img-1.xhscdn.net/default.jpg",
                "url": "https://sns-img-1.xhscdn.net/url.jpg",
                "urlPre": "https://sns-img-1.xhscdn.net/pre.jpg",
            },
            {
                "urlDefault": invalid,
                "url": "https://sns-img-2.xhscdn.net/url.jpg",
                "urlPre": "https://sns-img-2.xhscdn.net/pre.jpg",
            },
            {
                "urlDefault": invalid,
                "url": invalid,
                "urlPre": "https://sns-img-3.xhscdn.net/pre.jpg",
            },
        ]
        expected = {
            "1 · 图片 / GIF": images[0]["urlDefault"],
            "2 · 图片 / GIF": images[1]["url"],
            "3 · 图片 / GIF": images[2]["urlPre"],
        }
        for desktop in (False, True):
            with self.subTest(desktop=desktop):
                run = WorkflowFixture({NOTE: xhs_html(images, desktop=desktop)}, share=NOTE)
                self.assertEqual(run.run(), expected)
                self.assertEqual(run.requests, [NOTE])

    def test_xhs_untrusted_urls_and_identity_mismatch(self):
        for identity in (NOTE_ID, "other"):
            with self.subTest(identity=identity):
                html = xhs_html([{"url": "https://xhscdn.com.attacker.test/b.jpg"}], identity=identity)
                run = WorkflowFixture({NOTE: html}, share=NOTE)
                self.assertIsNone(run.run())
                self.assertTrue(run.alerts)

    def test_share_and_clipboard_short_links(self):
        media = [{"type": "photo", "media_url_https": PHOTO}]
        for host, target, response in [("t.co", POST, x_fixture(media)),
                                       ("xhslink.cn", NOTE, {NOTE: xhs_html([{"url": "https://sns-img.xhscdn.com/a.jpg"}])})]:
            with self.subTest(host=host):
                run = WorkflowFixture(response, clipboard=f"标题 http://{host}/abc，口令",
                                      redirects={f"https://{host}/abc": target})
                self.assertTrue(run.run())

    def test_unsupported_input_stops_before_network(self):
        for source in ("", "https://x.com.attacker.test/a/status/1", "https://x.com/user", "https://x.com/i/article/123"):
            with self.subTest(source=source):
                run = WorkflowFixture({}, share=source)
                self.assertIsNone(run.run())
                self.assertFalse(run.requests)
                self.assertFalse(run.saved)

    def test_xhs_gallery_saves_original_files_once_without_alerts(self):
        first = "https://sns-img.xhscdn.com/first.jpg"
        second = "https://sns-img.xhscdn.com/second.png"
        third = "https://sns-img.xhscdn.com/third.gif"
        images = [first, second, third]
        fixture = {
            NOTE: xhs_html([{"urlDefault": url} for url in images]),
            first: b"original JPEG bytes",
            second: b"original PNG bytes",
            third: b"original GIF bytes",
        }
        for choose, expected in [(None, images), ([1, 3], [first, third])]:
            with self.subTest(choose=choose):
                run = WorkflowFixture(fixture, share=NOTE, choose=choose)
                run.run(diagnostic=False)
                self.assertEqual(run.requests_at_picker, [NOTE, *images])
                self.assertEqual(run.requests, [NOTE, *images])
                self.assertEqual(run.picker_items, [
                    NamedItem("1 · 图片 ／ GIF", fixture[first]),
                    NamedItem("2 · 图片 ／ GIF", fixture[second]),
                    NamedItem("3 · 图片 ／ GIF", fixture[third]),
                ])
                self.assertEqual(run.saved, [fixture[url] for url in expected])
                self.assertEqual(run.save_calls, 1)
                self.assertEqual(run.alerts, [])

    def test_select_only_video_by_picker_position_after_skipped_post_item(self):
        hls = video(cover=COVER.replace("cover.jpg", "skipped.jpg"))
        hls["video_info"]["variants"] = hls["video_info"]["variants"][:1]
        fixture = x_fixture([
            {"type": "photo", "media_url_https": PHOTO},
            hls,
            video(),
            video("animated_gif", 0, url=GIF_MP4, cover=None),
        ])
        fixture.update({ORIGINAL: b"original photo", COVER: b"video cover", VIDEO: b"video bytes"})
        run = WorkflowFixture(fixture, share=POST, choose=[2])
        run.run(diagnostic=False)
        self.assertEqual([item.name for item in run.picker_items], ["1 · 图片", "3 · 视频", "4 · GIF（保存为视频）"])
        self.assertEqual(run.picker_items[0].content, fixture[ORIGINAL])
        self.assertEqual(run.picker_items[1].content, fixture[COVER])
        self.assertIsInstance(run.picker_items[2].content, str)
        self.assertEqual(run.requests_at_picker, [API, ORIGINAL, COVER])
        self.assertEqual(run.requests, [API, ORIGINAL, COVER, VIDEO])
        self.assertEqual(run.saved, [b"video bytes"])
        self.assertEqual(run.save_calls, 1)
        self.assertEqual(run.alerts, [])

    def test_gif_picker_only_downloads_allowlisted_https_covers(self):
        for cover, allowed in (
            ("https://pbs.twimg.com/media/cover.jpg", True),
            ("https://pbs.twimg.com/ext_tw_video_thumb/123/img/cover.jpg", True),
            ("https://pbs.twimg.com/amplify_video_thumb/123/img/cover.jpg", True),
            ("https://pbs.twimg.com/tweet_video_thumb/123/img/cover.jpg", True),
            (None, False),
            ("http://pbs.twimg.com/media/cover.jpg", False),
            ("https://pbs.twimg.com.attacker.test/media/cover.jpg", False),
            ("https://pbs.twimg.com/profile_images/cover.jpg", False),
        ):
            with self.subTest(cover=cover):
                fixture = x_fixture([video("animated_gif", 0, url=GIF_MP4, cover=cover)])
                fixture[GIF_MP4] = b"GIF as MP4"
                if allowed:
                    fixture[cover] = b"GIF cover"
                run = WorkflowFixture(fixture, share=POST, choose=[1])
                run.run(diagnostic=False)
                self.assertEqual([item.name for item in run.picker_items], ["1 · GIF（保存为视频）"])
                if allowed:
                    self.assertEqual(run.picker_items[0].content, fixture[cover])
                    self.assertEqual(run.requests_at_picker, [API, cover])
                else:
                    self.assertIsInstance(run.picker_items[0].content, str)
                    self.assertEqual(run.requests_at_picker, [API])
                self.assertEqual(run.requests, [*run.requests_at_picker, GIF_MP4])
                self.assertEqual(run.saved, [b"GIF as MP4"])
                self.assertEqual(run.alerts, [])

    def test_no_cover_video_between_images_keeps_position_and_saves_original(self):
        first = "https://pbs.twimg.com/media/first.jpg"
        second = "https://pbs.twimg.com/media/second.jpg"
        first_original = "https://pbs.twimg.com/media/first?format=jpg&name=orig"
        second_original = "https://pbs.twimg.com/media/second?format=jpg&name=orig"
        fixture = x_fixture([
            {"type": "photo", "media_url_https": first},
            video(cover=None),
            {"type": "photo", "media_url_https": second},
        ])
        fixture.update({
            first_original: b"original first photo",
            second_original: b"original second photo",
        })
        run = WorkflowFixture(fixture, share=POST, choose=[3])
        run.run(diagnostic=False)
        self.assertEqual([item.name for item in run.picker_items],
                         ["1 · 图片", "2 · 视频", "3 · 图片"])
        self.assertEqual(run.picker_items[2].content, fixture[second_original])
        self.assertEqual(run.requests_at_picker, [API, first_original, second_original])
        self.assertEqual(run.requests, [API, first_original, second_original])
        self.assertEqual(run.saved, [b"original second photo"])
        self.assertEqual(run.alerts, [])

    def test_cancel_after_no_cover_video_previews_does_not_download_mp4_or_save(self):
        first = "https://pbs.twimg.com/media/first.jpg"
        second = "https://pbs.twimg.com/media/second.jpg"
        first_original = "https://pbs.twimg.com/media/first?format=jpg&name=orig"
        second_original = "https://pbs.twimg.com/media/second?format=jpg&name=orig"
        fixture = x_fixture([
            {"type": "photo", "media_url_https": first},
            video(cover=None),
            {"type": "photo", "media_url_https": second},
        ])
        fixture.update({
            first_original: b"original first photo",
            second_original: b"original second photo",
        })
        run = WorkflowFixture(fixture, share=POST, choose=[])
        self.assertIsNone(run.run(diagnostic=False))
        self.assertEqual([item.name for item in run.picker_items],
                         ["1 · 图片", "2 · 视频", "3 · 图片"])
        self.assertEqual(run.requests_at_picker, [API, first_original, second_original])
        self.assertEqual(run.requests, run.requests_at_picker)
        self.assertEqual(run.save_calls, 0)
        self.assertEqual(run.alerts, [])

    def test_cancel_after_previews_does_not_download_mp4_or_save(self):
        fixture = x_fixture([{"type": "photo", "media_url_https": PHOTO}, video()])
        fixture.update({ORIGINAL: b"original photo", COVER: b"video cover"})
        run = WorkflowFixture(fixture, share=POST, choose=[])
        self.assertIsNone(run.run(diagnostic=False))
        self.assertEqual(run.requests_at_picker, [API, ORIGINAL, COVER])
        self.assertEqual(run.requests, run.requests_at_picker)
        self.assertEqual(run.save_calls, 0)
        self.assertEqual(run.alerts, [])

    def test_download_failure_never_calls_photos(self):
        for failed_url, requests, requests_at_picker in [
            (ORIGINAL, [API, ORIGINAL], None),
            (VIDEO, [API, ORIGINAL, COVER, VIDEO], [API, ORIGINAL, COVER]),
        ]:
            with self.subTest(failed_url=failed_url):
                fixture = x_fixture([{"type": "photo", "media_url_https": PHOTO}, video()])
                fixture.update({ORIGINAL: b"original photo", COVER: b"video cover", VIDEO: b"video bytes"})
                fixture[failed_url] = OSError("download failed")
                run = WorkflowFixture(fixture, share=POST, choose=[1, 2])
                with self.assertRaisesRegex(OSError, "download failed"):
                    run.run(diagnostic=False)
                self.assertEqual(run.requests_at_picker, requests_at_picker)
                self.assertEqual(run.requests, requests)
                self.assertEqual(run.save_calls, 0)
                self.assertEqual(run.alerts, [])

    def test_interpolation_uses_utf16_offsets(self):
        run = WorkflowFixture({})
        run.variables["x"] = "value"
        self.assertEqual(run.value(text("😀 ", variable("x"), " 中文")), "😀 value 中文")

    def test_preview_position_writes_text_not_repeat_index_attachment(self):
        workflow = build_workflow(diagnostic=False)["WFWorkflowActions"]
        position_writes = 0
        for action in workflow:
            p = action["WFWorkflowActionParameters"]
            if action["WFWorkflowActionIdentifier"] != "is.workflow.actions.setvalueforkey":
                continue
            source = p.get("WFDictionary", {}).get("Value", {})
            if source.get("VariableName") != "编号位置":
                continue
            position_writes += 1
            with self.subTest(key=p["WFDictionaryKey"]):
                self.assertEqual(
                    p["WFDictionaryValue"].get("WFSerializationType"),
                    "WFTextTokenString")
                interpolation = p["WFDictionaryValue"]["Value"]
                attachments = interpolation["attachmentsByRange"].values()
                self.assertEqual([item["VariableName"] for item in attachments],
                                 ["Repeat Index"])
        self.assertEqual(position_writes, 1)

    def test_downloads_use_text_token_strings_for_urls(self):
        download_actions = [
            action for action in build_workflow(diagnostic=False)["WFWorkflowActions"]
            if action["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl"
        ]
        self.assertGreater(len(download_actions), 0)
        for action in download_actions:
            raw_url = action["WFWorkflowActionParameters"]["WFURL"]
            with self.subTest(raw_url=raw_url):
                self.assertEqual(
                    raw_url.get("WFSerializationType") if isinstance(raw_url, dict) else None,
                    "WFTextTokenString")

    def test_native_comparisons_declare_subject_types(self):
        # Native Shortcuts rejects a string comparison on the union-typed
        # Dictionary Value output unless its content type is selected.
        comparisons = 0
        for action in build_workflow()["WFWorkflowActions"]:
            if action["WFWorkflowActionIdentifier"] != "is.workflow.actions.conditional":
                continue
            p = action["WFWorkflowActionParameters"]
            if p.get("WFControlFlowMode") != 0 or p["WFCondition"] in (100, 101):
                continue
            expected = ("WFBooleanContentItem" if "WFBooleanValue" in p else
                        "WFNumberContentItem" if "WFNumberValue" in p else "WFStringContentItem")
            subject = p["WFInput"]["Variable"]["Value"]
            self.assertEqual(subject["Aggrandizements"][-1], {
                "Type": "WFCoercionVariableAggrandizement", "CoercionItemClass": expected})
            comparisons += 1
        self.assertGreater(comparisons, 0)

    def test_undefined_normalization_preserves_quoted_text(self):
        raw = r'{"a":undefined,"b":",undefined,","c":"quote\" undefined","d":[undefined]}'
        parsed = json.loads(re.sub(UNDEFINED, "null", raw))
        self.assertEqual(parsed, {"a": None, "b": ",undefined,", "c": 'quote" undefined', "d": [None]})

    def test_cli_binary_plist_and_ios_builtin_only(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "build.shortcut"
            subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("build_shortcut.py")),
                            str(output), "--diagnostic"], check=True, capture_output=True)
            with output.open("rb") as handle:
                workflow = plistlib.load(handle)
        self.assertIn("ActionExtension", workflow["WFWorkflowTypes"])
        self.assertTrue(workflow["WFWorkflowHasShortcutInputVariables"])
        for action in workflow["WFWorkflowActions"]:
            self.assertTrue(action["WFWorkflowActionIdentifier"].startswith("is.workflow.actions."))
            self.assertNotIn(action["WFWorkflowActionIdentifier"], [
                "is.workflow.actions.runscript", "is.workflow.actions.runjavascriptonwebpage",
                "is.workflow.actions.savetocameraroll", "is.workflow.actions.choosefromlist"])


if __name__ == "__main__":
    unittest.main()
