import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '../shared/constants';
import { createApp } from './app';
import { LOG_FILE, log } from './log';

const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const HOST = process.env.HOST ?? '0.0.0.0';

process.on('uncaughtException', (err) => {
  log(`[錯誤] 伺服器發生未預期的錯誤：${err.stack ?? String(err)}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => log(`[錯誤] 未處理的 Promise 錯誤：${String(err)}`));

// After `npm run build` this file lives in dist/server/ and the client in dist/public/.
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const { server, hub } = createApp(publicDir);

// A host stops the server with SIGTERM before a deploy or a restart (Render gives 30 seconds): tell the
// players first, so the dropped connection is not a mystery. Rooms live in memory and do not survive.
process.on('SIGTERM', () => {
  log('收到 SIGTERM：通知玩家後關閉伺服器');
  hub.notifyAll('伺服器要更新或重新啟動，連線即將中斷，房間不會保留：請稍候 1 分鐘再重新整理頁面');
  setTimeout(() => process.exit(0), 2000);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  log(
    err.code === 'EADDRINUSE'
      ? `[錯誤] 埠 ${PORT} 已經有程式在用，請關掉那個程式，或用 PORT 換一個埠`
      : `[錯誤] 伺服器無法啟動：${err.message}`,
  );
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a!.address}:${PORT}`);
  log(`八方討伐伺服器已啟動（Node ${process.version}）`);
  log(`  本機：http://localhost:${PORT}`);
  for (const url of lan) log(`  同事：${url}`);
  log(`  紀錄檔：${LOG_FILE}`);
});
