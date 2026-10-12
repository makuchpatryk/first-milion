// Addresses and ids shared by `playwright.config.ts` and the fixtures. The origin must equal
// `ALLOWED_ORIGINS` in packages/worker/wrangler.toml, or the Worker answers 403 (FR-007).
export const WEB_URL = 'http://localhost:5173'
export const WORKER_URL = 'http://127.0.0.1:8787'
export const AUTH_EMULATOR_URL = 'http://127.0.0.1:9099'
export const FIREBASE_PROJECT_ID = 'demo-first-million'

/** The one UID the e2e Worker treats as admin (BR-017); passed to `wrangler dev --var`. */
export const ADMIN_UID = 'e2e-admin-uid'

/** `E2E_FULL_ROUND=1` runs the 10-minute NFR-006 round instead of the 3-minute default. */
export const FULL_ROUND = process.env.E2E_FULL_ROUND === '1'
