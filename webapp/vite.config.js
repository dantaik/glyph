import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tailwindcss from '@tailwindcss/postcss';

export default defineConfig({
  plugins: [
    react(),
    // brotli-wasm locates its .wasm via import.meta.url; vite-plugin-wasm
    // rewrites that URL, and brotli-wasm's init is a top-level await.
    wasm(),
    topLevelAwait(),
  ],
  // brotli-wasm locates its .wasm via import.meta.url; keep it out of the
  // dep optimizer so vite-plugin-wasm transforms that URL instead of the
  // prebundled copy 404ing into the SPA fallback.
  optimizeDeps: {
    exclude: ['brotli-wasm'],
  },
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  // brotli-wasm uses top-level await for WASM init
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
});
