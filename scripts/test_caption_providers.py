"""Live first-minute comparison; credentials only from environment/.env."""
import argparse
import os
import time
import urllib.error
from pathlib import Path

import video_pipeline as pipeline
from subtitle_providers import MODELS, ProviderError, authenticate, judge as provider_judge

NEUTRAL_PROMPT = pipeline.PROMPT


def judge(provider, batch, key):
    model = MODELS[provider]
    schema = pipeline.subtitle_schema()
    result = provider_judge(provider, batch, key, model, NEUTRAL_PROMPT, schema)
    pipeline.validate_corrections(result, batch)
    return result


def run_experiment(keys, providers, auth_only=False):
    source = pipeline.ROOT / 'artifacts/TE2mcomyNH8/first-minute'
    output = source / 'provider-corrected-subtitles'
    output.mkdir(exist_ok=True)
    asr = pipeline.read_json(source / 'independent-asr.json')['segments']
    youtube = pipeline.read_json(source / 'youtube-0-60.json')['segments']
    # Use original ASR, not manually corrected 大家さん, to test corrections honestly.
    batches = list(pipeline.comparison_batches(asr, youtube))
    result_path = output / ('auth-check.json' if auth_only else 'results.json')
    results = pipeline.read_json(result_path) if result_path.exists() else {}
    for provider in providers:
        key = keys.get(provider)
        if not key:
            results[provider] = {'status': 'missing-key'}
            continue
        try:
            models = authenticate(provider, key)
            model = MODELS[provider]
            if model not in models and f'models/{model}' not in models:
                raise ValueError(f'Configured {provider} model is not available to this key.')
            print(f'{provider}: authenticated; model available.', flush=True)
            auth_path = output / 'auth-check.json'
            auth_status = pipeline.read_json(auth_path) if auth_path.exists() else {}
            auth_status[provider] = {'status': 'authenticated', 'model': model}
            pipeline.write_json(auth_path, auth_status)
            if auth_only:
                results[provider] = {'status': 'authenticated', 'model': model}
                continue
            saved_batches = []
            for index, batch in enumerate(batches):
                signature = pipeline.digest({'prompt': NEUTRAL_PROMPT, 'provider': provider,
                                             'model': model, 'batch': batch})
                cache = output / provider / f'{signature}.json'
                if cache.exists():
                    saved = pipeline.read_json(cache)
                    pipeline.validate_corrections(saved['result'], batch)
                else:
                    started = time.monotonic()
                    result = judge(provider, batch, key)
                    saved = {'provider': provider, 'model': model, 'prompt': NEUTRAL_PROMPT,
                             'input': batch, 'result': result, 'seconds': round(time.monotonic() - started, 3)}
                    pipeline.write_json(cache, saved)
                saved_batches.append(saved)
                print(f'{provider}: compared batch {index + 1}/{len(batches)}', flush=True)
                if index + 1 < len(batches):
                    time.sleep(25)  # Stay comfortably below free-tier token/minute limits.
            corrected = [cue for saved in saved_batches for cue in saved['result']['cues']]
            transcript = {'language': 'ja', 'source': 'independent-asr-llm-compared', 'cues': [
                {'start': original['start'], 'end': original['end'], 'text': correction['text'].strip()}
                for original, correction in zip(asr, corrected) if correction['text'].strip()]}
            pipeline.validate_cues(transcript['cues'])
            pipeline.export_transcript(output / provider, transcript)
            results[provider] = {'status': 'completed', 'model': model,
                                 'usage': [b['result']['usage'] for b in saved_batches]}
        except ProviderError as error:
            results[provider] = {'status': 'api-error', 'httpStatus': error.status, 'code': error.code,
                                 'model': MODELS[provider]}
            print(str(error), flush=True)
        except (ValueError, urllib.error.URLError, TimeoutError) as error:
            # Network exception text is safe here: keys are header-only, not URL parameters.
            results[provider] = {'status': 'failed', 'error': str(error), 'model': MODELS[provider]}
            print(f'{provider}: {type(error).__name__}', flush=True)
    pipeline.write_json(output / ('auth-check.json' if auth_only else 'results.json'), results)
    if not auth_only:
        lines = ['# First-minute provider comparison', '',
                 'Input: original independent large-v3-turbo output and original Japanese YouTube captions.',
                 'Neutral prompt: neither recognizer gets priority. Text-only judgment, no ground-truth accuracy score.',
                 'Only the first 60 seconds are used. No App changes or paid-provider fallback.', '']
        for provider, result in results.items():
            lines += [f'## {provider}', '', f'Status: {result["status"]}', '']
            if result['status'] == 'completed':
                lines += [f'Model: `{result["model"]}`', '',
                          f'Corrected captions: `{provider}/transcript.json` (also SRT and VTT).', '']
            elif result.get('httpStatus'):
                lines += [f'HTTP {result["httpStatus"]}; code: {result.get("code")}', '']
        pipeline.atomic_text(output / 'README.md', '\n'.join(lines) + '\n')
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider', choices=['both', 'groq', 'gemini'], default='both')
    parser.add_argument('--auth-only', action='store_true', help='Check credentials without generating text.')
    parser.add_argument('--credentials-file', type=Path, help='Temporary owner-only JSON with groq/gemini keys.')
    args = parser.parse_args()
    pipeline.load_env(pipeline.ROOT)
    keys = pipeline.read_json(args.credentials_file) if args.credentials_file else {
        'groq': os.environ.get('GROQ_API_KEY'), 'gemini': os.environ.get('GEMINI_API_KEY')}
    providers = list(MODELS) if args.provider == 'both' else [args.provider]
    result = run_experiment(keys, providers, args.auth_only)
    return 0 if all(r['status'] in ('completed', 'authenticated') for r in result.values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
