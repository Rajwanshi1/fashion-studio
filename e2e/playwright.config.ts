import { defineConfig, devices } from '@playwright/test';

// Prerequisites (started by the runner, see README):
//   docker compose up -d --build   -> API on :3001 (fresh seeded DB)
//   frontend: npm run build && npm run preview -- --port 4173
//   admin:    npm run build && npm run preview -- --port 4174
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1, // ordered flows share backend state
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Mobile runs only the core purchase journey (spec 1), tagged @mobile.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
