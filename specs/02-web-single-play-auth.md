# M2 — Web app: single play and auth — Implementation Plan

Ticket 2 of 6 (PRD §19 M2). Index: [specs/README.md](README.md). Depends on ticket 1 (M1, done). Implementation runs on the current branch (`main`) of the current checkout: no worktree, no new branch.

## Summary
Build the Vue 3 web app (`packages/web`): vue-router with guards, PL/EN i18n, dark design tokens with self-hosted fonts, Firebase Auth login/register/verify/reset, nickname and account deletion from the menu account section, the public privacy page, and the single-play screen driven by the `shared` engine (chart, news bar, halt, margin call). Works offline from the server (no WebSocket yet). Deploy to Pages is **not** in this ticket (all deploy in M6; PRD §19 M2 DoD amended, §20 row 36). Firebase Auth emulator setup is the **last** implementation step (step 25).

## Success Criteria
- Route guard: logged-out user reaches only `/login` and public `/privacy`; unverified user only `/verify`; verified user reaches `/menu`, which shows "Single play" enabled and "Rooms" with `aria-disabled="true"` and no route (FR-001, FR-006, BR-001, BR-002). Verified by Vitest guard and component tests.
- Single play timing: at 8× one 80 ms interval appends exactly 8 price steps; pause appends 0; "Play again" returns the initial state (FR-004). Verified by Vitest with seeded RNG.
- Halt and margin call: during `isTradingHalted`, `buy`/`sell`/`close` are no-ops and the buttons are disabled; halt countdown freezes with pause; equity ≤ 0 sets `over` and liquidates (FR-005, BR-015, BR-005). Verified by Vitest.
- Locale: `pl.json` and `en.json` have identical flattened key sets with no empty values; `en-GB` → EN, `pl-PL` → PL (FR-019). Verified by Vitest.
- Boundaries: `web` imports only `@fm/shared/*`; Firebase imported only in `src/auth/`; no `v-html` (architecture test).

## Scope & Constraints
- **In scope:** FR-001 (auth screens, verify, reset, password ≥ 8 on register), FR-002 (UI: random `Trader-NNNN` on first verified entry, nickname change validated with `isValidNick`), FR-004 (single play), FR-005 (news bar UI, halt), FR-006 (menu with account section), FR-018 (privacy page PL/EN, account deletion with password re-auth), FR-019 (i18n), FR-020 (dark theme, 360 px), BP-001, BR-001, BR-002, BR-006, BR-016 (UI), BR-021, UF-001, UF-002, UF-006. WCAG basics at build time (labels, focus, reduced motion, aria); full axe audit is M6.
- **Out of scope:** WebSocket, `web/src/net/`, room and lobby screens, `/rooms` route (M5); server `HALTED` rejection (M4); Worker code (M3, M4); production Firebase project and production env values (M6); Pages deploy, Lighthouse, axe, Playwright e2e (M6, review only).
- **Hard constraints:**
  - NFR-005 bundle ≤ 300 KB gzip: measured in review, not here. Import only `firebase/app` and `firebase/auth` (no `firebase` root). No UI or chart library.
  - NFR-002: 0 PLN. Self-hosted fonts, no third-party requests.
  - ARCHITECTURE: `web` imports `shared` only, never `worker`. Firebase SDK only under `packages/web/src/auth/`.
  - CODE_QUALITY: `<script setup lang="ts">`; no `v-html`; no literal UI text; no `any`, `@ts-ignore`, or unexplained `!`; `localStorage` only for language, wrapped in try/catch.
  - BR-020/BR-006: no app-owned persistence beyond `localStorage['fm-lang']`; single-play results never stored.
  - Workflow: during implementation only lint, typecheck and Vitest. Playwright, production build, Lighthouse, axe never close a step or checkpoint.
- **Trade-offs:**
  - `vue-router` (user decision, ~10 KB gzip): real URLs, back button, one guard.
  - Self-hosted fonts (user decision): ~10 woff2 files in `public/`, none counted in the JS budget; no third-party request.
  - Rooms card shown but disabled until M5 (FR-006 says both modes visible).
  - Account actions live on the menu, as in the mockup (`docs/design/Menu.dc.html`). No `/settings` route. Keeps screens to the mockup set; costs a longer menu screen (scroll is fine at 360 px, no horizontal scroll).
  - Single-play timer in the main thread (prototype parity); background-tab throttling accepted.

## Architecture & Design

### High-Level Flow
```
main.ts: resolveLocale → createI18n → session.init() → router → mount App.vue
router beforeEach: await session.ready → routeFor(status, path)
  out         → /login        (/privacy always allowed)
  unverified  → /verify
  verified    → /menu, /single  (/login, /verify → /menu)
Auth views → auth/actions.ts → auth/firebase.ts (only file importing firebase/app) → firebase/auth
           → auth/session.ts (onAuthStateChanged, user.reload after verify)
SinglePlayView → single/useSinglePlay.ts (80 ms setInterval, injected now/rng)
  → single/loop.ts advanceSingle (pure) → @fm/shared/engine/market, @fm/shared/engine/portfolio
  → components/PriceChart.vue (priceChart.ts), NewsBar.vue, ChipGroup.vue
```

### Verified `shared` API (M1, checked against `packages/shared/src`)
- **Import paths:** `src/index.ts` is `export {}`. Use deep imports supported by the `./*` export map: `@fm/shared/engine/market`, `@fm/shared/engine/portfolio`, `@fm/shared/engine/news`, `@fm/shared/rules`, `@fm/shared/config`, `@fm/shared/rng`, `@fm/shared/validation`.
- **`market.ts`:** `createMarket(rng)`, `stepMarket(m, rng)` (calls `drawNews` internally), `tickHalt(m, elapsedMs)` (wall ms, clears `frozenPrice` at 0), `isTradingHalted(m)`, `shownPrice(m)` (= `frozenPrice ?? price`). UI fields: `price`, `haltMsLeft`, `frozenPrice`, `news`, `newsAge`.
- **`news.ts`:** `NewsEvent` = `{type:'SHOCK', dir, mag, idx}` | `{type:'FLASH_CRASH', drop}` | `{type:'VOL_SPIKE'}` | `{type:'TRADING_HALT'}` | `{type:'TREND', dir}`. `mag` and `drop` are fractions (UI × 100). `idx` 0–3.
- **`portfolio.ts`:** `Portfolio {units, avg, realized, closedTrades, wins}`, `emptyPortfolio`, `TradeSide`, `fillPrice`, `executeOrder(p, side, qty, price)`, `closePosition(p, price)`, `unrealized`, `equity`, `isBankrupt`, `liquidate`, `totalResult`. **Spread is applied inside** these: pass raw `m.price`, never a pre-spread price. `executeOrder` does not check halt; the caller must. No trade record is returned (see step 16).
- **`rules.ts` / `config.ts`:** `START_CASH`, `START_PRICE`, `MIN_PRICE`, `SPREAD`, `ORDER_QTYS`, `OrderQty`, `SPEEDS`, `Speed`, `NICK_PATTERN`; `TICK_MS` 80, `HALT_MS` 5000, `NEWS_FADE_TICKS` 90, `HISTORY_MAX` 2400, `SHOCK_TEXT_COUNT` 4.
- **`rng.ts` / `validation.ts`:** `type Rng`, `createRng(seed)`, `isValidNick`, `randomNick(rng)`, `suffixNick`. `Math.random` satisfies `Rng` in `web` (determinism rule applies to `shared` and `RoomLogic` only).
- **Not in shared, so kept in web:** price history (`prices: number[]`, capped at `HISTORY_MAX`) and the frozen-length logic for the chart during halt (prototype `shownLen`).

