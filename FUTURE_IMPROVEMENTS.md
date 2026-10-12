# Future improvements

## 手機複習與雲端同步後續

已完成手機 PWA、Supabase 登入與收藏／進度同步、離線介面快取。
設定與 Cloudflare 部署見 [MOBILE_SETUP.md](MOBILE_SETUP.md)。
後續：在真實 iPhone 驗證朗讀與離線體驗；將舊練習紀錄彙整成可重建的
狀態基準；大量詞彙時改為逐詞同步與 IndexedDB；有需要時再做原生 iOS App。
目前仍保留歷史紀錄，尚未自動彙整；手機背景關閉時不執行同步。

## 自然切句與字幕時間對齊

依 [自然切句設計](SUBTITLE_SEGMENTATION.md) 在日文校正後加入切句階段，
分開完整語意句子與畫面顯示段落。結合標點、形態分析及音訊停頓，並以
音訊時間錨點／日文對齊模型定位新的邊界；不逐一硬編碼時間點合併，也不
把 YouTube 顯示區塊直接當作句子。先以 0:50–1:20 驗證，再套用全文。

## 自訂單詞與片語學習

已完成「自己新增單字」：查詢完整 JMdict、選擇詞義，或自行填寫單字／片語、
讀音與意思。可直接輸入或上傳 JSON／TSV 例句，並沿用星號收藏、熟悉度排序、
播放清單複習、朗讀與備份。JMdict 附例句版提供日英 Tatoeba 例句。
例如「なんですね」可自行建立片語卡，不必新增自動切詞規則。
後續可補充已收藏詞條的讀音／意思編輯介面；現在可新增與刪除自訂例句。

## JLPT N5～N1 單字程度標記

評估具有可使用授權的 JLPT 單字分級資料，按字典原形、讀音及必要的義項
對應到目前 JMdict 詞條。在查詞視窗與複習卡顯示 N5～N1 標記，之後可按
程度篩選收藏。

保留分級來源與版本，確認資料是官方資訊還是第三方整理的參考分級。
沒有資料的詞顯示未分級；來源有歧義時不靠字長、漢字或模型猜出級別。
這是額外的資料層，不能把目前 JMdict 的常用詞標記直接當作 JLPT 程度。
目前僅記錄為後續改善，尚未安裝分級資料。

## English translations for newly imported videos

The current video has saved contextual English translations for all 284 Japanese
cues. Add an import-time translation stage after Japanese correction, using
neighboring cues to form sentences, persisting translations against exact
Japanese wording and timings, and caching completed batches. Keep playback
free of translation API calls. The current uploaded English captions are sparse,
so timestamp overlap alone is not a reliable complete translation pipeline.
Changing a sentence's Japanese source should invalidate its English translation;
do not reuse old English merely because a cue number stayed the same.

## Broader grammar-aware selection

Prioritize dictionary-backed lexical selection and tested suru compounds in
`scripts/grammar.mjs`. Leave explanatory endings such as `なんですね` to
user-created phrase cards rather than reintroducing special grouping.
Keep phrase-level selection,
component explanations and lexical dictionary meanings distinct. If a local
language model is evaluated for ambiguous import-time cases, cache annotations
and compare accuracy against the deterministic baseline; do not add a paid API
call to each word click. Provide a deliberate migration flow for old saved
fragments if needed, preserving their review history.

## Review audio, examples and persistence

The review page now supports Japanese browser speech when a Japanese voice is
available. Add a reliable voice installation/download flow or licensed recorded
pronunciation for devices that lack a Japanese voice. For a native iOS client,
evaluate AVSpeechSynthesizer and persist the study library in device storage.
The current JMdict extract has meanings but no audio or examples; review cards
use saved source-video subtitles as examples. Consider an attributed Japanese
example-sentence dataset with dictionary-form matching and audio.

Collections and FSRS progress currently live in browser localStorage with JSON
backup/restore. Add cross-device synchronization when needed, keeping stable
dictionary-form/reading identities across imported videos. After enough review
history is available, evaluate FSRS parameter fitting and refine the initial
one-minute/ten-minute same-day policy using actual recall results. Do not claim
that the default 90% retention target is measured user accuracy.

## Add a YouTube video inside the App

Add a place to paste a YouTube URL and start importing the next video without
running a terminal command. Display download, independent transcription, and
contextual comparison progress, then automatically open the completed video
with the selected subtitles and refreshed word lookups.

Use the same pipeline and video-ID folders as the CLI. Reuse completed work
when a link is added again; keep raw captions and comparison records. A failure
should show a retry action and keep the previous working video available.
The user should not need to choose between caption versions or approve changes.

This needs a local backend or worker: CPU transcription and API credentials
belong there, outside the browser/iOS bundle. The current React prototype stays
as the player; this import UI and a native iOS client are future work.

## Use audio evidence when caption candidates disagree

Experiment on disagreeing clips with an independent Japanese acoustic model:
score how well each candidate's pronunciation matches the same audio. Compare
length-normalized scores, use the margin as supporting evidence, and send both
scores plus context to the language-model judge. Scores need calibration on
listened examples; a successful forced alignment alone does not prove a caption
is correct. Homophones such as 大家 / 大屋 still need contextual judgment.

Other supporting signals: a third independent recognizer on disputed clips,
ASR word probabilities, and dictionary checks for suspicious spelling. Do not
blindly compare confidence values from different recognizers or automatically
discard words just because JMdict does not contain them. Proper names, slang,
and colloquial speech may be valid. The pipeline should continue to make and
adopt its best decision automatically, rather than asking the user to choose.

## Reduce comparison usage

The [first-minute live experiment](artifacts/TE2mcomyNH8/first-minute/provider-comparison/analysis.md)
found that Groq kept 15/20 ASR cues and Gemini kept 16/20, with conflicting edits
to fillers and particles. These are choice counts, not measured accuracy.
Consider an ASR-only baseline for personal use if the user chooses that policy;
do not infer that comparison never helps from a single minute. If retaining
comparison, align both transcripts and send only differences with enough
context, then cache decisions. Never automatically upgrade billing when the
free quota runs out; retain progress and resume later.
