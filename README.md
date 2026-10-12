# Komorebi（木漏れ日）

日文影片學習與單字 flashcards，使用 React、Vite 和本地 JMdict。
手機版為可加入 iPhone 主畫面的 PWA，可透過 Supabase 同步收藏、例句與學習進度。

## 開始使用

需要 Node.js 22。下載原始碼後：

```bash
npm ci
cp .env.example .env
```

`npm ci` 會初始化空的影片收藏，不會覆蓋已匯入的本地影片。
單字庫保存在瀏覽器；登入雲端帳號或還原 JSON 備份可取得原收藏。

若需要雲端同步，在 `.env` 加入 `.env.mobile.example` 示範的兩個
`VITE_SUPABASE_` 公開設定，並依 [手機與部署教學](MOBILE_SETUP.md)
在 Supabase 建立資料表及登入帳號。Gemini／Groq 私鑰只供本地 pipeline 使用。

```bash
npm run dev
npm run dev:mobile
```

沒有影片時，主程式會顯示單字複習介面。匯入影片後提供影片收藏與字幕學習。

## 功能

- YouTube 播放、本地音訊播放、字幕定位、循環播放與速度調整。
- 日文字幕附英文句子翻譯，點詞自動收藏，可取消星號。
- JMdict 解釋與日英例句，多音字可選擇要學的讀音。
- 手動新增單字、自訂及上傳例句，裝置日文朗讀。
- 按數量選擇熟悉度最低的單字；新收藏不會自動加入練習清單。
- 不熟悉插入後 10 張，普通插入後 20 張，熟悉今天完成。
- 熟悉度考慮當天評分歷程及距上次練習的時間。
- 本地 JSON 備份、跨裝置雲端合併、離線複習。

## 匯入影片

影片處理需要 Python 3.12、本地 Whisper 模型、完整 JMdict 輸入檔及翻譯 API key。
依 [PIPELINE.md](PIPELINE.md) 設定後執行：

```bash
npm run transcribe -- "https://youtu.be/VIDEO_ID"
```

優先使用作者上傳的日文字幕；自動字幕或沒有字幕時使用獨立 ASR 與語言模型比對。
英文翻譯與字典資料完成後，影片才會加入收藏。處理結果保存在本機 `artifacts/`。

## 手機部署

```bash
npm run package:mobile
```

上傳 `artifacts/mobile/komorebi-mobile.zip` 到 Cloudflare Pages，再用 Safari
開啟網址並加入主畫面。詳細步驟見 [MOBILE_SETUP.md](MOBILE_SETUP.md)。
手机版不包含影片、模型或本地 pipeline 私鑰。

## 驗證

```bash
npm test
npm run test:pipeline
npm run build
npm run package:mobile
npm run test:mobile-build
```

純邏輯、手機介面、模擬雲端及 PostgreSQL 權限測試可在新 clone 執行。
依賴原本本地影片的整合測試會在素材未匯入時明確跳過。

## 原始碼與資料

Repository 保留程式碼、SQL、設定範本、文件，以及有授權標示的公開字典分片。
以下檔案留在本機：`.env`、下載音訊／字幕、生成的影片索引、模型、Python runtime、
部署 ZIP、建置目錄及個人資料。換電腦時需重新匯入影片或自行搬移本地素材，
收藏則從 Supabase 或 JSON 備份取得。

JMdict 資料由 EDRDG 提供，採 CC BY-SA 4.0；字典例句來自 Tatoeba contributors，
採 CC BY 2.0。詳見 [DICTIONARY-SOURCES.md](DICTIONARY-SOURCES.md)。

其他說明：[複習演算法](REVIEW_ALGORITHM.md)、[單字與例句](STUDY_DICTIONARY.md)、
[未來改善](FUTURE_IMPROVEMENTS.md)。
