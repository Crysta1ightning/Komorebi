"""Independently transcribe precisely the first minute; never use YT as prompt."""
import argparse
import hashlib
import importlib.metadata
import json
import time
import wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

parser = argparse.ArgumentParser()
parser.add_argument('--source', default='artifacts/TE2mcomyNH8/TE2mcomyNH8.webm')
parser.add_argument('--output', default='artifacts/TE2mcomyNH8/first-minute')
parser.add_argument('--model', default='large-v3-turbo')
parser.add_argument('--model-cache', default='.asr-models')
parser.add_argument('--offline', action='store_true')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)

sample_rate = 16000
samples = decode_audio(args.source, sampling_rate=sample_rate)[:60 * sample_rate]
if len(samples) != 60 * sample_rate:
    raise ValueError('Source audio is shorter than the one-minute experiment')
wav_path = out / 'audio-0-60.wav'
with wave.open(str(wav_path), 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    wav.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
print('Prepared exactly 60.0 seconds of 16 kHz mono PCM audio.', flush=True)

load_start = time.monotonic()
model = WhisperModel(args.model, device='cpu', compute_type='int8', cpu_threads=8,
                     download_root=args.model_cache, local_files_only=args.offline)
load_seconds = time.monotonic() - load_start
print(f'Model loaded in {load_seconds:.1f}s. Starting independent Japanese transcription.', flush=True)
started = time.monotonic()
segments, info = model.transcribe(samples, language='ja', task='transcribe', beam_size=5,
                                  word_timestamps=True, condition_on_previous_text=False,
                                  initial_prompt=None, vad_filter=False, temperature=0.0)
result = []
for segment in segments:
    item = {
        'start': segment.start, 'end': segment.end, 'text': segment.text,
        'avg_logprob': segment.avg_logprob, 'no_speech_prob': segment.no_speech_prob,
        'words': [{'start': word.start, 'end': word.end, 'text': word.word,
                   'probability': word.probability} for word in segment.words or []],
    }
    result.append(item)
    print(f'{segment.start:.2f}-{segment.end:.2f}: {segment.text}', flush=True)
elapsed = time.monotonic() - started
metadata = {
    'model': args.model, 'engine': 'faster-whisper',
    'engine_version': importlib.metadata.version('faster-whisper'),
    'device': 'cpu', 'compute_type': 'int8', 'language': 'ja', 'task': 'transcribe',
    'beam_size': 5, 'temperature': 0, 'condition_on_previous_text': False,
    'initial_prompt': None, 'youtube_transcript_used_as_input': False,
    'vad_filter': False, 'sample_rate': sample_rate, 'duration': len(samples) / sample_rate,
    'model_load_and_download_seconds': round(load_seconds, 3),
    'transcription_seconds': round(elapsed, 3),
    'source': args.source, 'audio_sha256': hashlib.sha256(wav_path.read_bytes()).hexdigest(),
    'human_verified': False,
    'timing_note': 'Model-estimated timestamps; not independently validated forced alignment.',
}
(out / 'independent-asr.json').write_text(json.dumps({'metadata': metadata, 'segments': result}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'independent-asr.txt').write_text('\n'.join(segment['text'] for segment in result) + '\n', encoding='utf-8')
print(f'Saved {len(result)} segments. Transcription took {elapsed:.1f}s.', flush=True)
