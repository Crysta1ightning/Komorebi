# Komorebi（木漏れ日）

A Japanese learning app with video subtitles, dictionary lookups, and flashcards.
Built with React and Vite. The mobile PWA can sync vocabulary and learning
progress with the desktop app through your own Supabase project.

The interface currently uses Traditional Chinese labels, Japanese vocabulary,
and English definitions and sentence translations.

## 1. Install and start the app

Install **Node.js 22** and Git, then run:

```bash
git clone https://github.com/Crysta1ightning/Komorebi.git
cd Komorebi
npm ci
cp .env.example .env
npm run dev
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Create `.env` once; when updating, edit the existing file rather than replacing it.

Open the URL printed by Vite, normally `http://127.0.0.1:5173`.
Keep the terminal running; press Ctrl+C to stop the app.

**You can use flashcards without any API keys.** A fresh clone starts with an
empty video collection and opens the vocabulary review interface. The bundled
JMdict dictionary is ready for word lookups. Installation creates the empty
video index without overwriting previously imported videos.

For the dedicated phone layout, stop that server and run:

```bash
npm run dev:mobile
```

Open the URL printed by Vite. To preview on a phone on the same Wi-Fi, use your
computer's LAN IP and the displayed port. Use HTTPS hosting for installation
and offline caching; see the deployment instructions below.

## 2. Configure your own `.env`

The root `.env` file is ignored by Git. Use your own credentials, not another
user's keys. Configuration depends on which features you want:

| Feature | Required settings |
| --- | --- |
| Local flashcards, dictionary, custom examples, JSON backups | None |
| Sync between desktop and phone | Supabase project URL and publishable key |
| Import videos and generate subtitles/English translations | Gemini **or** Groq API key; Python and the full dictionary input |

### Optional cloud sync

Create your own Supabase project, run the complete
[`supabase/study-sync.sql`](supabase/study-sync.sql) in its SQL Editor, and create
an email/password user in **Authentication → Users**, with email confirmed.
Add your project's public settings to `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Use a **publishable key**, not a secret or `service_role` key. These two `VITE_`
values are visible in the browser; database access is protected by authentication,
RLS, and the sync function. Do not add `VITE_` to a private API key.

Restart the development server after editing `.env`. Open **雲端同步** and sign
in with the app user you created. This is separate from your Supabase Dashboard
login. Sign in to the same app account on desktop and phone.

The app stores one JSON library per user in `public.study_libraries`; individual
words are inside `document.cards`. No video or audio files are uploaded to
Supabase. For SQL, account setup, and troubleshooting, see
[MOBILE_SETUP.md](MOBILE_SETUP.md).

### Optional video-processing API key

For Gemini, edit these lines in `.env`:

```dotenv
SUBTITLE_PROVIDER=gemini
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
JMDICT_PATH=.dictionary/jmdict-eng.json
```

Or use Groq:

```dotenv
SUBTITLE_PROVIDER=groq
GROQ_API_KEY=YOUR_GROQ_API_KEY
JMDICT_PATH=.dictionary/jmdict-eng.json
```

Only the selected provider needs a key. Optional `SUBTITLE_JUDGE_MODEL` overrides
the model used by that provider. The Python pipeline reads `.env` when started;
shell environment variables take precedence. Private keys stay in the local
pipeline and are not included in the app build. Provider quotas and billing
depend on your own account. Playback and review do not make these API calls.

## 3. Add words and review

1. Open **收藏** in the phone menu, or **單字複習 → 單字收藏** on desktop.
2. Expand **自己新增單字**, enter Japanese, and press **查字典**. Select a
   dictionary entry, or provide your own reading and meaning.
3. Optionally add Japanese examples with English translations, then save the word.
4. Open **複習**, enter how many words to practice, and add them to the playlist.
   The app selects the lowest familiarity scores first. Newly saved words stay
   in the collection until you explicitly add them to practice.
5. Think of the meaning and reading, flip the card, and choose a rating:

| Rating | Behavior |
| --- | --- |
| 不熟悉 — unfamiliar | Returns after 10 other cards, or at the end of a shorter queue |
| 普通 — ordinary | Returns after 20 other cards, or at the end of a shorter queue |
| 熟悉 — familiar | Finished for the current local calendar day |

The mobile **＋** next to the remaining count lets you add more words without
leaving the current card. Words already queued or completed today are excluded.
Familiarity considers repeated attempts and decays with time; history is retained.

