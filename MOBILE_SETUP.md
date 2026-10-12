# 手機複習、Supabase 同步與 Cloudflare 部署

手機版是獨立 PWA：翻字卡、日英例句、裝置朗讀、收藏與自訂單字。
與電腦版共用熟悉度演算法。手機部署包沒有影片、轉錄模型或 pipeline API key。

**不必先上傳單字才能部署。** 建議順序為：建立 Supabase → 設定兩端 →
電腦登入並同步現有收藏 → 部署手機版 → 手機登入相同帳號。
沒有 Supabase 時也能部署，並用「收藏 → 還原備份」匯入電腦匯出的 JSON，
但這時兩端不會自動同步。

## 1. 建立免費 Supabase 專案

1. 到 <https://supabase.com/dashboard> 建立 Free 專案，選擇適合你的資料中心。
2. 開啟 **SQL Editor → New query**，貼上本專案
   [`supabase/study-sync.sql`](supabase/study-sync.sql) 的全部內容，按 Run。
3. 在 **Authentication → Users → Add user → Create new user** 建立自己的
   電子郵件／密碼帳號，勾選確認電子郵件（Auto Confirm User；若介面名稱不同，
   確保帳號已確認）。App 第一版提供登入，沒有公開註冊介面。
4. 在專案設定／Connect 對話框找到 **Project URL**，以及
   **API Keys → Publishable key**。舊專案的 `anon` key 也可使用。

SQL 建立 `study_libraries` 表，每個登入帳號只有自己的一列：

| 欄位 | 內容 |
| --- | --- |
| `user_id` | 登入帳號 ID |
| `document` | 單字庫 JSON，包括意思、例句、評分紀錄與熟悉度 |
| `revision` | 版本號，防止兩台裝置互相覆蓋 |
| `updated_at` | 最近一次成功寫入時間 |

