# Full-video subtitle pipeline

The command downloads/reuses Japanese audio and original YouTube captions.
When YouTube metadata identifies an uploaded Japanese track, the pipeline uses
its wording and timestamps directly, skipping ASR and subtitle correction.
A Japanese caption filename alone is not treated as proof: automatic captions
and machine-translated tracks still use the ASR workflow. Empty or invalid
uploaded captions cannot activate an empty lesson.

Otherwise it transcribes the entire audio independently with large-v3-turbo,
then uses a language model to compare both transcripts with surrounding context. Its final
choices are saved, translated into English using the final Japanese cues, and
automatically become the App's captions, English translations, and word data.
There is no adoption switch or manual review step.

Every successfully processed video is also registered in the App's **影片收藏**
tab. Select a video there to switch its player, Japanese captions, English
translations, and dictionary together. The earlier videos and saved vocabulary
remain available. Reprocessing a video replaces its collection revision rather
than adding a duplicate. `src/data/video-collection.json` records the completed
lessons and `video-collection.js` provides their bundled assets; partial pipeline
results are not registered as ready lessons.

For example, to process and add a new link:

```bash
npm run transcribe -- "https://youtu.be/xtNfteab1_o"
```

To regenerate English for the current Japanese revision without downloading,
transcribing, comparing recognizers, or rebuilding vocabulary:

```bash
npm run translate -- TE2mcomyNH8
```

This uses the provider/key already configured in `.env`. It sends Japanese
subtitle text and surrounding context to that provider, not audio or saved words.
For the active video it translates the exact transcript imported by the App;
for another video it uses that video's latest completed revision. Successful
translation of the active video updates its imports automatically.

## Setup once

Use Python 3.12 and Node 22. The existing workspace already has `.venv-asr`,
the ASR model cache, and the full dictionary. On a new machine:

This workspace's interpreter is kept in `.python-runtime/python312` so it
survives cleanup of `/tmp`; keep this ignored runtime directory with the local
environment, or recreate the virtual environment using your installed Python.

```bash
python3.12 -m venv .venv-asr
.venv-asr/bin/python -m pip install -r scripts/asr-requirements.txt
npm install
```

