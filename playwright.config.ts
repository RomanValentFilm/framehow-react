// THE SIMULATOR (#309).
//
// Starts the app and a LOCAL worker with a LOCAL database, then runs the tests
// in two real browser engines. Nothing here can touch the real server or the real
// D1: `wrangler dev --local` keeps everything in a folder under backend/.
//
//   npm run e2e          all of it, headless
//   npm run e2e:webkit   only WebKit — the engine the iPad actually runs
//   npm run e2e:watch    with the Playwright inspector, to watch it happen
//
// The two projects are the two engines, not the two devices: every test opens its
// own pair of devices inside whichever engine it is running in. So the whole
// suite runs twice, once in Chromium (the desktop's engine) and once in WebKit
// (Safari's) — which is where iOS behaves differently.

import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 5173;
const API_PORT = 8787;

export default defineConfig({
  testDir: './e2e',
  // These tests wait for real timers — the 3-second connection watch, the
  // 5-second heartbeat, the 2-second local save. Generous, on purpose.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // One at a time: two devices in one test already share a server, and running
  // several tests at once makes a log impossible to read.
  workers: 1,
  fullyParallel: false,
  // 'list' prints each test as it starts and finishes; the steps inside print
  // themselves as they go (see say() in the harness), so the terminal is never
  // silent for more than a few seconds.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  retries: 0,
  // Stop after three failures. When the harness itself is wrong every test fails
  // the same way, and waiting out six of them teaches nothing.
  maxFailures: 3,

  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  webServer: [
    {
      // The real worker, the real routes, a local database of its own.
      command: 'npm run dev:local --prefix backend',
      port: API_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The real app, pointed at that worker.
      command: `VITE_API_BASE_URL=http://127.0.0.1:${API_PORT} npm run dev -- --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
