// playwright.config.js — the browser tests: the built app (dist/) served
// over HTTP, a mock JSON-RPC node for both chains, Chromium.
//
//   npm run build && npm run test:e2e
//
// PW_CHROMIUM=/path/to/chromium uses a browser already on the machine
// instead of Playwright's own download.
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const RPC_PORT = 8545;

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /.*\.spec\.js/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `node test/e2e/serve.mjs ${PORT}`,
      url: `http://127.0.0.1:${PORT}/__health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `node test/e2e/rpcServer.mjs ${RPC_PORT}`,
      url: `http://127.0.0.1:${RPC_PORT}/__health`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