RLS 限制只能讀取自己的資料，寫入透過檢查登入帳號與版本號的 RPC。
這些設定依據 [Supabase RLS 文件](https://supabase.com/docs/guides/database/postgres/row-level-security)。

目前以個人使用為目標：一份 JSON 最多 10,000 詞／5 MB。現有收藏不需要
手動拆資料表，也不需要上傳全字典。若未來規模超過限制，再改成逐詞資料表。

## 2. 設定本地 App

在**專案根目錄現有的 `.env`** 最後加入兩行，不要覆蓋轉錄用的其他設定：

```dotenv
VITE_SUPABASE_URL=https://你的專案.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=你的publishable_key
```

可參考 [`.env.mobile.example`](.env.mobile.example)。使用舊 `anon` key 時，
第二行可改成 `VITE_SUPABASE_ANON_KEY=...`。
這是會出現在前端的**公開金鑰**，不能填 secret 或 `service_role` key；
資料存取由登入與 RLS 控制。轉錄用的 Gemini／Groq key 不使用 `VITE_` 前綴。

設定後**重新啟動**電腦版：

```bash
npm run dev
```

用原本收藏所在的瀏覽器與相同網址／port 開啟電腦版，展開頂端「雲端同步」，
登入剛建立的帳號。首次登入會合併現有本地與雲端收藏，不會以空雲端清空本地。
看到「已同步」後，可在 Supabase Table Editor 確認自己的資料列。
首次操作前可在「單字複習 → 單字收藏 → 下載備份」保留一份 JSON。

## 3. 查看手機介面

```bash
npm run dev:mobile
```

電腦開啟終端顯示的網址。在同一 Wi-Fi 的 iPhone 可開啟電腦的區域網路 IP
及相同 port，例如 `http://192.168.1.20:5173`。若 5173 已被電腦版占用，
Vite 會使用下一個 port，請以終端輸出為準。
這適合預覽介面；完整離線／主畫面安裝請使用部署後的 HTTPS 網址。

正式建置與本地預覽：

```bash
npm run build:mobile
npm run preview:mobile
```

產物是 `dist-mobile/`，不是原本包含影片的 `dist/`。
手機介面從左上角選單切換「複習／收藏／同步」。開始練習後隱藏標題與數量設定，
字卡翻面後固定單字與評分按鈕，中間解釋／例句可捲動。未設定雲端時，仍可匯入備份和複習。
點開收藏中的多音字會按讀音顯示字典解釋，選「收藏此讀音」可更新原卡片的讀音與意思。
選擇會與雲端同步，原例句與學習紀錄保留；未快取的其他讀音需要連線載入字典。

## 4. 部署到 Cloudflare Pages

最直接的方法是 **Direct Upload**，目前不需要 Git repository。

1. 在設定好 `.env` 後執行 `npm run build:mobile`。
2. 登入 <https://dash.cloudflare.com>，進入 **Workers & Pages**。
3. 選 **Create application → Pages → Upload assets／Drag and drop**
   （介面可能顯示 Get started）。這裡選 Pages 的靜態上傳。
4. 輸入專案名稱，例如 `komorebi-review`，上傳整個 `dist-mobile/` 資料夾。
5. 按 Deploy，取得 Cloudflare 顯示的 `https://你的名稱.pages.dev` 網址。

也可以產生 ZIP 後上傳：

```bash
npm run package:mobile
```

輸出 `artifacts/mobile/komorebi-mobile.zip`，ZIP 根目錄直接包含 `index.html`。

Cloudflare 上傳的是已編譯產物，所以本機 `.env` 的兩個公開設定已加入程式。
**Direct Upload 的後台環境變數不會重新改寫已編譯的檔案**；設定有變更時，
請本地重新建置並上傳。不要上傳 `.env`、整個專案或影片 artifacts。

若偏好命令列，依 [Cloudflare Direct Upload 文件](https://developers.cloudflare.com/pages/get-started/direct-upload/)：

```bash
npx wrangler login
npx wrangler pages project create komorebi-review --production-branch main
npx wrangler pages deploy dist-mobile --project-name komorebi-review --branch main
```

名稱若被占用請替換；Direct Upload 專案日後不能直接切換成 Git integration，
想用 Git 自動部署需另建專案。後續更新可用同樣的 deploy 指令或後台
Create a new deployment，上傳新的 `dist-mobile/`。

本產物約 270 個檔案；字典約 94 MB，已拆成 256 個小檔，首屏不載入全部字典。
符合 Pages 拖曳上傳 1,000 檔、單檔 25 MiB 的
[限制](https://developers.cloudflare.com/pages/get-started/direct-upload/#limits)。

## 5. iPhone 安裝與首次同步

1. **Safari** 開啟部署後的網址。
2. 點分享 → 加入主畫面；如有「作為網頁 App 開啟」選項，將它打開。
3. 從主畫面圖示開啟，進入「同步」，登入電腦使用的同一個帳號。
4. 等到「已同步」，到「收藏」確認單字，再選擇複習數量。
5. 手機評分後等到「已同步」，回到電腦並按「立即同步」，確認熟悉度更新。

Safari 分頁與主畫面 App 的本地資料／登入狀態可能分開；以你平常使用的
主畫面 App 為準，必要時再登入一次。[Apple 安裝說明](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)。

## 同步與離線的實際行為

- 變更後約一秒嘗試同步；開啟 App、回到前景、恢復網路或按「立即同步」也會同步。
  在前景每 30 秒拉取雲端變更。未實作關閉 App 後持續背景同步。
- 每次新評分有 UUID、時間與當時的日期，兩端的練習紀錄合併後重新計算熟悉度。
  以同一 ID 重送不會重複算分。首次版本**仍保留既有完整紀錄**，尚未自動彙整舊紀錄；
  之後加入壓縮時需保留可重建狀態的基準，不直接刪除歷史。
- 使用雲端版本號及原子寫入；另一台剛更新時重新合併。同步途中產生的新本地操作
  也保留，待下次同步。兩端離線評分均保留；時間相同時用紀錄 ID 固定排序。
- 收藏星號及自訂例句使用上次同步資料做三方合併；未變更的本地欄位不覆蓋
  雲端修改。雙方同时修改同一個意思／星號時，後成功提交的修改優先。
  兩台的待練清單會合併並依現有位置排序；評分完成的詞不會再加入今天候選。
- 還原備份會替換本地收藏，但啟用同步後會與雲端**合併**。缺少的詞不視為
  雲端刪除；不想學的詞請取消星號。第一版沒有雲端整庫刪除功能。
- 一個瀏覽器的收藏綁定第一次同步的帳號，避免之後登入別的帳號誤上傳。
  登出保留本地收藏，私人裝置以外請勿使用。
- 第一次連線開啟部署後的 App 會快取介面。單字與評分儲存在本地；影片例句、
  自訂例句隨卡片保存。**字典例句需先連線載入過**才有對應分片的離線快取。
  系統若清除網站儲存資料，需重新同步／載入。完整字典不自動下載。
- 朗讀用裝置日文語音，實際發音與離線可用性要在 iPhone 驗證，沒有付費 TTS。
  第一版不提供背景／鎖定畫面持續朗讀。

## 費用與驗證

Supabase Free 目前含 500 MB 資料庫、5 GB 月流出流量，个人規模預期足夠。
活動不足七天可能暫停，需到 Dashboard 恢復；離線收藏仍可複習。
[額度](https://supabase.com/docs/guides/platform/billing-on-supabase)、[暫停政策](https://supabase.com/docs/guides/platform/free-project-pausing)。

已以本地 PostgreSQL 引擎測試 SQL 的 RLS 帳號隔離、未登入拒絕、直接寫入拒絕
及版本衝突；並測試跨裝置紀錄合併、重送、同步中本地變更、手機 UI 與離線快取。
尚未連到你的 Supabase 專案，也未部署到你的 Cloudflare 帳號。
設定好服務後，請實際做一次「電腦新增 → 手機取得 → 手機評分 → 電腦更新」。
