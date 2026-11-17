import subprocess
import tempfile
from pathlib import Path
from unittest import mock

from test_host import MediaTestCase, host


class SaveResultTests(MediaTestCase):
    def test_limit_rejects_the_whole_request_before_download(self):
        with mock.patch.object(host, 'download_image') as download:
            result = host.process({'images': [{'url': self.image_url}] * 31})
        self.assertFalse(result['ok'])
        self.assertIn('30', result['error'])
        download.assert_not_called()

    def test_invalid_items_count_as_failures_and_keep_original_numbers(self):
        image = self.temporary_file('.gif')
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(host, 'download_image', return_value=(image, self.image_url, 'gif')),
        ):
            result = host.process({'destination': 'folder', 'folderPath': directory, 'images': [
                {'index': 2, 'url': None}, {'index': 5, 'url': self.image_url},
            ]})
            self.assertTrue(result['ok'])
            self.assertEqual((result['saved'], result['failed']), (1, 1))
            self.assertIn('第 2 张', result['failureDetails'][0])
            self.assertEqual(result['failedIndices'], [2])
            self.assertEqual(result['items'][0]['index'], 5)
            self.assertTrue((Path(result['folderPath']) / '05.gif').is_file())

    def test_failed_export_does_not_count_as_saved_static_fallback(self):
        images = [self.temporary_file('.jpg') for _ in range(2)]
        copy = host.shutil.copyfile
        def fail_first(source, destination):
            if Path(destination).name == '01.jpg':
                raise OSError('磁盘已满')
            return copy(source, destination)
        with (
            tempfile.TemporaryDirectory() as directory,
            mock.patch.object(host, 'download_image', side_effect=[(p, self.image_url, 'jpg') for p in images]),
            mock.patch.object(host.shutil, 'copyfile', side_effect=fail_first),
        ):
            result = host.process({'destination': 'folder', 'folderPath': directory,
                                   'images': [{'url': self.image_url, 'kind': 'live'}] * 2})
        self.assertEqual((result['saved'], result['failed'], result['liveFallback']), (1, 1, 1))
        self.assertEqual(len(result['liveFallbackDetails']), 1)
        self.assertIn('第 2 张', result['liveFallbackDetails'][0])

    def test_photos_unconfirmed_batch_is_not_retried_or_reported_as_saved(self):
        images = [self.temporary_file('.jpg') for _ in range(2)]
        with (
            mock.patch.object(host, 'download_image', side_effect=[(p, self.image_url, 'jpg') for p in images]),
            mock.patch.object(host, 'import_to_photos',
                              return_value=host.PhotosImportResult('unknown', '无法确认导入结果')) as importer,
        ):
            result = host.process({'images': [{'index': 2, 'url': self.image_url, 'kind': 'live'},
                                             {'index': 5, 'url': self.image_url, 'kind': 'live'}]})
        self.assertFalse(result['ok'])
        self.assertEqual((result['saved'], result['failed']), (0, 0))
        self.assertEqual(result['failedIndices'], [])
        self.assertEqual(result['unconfirmedIndices'], [2, 5])
        self.assertIn('先检查', result['error'])
        self.assertEqual(importer.call_count, 1)

    def test_photos_import_batches_items_into_one_call(self):
        images = [self.temporary_file('.jpg') for _ in range(5)]
        calls = []

        def import_photos(paths, album_id='', timeout=120, expected_count=1):
            calls.append(list(paths))
            self.assertEqual(expected_count, 5)
            return host.PhotosImportResult('confirmed')

        with (
            mock.patch.object(host, 'download_image',
                              side_effect=[(p, self.image_url, 'jpg') for p in images]),
            mock.patch.object(host, 'import_to_photos', side_effect=import_photos),
        ):
            result = host.process({'images': [{'url': self.image_url} for _ in range(5)]})
        self.assertEqual(result['saved'], 5)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(calls[0]), 5)

    def test_import_to_photos_classifies_confirmed_failed_and_unconfirmed_outcomes(self):
        paths = [Path('/tmp/image.jpg'), Path('/tmp/video.mov')]
        cases = [
            ('exact-live-pair', mock.Mock(returncode=0, stdout='1\n', stderr=''), 1, 'confirmed'),
            ('exact-batch', mock.Mock(returncode=0, stdout='2\n', stderr=''), 2, 'confirmed'),
            ('empty', mock.Mock(returncode=0, stdout='0\n', stderr=''), 2, 'failed'),
            ('partial', mock.Mock(returncode=0, stdout='1\n', stderr=''), 2, 'unknown'),
            ('malformed', mock.Mock(returncode=0, stdout='ok\n', stderr=''), 1, 'unknown'),
            ('script-error', mock.Mock(returncode=1, stdout='', stderr='Photos got an error'), 1, 'unknown'),
            ('timeout', subprocess.TimeoutExpired('osascript', 120), 1, 'unknown'),
            ('launch-error', OSError('osascript missing'), 1, 'failed'),
        ]
        for name, effect, expected_count, status in cases:
            with self.subTest(name=name):
                patch = (mock.patch.object(host.subprocess, 'run', side_effect=effect)
                         if isinstance(effect, BaseException)
                         else mock.patch.object(host.subprocess, 'run', return_value=effect))
                with patch:
                    outcome = host.import_to_photos(paths, 'album-a', timeout=120, expected_count=expected_count)
                self.assertEqual(outcome.status, status)
                self.assertEqual(bool(outcome.detail), status != 'confirmed')

    def test_mixed_live_and_static_batch_counts_media_items_not_resource_files(self):
        still = self.temporary_file('.jpg')
        movie = self.temporary_file('.mov')
        photo = self.temporary_file('.png')
        with (
            mock.patch.object(host, 'download_image', side_effect=[
                (still, self.image_url, 'jpg'), (photo, self.image_url, 'png')]),
            mock.patch.object(host, 'download_video', return_value=(movie, 'mov')),
            mock.patch.object(host, 'prepare_live_photo'),
            mock.patch.object(host.subprocess, 'run', return_value=mock.Mock(returncode=0, stdout='2\n', stderr='')) as runner,
        ):
            result = host.process({'images': [
                {'index': 1, 'url': self.image_url, 'kind': 'live', 'videoUrl': self.video_url},
                {'index': 2, 'url': self.image_url, 'kind': 'image'},
            ]})
        self.assertTrue(result['ok'])
        self.assertEqual(result['saved'], 2)
        self.assertEqual(len(runner.call_args.args[0]) - 4, 3)

    def test_confirmed_and_unconfirmed_batches_separate_saved_retryable_and_unknown_items(self):
        images = [self.temporary_file('.jpg') for _ in range(2)]
        urls = {index: f'{self.image_url}?item={index}' for index in (2, 5, 9)}

        def download(url):
            if url == urls[5]:
                raise RuntimeError('下载超时')
            return images[0 if url == urls[2] else 1], url, 'jpg'

        with (
            mock.patch.object(host, 'IMPORT_BATCH_SIZE', 1),
            mock.patch.object(host, 'download_image', side_effect=download),
            mock.patch.object(host, 'import_to_photos', side_effect=[
                host.PhotosImportResult('confirmed'),
                host.PhotosImportResult('unknown', 'Photos 导入超时，无法确认是否已导入'),
            ]) as importer,
        ):
            result = host.process({'images': [
                {'index': index, 'url': urls[index]} for index in (2, 5, 9)
            ]})
        self.assertTrue(result['ok'])
        self.assertEqual([item['index'] for item in result['items']], [2])
        self.assertEqual(result['failed'], 1)
        self.assertEqual(result['failedIndices'], [5])
        self.assertEqual(result['unconfirmedIndices'], [9])
        self.assertEqual(importer.call_count, 2)

    def test_page_video_lookup_preserves_undefined_inside_urls(self):
        page = '<script>window.__INITIAL_STATE__={"noteId":"current123","value":undefined,"imageList":[{"urlDefault":"https://ci.xiaohongshu.com/undefined-image","stream":{"h264":[{"masterUrl":"https://sns-video-bd.xhscdn.com/undefined-video"}]}}]};</script>'
        with mock.patch.object(host, 'fetch_url', return_value=page.encode()):
            result = host.live_video_map_from_page('https://www.xiaohongshu.com/explore/current123')
        self.assertEqual(result['undefined-image'], ['https://sns-video-bd.xhscdn.com/undefined-video'])

    def test_protocol_check_is_read_only(self):
        with mock.patch.object(host, 'download_image') as download, mock.patch.object(host, 'import_to_photos') as photos:
            result = host.process({'action': 'status'})
        self.assertEqual(result, {'ok': True, 'protocolVersion': 4})
        download.assert_not_called()
        photos.assert_not_called()

    def test_quality_warning_only_counts_saved_page_versions(self):
        for failed_import in (False, True):
            for transformed in (False, True):
                with self.subTest(failed_import=failed_import, transformed=transformed):
                    images = [self.temporary_file('.jpg') for _ in range(2)]
                    url = self.image_url + ('!format/webp' if transformed else '')
                    with (mock.patch.object(host, 'download_image',
                                            side_effect=[(image, url, 'jpg') for image in images]),
                          mock.patch.object(host, 'IMPORT_BATCH_SIZE', 1),
                          mock.patch.object(host, 'import_to_photos', side_effect=[
                              host.PhotosImportResult('failed' if failed_import else 'confirmed', '失败'),
                              host.PhotosImportResult('confirmed')])):
                        result = host.process({'images': [{'index': 4, 'url': url}, {'index': 9, 'url': self.image_url}]})
                    self.assertEqual(len(result['qualityFallbackDetails']), int(transformed and not failed_import))
                    if result['qualityFallbackDetails']:
                        self.assertIn('第 4 张', result['qualityFallbackDetails'][0])

    def test_export_source_records_only_successful_resources(self):
        import json
        image = self.temporary_file('.gif')
        with (tempfile.TemporaryDirectory() as directory,
              mock.patch.object(host, 'download_image', return_value=(image, self.image_url, 'gif'))):
            result = host.process({'destination': 'folder', 'folderPath': directory,
                                   'pageUrl': 'https://www.xiaohongshu.com/explore/current123', 'title': '来源测试',
                                   'images': [{'index': 2, 'url': None}, {'index': 7, 'url': self.image_url}]})
            source = json.loads((Path(result['folderPath']) / 'source.json').read_text())
            self.assertEqual(source['title'], '来源测试')
            self.assertIn('current123', source['pageUrl'])
            self.assertEqual(source['failedIndices'], [2])
            self.assertEqual(source['items'][0]['files'], ['07.gif'])
            self.assertEqual(source['items'][0]['index'], 7)

    def test_source_write_failure_keeps_saved_media_and_reports_warning(self):
        image = self.temporary_file('.gif')
        with (tempfile.TemporaryDirectory() as directory,
              mock.patch.object(host, 'download_image', return_value=(image, self.image_url, 'gif')),
              mock.patch.object(Path, 'write_text', side_effect=OSError('磁盘已满'))):
            result = host.process({'destination': 'folder', 'folderPath': directory,
                                   'images': [{'url': self.image_url}]})
            self.assertTrue(result['ok'])
            self.assertEqual(result['saved'], 1)
            self.assertIn('来源记录写入失败', result['sourceWarning'])
            self.assertEqual({p.name for p in Path(result['folderPath']).iterdir()}, {'01.gif'})