### Key Changes

**Package `packages/shared`** (additive, step 16):
- `src/engine/portfolio.ts`: add `BookedTrade = { dir: 1 | -1; units: number; entry: number; exit: number; pnl: number }`, `bookedTrade(p, side, qty, price): BookedTrade | null` (returns the reduced/closed part; `null` when no reduction), and `closedTradeOf(p, price): BookedTrade | null` (whole position, used by close and liquidation). Refactor `realize` to share the arithmetic so netting stays in one place (CODE_QUALITY single source). Existing 66 tests unchanged.
- `src/rules.ts`: add `PASSWORD_MIN_LENGTH = 8` (BR-002) as single source for UI validation.

**Package `packages/web`** (Vue 3 + Vite + TS, `@fm/web`, private, ESM):
- `package.json`: deps `vue`, `vue-router`, `vue-i18n`, `firebase`, `@fm/shared` (`workspace:*`). Dev: `vite`, `@vitejs/plugin-vue`, `vue-tsc`, `eslint-plugin-vue`, `happy-dom`, `@vue/test-utils`. Scripts: `dev`, `build`, `preview`, `typecheck` (`vue-tsc --noEmit -p tsconfig.json`), `test` (`vitest run`). The `dev:auth` script lives in the root `package.json` (step 25).
- `tsconfig.json`: extends `../../tsconfig.base.json`; `lib: ["ES2022", "DOM", "DOM.Iterable"]` (base is ES2022 only); `types: ["vite/client"]`; includes `src/**/*.ts`, `src/**/*.vue`, `vite.config.ts`, test files (so root `projectService` lint finds every `.ts`).
- `vite.config.ts`: `@vitejs/plugin-vue`; `test.include: ['src/**/*.test.ts']`; default `node` environment; component tests opt in with `// @vitest-environment happy-dom`.
- `index.html`: `<html lang="pl">` placeholder (replaced at runtime), viewport meta. No Google Fonts `<link>` (fonts are self-hosted).
- `src/env.d.ts`: `ImportMetaEnv` typing for `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_AUTH_EMULATOR_URL` (no `any`).
- `public/fonts/`: 10 woff2 files, latin and latin-ext subsets. Space Grotesk 500, 700. JetBrains Mono 400, 500, 700 (the prototype's Google Fonts request uses exactly these weights).
- `src/main.ts`: `document.documentElement.lang` set from `resolveLocale` before mount; i18n, router created; `session.init()` awaited before mount so the first frame is correct.
- `src/App.vue`: header with PL/EN `ChipGroup`, `<RouterView>`, skip link to `<main>`, global `:focus-visible`.
- `src/router/guards.ts`: pure `routeFor(status, path): string | null`. Unit-tested without the router.
- `src/router/index.ts`: routes `/login`, `/verify`, `/menu`, `/single`, `/privacy`. Lazy `import()` for views. `beforeEach` awaits `session.ready`, applies `routeFor`. Unknown path → `/menu` or `/login` by status. No `/settings` route (account section lives on the menu).
- `src/auth/firebase.ts`: **only** file importing `firebase/app` and `firebase/auth`. `initializeApp` from `import.meta.env.VITE_FIREBASE_*`. `connectAuthEmulator(auth, url, { disableWarnings: true })` only when `import.meta.env.DEV && VITE_AUTH_EMULATOR_URL` is set (double guard).
- `src/auth/session.ts`: reactive `session = { status: 'loading'|'out'|'unverified'|'verified', user: { uid, nick, email } | null }`. `init()` wraps `onAuthStateChanged`; `ready` promise resolves on first event. On `verified` calls `ensureNick()` once. `displayName` and `emailVerified` narrowed with `typeof` (CODE_QUALITY: SDK data is `unknown` at the boundary; zod comes in M3, not here).
- `src/auth/actions.ts`: `register(email, pw)`, `login`, `logout`, `resendVerification`, `checkVerified` (`user.reload()`, then updates session), `sendReset`, `changeNick(nick)` (`isValidNick` before any network call, then `updateProfile({displayName})`), `deleteAccount(password)` (`reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password))`, then `deleteUser`), `ensureNick()` (if `displayName` empty and verified → `randomNick(Math.random)` → `updateProfile`) (BP-001 step 4). Register checks `PASSWORD_MIN_LENGTH` before the SDK call.
- `src/auth/errors.ts`: pure `authErrorKey(code: unknown): string`. Maps `auth/invalid-email`, `auth/email-already-in-use`, `auth/weak-password`, `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found`, `auth/too-many-requests`, `auth/network-request-failed`, `auth/requires-recent-login` to `auth.error.*`. Unknown or non-string → `auth.error.unknown`. Matches on `code` only, never message text.
- `src/views/LoginView.vue`: register/login mode toggle (two buttons with `aria-pressed`, per UF-001), labelled email and password with `autocomplete`, min-8 check on register, `role="alert"` error region, inline "Forgot password" form (`auth.resetSent`), privacy link in footer.
- `src/views/VerifyView.vue`: "Resend", "I've verified" (`checkVerified`; shows `auth.verifyPending` if still unverified), and "Log out" text button (added by user decision; avoids a dead end after a wrong registration; one extra i18n key).
- `src/views/MenuView.vue`: nickname line; "Single play" card (enabled, links `/single`); "Rooms" card (`aria-disabled="true"`, muted, no route, no caption); account section (mockup `Menu.dc.html` rows, min 52 px each): **Nick** with "Zmień" → inline form (`isValidNick`, error key on invalid, no SDK call); **Język** PL/EN `ChipGroup`; **Polityka prywatności** → `/privacy`; **Wyloguj**; **Usuń konto** → inline password form (`deleteAccount`; wrong password → `auth.error.*`; success → `/login`). Delete button styled `--down`.
- `src/views/PrivacyView.vue`: `privacy.*` text PL + EN: email and nickname in Firebase; Cloudflare as infrastructure; no game results stored; deletion path (menu). Public route (decision: reachable logged out, linked from login).
- `src/i18n/locale.ts`: pure `resolveLocale(saved: unknown, navigatorLanguage: string): 'pl' | 'en'`. Allowlist for `saved` (`'pl'`/`'en'`); else `navigator.language` `pl*` → `pl`, otherwise `en` (FR-019).
- `src/i18n/index.ts`: vue-i18n composition mode (`legacy: false`). `setLocale(l)` writes `fm-lang` in try/catch and updates `document.documentElement.lang`.
- `src/i18n/format.ts`: `formatMoney(n)`, `formatDecimal(n, digits)` via `Intl.NumberFormat` (`pl-PL` / `en-US`), 2 decimals; 1 decimal for news percentages. Used for chart labels too (PL comma; prototype used `toFixed` dot, FR-019 requires per-locale formatting).
- `src/i18n/pl.json`, `en.json`: groups `common.*`, `app.*`, `auth.*`, `auth.error.*`, `menu.*`, `account.*`, `single.*` (incl. `single.chartLabel` = "SYNTH/USD" instead of a literal), `news.*` (`shock.up.0-3`, `shock.down.0-3`, `flash`, `vol`, `halt`, `trend.up`, `trend.down`, `none`), `privacy.*`. Interpolation `{n}`, `{p}`, `{x}` as in prototype.
- `src/styles/tokens.css`: `:root` custom properties from PRD §16: `--bg #07090d`, `--surface #0f141b`, `--border #1c2530`, `--grid #18212b`, `--text #e6edf3`, `--muted #7d8a99`, `--up #2ee59d`, `--down #ff5d6c`, `--gold #f5c451`, `--on-up #04150d`, `--on-down #1a0508`, `--on-gold #1a1405`, `--font-ui`, `--font-data`. Explicit `body { background: var(--bg) }`. `@media (prefers-reduced-motion: reduce)` disables transitions and press transform. (Prototype `--muted #8a97a6` is superseded by PRD values.)
- `src/styles/fonts.css`: `@font-face` for each family and weight, `font-display: swap`, `unicode-range` split latin / latin-ext (covers Polish diacritics).
- `src/single/loop.ts`: pure `advanceSingle(sim, elapsedMs, speed, rng): SingleSim`. Order: `tickHalt(m, elapsedMs)`; then `speed` × `stepMarket` with price push and trim to `HISTORY_MAX`; then if `isBankrupt(p, m.price)` → `liquidate` → `over = true` → stop stepping (deliberate deviation from prototype, which keeps stepping after game over; harmless). Bankruptcy uses true `m.price` (prototype `trueEquity`); display equity uses `shownPrice(m)`.
- `src/single/history.ts`: pure `pushTrade(history, trade, max = 8)`.
- `src/single/useSinglePlay.ts`: composable. `shallowRef` for `market`, `portfolio`, `prices`, `history`, `peak`; immutable updates. Injected `now()` and `rng` seams. `setInterval(TICK_MS)`: `elapsed = min(now − last, 250)`; skipped when paused or over; calls `advanceSingle`. Actions `buy`, `sell`, `close` (no-op when `over` or `isTradingHalted`) call `executeOrder` / `closePosition` at raw `market.price`. `setQty(OrderQty)` (default 50), `setSpeed(Speed)` (default 3), `togglePause`, `restart()` (fresh `createMarket` and `emptyPortfolio`), `dispose()` clears interval. Each visit starts a fresh game (no storage, BR-006).
- `src/components/priceChart.ts`: pure `chartGeometry(prices, avg | null, width, height)` (VIEW 220, pad 12% or 0.5, margins L 8 / R 62 / T 10 / B 12, entry included in range) and `drawChart(ctx, geometry, colors)` (5 grid lines, right-hand labels, fill `rgba(46,229,157,0.12)`, line width 1.7, dashed entry line with label, gold last-price dot and label box).
- `src/components/PriceChart.vue`: `<canvas role="img" :aria-label="t('single.chartLabel')">`, DPR-aware, `ResizeObserver` guarded by `typeof ResizeObserver`, disconnected on unmount.
- `src/components/NewsBar.vue`: text from `news.*` with params from `NewsEvent`; tone via pure `newsTone(news, newsAge)`: `up`/`down` by `dir` (SHOCK, TREND), `down` for FLASH_CRASH, `warn` for VOL_SPIKE and TRADING_HALT; none after `NEWS_FADE_TICKS`. `aria-live="polite"`.
- `src/components/ChipGroup.vue`: generic `role="group"` with `aria-label` and `aria-pressed` buttons (size, speed, language). Typed props; no boolean-flag props other than `disabled`.
- `src/views/SinglePlayView.vue`: prototype layout at 360 px, mockup spacing (16 px gutters, 44 px min touch targets, 52 px primary buttons): mode label, price and change, news bar, chart with halt bar (countdown, `aria-live`) and margin-call overlay with "Play again" (UF-002); stats 2×2 below 560 px, 4 columns above; size chips (`ORDER_QTYS`), speed chips (`SPEEDS`), pause; Buy / Close / Sell grid (disabled while halted or over); hint with keys; last 8 trades (empty state `single.histEmpty`); footer (trades, win rate, equity record). B/S/C on `document` keydown, ignored when target is INPUT, TEXTAREA, SELECT (pure `isTypingTarget`). Listeners removed on unmount.

### Fit with Project Docs
- **PRD:** FR-001, FR-002 (UI), FR-004, FR-005 (UI), FR-006, FR-018 (privacy, deletion), FR-019, FR-020, BP-001, BR-001, BR-002, BR-006, BR-016 (UI), BR-021, UF-001, UF-002, UF-006. No result storage (BR-006, BR-020).
- **ARCHITECTURE:** `web` imports `shared` only. Firebase only in `web/src/auth/`. No WebSocket (`web/net` is M5). Timers live in the composable (web equivalent of the DO shell), cleaned on unmount.
- **CODE_QUALITY:** `<script setup lang="ts">`; logic in composables and pure modules; PL + EN keys; no `v-html`; no literal UI text; Firebase errors matched by code; `localStorage` only for language, try/catch; tests cite FR/BR.
- **Docs to update (same change):**
  - `docs/CODE_QUALITY.md`: deps list gains `vue-router`; path rows say `web/i18n/` and `web/styles/tokens.css`, change to `web/src/i18n/` and `web/src/styles/tokens.css` (real layout).
  - `docs/PRD.md` §19 M2 DoD: "deployed to Pages" → "deployed to Pages in M6 (see §20 row 36)".
  - `docs/PRD.md` §20 row 36: "All deployment (Pages, Worker, Firebase project setup) in M6; M1–M5 run locally".
  - `docs/PRD.md` §20: note `bookedTrade` helper in shared is a shared-engine addition (row 36 is reserved for deploy, so record it under the M2 ticket in this spec only, not as a new row).
  - `docs/ARCHITECTURE.md`: status line "M2 in progress" at start; final layout update at M2 close; Testing note on the emulator (step 25).

### Alternative Approaches Considered
- **State-driven screens, no router (A):** zero dep, no back button, no URLs. Rejected by user decision.
- **`vue-router` + lazy views (chosen):** URLs, one guard, small initial bundle. ~10 KB gzip accepted.
- **Firebase Auth via REST (B):** no SDK, but reimplements refresh, reauth, verification. Rejected (KISS: the SDK is the platform).
- **Chart library (C):** violates CODE_QUALITY. Canvas helper instead.
- **Trade record derived in web:** duplicates netting arithmetic. Rejected (user decision: shared helper).
- **Account section on `/settings` route:** matches FR-006 wording; mockup puts it on the menu. Rejected (user decision: menu, as mockup).
- **Single-play timer in a Web Worker:** avoids background throttling; more code. Rejected (KISS, prototype parity).
- **zod in web now:** formal boundary, first needed in M3. Rejected for M2 (YAGNI); explicit `typeof` narrowing instead.
- **`@fontsource` packages:** rejected by user decision (committed woff2 + hand-written `@font-face`).

## Implementation Steps

Each step ends with a tick here and a line in the Implementation Log. Light checks only: lint, typecheck, Vitest.

1. [x] Scaffold `packages/web`: `package.json` (`@fm/web`, scripts per Key Changes, deps per Key Changes), `tsconfig.json` (lib DOM, `types: ["vite/client"]`, includes per Key Changes), `vite.config.ts` (vue plugin, Vitest `include`), `index.html` (viewport meta, `lang="pl"` placeholder), `src/env.d.ts`, minimal `src/main.ts` and `src/App.vue`. Run `pnpm install`; commit the lockfile change with the work (CI uses `--frozen-lockfile`).
2. [x] Root `eslint.config.js`: add a block for `packages/web/**/*.vue` with `eslint-plugin-vue` `flat/recommended` and `vue-eslint-parser` with `tseslint.parser` for `<script lang="ts">`. No type-aware rules on `.vue`. `.ts` block unchanged. `pnpm lint` green.
3. [x] `.env.example` (demo values: `VITE_FIREBASE_API_KEY=demo-key`, `VITE_FIREBASE_PROJECT_ID=demo-first-million`, `VITE_AUTH_EMULATOR_URL=http://127.0.0.1:9099`), `src/auth/firebase.ts` (`initializeApp`; `connectAuthEmulator(..., { disableWarnings: true })` only under `import.meta.env.DEV && VITE_AUTH_EMULATOR_URL`). Typecheck green. (Early hook is one `if`; the emulator itself is step 25.)
4. [x] `src/styles/tokens.css` (PRD §16 values + `--grid`, `--on-up`, `--on-down`, `--on-gold`; explicit `body` background; reduced-motion rule) and `src/styles/fonts.css` (`@font-face` ×10, `font-display: swap`, `unicode-range` latin / latin-ext). Download the 10 woff2 files into `public/fonts/` from the Google Fonts CSS for `Space Grotesk:500,700` and `JetBrains Mono:400,500,700`, commit them. If the download is blocked, log it and continue with the system font stack (Risks).
5. [x] i18n core: `src/i18n/locale.ts` (`resolveLocale`), `src/i18n/index.ts` (composition mode, `setLocale` with `fm-lang` in try/catch, sets `document.documentElement.lang`), `src/i18n/format.ts` (`formatMoney`, `formatDecimal`).
6. [x] `src/i18n/pl.json` and `en.json` with all key groups in Key Changes; texts from prototype L196–249 (PL/EN objects), PRD §11 UF-001/UF-002/UF-006, FR-018 privacy scope. Tests: `src/i18n/locale-keys.test.ts` (identical flattened key sets; no empty values); `src/i18n/locale.test.ts` (`en-GB` → en; `pl-PL` → pl; saved `en` overrides `pl-PL`; invalid saved → fallback; throwing storage → fallback). **Checkpoint CP1.**
7. [x] `src/auth/session.ts` (reactive session, `init`, `ready`, `typeof` narrowing) and `src/auth/errors.ts` (`authErrorKey`). Test `src/auth/errors.test.ts`: every mapped code → key; unknown and non-string → `auth.error.unknown`.
8. [x] `src/auth/actions.ts`: register, login, logout, resend, `checkVerified`, `sendReset`, `changeNick`, `deleteAccount`, `ensureNick`. Test `src/auth/actions.test.ts` with `vi.mock('firebase/auth')` and `vi.mock('./firebase')`: `ensureNick` only when `displayName` empty (BP-001); `changeNick('ab')` makes no SDK call (FR-002 AC); register with 7-character password rejected before SDK call (FR-001 AC); `deleteAccount` reauthenticates before `deleteUser` (FR-018 AC).
9. [x] `src/router/guards.ts` (pure `routeFor`); `src/router/index.ts` (routes, lazy views, `beforeEach` awaiting `session.ready`) moved to step 21, because its lazy view imports cannot typecheck before the views exist. Test `src/router/guards.test.ts`: logged out → only `/login` and `/privacy` (FR-001 AC); unverified → only `/verify` (FR-001 AC); verified redirected from `/login` and `/verify` to `/menu` (FR-006); `/privacy` allowed for every status.
10. [x] `src/views/LoginView.vue`: mode toggle with `aria-pressed`, labelled email/password (`autocomplete`), min-8 check on register, `role="alert"`, inline reset form, privacy link. Component test `src/views/login.test.ts` (happy-dom, `@vue/test-utils`, test i18n instance): 7-character password shows validation key (FR-001 AC).
11. [x] `src/views/VerifyView.vue` (resend, "I've verified", "Log out") and `src/views/MenuView.vue` (Single play enabled; Rooms `aria-disabled="true"`, no route; nickname; account section with nick change, language `ChipGroup`, privacy link, logout, delete-account inline form per Key Changes). Component tests `src/views/menu.test.ts`: verified user sees both modes (FR-006 AC); Rooms disabled; invalid nick shows error key with no SDK call; wrong password shows `auth.error.*` and does not navigate. **Checkpoint CP2** after step 12.
12. [x] Gate for CP2: run Vitest for `auth`, `router`, `views/login`, `views/menu`; typecheck green.
13. [x] `src/views/PrivacyView.vue` with `privacy.*` text (PL + EN: email and nickname in Firebase; Cloudflare as infrastructure; no game results stored; deletion path). Public route. Test: route allowed for every status (covered by step 9 test; add one assertion for the view's keys existing).
14. [x] `packages/shared` additive helper: `bookedTrade` and `closedTradeOf` in `src/engine/portfolio.ts`, `realize` refactored to share arithmetic; `PASSWORD_MIN_LENGTH` in `src/rules.ts`. Tests in `packages/shared/test/portfolio.test.ts`: partial close returns `units` = closed size and `pnl` as BR-004; reversal returns only the closed part; close on flat returns `null`; `closedTradeOf` matches `closePosition`'s P&L for the same price. Existing 66 tests still green. Shared typecheck green (`tsconfig.src.json` platform-free guard still passes).
15. [x] `src/single/loop.ts` (`advanceSingle` per Key Changes, break on bankruptcy) and `src/single/history.ts` (`pushTrade`, max 8). Tests `src/single/loop.test.ts` with `createRng(42)`: speed 8 appends exactly 8 prices and equals 8 direct `stepMarket` calls (FR-004 AC); `tickHalt` counts down only by elapsed ms (BR-015); halt keeps `frozenPrice` (FR-005); equity ≤ 0 sets `over` and flattens position (FR-003, BR-005). `src/single/history.test.ts`: 9th trade drops the oldest (UF-002).
16. [x] `src/single/useSinglePlay.ts`: `shallowRef` state, injected `now` and `rng`, 80 ms interval with `elapsed` cap 250, `buy`/`sell`/`close` (no-op when over or halted; use `bookedTrade`/`closedTradeOf` to push history), `setQty`, `setSpeed`, `togglePause`, `restart`, `dispose`. Test `src/single/useSinglePlay.test.ts` (fake clock, seeded RNG): pause stops steps (FR-004); restart returns initial state (FR-004 AC); halt blocks trades and `close` (FR-005 AC); no `localStorage`/`sessionStorage` writes (BR-006 spy).
17. [x] `src/components/priceChart.ts` (`chartGeometry`, `drawChart`) and `src/components/PriceChart.vue`. Test `src/components/priceChart.test.ts`: window is last 220 points of displayed slice; 12% pad; entry inside range when position open; empty prices do not throw; labels use `formatDecimal` (PL comma in PL).
18. [x] `src/components/NewsBar.vue` (text, `newsTone`, `aria-live`) and `src/components/ChipGroup.vue`. Tests: `newsTone` gives `warn` for VOL_SPIKE and TRADING_HALT, `up`/`down` by direction, none after 90 ticks (FR-005); `ChipGroup` sets `aria-pressed="true"` on exactly one item.
19. [x] `src/views/SinglePlayView.vue` per Key Changes at 360 px first; keyboard B/S/C with `isTypingTarget` guard (test `src/views/keys.test.ts`); halt bar and margin-call overlay with i18n keys; listeners removed on unmount. **Checkpoint CP4** after step 19.
20. [x] Gate for CP4: Vitest green for shell-independent single-play tests (steps 15–19); typecheck green.
21. [x] `src/router/index.ts` (moved from step 9: routes `/login`, `/verify`, `/menu`, `/single`, `/privacy`, `/` and unknown paths redirect to `/menu`, lazy views, `beforeEach` awaiting `session.ready` then `routeFor`). `App.vue` wiring: header with PL/EN `ChipGroup` on all screens, `<RouterView>`, skip link to `<main>`, global `:focus-visible` from tokens. `main.ts` finalised: `resolveLocale`, i18n, `session.init()` before mount. `src/architecture.test.ts`: no `firebase` import outside `src/auth/`; no `v-html` in `.vue` files; no `@fm/worker` import anywhere in `web`.
22. [x] Component smoke test for App shell: mounts with a test router and session stub; language chip changes `document.documentElement.lang`.
23. [x] Docs: `docs/CODE_QUALITY.md` (deps gains `vue-router`; path rows → `web/src/...`); `docs/PRD.md` §19 M2 DoD amended; `docs/PRD.md` §20 row 36 added; `docs/ARCHITECTURE.md` status line "M2 in progress". Docs only. **Checkpoint CP5** after step 25 (see below).
24. [x] Final light verification (no new code): `pnpm lint`, `pnpm typecheck`, `pnpm test` green for `shared` and `web`; M1 tests still green; implementation log filled.
25. [x] Firebase Auth emulator via the `firebase-tools` CLI, no Docker (LAST implementation step; changed from Docker + JDK at the user's request: the CLI is already Node/TypeScript and the Auth emulator does not need Java, verified by a manual start: `pnpm dev:auth` ran with no Java on PATH, Auth on `127.0.0.1:9099` and UI on `127.0.0.1:4000` both answered HTTP 200; only Node is required). Files in `tools/auth-emulator/` (not a workspace package, so no pnpm/ESLint/typecheck impact):
    - `firebase.json`: `emulators.auth` on `127.0.0.1:9099`; `emulators.ui` enabled on `127.0.0.1:4000` so verification and reset links are visible in dev.
    - Root `package.json` script `dev:auth`: `pnpm dlx firebase-tools@15.33.0 emulators:start --only auth --project demo-first-million --config tools/auth-emulator/firebase.json`. `dlx` keeps the large CLI out of the lockfile and the CI install; the version is pinned in the script.
    - Docs note in `docs/ARCHITECTURE.md` Testing: prerequisite is Node only (no Docker); copy `packages/web/.env.example` → `packages/web/.env.development.local`; run `pnpm dev:auth`; emulator data is in memory and lost on stop (fits BR-020); emulator ID tokens are unsigned, so the Worker needs a dev-only verification path in M3.
    - Add `.firebase/` to `.gitignore` if it is created. Config only; no Vitest test uses the emulator (they mock `firebase/auth`). Lint and typecheck still green. The emulator is not started during implementation (not closing evidence); first manual start done at the user's request (Java check, see step 25 header). Full manual login flow in the emulator still pending.

## Checkpoints (Todo List)

- [x] CP1 — Shell: steps 1–6 (scaffold, lint, Firebase init hook, tokens and fonts, i18n, locale tests). Vitest green for `locale-keys` and `locale`; typecheck clean. — 12 tests green, typecheck and lint clean
- [x] CP2 — Auth and routing: steps 7–12 (session, errors, actions, guard, Login, Verify, Menu). Vitest green for errors, actions (mocked SDK), guard, login (7-character password), menu (FR-006 AC); typecheck clean. — 44 tests in 5 files green, typecheck and lint clean (`router/index.ts` still pending, step 21)
- [x] CP3 — Privacy and shared helper: steps 13–14. Vitest green for privacy keys and the new `shared` portfolio tests; `pnpm --filter shared test` green. — privacy 3 tests, shared 74 tests (7 new), shared typecheck incl. platform-free `tsconfig.src.json` green
- [x] CP4 — Single play: steps 15–20 (loop, history, composable, chart, news and chips, view, gate). Vitest green for FR-004 AC (8 steps per interval), FR-005 AC (halt), restart, chart geometry, news tone, chips, keys; typecheck clean.
- [x] CP5 — Wiring, docs, verification, emulator: steps 21–25. Architecture test green; docs updated; `pnpm lint`, `pnpm typecheck`, `pnpm test` green in `shared` and `web`; emulator config present; no step left unticked. — architecture test (7 cases) green; shared 74 + web 140 tests; heavy checks deferred to review

## Risks & Mitigations

- **Risk:** Engine returns no trade record and applies spread internally. A wrong derivation gives wrong "last 8 trades" P&L or a double spread.
  - Mitigation: step 14 adds `bookedTrade`/`closedTradeOf` with tests against `executeOrder`/`closePosition` values. Composable passes raw `m.price` only.
  - Mitigation if the helper proves awkward: derive in `web/src/single/loop.ts` from before/after portfolios, with a test pinning the same numbers.
- **Risk:** Font download (step 4) blocked by the environment, or wrong weight set.
  - Mitigation: weight set listed explicitly; if blocked, log, keep system fallback in `font-family`, re-run step 4 later. No test depends on font files.
- **Risk:** Vue tooling friction: `vue-tsc` vs TypeScript 6, root `projectService` for `.ts` outside a tsconfig, `.vue` parser block.
  - Mitigation: `web/tsconfig.json` includes every `.ts` and `.vue`; no type-aware rules on `.vue`. If `vue-tsc` and TS 6 conflict, pick the newest compatible `vue-tsc` and record it; do not downgrade root TypeScript.
- **Risk:** Emulator config reaches production bundle.
  - Mitigation: `.env.example` is not loaded by Vite; developers use `.env.development.local` (dev only); code guards on `import.meta.env.DEV`. Production grep for the emulator URL is a review-time check, not closing evidence.
- **Risk:** Bundle over 300 KB gzip (NFR-005) from Vue, router, i18n and `firebase/auth`.
  - Mitigation: modular Firebase imports only; lazy views. Measured in review. First fallback: move reauth + `deleteUser` into a lazy chunk.
- **Risk:** Timing tests flaky, or background-tab throttling changes halt length.
  - Mitigation: injected `now()` and `rng`; no `Date.now`/`Math.random` in tested code; `elapsed` capped at 250 ms (prototype). Background-tab drift accepted and noted.
- **Risk:** Firebase's own session persistence (IndexedDB) looks like a conflict with BR-020.
  - Mitigation: app adds no persistence beyond `fm-lang`. Firebase session is the account login state required by FR-001 (token refresh); BR-020 names the Firebase account as the only persistent data. Reflect this in privacy text.
- **Risk:** Account section on the menu makes the menu long at 360 px.
  - Mitigation: rows at 52 px, single column, no horizontal scroll; check at 360 px in dev (manual, not closing evidence).

## Test Strategy

**Light (during implementation; closing evidence for checkpoints):**
- Vitest, `packages/web` (`node` by default, `happy-dom` for components):
  - `src/i18n/locale-keys.test.ts`, `src/i18n/locale.test.ts` (FR-019).
  - `src/auth/errors.test.ts`, `src/auth/actions.test.ts` (FR-001 AC, FR-002 AC, FR-018 AC, BP-001).
  - `src/router/guards.test.ts` (FR-001 AC ×2, FR-006).
  - `src/views/login.test.ts` (FR-001 AC), `src/views/menu.test.ts` (FR-006 AC, FR-002 AC, FR-018 AC).
  - `src/single/loop.test.ts` (FR-004 AC, FR-003/BR-005 bankruptcy, BR-015 wall-time halt), `src/single/history.test.ts` (UF-002), `src/single/useSinglePlay.test.ts` (FR-004, FR-005 AC, BR-006).
  - `src/components/priceChart.test.ts`, `src/components/newsTone.test.ts` (FR-005), `src/components/chip-group.test.ts`.
  - `src/views/keys.test.ts` (UF-002 keyboard guard).
  - `src/architecture.test.ts` (ARCH dependency rules, no `v-html`).
- Vitest, `packages/shared`: new `bookedTrade`/`closedTradeOf` tests (step 14) and the existing 66 tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Seeded RNG, injected clock, no sleeps. Test names state the rule and cite FR/BR.

**Heavy (review only, never a step or checkpoint closer):**
- Playwright single-play and auth e2e (written in M6).
- Production build and gzip bundle size against NFR-005.
- Lighthouse and axe at 360 px (full NFR-003 audit in M6).
- Manual 360 px check against `docs/design/Menu.dc.html` and `Main.dc.html`.
- Production grep for emulator URL.

## Success Checklist
- [ ] All success criteria met, with light-check evidence
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green in `shared` and `web`
- [ ] Firebase imported only under `packages/web/src/auth/` (architecture test)
- [ ] No `v-html`; no literal UI text in `.vue` (text checked in review)
- [ ] `web` imports only `@fm/shared/*`
- [ ] PL and EN key parity (test)
- [ ] Docs updated: CODE_QUALITY deps and paths, PRD §19 M2 DoD, PRD §20 row 36, ARCHITECTURE status and Testing note
- [ ] Emulator setup is step 25 and ticked
- [ ] Lockfile committed with the change
- [ ] Code review run separately with `first-million-review` (heavy checks there)

## Timeline & Estimates
- Phase 1 (scaffold, i18n, tokens, fonts): ~4 h
- Phase 2 (auth, router, login/verify/menu): ~6 h
- Phase 3 (privacy, shared helper, single-play engine, chart, view): ~9 h
- Phase 4 (wiring, docs, emulator, verification): ~3 h
- **Total**: ~22–25 h (rough, plus buffer for font download and Vue tooling friction)

## Open Questions
- [ ] Emulator JDK: does `--only auth` run without Java? Image ships JDK 21 until a first manual start proves it is unnecessary; then drop it from the Dockerfile (user task after M2, not a blocker).
- [ ] Currency format: prototype stats show numbers without `$`; mockup shows "+500,00 $". Plan follows the prototype (`$` only in margin-call text). Confirm before step 19.
- [ ] Rooms card: disabled and muted, no caption (no new copy). Confirm before step 11.
- [ ] Single-play defaults: qty 50, speed 3× (prototype). Confirm before step 16.

## Implementation Log
(Empty. first-million-implement appends one line per step event here.)
- Session start — branch `main`; baseline uncommitted: only this spec. Open questions resolved by plan defaults (no `$` in stats, Rooms card no caption, qty 50 / speed 3×)
- Step 1 — started
- Step 1 — done — files: packages/web/package.json, tsconfig.json, vite.config.ts, index.html, src/env.d.ts, src/main.ts, src/App.vue, pnpm-lock.yaml — scaffold installed, `vue-tsc` typecheck green; no `.vue` shim needed (vue-tsc resolves them); `vitest run` has no tests until step 6
- Step 2 — started
- Step 2 — done — files: eslint.config.js, package.json, pnpm-lock.yaml, packages/web/package.json, packages/web/src/shims-vue.d.ts, packages/web/src/App.vue — vue block added (`flat/recommended`, vue-eslint-parser + tseslint.parser, `vue/no-v-html` error); deviation: `eslint-plugin-vue` and `vue-eslint-parser` moved to ROOT devDependencies (root config cannot resolve them from `packages/web`); `shims-vue.d.ts` added because type-aware lint cannot resolve `.vue` imports (`main.ts` failed `no-unsafe-argument`); lint and typecheck green
- Step 3 — started
- Step 3 — done — files: packages/web/.env.example, packages/web/src/auth/firebase.ts — exports `auth`; emulator connected only under `import.meta.env.DEV && VITE_AUTH_EMULATOR_URL`; `.env.example` not git-ignored; typecheck and lint green
- Step 4 — started
- Step 4 — done — files: packages/web/src/styles/tokens.css, packages/web/src/styles/fonts.css, packages/web/src/main.ts, packages/web/public/fonts/{space-grotesk,jetbrains-mono}-{latin,latin-ext}.woff2 — deviation: both Google families are variable fonts, so 4 woff2 files (one per subset, weight ranges `500 700` / `400 700`) instead of 10; downloaded from fonts.gstatic.com, no request at runtime; styles imported in `main.ts`
- Step 5 — started
- Step 5 — done — files: packages/web/src/i18n/locale.ts, format.ts, index.ts — `resolveLocale`, `readSavedLocale`/`saveLocale` (try/catch), `createAppI18n(locale)`, `useLocale()` composable (sets i18n locale, `<html lang>`, `fm-lang`); `formatMoney/formatDecimal/formatSigned` take the locale as a parameter (pure, cached `Intl.NumberFormat`); typecheck verified together with step 6 (index.ts imports the JSON)
- Step 6 — started
- Step 6 — done — files: packages/web/src/i18n/pl.json, en.json, locale-keys.test.ts, locale.test.ts — all key groups; shock `{p}` carries the formatted signed percent, flash `{x}`; `@` in the email placeholder escaped as `{'@'}` (vue-i18n linked-message char); 12 tests green. CP1 ticked
- Step 7 — started
- Step 7 — done — files: packages/web/src/auth/session.ts, errors.ts, errors.test.ts — `session`, `ready`, `setSessionFromUser`, `init(onVerified)` (deviation: takes the `ensureNick` hook as a parameter so `session.ts` does not import `actions.ts`, avoiding a cycle; `main.ts` passes it in step 21); `authErrorKey` + `authErrorKeyOf`; `user-not-found` shares the invalid-credential message (no account enumeration); 24 tests green in package
- Step 8 — started
- Step 8 — done — files: packages/web/src/auth/actions.ts, actions.test.ts, packages/shared/src/rules.ts — actions return `ActionResult` (`{ok:true}` | `{ok:false, errorKey}`) instead of throwing; `login`/`register`/`checkVerified` run `ensureNick` then publish the session (avoids a race with `onAuthStateChanged` before navigation); deviation: `PASSWORD_MIN_LENGTH = 8` added to `shared/src/rules.ts` now (needed here; step 14 no longer adds it); 13 new tests, 37 total in web, shared 67 green
- Step 9 — started
- Step 9 — done — files: packages/web/src/router/guards.ts, guards.test.ts — pure `routeFor(status, path)`; deviation: `router/index.ts` moved to step 21 (lazy view imports do not typecheck until views exist; no stubs); `/rooms` falls to `/menu` (no route in M2); 6 tests, 43 total green
- Step 10 — started
- Step 10 — done — files: packages/web/src/views/LoginView.vue, login.test.ts, packages/web/src/test-support.ts, packages/web/src/styles/base.css, packages/web/src/main.ts, packages/web/src/i18n/pl.json, en.json, eslint.config.js — additions beyond the plan: shared `base.css` (focus ring, `.input`, `.btn`, `.chip`, `.link`, `.error`; imported in `main.ts`) so views do not copy control styles; `test-support.ts` (`mountWithApp`, `buttonByText`) shared by component tests; `app.title` replaced by `app.brandFirst`/`app.brandSecond` (gold span without literal text); eslint vue block turns off `max-attributes-per-line`, `singleline-html-element-content-newline` and relaxes void self-closing (Prettier owns template layout); 5 component tests, 48 total green
- Step 11 — started
- Step 11 — done — files: packages/web/src/views/VerifyView.vue, MenuView.vue, menu.test.ts, packages/web/src/components/ChipGroup.vue — deviation: `ChipGroup.vue` created here (the menu language switch needs it); step 18 now only adds `NewsBar` and its tests (`ChipGroup` test still due there); Rooms card is `<a role="link" aria-disabled="true">` without `href`; menu tests: both modes, Rooms disabled, invalid nick (no SDK call), valid nick, wrong password (no navigation), delete OK, logout, language switch; 56 tests total
- Step 12 — started
- Step 12 — done — gate: `vitest run src/auth src/router src/views/login.test.ts src/views/menu.test.ts` 44 tests green, typecheck green. CP2 ticked
- Step 13 — started
- Step 13 — done — files: packages/web/src/views/PrivacyView.vue, privacy.test.ts — five sections from `privacy.*` (data, infra, game, browser, delete); back link reuses `routeFor(status, '/menu')` so it goes to /login, /verify or /menu by status; 3 tests (PL, EN, back link), 59 total in web
- Step 14 — started
- Step 14 — done — files: packages/shared/src/engine/portfolio.ts, packages/shared/test/portfolio.test.ts — `BookedTrade`, `bookedTrade`, `closedTradeOf`; P&L arithmetic now lives in one private `reduction()` used by `realize`, `bookedTrade`, `closedTradeOf`; `opposes` and `closeFill` helpers extracted; `PASSWORD_MIN_LENGTH` was already added in step 8; 7 new tests (shared 74 green, existing tests unchanged). CP3 ticked
- Step 15 — started
- Step 15 — done — files: packages/web/src/single/loop.ts, history.ts, loop.test.ts, history.test.ts — `SingleSim` (market, portfolio, prices, `frozenLen`, history, peak, over), `createSingle`, `advanceSingle`, `shownPrices`, `shownEquity`; deviation: the pure order handlers `placeOrder`/`closeOrder` (halt/over guards, `bookedTrade`/`closedTradeOf` history, peak) live in `loop.ts` rather than the composable, so step 16 is a thin timer shell; halt freeze point detected by `frozenPrice` going null -> set (display frozen at the price before that step moves it); 23 tests green
- Step 16 — started
- Step 16 — done — files: packages/web/src/single/useSinglePlay.ts, useSinglePlay.test.ts — one `shallowRef<SingleSim>` plus computed views (`prices`, `price`, `change`, `equity`, `open`, `total`, `winRate`, `halted`); `now`/`rng` injected; `elapsed` capped at 250 ms and `last` keeps advancing while paused (resume does not count the pause as halt time); `dispose` also via `onScopeDispose`; tests: 8x = 8 steps, pause, pause freezes halt, 250 ms cap, restart, halt no-ops, no storage writes (BR-006 spy); 12 tests, 35 in `single/`
- Step 17 — started
- Step 17 — done — files: packages/web/src/components/priceChart.ts, PriceChart.vue, priceChart.test.ts — `chartGeometry` returns `null` for no data; `drawChart` takes colors and a `{format, entry}` text object (locale-aware via `formatMoney`, so PL gets a comma, FR-019) and expects the caller to clear/scale the context (PriceChart.vue does, DPR-aware, `ResizeObserver` guarded and disconnected on unmount); 11 tests (window of 220, right alignment, 12% pad, flat pad, entry in range, labels PL/EN, null geometry)
- Step 18 — started
- Step 18 — done — files: packages/web/src/components/newsTone.ts, NewsBar.vue, newsTone.test.ts, chip-group.test.ts — `newsTone` (up/down/warn/none; age <= 90 still lit, 91 gone, prototype parity) and `newsMessage` (i18n key + params: signed percent via `formatDecimal`, U+2212 minus); `ChipGroup.vue` already existed from step 11, only its test is new here; test asserts every news key exists in PL and EN; 118 tests in web, typecheck and lint clean
- Step 19 — started
- Step 19 — done — files: packages/web/src/views/SinglePlayView.vue, keys.ts, keys.test.ts, single-view.test.ts — prototype layout with mockup spacing; halt bar is `role="status"` with the countdown `aria-hidden` (no 12 Hz announcements); margin-call overlay `role="alertdialog"` with focus moved to "Play again"; extra beyond plan: `orderKey` ignores Ctrl/Cmd/Alt combos (Ctrl+S must not sell), view smoke tests (keys B/S/C, typing guard, listener removed on unmount, size chips, pause label); stats show no `$` (plan default)
- Step 20 — started
- Step 20 — done — gate: `vitest run src/single src/components src/views/keys.test.ts src/views/single-view.test.ts` 71 tests green, typecheck and lint clean. CP4 ticked
- Step 21 — started
- Step 21 — done — files: packages/web/src/router/index.ts, App.vue, main.ts, architecture.test.ts — `createAppRouter(history?)` with lazy views, `/` and unknown paths -> `/menu`, `beforeEach` awaits `ready` then `routeFor`; `main.ts` resolves locale, `init(ensureNick)`, awaits `ready`, then mounts; `App.vue` header with PL/EN `ChipGroup`, skip link, `<main id="main" tabindex="-1">`; global `:focus-visible` lives in `base.css` (step 10); architecture test: Firebase only under `src/auth/` (and `firebase/app` only in `auth/firebase.ts`), no `@fm/worker`, no relative path into `shared`, no `v-html`, browser storage only in `i18n/locale.ts` (BR-020)
- Step 22 — started
- Step 22 — done — files: packages/web/src/app.test.ts — skip link, routed view inside `<main>`, language chips switch `<html lang>`, texts and `fm-lang`; 18 files, 140 tests in web
- Step 23 — started
- Step 23 — done — files: docs/CODE_QUALITY.md, docs/PRD.md, docs/ARCHITECTURE.md — `vue-router` in deps; paths `web/src/i18n/`, `web/src/styles/tokens.css`; PRD §19 M2 DoD amended; PRD §20 row 36 added (deploy in M6); ARCHITECTURE status "M2 in progress" and web layout line (`router/`, `styles/`, `net/` marked M5); the emulator Testing note comes with step 25
- Step 24 — started
- Step 24 — done — `pnpm lint` clean, `pnpm typecheck` clean (shared incl. platform-free `tsconfig.src.json`, web via vue-tsc), `pnpm test`: shared 74 passed (M1 tests unchanged), web 140 passed in 18 files
- Step 25 — started — user asked for a TS alternative to the Docker/JDK emulator; step 25 rewritten to run the official TS CLI via `pnpm dlx firebase-tools@15.33.0` (no Docker, no JDK)
- Step 25 — done — files: tools/auth-emulator/firebase.json, package.json (`dev:auth`), docs/ARCHITECTURE.md (Testing note), .gitignore (`.firebase/`) — auth on 127.0.0.1:9099, UI on 127.0.0.1:4000; emulator not started (first manual start by the user, also confirms no Java is needed); lint, typecheck, tests green. CP5 ticked
