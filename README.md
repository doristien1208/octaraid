# 八方討伐

FF14 風格的 3D 網頁團隊討伐戰，給同事在公司區網一起玩：輸入暱稱後建立房間或用邀請碼加入，在待機室選職業（2 坦 2 補 4 DPS，每職 5 個技能加全隊共用的極限技）、從 8 個「副本 + 難度」中投票，出發後閃避並處理 Boss 機制，在狂暴前把王打倒。每房 1–8 人，數值以平常的 3–4 人為基準，任何一場最長 8 分鐘。

企劃書：<https://claude.ai/code/artifact/dd4ddb06-eea7-4b00-b1e9-02e6bc31219c>

目前進度：M3 完成——第一個 Boss「崩岩巨像」（Normal / Hard，三個階段，中間要先打倒兩隻岩巨兵），以及共用的機制引擎：時間軸、地面預兆（圓形、月環、扇形、直線、分散、分攤、擊退、死刑標記）、岩牢、小怪、失誤懲罰與零失誤的極限技加成。戰鬥核心（M2）：8 個職業的技能、GCD、冷卻、詠唱與滑步、仇恨、傷害與減傷、護盾、死亡與復活、極限技、缺角補正與超越之力。其他三個副本在 M4 加入，這一版還是訓練木人。角色用 CC0 的 KayKit 模型（見 [CREDITS.md](CREDITS.md)）。

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
- `n=1`–`8`：人數（其他職業由電腦隊友擔任，會自己走位、出招、補血與復活）
- `job=`：你的職業（guardian、berserker、priest、warden、brawler、lancer、ranger、sorcerer）
- `dummy`：打訓練木人，不打副本的 Boss
- `calm`：打不會攻擊的木人，用來量輸出
- `lb`：開戰時極限技量表就是滿的
- `skip=90`：前 90 秒由電腦代打你的角色，之後交給你（練後面的段落）
- `until=岩牢`：同上，代打到 Boss 開始詠唱這一招為止（招式名稱照讀條寫）
- `gallery`：8 個職業排成一排面向鏡頭，用來比對造型

操作：

| 動作 | 按鍵 |
| --- | --- |
| 移動 | W A S D、方向鍵（以鏡頭方向為準） |
| 轉鏡頭 / 縮放 | 滑鼠拖曳 / 滾輪；V 切換俯視 |
| 技能 1–5 | 1–5（按住 1 會一直接著打） |
| 極限技 | R（量表滿時） |
| 選敵人 | Tab（再按換下一個）、點敵人 |
| 選隊友 | F1–F8、點隊伍清單或角色；Esc 取消目標 |
| 聊天 | Enter |

技能、極限技、聊天、俯視等按鍵可在「設定」裡改；設定裡也能關掉「補師單體治療自動選人」。

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
| 移動速度、倒數、結算時間、聊天限制、GCD、暴擊、仇恨倍率、復活與衰弱、LB 累積 | `shared/constants.ts` 的 `RULES` |
| 職業、技能的威力與效果、極限技（`fx` 與說明要一起改） | `shared/jobs.ts` |
| 增益與減益的數值 | `shared/status.ts` |
| Boss 的時間軸、招式、傷害與階段 | `shared/bosses/colossus.ts` |
| 敵人的名稱、目標圈大小與移動速度 | `shared/bosses/foes.ts` |
| 機制怎麼判定（形狀、分攤、擊退、岩牢、小怪） | `shared/sim/boss.ts`、`shared/sim/mech.ts` |
| 失誤懲罰、零失誤的極限技加成 | `shared/constants.ts` 的 `RULES` |
| 訓練木人的普攻、死刑與全場 AoE | `shared/sim/practice.ts` |
| 副本、場地大小、目標時長、狂暴時間、Boss 血量 | `shared/encounters.ts` |
| 職能上限、Boss 血量權重 | `shared/party.ts` |
| 預設按鍵 | `client/keys.ts` |
| 職業的配色、武器與動作 | `client/game/look.ts` |
| 場地造型 | `client/game/arena.ts` |

改了數值就跑一次 `npm test`：`tests/colossus.test.ts` 讓 1–8 人的電腦隊伍打崩岩巨像 Normal 與 Hard（看得懂預兆、會走位），檢查通關率與時間；`tests/balance.test.ts` 讓電腦隊伍打還是木人的副本，印出各職業的每秒傷害。

## 專案結構

```text
shared/   規則常數、職業與技能、狀態、副本、投票、邀請碼、通訊協定、戰鬥模擬與電腦隊友（前後端共用）
server/   HTTP + WebSocket、房間、待機室與戰鬥迴圈
client/   介面、three.js 3D 畫面、角色造型與動作、特效、音效
client/public/models/   CC0 角色、武器與動作（來源見 CREDITS.md）
tests/    規則、戰鬥、平衡模擬、伺服器整合測試（Vitest）
deploy/   測試機用的 bat 與部署說明
scripts/  建置、打包、產生角色模型檔
```
