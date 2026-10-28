# Labu 玩具城市大富翁 🎲

48 格 3D 玩具城市大富翁，支援 2–4 位玩家、本機同桌與本機多人房間，空位由 NPC 補齊。此儲存庫供學生學習網頁遊戲和 M5Stack 感測器整合。

## 啟動

需要 Node.js 22.13 以上（測試使用 `node:sqlite`）、npm 與支援 WebGL 的瀏覽器。

```bash
npm ci
npm run dev
```

開啟終端機顯示的網址即可玩本機同桌。要使用本機多人房間，另開一個終端機執行 `npm run rooms`；服務預設只在本機監聽。另可 `npm run build` 後執行 `npm run play` 啟動建置版及房間服務。

```bash
npm test            # 規則和伺服器單元測試
npm run build       # TypeScript 檢查與網頁建置
npm run test:e2e    # Playwright 瀏覽器測試，需安裝 Chrome
```

遊戲功能與規則參見[遊玩說明書](docs/PLAYER_GUIDE.md)。Labu 使用內建回覆，不需要 API 金鑰。此版本不包含正式網站的代管設定或資料庫；本機多人房間不等於可供網際網路公開使用的正式伺服器。

新遊戲預設 20 輪，每位玩家持有 1,000 萬元現金和 200 萬元存款；開局時可選其他輪數。

## 學生專題：搖動 M5Stack 擲骰

目標是用 M5Stack 的加速度感測器辨識搖動，讓遊戲執行一次擲骰。**目前尚未接上硬體**；作業分解、建議架構和驗收條件見 [M5Stack 整合指南](docs/M5STACK_DICE.md)。

## 主要程式

- `src/main.ts`：畫面、玩家操作與房間客戶端。
- `src/engine.ts`、`src/game-types.ts`：遊戲狀態、骰子和規則。
- `src/city.ts`、`src/model-assets.ts`：3D 城市與模型。
- `src/network.ts`、`server/room-server.ts`：本機多人連線。
- `server/hosted-rooms.ts`：代管版房間規則，需另行提供相容資料庫與部署設定。
- `src/**/*.test.ts`、`server/**/*.test.ts`、`tests/`：自動化測試。

## 素材與授權

專案含遊戲模型、圖像與音樂，公開儲存庫並不自動代表第三方素材可自由再利用；請在課堂以外散布前確認各項素材權利。此儲存庫尚未指定開源授權條款。
