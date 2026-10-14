import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // Ketcher reads Node's `global` when it creates its store, and its `util` polyfill reads
  // process.env.NODE_DEBUG at load time.
  define: { global: "globalThis", "process.env.NODE_DEBUG": "undefined" },
  // ketcher-core imports Node's `events`. A bare "events" is treated as a Node built-in and stubbed
  // out in dev, so point it at the browser implementation explicitly.
  resolve: { alias: { events: "events/events.js" } },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // 3. tell Vite to ignore watching `src-tauri`
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // The structure editor (Ketcher with Indigo inlined, about 29 MB), Mol* (about 3 MB) and ECharts
  // (about 580 kB) are separate chunks loaded on demand from local files. Startup only loads the
  // main bundle (about 420 kB), so the limit is set above the editor chunk.
  build: { chunkSizeWarningLimit: 30000 },
  test: { environment: "jsdom" },
}));
