// End-to-end tests: drive the real game in Chromium (WebGL via SwiftShader in CI).
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 7788);

export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  expect: { timeout: 20000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1366, height: 768 },
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node server/index.js --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