Click a saved word to open its dictionary dialog. For multiple readings, choose
**收藏此讀音** to update that card's reading and meanings without losing history.
Japanese pronunciation uses your device's speech voices. You can add or upload
custom examples; see [STUDY_DICTIONARY.md](STUDY_DICTIONARY.md) for file formats.

Collections are stored in your browser. Use **下載備份** to export JSON and
**還原備份** to import it. Without cloud sync, different browsers, hosts, and ports
have separate collections. With sync, restoring a backup merges it into the
cloud library. Cancel a star to remove a word from study.

## 4. Import a YouTube video

Video processing runs on your computer. Install **Python 3.12**, then create the
environment expected by the pipeline:

```bash
python3.12 -m venv .venv-asr
.venv-asr/bin/python -m pip install -r scripts/asr-requirements.txt
mkdir -p .dictionary
```

On Windows PowerShell:

```powershell
py -3.12 -m venv .venv-asr
.venv-asr\Scripts\python.exe -m pip install -r scripts/asr-requirements.txt
New-Item -ItemType Directory -Force .dictionary
```

Download the **full English JMdict JSON** from the jmdict-simplified releases
listed in [PIPELINE.md](PIPELINE.md), unpack it, and place it at
`.dictionary/jmdict-eng.json`. The bundled browser dictionary shards are for
lookups; the pipeline needs this separate full input file.

Configure a provider key as described above, then run:

```bash
npm run transcribe -- "https://youtu.be/VIDEO_ID"
```

Replace `VIDEO_ID` with a real video ID or paste a full YouTube link.

- Uploaded Japanese subtitles are used directly, preserving author timings and
  wording and skipping ASR and Japanese correction.
- With only automatic captions or no Japanese captions, the pipeline runs
  **large-v3-turbo locally on CPU**, then compares wording with the configured
  language model. The first ASR run downloads the model to `.asr-models/`.
- It generates English translations and vocabulary, then adds the completed
  lesson to **影片收藏**. Refresh the app to see it.

Click a subtitle word to automatically save it; remove an accidental star in
the popup. Click a passage to replay it. You can switch between embedded YouTube
playback and the locally downloaded audio.

Output stays in `artifacts/<video-id>/`. Rerun the same command after a temporary
failure to reuse completed checkpoints. To regenerate only English translations:

```bash
npm run translate -- VIDEO_ID
```

See [PIPELINE.md](PIPELINE.md) for model settings, caching, and output files.

## 5. Build or host the app

Desktop production build:

```bash
npm run build
npm run preview
```

Phone PWA package (requires Python 3 for ZIP creation):

```bash
npm run package:mobile
```

Upload **`artifacts/mobile/komorebi-mobile.zip`** to Cloudflare Pages using
Direct Upload. Open the deployed HTTPS URL in iPhone Safari, add it to the home
screen, then sign in to your sync account. The mobile package contains review,
dictionary, and sync features; it does not contain videos, ASR models, or private
pipeline keys. Follow [MOBILE_SETUP.md](MOBILE_SETUP.md) for the complete walkthrough.

If Windows has `py` but no `python3` command, package it with:

```powershell
npm run build:mobile
py -3 scripts/package-mobile.py
```

`.env` settings are embedded **at build time**. After changing Supabase settings,
rebuild and redeploy; changing Cloudflare's environment variables does not modify
a ZIP already built on your computer. For subsequent releases, upload a new ZIP
to the same Pages project.

## Development checks

```bash
npm test
npm run test:pipeline
npm run build
npm run package:mobile
npm run test:mobile-build
```

`test:pipeline` requires Python 3. Tests use mock providers rather than live API
calls. Tests for the original local video fixtures are explicitly skipped in a
fresh clone; logic, mobile UI, mock sync, and SQL permission tests still run.

## Data and attribution

This repository includes source code, SQL, configuration templates, documentation,
and the licensed browser dictionary shards. It excludes `.env`, downloaded audio
and subtitles, generated video indexes, models, Python environments, deployment
ZIPs, and builds. On another computer, import videos again or transfer their local
files and generated indexes; restore vocabulary from Supabase or a JSON backup.

JMdict is provided by EDRDG under CC BY-SA 4.0. Dictionary examples are from
Tatoeba contributors under CC BY 2.0. See [DICTIONARY-SOURCES.md](DICTIONARY-SOURCES.md).

Further reading: [review algorithm](REVIEW_ALGORITHM.md),
[custom words and examples](STUDY_DICTIONARY.md),
[future improvements](FUTURE_IMPROVEMENTS.md).
