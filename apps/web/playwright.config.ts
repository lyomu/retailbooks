import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/reference-capture.spec.ts',
  outputDir: './test-results',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3300',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true },
    },
  ],
  webServer: [
    {
      command:
        'npm run e2e:prepare --workspace @retailbooks/web && npm run start --workspace @retailbooks/api',
      url: 'http://127.0.0.1:3401/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      cwd: '../..',
      env: {
        ...process.env,
        API_PORT: '3401',
        DATABASE_URL: 'postgresql://retailbooks:retailbooks@localhost:55432/retailbooks_e2e',
        NODE_ENV: 'test',
        QUEUE_PREFIX: 'retailbooks-e2e',
        WEB_APP_URL: 'http://127.0.0.1:3300',
      },
    },
    {
      command:
        'npm run build --workspace @retailbooks/web && npm run start --workspace @retailbooks/web -- --hostname 127.0.0.1 --port 3300',
      url: 'http://127.0.0.1:3300/login',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      cwd: '../..',
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3401',
      },
    },
  ],
});
