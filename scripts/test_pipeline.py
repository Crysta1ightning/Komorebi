import json
import os
import tempfile
import urllib.error
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import video_pipeline as pipeline
import subtitle_providers as providers
import translate_subtitles as translation


def fixture_judge(batch, model, key):
    return {'cues': [{'id': c['id'], 'text': c['text'].replace('大屋さん', '大家さん')}
                     for c in batch['targets']]}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.asr = {'cues': [{'start': 0, 'end': 2, 'text': '大屋さんの家賃は八万円です'},
                             {'start': 3, 'end': 5, 'text': 'ペーパーナプキンをもらった'}]}
        self.yt = [{'start': 0, 'end': 2, 'text': 'あの皆さんの家賃は八万円です'}]
        self.batch = next(pipeline.comparison_batches(self.asr['cues'], self.yt))

    def tearDown(self):
        self.temporary.cleanup()

    def test_url_identity_and_rejection(self):
        for value in ['TE2mcomyNH8', 'https://youtu.be/TE2mcomyNH8?si=test',
                      'https://www.youtube.com/watch?v=TE2mcomyNH8&list=anything']:
            self.assertEqual(pipeline.video_id(value), 'TE2mcomyNH8')
        for value in ['../anything', 'https://example.com/watch?v=TE2mcomyNH8',
                      'https://youtube.com.evil.com/watch?v=TE2mcomyNH8']:
            with self.assertRaises(ValueError):
                pipeline.video_id(value)

    def test_clean_transcript_preserves_timing_and_context(self):
        judge = Mock(side_effect=fixture_judge)
        transcript = pipeline.correct_transcript(self.asr, self.yt, self.root, 'model', 'key', judge)
        self.assertEqual(transcript['cues'][0], {'start': 0, 'end': 2, 'text': '大家さんの家賃は八万円です'})
        self.assertEqual(transcript['cues'][1], self.asr['cues'][1])
        self.assertEqual(judge.call_args.args[0]['youtubeContext'], self.yt)
        saved = next((self.root / 'checkpoints').glob('*.json'))
        self.assertEqual(set(pipeline.read_json(saved)['result']['cues'][0]), {'id', 'text'})

    def test_cache_reuse_and_model_invalidation(self):
        pipeline.correct_transcript(self.asr, self.yt, self.root, 'model', 'key', fixture_judge)
        judge = Mock(side_effect=AssertionError('Should be cached'))
        pipeline.correct_transcript(self.asr, self.yt, self.root, 'model', 'key', judge)
        judge.assert_not_called()
        judge = Mock(side_effect=fixture_judge)
        pipeline.correct_transcript(self.asr, self.yt, self.root, 'new-model', 'key', judge)
        judge.assert_called_once()

    def test_bad_ids_text_and_extra_fields_rejected(self):
        for mutate in [lambda cs: cs.reverse(), lambda cs: cs.pop(),
                       lambda cs: cs[0].update(reason='unwanted'),
                       lambda cs: cs[0].update(text='x\nmalformed')]:
            data = fixture_judge(self.batch, 'model', 'key')
            mutate(data['cues'])
            with self.assertRaises(ValueError):
                pipeline.validate_corrections(data, self.batch)

    def test_empty_noise_removed_but_all_empty_rejected(self):
        def judge(batch, model, key):
            result = fixture_judge(batch, model, key)
            result['cues'][1]['text'] = ''
            return result
        transcript = pipeline.correct_transcript(self.asr, [], self.root, 'model', 'key', judge)
        self.assertEqual(len(transcript['cues']), 1)
        def empty(batch, model, key):
            return {'cues': [{'id': c['id'], 'text': ''} for c in batch['targets']]}
        with self.assertRaises(ValueError):
            pipeline.correct_transcript(self.asr, [], self.root, 'new-model', 'key', empty)

    def test_original_json3_overlap_normalized(self):
        pipeline.write_json(self.root / 'TE2mcomyNH8.ja-orig.json3', {'events': [
            {'tStartMs': 0, 'dDurationMs': 5000, 'segs': [{'utf8': 'こんにちは'}]},
            {'tStartMs': 3000, 'dDurationMs': 2000, 'segs': [{'utf8': '皆さん'}]}]})
        self.assertEqual(pipeline.youtube_cues(self.root, 'TE2mcomyNH8')[0]['end'], 3)

    def test_uploaded_captions_require_manual_metadata_and_prefer_it_over_auto_orig(self):
        identifier = 'TE2mcomyNH8'
        pipeline.write_json(self.root / f'{identifier}.ja.json3', {'events': [
            {'tStartMs': 1000, 'dDurationMs': 2000, 'segs': [{'utf8': '作者の字幕'}]}]})
        pipeline.write_json(self.root / f'{identifier}.ja-orig.json3', {'events': [
            {'tStartMs': 0, 'dDurationMs': 2000, 'segs': [{'utf8': '自動字幕'}]}]})
        manual = {'subtitles': {'ja': [{'ext': 'json3', 'url': 'https://example.com/captions?lang=ja'}]}}
        self.assertEqual(pipeline.uploaded_japanese_cues(self.root, identifier, manual),
                         [{'start': 1, 'end': 3, 'text': '作者の字幕'}])
        self.assertEqual(pipeline.uploaded_japanese_cues(self.root, identifier,
                         {'automatic_captions': manual['subtitles']}), [])
        for query in ['kind=asr', 'tlang=ja']:
            self.assertEqual(pipeline.uploaded_japanese_cues(self.root, identifier,
                {'subtitles': {'ja': [{'ext': 'json3', 'url': f'https://example.com/?{query}'}]}}), [])
        pipeline.write_json(self.root / f'{identifier}.ja.json3', {'events': []})
        self.assertEqual(pipeline.uploaded_japanese_cues(self.root, identifier, manual), [])
        pipeline.write_json(self.root / f'{identifier}.ja-orig.json3', {'events': []})
        pipeline.write_json(self.root / f'{identifier}.ja.json3', {'events': [
            {'dDurationMs': 2000, 'segs': [{'utf8': '欠けた時刻'}]}]})
        self.assertEqual(pipeline.uploaded_japanese_cues(self.root, identifier, manual), [])
        self.assertEqual(pipeline.youtube_cues(self.root, identifier), [])

    def test_uploaded_route_skips_recognition_and_correction_but_translates_and_activates(self):
        identifier = 'TE2mcomyNH8'
        pipeline.write_json(self.root / '.dictionary/jmdict-eng.json', {'words': [1], 'tags': {'n': 'noun'}})
        (self.root / 'node_modules/kuromoji').mkdir(parents=True)
        pipeline.write_json(self.root / f'{identifier}.ja.json3', {'events': [
            {'tStartMs': 1000, 'dDurationMs': 2000, 'segs': [{'utf8': '作者の字幕'}]}]})
        info = {'subtitles': {'ja': [{'ext': 'json3', 'url': 'https://example.com/?lang=ja'}]}}
        def build(args, **kwargs):
            transcript = pipeline.read_json(Path(args[-2]))
            pipeline.write_json(Path(args[-1]), {'transcriptTexts': [c['text'] for c in transcript['cues']]})
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key'}, clear=True), \
             patch('subtitle_providers.authenticate', return_value=['models/gemini-3.5-flash-lite']), \
             patch.object(pipeline, 'download', return_value=(self.root, self.root / 'audio', info)), \
             patch.object(pipeline, 'transcribe_audio') as asr, \
             patch.object(pipeline, 'correct_transcript') as correct, \
             patch.object(pipeline.subprocess, 'run', side_effect=build), \
             patch.object(translation, 'generate', return_value={'cues': []}) as translate:
            pipeline.run(self.root, identifier)
            asr.assert_not_called()
            correct.assert_not_called()
            self.assertEqual(translate.call_args.args[1]['source'], 'youtube-uploaded-captions')
        self.assertEqual(pipeline.read_json(self.root / 'src/data/active-video.json')['id'], identifier)

    def test_export_and_atomic_app_activation(self):
        revision = self.root / 'artifacts/TE2mcomyNH8/processed/revisions/test'
        transcript = pipeline.correct_transcript(self.asr, self.yt, self.root, 'model', 'key', fixture_judge)
        pipeline.export_transcript(revision, transcript)
        pipeline.write_json(revision / 'vocabulary.json', {'cues': []})
        audio = self.root / 'artifacts/TE2mcomyNH8/TE2mcomyNH8.webm'
        pipeline.activate(self.root, 'TE2mcomyNH8', audio, {'title': '字幕', 'duration': 5}, revision)
        module = (self.root / 'src/data/active-video.js').read_text()
        self.assertIn('processed/revisions/test/transcript.json', module)
        self.assertIn('processed/revisions/test/vocabulary.json', module)
        self.assertIn('const translations = null;', module)
        self.assertIn('export { transcript, vocabulary, translations };', module)
        self.assertIn('00:00:00,000 --> 00:00:02,000', (revision / 'transcript.srt').read_text())
        self.assertTrue((revision / 'transcript.vtt').read_text().startswith('WEBVTT'))

    def test_missing_key_stops_before_download(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(pipeline, 'download') as download:
            with self.assertRaisesRegex(ValueError, 'GEMINI_API_KEY'):
                pipeline.run(self.root, 'TE2mcomyNH8')
            download.assert_not_called()

    def test_failed_correction_keeps_previous_app(self):
        active = self.root / 'src/data/active-video.js'
        pipeline.atomic_text(active, 'previous app module')
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'test-key', 'SUBTITLE_PROVIDER': 'gemini'}, clear=True):
            pipeline.write_json(self.root / '.dictionary/jmdict-eng.json', {'words': [1], 'tags': {'n': 'noun'}})
            (self.root / 'node_modules/kuromoji').mkdir(parents=True)
            with patch('subtitle_providers.authenticate', return_value=['models/gemini-3.5-flash-lite']), \
                 patch.object(pipeline, 'download', return_value=(self.root, self.root / 'audio', {})), \
                 patch.object(pipeline, 'transcribe_audio', return_value=self.asr), \
                 patch.object(pipeline, 'youtube_cues', return_value=self.yt), \
                 patch.object(pipeline, 'correct_transcript', side_effect=RuntimeError('API failure')):
                with self.assertRaisesRegex(RuntimeError, 'API failure'):
                    pipeline.run(self.root, 'TE2mcomyNH8')
        self.assertEqual(active.read_text(), 'previous app module')

    def test_both_provider_response_contracts(self):
        cues = fixture_judge(self.batch, 'model', 'key')['cues']
        cases = {
            'groq': {'id': 'mock', 'usage': {}, 'choices': [{'finish_reason': 'stop',
                     'message': {'content': json.dumps({'cues': cues})}}]},
            'gemini': {'responseId': 'mock', 'usageMetadata': {}, 'candidates': [{
                'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({'cues': cues})}]}}]},
        }
        for name, response in cases.items():
            with self.subTest(provider=name), patch.object(providers, 'request_json', return_value=response) as http:
                result = providers.judge(name, self.batch, 'secret-key', providers.MODELS[name], pipeline.PROMPT, pipeline.subtitle_schema())
                self.assertEqual(pipeline.validate_corrections(result, self.batch), cues)
                self.assertNotIn('secret-key', json.dumps(http.call_args.args[3]))

    def test_daily_quota_does_not_switch_provider(self):
        call = providers.throttled_judge('groq', 'model', pipeline.PROMPT, {}, pipeline.validate_corrections)
        with patch.object(providers, 'judge', side_effect=providers.ProviderError('groq', 429, retry_after=3600)) as judge:
            with self.assertRaises(providers.ProviderError):
                call(self.batch, 'model', 'key')
        judge.assert_called_once()

    def test_temporary_provider_outage_retries_same_batch_with_a_bound(self):
        call = providers.throttled_judge('gemini', 'model', pipeline.PROMPT, {}, pipeline.validate_corrections)
        result = fixture_judge(self.batch, 'model', 'key')
        with patch.object(providers, 'judge', side_effect=[providers.ProviderError('gemini', 503), result]) as judge, \
             patch.object(providers.time, 'sleep'):
            self.assertEqual(call(self.batch, 'model', 'key'), result)
            self.assertEqual(judge.call_count, 2)
            self.assertEqual(judge.call_args_list[0], judge.call_args_list[1])
        call = providers.throttled_judge('gemini', 'model', pipeline.PROMPT, {}, pipeline.validate_corrections)
        with patch.object(providers, 'judge', side_effect=providers.ProviderError('gemini', 503)) as judge, \
             patch.object(providers.time, 'sleep'):
            with self.assertRaises(providers.ProviderError):
                call(self.batch, 'model', 'key')
            self.assertEqual(judge.call_count, 3)

    def test_connection_failure_is_sanitized_and_retried(self):
        with patch.object(providers.urllib.request, 'urlopen', side_effect=urllib.error.URLError('temporary DNS error')):
            with self.assertRaises(providers.ProviderError) as caught:
                providers.request_json('gemini', 'https://example.com', 'secret-key')
            self.assertEqual(caught.exception.code, 'NETWORK_UNAVAILABLE')
            self.assertNotIn('secret-key', str(caught.exception))
        call = providers.throttled_judge('gemini', 'model', pipeline.PROMPT, {}, pipeline.validate_corrections)
        result = fixture_judge(self.batch, 'model', 'key')
        with patch.object(providers, 'judge', side_effect=[providers.ProviderError('gemini', 0, 'NETWORK_UNAVAILABLE'), result]) as judge, \
             patch.object(providers.time, 'sleep'):
            self.assertEqual(call(self.batch, 'model', 'key'), result)
            self.assertEqual(judge.call_count, 2)

    def test_translation_groups_preserve_japanese_and_timing_and_cache(self):
        batch = next(translation.batches(self.asr['cues']))
        result = {'groups': [{'first': 0, 'last': 1, 'english': 'Two translated sentences.'}]}
        judge = Mock(return_value=result)
        translated = translation.translate(self.asr, self.root, 'model', 'key', judge, 'gemini')
        self.assertEqual([c['japanese'] for c in translated['cues']], [c['text'] for c in self.asr['cues']])
        self.assertEqual(translated['cues'][1]['start'], 3)
        self.assertEqual(translated['cues'][1]['sentenceStart'], 0)
        self.assertEqual(translated['cues'][0]['sentenceEnd'], 1)
        cached = Mock(side_effect=AssertionError('Already translated'))
        self.assertEqual(translation.translate(self.asr, self.root, 'model', 'key', cached, 'gemini'), translated)
        cached.assert_not_called()
        revised = {'cues': [{**c, 'text': c['text'] + '。'} for c in self.asr['cues']]}
        translation.translate(revised, self.root, 'model', 'key', judge, 'gemini')
        self.assertEqual(judge.call_count, 2)
        for groups in [[], [{'first': 1, 'last': 1, 'english': 'Missing cue'}],
                       [{'first': 0, 'last': 2, 'english': 'Out of range'}],
                       [{'first': 0, 'last': 1, 'english': ''}]]:
            with self.assertRaises(ValueError):
                translation.validate({'groups': groups}, batch)

    def test_translation_only_failure_preserves_active_app_and_old_translation(self):
        revision = self.root / 'artifacts/TE2mcomyNH8/processed/revisions/test'
        pipeline.export_transcript(revision, self.asr)
        pipeline.write_json(revision / 'translations.json', {'previous': True})
        pipeline.write_json(self.root / 'src/data/active-video.json', {
            'id': 'TE2mcomyNH8', 'transcriptPath': (revision / 'transcript.json').relative_to(self.root).as_posix()})
        pipeline.atomic_text(self.root / 'src/data/active-video.js', 'previous app module')
        with patch.object(translation, 'generate', side_effect=RuntimeError('Translation API failure')), \
             patch.object(pipeline, 'transcribe_audio') as asr:
            with self.assertRaisesRegex(RuntimeError, 'Translation API failure'):
                pipeline.translate_only(self.root, 'TE2mcomyNH8')
            asr.assert_not_called()
        self.assertEqual((self.root / 'src/data/active-video.js').read_text(), 'previous app module')
        self.assertEqual(pipeline.read_json(revision / 'translations.json'), {'previous': True})

    def test_activation_prefers_revision_translation_over_legacy(self):
        revision = self.root / 'artifacts/TE2mcomyNH8/processed/revisions/test'
        pipeline.export_transcript(revision, self.asr)
        pipeline.write_json(revision / 'translations.json', {'cues': []})
        pipeline.write_json(revision.parent.parent.parent / 'TE2mcomyNH8.en.translations.json', {'cues': []})
        pipeline.activate(self.root, 'TE2mcomyNH8', revision / 'audio.webm', {}, revision)
        self.assertIn('processed/revisions/test/translations.json',
                      (self.root / 'src/data/active-video.js').read_text())

    def test_collection_keeps_previous_videos_and_replaces_only_the_processed_revision(self):
        for identifier in ['TE2mcomyNH8', 'xtNfteab1_o', 'xtNfteab1_o']:
            revision = self.root / 'artifacts' / identifier / 'processed/revisions/test'
            pipeline.export_transcript(revision, self.asr)
            pipeline.write_json(revision / 'translations.json', {'cues': []})
            pipeline.activate(self.root, identifier, revision / 'audio.webm', {'title': identifier}, revision)
        collection = pipeline.read_json(self.root / 'src/data/video-collection.json')
        self.assertEqual([video['id'] for video in collection], ['TE2mcomyNH8', 'xtNfteab1_o'])
        module = (self.root / 'src/data/video-collection.js').read_text()
        self.assertIn('TE2mcomyNH8/processed/revisions/test/vocabulary.json', module)
        self.assertIn('xtNfteab1_o/processed/revisions/test/vocabulary.json', module)
        self.assertEqual(module.count('audioUrl: new URL('), 2)


if __name__ == '__main__':
    unittest.main()
