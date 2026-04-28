import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4174',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
