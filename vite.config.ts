import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: './',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    target: 'es2022',
    // three.js alone is about 700 kB; the game is loaded once over the office network
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // 5173 is 水球大亂鬥's; both can run side by side
    port: 5174,
    // The game server runs on 3100 during development; the browser only talks to Vite.
    proxy: { '/ws': { target: 'ws://localhost:3100', ws: true } },
  },
});
