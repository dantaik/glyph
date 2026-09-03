// vitest.config.js — unit tests. Kept apart from vite.config.js on purpose:
// the app build carries WASM, single-file and Tailwind plugins that have no
// business in a unit run, and the offline build's define()s have to exist
// here too (src/lib/offline.js reads them at module scope, no fallback).
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __GLYPH_OFFLINE_BUILD__: 'false',
    __GLYPH_OFFLINE_FILE__: JSON.stringify('glyph.html'),
  },
  test: {
    // Node by default; a file that needs the DOM (localStorage, React) says
    // so with `// @vitest-environment jsdom` at its top.
    environment: 'node',
    include: ['test/unit/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
