import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3030',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm -F @holo/web dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:3030',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5432/holo',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      HOLO_TOKEN_ENCRYPTION_KEY:
        process.env.HOLO_TOKEN_ENCRYPTION_KEY ?? 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk=',
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? 'dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQ=',
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3030',
      GITHUB_LOGIN_CLIENT_ID: 'test-login-cid',
      GITHUB_LOGIN_CLIENT_SECRET: 'test-login-csec',
      GITHUB_CONNECTOR_CLIENT_ID: 'test-conn-cid',
      GITHUB_CONNECTOR_CLIENT_SECRET: 'test-conn-csec',
      EMAIL_PROVIDER: 'console',
      NODE_ENV: 'test',
    },
  },
});