class XVideoResultTests(MediaTestCase):
    def test_video_without_a_direct_source_does_not_download_the_poster(self):
        with mock.patch.object(host, 'download_video') as video:
            result = host.process({'images': [{
                'index': 1,
                'url': 'https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg',
                'kind': 'video',
            }]})
        self.assertFalse(result['ok'])
        self.assertIn('没有找到视频直链', result['error'])
        video.assert_not_called()

    def test_placeholder_promotional_image_is_rejected(self):
        with mock.patch.object(host, 'download_image') as download:
            result = host.process({'images': [{
                'index': 1,
                'url': 'https://abs.twimg.com/rweb/ssr/default/v2/og/image.png',
                'kind': 'image',
            }]})
        self.assertFalse(result['ok'])
        self.assertIn('跳过平台默认宣传图', result['error'])
        download.assert_not_called()

    def test_mp4_video_and_animated_gif_export_as_video_with_actual_suffix(self):
        import io
        import json
        url = 'https://video.twimg.com/tweet_video/example.mp4'
        payloads = [
            {'url': url, 'kind': 'video'},
            {'url': 'https://pbs.twimg.com/media/poster?format=jpg', 'kind': 'gif', 'videoUrl': url},
            {'url': url, 'kind': 'gif'},
        ]
        for item in payloads:
            with self.subTest(item=item), tempfile.TemporaryDirectory() as directory:
                response = mock.MagicMock()
                response.__enter__.return_value = response
                response.headers = {}
                data = b'\x00\x00\x00\x18ftypisom' + b'\x00' * 16
                response.read.side_effect = io.BytesIO(data).read
                with (mock.patch.object(host, 'open_download', return_value=response),
                      mock.patch.object(host, 'download_image') as image,
                      mock.patch.object(host, 'prepare_live_photo') as pair):
                    result = host.process({'destination': 'folder', 'folderPath': directory,
                                           'images': [{**item, 'index': 4}]})
                self.assertTrue(result['ok'])
                self.assertEqual(result['liveFallback'], 0)
                self.assertEqual(result['items'][0]['kind'], 'video')
                self.assertEqual(result['items'][0]['format'], 'mp4')
                folder = Path(result['folderPath'])
                self.assertEqual((folder / '04.mp4').read_bytes(), data)
                source = json.loads((folder / 'source.json').read_text())
                self.assertEqual(source['items'][0]['files'], ['04.mp4'])
                self.assertEqual(source['items'][0]['url'], url)
                image.assert_not_called()
                pair.assert_not_called()

    def test_standalone_video_imports_one_resource_and_reports_failed_item(self):
        path = self.temporary_file('.mp4')
        url = 'https://video.twimg.com/a.mp4'
        with (mock.patch.object(host, 'download_video', side_effect=[ValueError('不支持 HLS'), (path, 'mp4')]),
              mock.patch.object(host, 'import_to_photos', return_value=host.PhotosImportResult('confirmed')) as importer,
              mock.patch.object(host, 'prepare_live_photo') as pair):
            result = host.process({'images': [{'index': 2, 'url': url, 'kind': 'video'},
                                             {'index': 8, 'url': url, 'kind': 'video'}]})
        self.assertTrue(result['ok'])
        self.assertEqual((result['saved'], result['failedIndices']), (1, [2]))
        self.assertEqual(result['items'][0]['index'], 8)
        importer.assert_called_once_with([path], '', timeout=120, expected_count=1)
        pair.assert_not_called()
        self.assertFalse(path.exists())
