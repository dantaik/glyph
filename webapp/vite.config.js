import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import tailwindcss from '@tailwindcss/postcss';

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
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
