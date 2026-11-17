import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_host import MediaTestCase, host


class ResourceTests(MediaTestCase):
    def test_progress_failure_cleans_completed_and_unconsumed_downloads(self):
        images = [self.temporary_file('.jpg') for _ in range(4)]

        def report(event):
            if event['completed'] == 1:
                raise BrokenPipeError('弹窗连接已关闭')

        with (
            mock.patch.object(host, 'download_image',
                              side_effect=[(path, self.image_url, 'jpg') for path in images]),
            mock.patch.object(host, 'import_to_photos') as importer,
        ):
            with self.assertRaisesRegex(BrokenPipeError, '弹窗连接已关闭'):
                host.process({'images': [{'url': self.image_url}] * 4}, report)
        importer.assert_not_called()
        self.assertTrue(all(not path.exists() for path in images))

    def test_pair_resources_live_until_import_then_close_on_failure_or_cancellation(self):
        for outcome in ('success', 'failure', 'cancelled'):
            with self.subTest(outcome=outcome):
                image = self.temporary_file('.jpg')
                video = self.temporary_file('.mov')
                paired_paths = []

                def pair(still, movie):
                    paired_paths.extend((still, movie))
                    if outcome == 'cancelled':
                        host.CANCELLED.set()

                def import_pair(paths, album_id='', **kwargs):
                    self.assertEqual(paths, paired_paths)
                    self.assertTrue(all(path.is_file() for path in paths))
                    if outcome == 'failure':
                        raise RuntimeError('导入失败')
                    return host.PhotosImportResult('confirmed')

                try:
                    with (
                        mock.patch.object(host, 'download_image', return_value=(image, self.image_url, 'jpg')),
                        mock.patch.object(host, 'download_video', return_value=(video, 'mov')),
                        mock.patch.object(host, 'prepare_live_photo', side_effect=pair),
                        mock.patch.object(host, 'import_to_photos', side_effect=import_pair) as importer,
                    ):
                        result = host.process({'images': [{
                            'url': self.image_url, 'kind': 'live', 'videoUrl': self.video_url,
                        }]})
                    self.assertEqual(result['ok'], outcome == 'success')
                    if outcome == 'cancelled':
                        importer.assert_not_called()
                finally:
                    host.CANCELLED.clear()
                self.assertFalse(image.exists())
                self.assertFalse(video.exists())
                self.assertTrue(paired_paths)
                self.assertFalse(paired_paths[0].parent.exists())

    def test_partial_write_failure_removes_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            real_mkstemp = tempfile.mkstemp
            real_fdopen = os.fdopen

            def broken_writer(fd, mode):
                file = real_fdopen(fd, mode)
                writer = mock.MagicMock()
                writer.__enter__.return_value = writer
                writer.__exit__.side_effect = lambda *args: file.close()
                def write(data):
                    file.write(data[:2])
                    raise OSError('磁盘已满')
                writer.write.side_effect = write
                return writer

            with (
                mock.patch.object(host.tempfile, 'mkstemp', side_effect=lambda **kw: real_mkstemp(dir=directory, **kw)),
                mock.patch.object(host.os, 'fdopen', side_effect=broken_writer),
            ):
                response = mock.MagicMock()
                response.__enter__.return_value = response
                response.headers = {}
                response.read.side_effect = [b'GIF89a', b'']
                with mock.patch.object(host, 'open_download', return_value=response):
                    with self.assertRaisesRegex(OSError, '磁盘已满'):
                        host.download_media(self.image_url, 'image/*')
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_conversion_timeout_removes_output(self):
        with tempfile.TemporaryDirectory() as directory:
            real_mkstemp = tempfile.mkstemp
            with (
                mock.patch.object(host.tempfile, 'mkstemp', side_effect=lambda **kw: real_mkstemp(dir=directory, **kw)),
                mock.patch.object(host.subprocess, 'run', side_effect=subprocess.TimeoutExpired('sips', 120)),
            ):
                with self.assertRaises(subprocess.TimeoutExpired):
                    host.convert_live_image_to_jpeg(Path('/input.webp'))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_missing_video_keeps_original_gif(self):
        path = self.temporary_file('.gif')
        captured = []
        def import_image(paths, album_id='', **kwargs):
            captured.extend(paths)
            return host.PhotosImportResult('confirmed')
        with (
            mock.patch.object(host, 'download_image', return_value=(path, self.image_url, 'gif')),
            mock.patch.object(host, 'convert_live_image_to_jpeg') as convert,
            mock.patch.object(host, 'import_to_photos', side_effect=import_image),
        ):
            result = host.process({'images': [{'url': self.image_url, 'kind': 'live'}]})
        self.assertTrue(result['ok'])
        self.assertEqual(result['items'][0]['format'], 'gif')
        self.assertEqual(captured, [path])
        convert.assert_not_called()

    def test_failed_pairing_cannot_destroy_static_fallback(self):
        path = self.temporary_file('.jpg')
        video = self.temporary_file('.mov')
        captured = []
        def break_pair(image, video):
            image.unlink()
            raise RuntimeError('配对失败')
        def capture(paths, album_id='', **kwargs):
            captured.append(paths[0].read_bytes())
            return host.PhotosImportResult('confirmed')
        with (
            mock.patch.object(host, 'download_image', return_value=(path, self.image_url, 'jpg')),
            mock.patch.object(host, 'download_video', return_value=(video, 'mov')),
            mock.patch.object(host, 'prepare_live_photo', side_effect=break_pair),
            mock.patch.object(host, 'import_to_photos', side_effect=capture),
        ):
            result = host.process({'images': [{'url': self.image_url, 'kind': 'live', 'videoUrl': self.video_url}]})
        self.assertTrue(result['ok'])
        self.assertEqual(captured, [b'test'])
        self.assertEqual(result['liveFallback'], 1)
        self.assertFalse(path.exists())
        self.assertFalse(video.exists())
