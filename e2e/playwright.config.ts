import { defineConfig, devices } from '@playwright/test'
import { ADMIN_UID, AUTH_EMULATOR_URL, FIREBASE_PROJECT_ID, WEB_URL, WORKER_URL } from './env'

const CI = process.env.CI !== undefined && process.env.CI !== ''

// Run in review and on `main` only (ARCHITECTURE A7). Real timers: the 3-minute round and the
// 31 s disconnect are wall clock, so one worker runs the specs one after another and the
// latency numbers are not disturbed by other tests.
export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    // PL/EN is picked from the browser language (FR-019); the specs read the English texts.
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // FR-020, NFR-003: the 360 px layout, audited by axe and used for single play.
      name: 'mobile',
      testMatch: ['a11y.spec.ts', 'single-play.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 640 } },
    },
    {
      name: 'desktop',
      testIgnore: ['a11y.spec.ts', 'single-play.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      // Firebase Auth emulator (PRD §20 #35): no real account, no email, no quota.
      command: 'pnpm dev:auth',
      cwd: '..',
      port: Number(new URL(AUTH_EMULATOR_URL).port),
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      // Emulator tokens are unsigned, so this Worker needs the flag. It is set here on the
      // command line only, never in wrangler.toml (decision 35, NFR-004).
      command: [
        'pnpm --filter @fm/worker exec wrangler dev',
        `--port ${new URL(WORKER_URL).port}`,
        `--var FIREBASE_PROJECT_ID:${FIREBASE_PROJECT_ID}`,
        '--var AUTH_EMULATOR:true',
        `--var ADMIN_UIDS:${ADMIN_UID}`,
      ].join(' '),
      cwd: '..',
      port: Number(new URL(WORKER_URL).port),
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      // The Vite dev server, not `vite preview`: the emulator hook in `web/auth/firebase.ts`
      // exists only in dev builds (`import.meta.env.DEV`). Spec 06 deviation, see its log.
      command: 'pnpm --filter @fm/web exec vite --host localhost --port 5173 --strictPort',
      cwd: '..',
      url: WEB_URL,
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: {
        VITE_FIREBASE_API_KEY: 'demo-key',
        VITE_FIREBASE_PROJECT_ID: FIREBASE_PROJECT_ID,
        VITE_AUTH_EMULATOR_URL: AUTH_EMULATOR_URL,
        VITE_WORKER_URL: WORKER_URL,
      },
    },
  ],
})