Windows: use `.venv-asr\Scripts\python.exe` in place of `.venv-asr/bin/python`.
Download the **full English JMdict JSON** from
[jmdict-simplified releases](https://github.com/scriptin/jmdict-simplified/releases/latest),
unpack it and put the JSON at `.dictionary/jmdict-eng.json` (create the directory).
Alternatively set `JMDICT_PATH` to its location.

Copy `.env.example` to `.env`, then fill in `GEMINI_API_KEY` in your editor.
The key is used only by the local Python process, never shipped to the App.
The default comparison is Gemini `gemini-3.5-flash-lite`. For Groq, set
`SUBTITLE_PROVIDER=groq` and `GROQ_API_KEY`; its default is `openai/gpt-oss-120b`.
`SUBTITLE_JUDGE_MODEL` can override the provider's model. Shell environment
variables take precedence over `.env`. The parser accepts literal `KEY=value`
lines with optional quotes; it does not expand shell variables.

For uploaded captions only English translation uses the configured API;
their Japanese text is not sent for correction. The output source is
`youtube-uploaded-captions`; author timings and line boundaries are retained.

When needed, ASR runs locally on CPU using int8, 8 threads, beam size 5, Japanese, no YouTube
prompt. First use downloads the model to `.asr-models/`. The language model gets
subtitle text and context via Gemini or Groq, not audio. Use a free-tier project
or account for free calls; the key alone cannot prove its billing tier. The
pipeline does not enable billing or fall back to a paid provider. Paid accounts
follow their provider's pricing. Requests are spaced and quota errors stop after
bounded retries; rerun later to resume. No API key is needed for playback afterward.
The API integration follows [Gemini generation documentation](https://ai.google.dev/api/generate-content)
and [Groq structured outputs documentation](https://console.groq.com/docs/structured-outputs).

## Run it yourself

From the project directory, for the existing video:

```bash
npm run transcribe -- TE2mcomyNH8
```

Or pass a new URL directly; download happens automatically:

```bash
npm run transcribe -- "https://youtu.be/TE2mcomyNH8"
```

To download first and transcribe later:

```bash
npm run download -- "https://youtu.be/TE2mcomyNH8"
npm run transcribe -- TE2mcomyNH8
```

Equivalent direct command:

```bash
.venv-asr/bin/python scripts/video_pipeline.py transcribe TE2mcomyNH8
```

Then run `npm run dev`, or reload the running development player. Rebuild with
`npm run build` if you serve a production build. The active video title, channel,
duration, audio, captions, and vocabulary all switch to this video's outputs.
The current player is still the React prototype, not a native iOS application.

## Saved files and reruns

Folders use the video ID, which stays identical across different share URLs:

```text
artifacts/TE2mcomyNH8/
  TE2mcomyNH8.webm                  original downloaded audio
  TE2mcomyNH8.info.json             original video metadata
  TE2mcomyNH8.ja-orig.json3         original YouTube captions (when available)
  processed/
    asr.json                       completed full independent transcription
    checkpoints/<hash>.json        internal resume cache
    translation-checkpoints/<hash>.json  resumable English translation batches
    transcript.json               complete corrected subtitles
    transcript.srt
    transcript.vtt
    revisions/<hash>/
      transcript.json
      transcript.srt
      transcript.vtt
      vocabulary.json
      translations.json            English for this exact Japanese revision
    latest.json                    latest successfully activated revision
```

The generated `src/data/active-video.js` imports the transcript, its matching
vocabulary, and its English translations from one revision. Previous revisions and original files
are retained. Completed batches are reused only when model, prompt, and input match;
ASR is reused only when the audio hash and inference settings match. If the
comparison fails, rerun the same command to reuse already finished batches.
Interrupted ASR must restart; its completed output is cached, not partial output.
Missing credentials/dictionary stop before expensive transcription. API failure
stops the pipeline without silently substituting a heuristic or changing the App.

English is generated after the final Japanese cue boundaries are known, before
activating the revision. Each translation batch has up to 24 targets and 4 cues
of context on each side. Consecutive cues can share a complete English sentence;
every target must be covered exactly once. Japanese wording and timings are
copied exactly into the English output so existing stale-translation checks
remain effective. Changing text or boundaries invalidates affected translation
checkpoints. Failed translation leaves the previous App revision active; rerun
to resume finished batches. There is no automatic provider or billing fallback.

Each comparison batch has up to 8 target ASR cues, 3 previous and 3 following
ASR cues, and overlapping original YouTube captions. The judge can keep ASR,
choose YouTube wording, correct wording, or drop a clear hallucination. It must
produce one corrected text per fixed cue ID; unknown/reordered IDs and malformed
outputs are rejected. If uncertain, it still makes a best choice; neither
recognizer gets priority. If YouTube Japanese captions are absent, it judges
ASR from context alone.

The model returns only cue IDs and corrected text. Final subtitles contain
`start`, `end`, and `text` for each cue, without reasons, source-choice labels,
or human-confirmation fields. The stable completed files are
`artifacts/<video-id>/processed/transcript.json`, `.srt`, and `.vtt`; the App
automatically imports the matching completed revision and word data.

These are automatically chosen subtitles, not guaranteed verbatim subtitles.
Timing stays on ASR segments; corrected text is not force-aligned. A phrase
missed entirely by ASR may remain missing. Dictionary meanings remain JMdict
entries, not model-generated translations. This pipeline does not reuse the
manually adopted first-minute experiment as a full-video result.

## Validation

```bash
npm run test:pipeline
npm test
npm run build
```

Pipeline tests use mocked language-model responses and fixture transcripts,
including invalid outputs, cache reuse, failure behavior and App activation.
They do not make paid API calls. A live full-video comparison requires your key.

The planned paste-a-link App interface is in [FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md).

## Reproduce the first-minute provider experiment

With your keys in `.env` (`GROQ_API_KEY`, `GEMINI_API_KEY`):

```bash
python3 scripts/test_caption_providers.py
```

It uses the saved original first-minute ASR and YouTube transcripts, never the
manually corrected transcript. It compares both providers with the same neutral
prompt, saves corrected subtitles/usage, and leaves the player unchanged. New outputs are in
`artifacts/TE2mcomyNH8/first-minute/provider-corrected-subtitles/`. The older
`provider-comparison/` folder is the historical experiment. Successful batches are
cached; a failure does not switch provider or enable billing. This is a live
experiment, separate from `npm run test:pipeline`'s offline tests.
