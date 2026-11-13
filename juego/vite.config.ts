import { defineConfig } from 'vite';

// El juego lee los YAML de ../mundo/datos y ../config (una sola fuente de verdad), por eso se abre
// el acceso al directorio padre. El mundo (FastAPI) escucha en 8765; en Fase 1 puede no existir.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8765', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true, changeOrigin: true },
    },
  },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 },
});
