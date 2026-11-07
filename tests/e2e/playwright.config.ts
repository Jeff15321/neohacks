import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  retries: 0,
  workers: 1,                       // single browser profile, keep serial
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -w apps/backend',
    cwd: '../..',
    url: 'http://127.0.0.1:8787/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LLM_PROVIDER: 'mock',
      BACKEND_PORT: '8787',
      EXTENSION_AUTH_TOKEN: 'dev-token-change-me',
    },
  },
});
