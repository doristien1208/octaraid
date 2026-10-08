# 八方討伐

FF14 風格的 3D 網頁團隊討伐戰，給同事在公司區網一起玩：輸入暱稱後建立房間或用邀請碼加入，在待機室選職業（2 坦 2 補 4 DPS，每職 5 個技能加全隊共用的極限技）、從 8 個「副本 + 難度」中投票，出發後閃避並處理 Boss 機制，在狂暴前把王打倒。每房 1–8 人，數值以平常的 3–4 人為基準，任何一場最長 8 分鐘。

企劃書：<https://claude.ai/code/artifact/dd4ddb06-eea7-4b00-b1e9-02e6bc31219c>

目前進度：M1（專案骨架）完成——邀請碼房間、待機室（職業、投票、準備、聊天）、4 個副本的 3D 場地、移動與連線、離線練習。技能與戰鬥在 M2 加入；角色模型暫時用程式產生，CC0 素材下載後替換。

## 環境

Node.js 22.18.0（與測試機相同）。用 nvm 的話，在專案資料夾執行 `nvm use` 會讀 `.nvmrc`。

```bash
npm install
```

## 本機試玩

```bash
npm run build
```

```bash
npm start
```

開 <http://localhost:3100>。同一台電腦開兩個分頁，就能當兩位玩家（每個分頁各自是一位玩家）；第一個分頁建立房間後，按「複製邀請連結」貼到第二個分頁。

離線練習（不用開房）：<http://localhost:3100/?sandbox>

- `boss=0`–`3`：副本（0 崩岩巨像、1 霜冠魔女、2 發條城塞 1F、3 發條城塞 2F）
- `hard`：Hard 難度
- `n=1`–`8`：人數（其他角色由電腦隨意走動）
- `job=`：你的職業（guardian、berserker、priest、warden、brawler、lancer、ranger、sorcerer）

操作：W A S D 移動、滑鼠拖曳轉鏡頭、滾輪縮放、V 切換俯視、Enter 聊天、1–5 技能（M2 開放）、R 極限技（M2 開放）；技能、聊天、俯視等按鍵可在「設定」裡改。

## 開發

```bash
npm run dev
```

伺服器跑在 3100，畫面開 <http://localhost:5174>（Vite，改程式自動重新整理）。

```bash
npm test
```

```bash
npm run typecheck
```

## 部署到測試機

測試機是 Windows，遊戲放在它共享資料夾裡的 `octaraid/`，用 3100 埠，由 Game Hub 啟動與看管。測試機 IP 與共享資料夾路徑記在本機的 `CLAUDE.local.md`（不進 git）。

1. 打包：產出 `release/octaraid-server/`（`dist/`、`start-server.bat`、`open-firewall.bat`、`README-DEPLOY.txt`）與同名 zip

   ```bash
   npm run package
   ```

2. 第一次上線：建立共享資料夾的 `octaraid/`、複製進去、在 Game Hub 的 `hub.config.json` 加一筆設定並放縮圖、在測試機以系統管理員身分執行一次 `open-firewall.bat`（細節見 `deploy/README-DEPLOY.txt`）
3. 之後更新：在 `octaraid/` 放 `maintenance.txt`，等 hub 的 `/api/status` 顯示 `octaraid` 為 `maintenance`，再複製新版、刪掉 `maintenance.txt`

   ```bash
   ditto --norsrc --noextattr --noacl release/octaraid-server /Volumes/<共享資料夾>/octaraid
   ```

4. 同事開 `http://<測試機 IP>:3100`；`/healthz` 可看版本、房間數與線上人數

## 調整數值

| 想改的東西 | 檔案 |
| --- | --- |
| 移動速度、倒數、結算時間、聊天限制 | `shared/constants.ts` 的 `RULES` |
| 職業、技能說明、極限技 | `shared/jobs.ts` |
| 副本、場地大小、目標時長與狂暴時間 | `shared/encounters.ts` |
| 職能上限、Boss 血量權重 | `shared/party.ts` |
| 預設按鍵 | `client/keys.ts` |
| 角色與場地的造型配色 | `client/game/models.ts`、`client/game/arena.ts` |

## 專案結構

```text
shared/   規則常數、職業、副本、投票、邀請碼、通訊協定、戰鬥模擬（前後端共用）
server/   HTTP + WebSocket、房間、待機室與戰鬥迴圈
client/   介面、three.js 3D 畫面、程式產生的模型、音效
tests/    規則、模擬、伺服器整合測試（Vitest）
deploy/   測試機用的 bat 與部署說明
scripts/  建置與打包
```
