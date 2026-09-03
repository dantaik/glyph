// vitest.config.js — unit tests. Kept apart from vite.config.js on purpose:
// the app build carries WASM and Tailwind plugins that have no business in
// a unit run.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default; a file that needs the DOM (localStorage, React) says
    // so with `// @vitest-environment jsdom` at its top.
    environment: 'node',
    include: ['test/unit/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
});
