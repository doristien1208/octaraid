八方討伐（octaraid）伺服器部署說明
==================================

這個資料夾就是完整的伺服器，不需要 npm install，也不需要 nginx。
遊戲用 TCP 3100 埠；同事用 Chrome 或 Edge 開 http://<測試機 IP>:3100 。

  dist\               遊戲本體（網頁與伺服器）
  start-server.bat    不經 Game Hub 時用來啟動伺服器
  open-firewall.bat   開放防火牆 TCP 3100（第一次用，需要系統管理員）
  README-DEPLOY.txt   本說明
  logs\               執行後自動產生：server.log（伺服器輸出）、launcher.log（start-server.bat 的每一步）


一、需求
--------
- Windows，已安裝 Node.js 22.18.0
  （命令提示字元輸入 node -v，應顯示 v22.18.0）


二、由 Game Hub 啟動（測試機的做法）
------------------------------------
測試機上的遊戲由 Game Hub 啟動與看管，不要再雙擊 start-server.bat（會跟 hub 搶同一個埠）。

第一次上線：
1. 把這個資料夾放到共用資料夾的 octaraid\（與 BnB\ 同層）。
2. 在 hub 的 hub.config.json 的 games 加一筆（dir 依實際位置調整）：
     {
       "id": "octaraid",
       "name": "八方討伐",
       "image": "octaraid.png",
       "desc": "FF14 風格的團隊討伐戰，1–8 人",
       "dir": "../octaraid",
       "command": "node",
       "args": ["dist/server/index.js"],
       "port": 3100,
       "health": "/healthz"
     }
   並把 200×200 的縮圖 octaraid.png 放進 GameHub\assets\。hub 會在約 5 秒後自己重新載入設定，
   不影響其他遊戲。
3. 以系統管理員身分執行一次 open-firewall.bat（hub 的防火牆腳本只開 hub 自己的埠）。
4. 在 hub 入口網站確認「八方討伐」顯示執行中，再從另一台電腦開 http://<IP>:3100/healthz，
   看到 {"ok":true,"version":"0.1.0",...} 就是正常。

之後每次更新：
1. 在這個資料夾放 maintenance.txt（內容會顯示成入口網站的公告）。
2. 等 hub 的 /api/status 顯示 octaraid 為 maintenance（它會等進行中的戰鬥結束，最多 15 分鐘）。
3. 用新版覆蓋這個資料夾。
4. 刪掉 maintenance.txt，hub 會啟動新版。


三、不經 Game Hub 單獨執行
--------------------------
1. 在 open-firewall.bat 上按右鍵，選「以系統管理員身分執行」，看到 Done 就完成（只要做一次）。
2. 雙擊 start-server.bat。
3. 視窗出現下列文字就代表啟動成功：
     八方討伐伺服器已啟動（Node v22.18.0）
       同事：http://<這台電腦的 IP>:3100
4. 換埠：執行 start-server.bat 8080，並用系統管理員身分執行一次 open-firewall.bat 8080。
請不要修改兩個 bat 檔的編碼；它們刻意只用英文字元，任何編碼存檔都一樣。


四、問題排除
------------
- 先看 logs\server.log（由 hub 啟動時，hub 自己的 logs\octaraid.log 也有主控台輸出）。
- 同事連不上：
  1. 先在伺服器本機開 http://localhost:3100/healthz 確認服務有在跑。
  2. 再從同事電腦開 http://<IP>:3100/healthz；本機可以、同事不行，通常是防火牆沒開，
     請用系統管理員身分執行 open-firewall.bat，或請 IT 開放 TCP 3100。
- 3D 畫面出不來：瀏覽器要能用 WebGL2（Chrome、Edge 新版都可以）；畫面卡頓時在遊戲的「設定」把畫質調低。
- 遊戲畫面一直顯示「連線中」：確認網址的 IP 與埠正確，且中間沒有會擋 WebSocket 的代理伺服器。
