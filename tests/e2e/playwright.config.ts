import { defineConfig } from '@playwright/test';

const PORT = process.env.E2E_PORT ?? '8787';

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  retries: 0,
  workers: 1,                       // single browser profile, keep serial
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: { trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run start -w apps/backend',
    cwd: '../..',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      LLM_PROVIDER: 'mock',
      BACKEND_PORT: PORT,
      EXTENSION_AUTH_TOKEN: 'dev-token-change-me',
      DATA_DB_PATH: ':memory:',
      LOG_LEVEL: 'warn',
    },
  },
});
