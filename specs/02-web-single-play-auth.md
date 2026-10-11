# M2 — Web app: single play and auth — Implementation Plan

Ticket 2 of 6 (PRD §19 M2). Index: [specs/README.md](README.md). Depends on ticket 1 (M1).

## Summary
Build the Vue 3 web app shell: routing with guards, PL/EN i18n, dark design tokens with self-hosted fonts, Firebase Auth login/register/verify/reset (emulator in dev), nickname settings, account deletion, the privacy page, and the single-play screen driven by the `shared` engine (chart, news bar, halt, margin call). Works fully offline from the server (no WebSocket yet). Implementation runs on the current branch of the current checkout (no worktree), after M1 is in place. Deploy to Pages is **not** in this ticket (decision: all deploy in M6); the PRD M2 DoD line "deployed to Pages" is amended accordingly.

## Success Criteria
- A logged-out user sees only login/register; an unverified user sees only the verify screen; a verified user reaches the menu (FR-001, FR-006, BR-001, BR-002) — verified with Vitest route-guard tests and the Auth emulator in dev.
- Single play reproduces the prototype: speed 8× executes exactly 8 `stepMarket` calls per 80 ms interval; margin call and restart work (FR-004).
- Every user-visible string exists in `pl.json` and `en.json` with identical key sets (test); `en-GB` browser → EN (FR-019).
- Layout has no horizontal scroll at 360 px width (checked by Vitest CSS-free logic only; visual check is manual, heavy axe is M6).
- Web bundle stays free of server code; `web` imports only `shared` (ARCH dependency rules).

## Scope & Constraints
- **In scope:** FR-001 (auth screens, verification, reset), FR-002 (nickname UI + random default on first verified login), FR-004 (single play), FR-005 (news bar UI), FR-006 (menu), FR-018 (privacy page PL/EN, account deletion with re-auth), FR-019 (i18n), FR-020 (dark theme, 360 px), BP-001, BR-021, BR-016 (settings change), UF-001, UF-002, UF-006, WCAG basics at build time (labels, focus, reduced motion; full audit is M6).
- **Out of scope:** WebSocket and room screens (M5), Worker auth (M3), Firebase production project (M6), Pages deploy (M6), axe/Lighthouse (M6), e2e (M6).
- **Hard constraints:**
  - NFR-005 bundle ≤ 300 KB gzip: checked in M6, but this ticket must not add anything large. Firebase imports only the modular `firebase/auth` subset; no UI library.
  - Firebase SDK **only** in `web/src/auth/` (ARCH dependency rule).
  - No `v-html` (CODE_QUALITY).
  - No persistence beyond language choice in `localStorage` (CODE_QUALITY, BR-020).
  - Single play results not stored anywhere (BR-006).
- **Trade-offs:**
  - Routing with `vue-router` (user decision; ~10 KB gzip) accepted for real URLs and the back button. CODE_QUALITY dependency list is updated in this ticket.
  - Self-hosted fonts (user decision): costs a few hundred KB of woff2 in `public/`, but none of it counts toward the JS bundle budget; no third-party request, which keeps the privacy policy simpler.
  - Rooms button is shown on the menu (FR-006) but disabled until M5 (`aria-disabled`, no route). Avoids a placeholder screen.

## Architecture & Design

### High-Level Flow
```
main.ts → router (guards) → App.vue
  guard: session state from auth/session.ts
    logged out           → /login
    unverified           → /verify
    verified             → /menu, /single, /settings, /privacy (public), /rooms (M5)
  single play: views/SinglePlayView.vue → single/useSinglePlay.ts → shared engine
                         → components/PriceChart.vue (canvas)
```

### Key Changes

**Package `packages/web`** (Vue 3 + Vite + TS):
- `package.json` — `@fm/web`; deps: `vue`, `vue-router`, `vue-i18n`, `firebase` (auth only), `@fm/shared` (workspace). Dev: `vite`, `@vitejs/plugin-vue`, `vitest`, `happy-dom` (only for component-level tests), `@vue/test-utils`, `eslint-plugin-vue`.
- `tsconfig.json` extends base; `"types": ["vite/client"]`.
- `vite.config.ts` — plugin vue, `test` block (`environment: "happy-dom"` for component tests, `node` default for pure modules), `server.port` default.
- `index.html` — `<html lang="pl">` placeholder, replaced at runtime by `document.documentElement.lang`; `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- `public/fonts/` — `space-grotesk-latin-{500,700}.woff2`, `space-grotesk-latin-ext-{500,700}.woff2`, `jetbrains-mono-latin-500.woff2`, `jetbrains-mono-latin-ext-500.woff2`. Downloaded from Google Fonts (OFL), committed.
- `src/main.ts` — createApp, router, i18n, mount.
- `src/router/index.ts` — routes: `/login`, `/verify`, `/menu`, `/single`, `/settings`, `/privacy`; `beforeEach` guard using `session` (see below). `/rooms` route added in M5. Unknown path → `/menu` or `/login` by session.
- `src/auth/firebase.ts` — **only file** that imports `firebase/*`. Initialises app from `import.meta.env.VITE_FIREBASE_*` config; if `VITE_AUTH_EMULATOR_URL` is set, `connectAuthEmulator(auth, url, { disableWarnings: true })`.
- `src/auth/session.ts` — reactive `session: { status: 'loading'|'out'|'unverified'|'verified', user: { uid, email (private to Settings only), nick } }`. Uses `onAuthStateChanged` + `user.reload()` after verify. Firebase SDK types are trusted here (no zod: the SDK is the boundary, not the socket).
- `src/auth/actions.ts` — `register(email, pw)`, `login(email, pw)`, `logout()`, `resendVerification()`, `checkVerified()`, `sendReset(email)`, `changeNick(nick)` (validated by `shared/validation.ts`, then `updateProfile({displayName})`), `deleteAccount(password)` (reauthenticate with `EmailAuthProvider.credential`, then `deleteUser`), `ensureNick()` (if `displayName` empty and verified → `randomNick(Math.random)` → `updateProfile`) (BP-001 step 4).
- `src/auth/errors.ts` — maps Firebase error `code` (e.g. `auth/email-already-in-use`, `auth/wrong-password`, `auth/invalid-credential`, `auth/network-request-failed`, `auth/too-many-requests`) to i18n keys `auth.error.*`. Code comparison only, never message text (CODE_QUALITY). Unknown code → `auth.error.unknown`.
- `src/views/LoginView.vue` — register/login toggle (`role="tablist"`-style toggle buttons with `aria-pressed`), email, password (min 8 for register, FR-001), "Forgot password" link → inline reset form (sends email, shows `auth.resetSent`), error region `role="alert"`.
- `src/views/VerifyView.vue` — "Resend" and "I've verified" buttons (UF-001).
- `src/views/MenuView.vue` — "Single play" (enabled), "Rooms" (`aria-disabled="true"` until M5), nickname display, settings link, logout (FR-006).
- `src/views/SinglePlayView.vue` — layout per prototype and mockup (`docs/design/Round.dc.html` chart/stats/buttons, `docs/game/first-million.html` features): header with mode and PL/EN chips; price + change; news bar; chart with halt overlay and margin call overlay; stats (capital, open P&L, position, total); controls: size chips (`aria-pressed`), speed chips, pause; Buy / Close / Sell; hint; last 8 trades; footer (trades, win rate, peak).
- `src/views/SettingsView.vue` — nickname form (validated), language switch, link to privacy, logout, "Delete account" (requires password re-entry, FR-018).
- `src/views/PrivacyView.vue` — policy text from i18n keys (`privacy.*`), PL and EN (FR-018, BR-021): scope = email + nickname in Firebase, Cloudflare as infrastructure, no game-result storage.
- `src/single/useSinglePlay.ts` — composable. Holds `Market`, `Portfolio`, trade history (last 8), counters (`closedTrades`, `wins`, `peakEquity`), `speed`, `qty`, `paused`, `over`. Owns the 80 ms `setInterval` (ARCH: timers in shell only; for web the composable is the shell): each interval computes `elapsed = min(now − last, 250)` (prototype L542), calls `tickHalt(market, elapsed)` (unless paused), runs `speed` × `stepMarket`, checks `isBankrupt` → `liquidate` → `over = true`. Trade actions: `buy()`, `sell()`, `close()` call `executeOrder`/`closePosition` at `market.price` with spread (the same functions as the server; client mirrors them for single play only, BR-006). Keyboard B/S/C handled in view with the same guard as prototype (ignore when focus in input). `restart()` resets state. `dispose()` clears interval and key listeners.
- `src/single/history.ts` — pure: `pushTrade(history, trade, max = 8)`.
- `src/components/PriceChart.vue` + `src/components/priceChart.ts` (pure draw helper taking `ctx`, `prices`, `avg`, `viewLen = 220`): right-hand price axis, grid, entry dashed line when position open, last-price marker, `ResizeObserver` for DPR. Canvas `role="img"` with `aria-label` from i18n. Reduced-motion: no animated transition (chart has none; keep it that way).
- `src/components/NewsBar.vue` — text from `news.*` i18n keys; class `hot up|down|warn` for 90 ticks (FR-005); `aria-live="polite"`.
- `src/components/ChipGroup.vue` — generic `role="group"` with `aria-pressed` buttons (qty/speed/lang). Props typed; no boolean flags beyond `disabled`.
- `src/styles/tokens.css` — CSS custom properties on `:root` (PRD §16 tokens): `--bg #07090d`, `--surface #0f141b`, `--border #1c2530`, `--text #e6edf3`, `--muted #7d8a99`, `--up #2ee59d`, `--down #ff5d6c`, `--gold #f5c451`, `--on-gold #1a1405`, `--grid`, `--font-ui`, `--font-data`. Dark only (PRD §10.3 light theme out of scope). Also `body { background: var(--bg) }` explicitly. `@media (prefers-reduced-motion: reduce)` disables transitions.
- `src/styles/fonts.css` — `@font-face` for Space Grotesk and JetBrains Mono with `font-display: swap`, `unicode-range` split latin / latin-ext.
- `src/i18n/index.ts` — vue-i18n (legacy: false, composition), locale from `localStorage['fm-lang']` (try/catch) else `navigator.language` (`pl*` → PL, else EN) (FR-019). Number/currency via `Intl` per locale (`pl-PL` / `en-US`). Helper `formatMoney(n)` (2 decimals, `$` suffix in EN? Prototype shows no currency symbol in numbers; keep prototype format).
- `src/i18n/pl.json`, `src/i18n/en.json` — all keys. Key groups: `auth.*`, `auth.error.*`, `menu.*`, `single.*`, `news.*` (shock/flash/vol/halt/trend texts with params), `settings.*`, `privacy.*`, `common.*`.
- `src/i18n/locale-keys.test.ts` — asserts identical key sets PL/EN (ARCH "locale completeness").

**Package `packages/shared`** (small additions):
- `src/validation.ts` already has nick rules from M1. No change needed.

**Dependencies (new, with reasons):**
- `vue-router` — user decision (real URLs, back button).
- `vue-i18n` — FR-019, CODE_QUALITY deps list.
- `firebase` (use `firebase/app` and `firebase/auth` only; tree-shaken).
- `eslint-plugin-vue` — `<script setup>` lint rules; added to the root ESLint config.
- Dev only: `happy-dom`, `@vue/test-utils`, `@vitejs/plugin-vue`.

**Docs in this ticket:**
- `docs/CODE_QUALITY.md` Principles → KISS: "Deps limited to Vue, vue-i18n, vue-router, Firebase Auth, zod." (add `vue-router`).
- `docs/PRD.md` §19 M2 DoD: replace "deployed to Pages" with "deployed to Pages in M6 (see §20 row 36)". Row 36 added to §20: "All deployment (Pages, Worker, Firebase project setup) in M6; M1–M5 run locally".

### Fit with Project Docs
- **PRD:** FR-001, FR-002 (UI side), FR-004, FR-005 (UI), FR-006, FR-018, FR-019, FR-020, BP-001, BR-001, BR-002, BR-006, BR-016 (UI), BR-021, UF-001, UF-002, UF-006. Single play results not stored (BR-006): no `localStorage` for results, only language.
- **ARCHITECTURE:** `web` imports `shared`, never `worker`. Firebase only in `web/src/auth/`. No WebSocket code here (web/net is M5). Timers in the composable are the web equivalent of the DO shell; cleaned on unmount.
- **CODE_QUALITY:** `<script setup lang="ts">`; logic in composables; PL+EN keys; `prefers-reduced-motion`; 360 px; no `v-html`; no literal UI text; Firebase error codes matched by code, not text; `localStorage` only for language and wrapped in try/catch.
- **Docs to update:** CODE_QUALITY deps list; PRD §19 M2 DoD; PRD §20 row 36 (deploy in M6).

### Alternative Approaches Considered
- **State-driven screens without router (Option A):** Pro: zero dep. Con: no back button, no shareable URLs; user chose router. Not chosen.
- **`vue-router` with lazy routes (chosen):** Pro: URLs, guards in one place, lazy-loaded views keep the initial bundle small. Con: ~10 KB gzip extra. Accepted.
- **Firebase Auth via REST instead of SDK (Option B):** Pro: no SDK bundle. Con: reimplements token refresh, verification polling, reauth. Not chosen (KISS: platform first is fine, SDK is the platform for Firebase).
- **Canvas drawing via a chart library (Option C):** Pro: less code. Con: violates CODE_QUALITY (no chart libraries). Not chosen.
- **Single play via a Web Worker timer:** Pro: not throttled in background tabs. Con: more code; prototype uses `setInterval` and the tab-throttle behaviour is acceptable for single play. Not chosen (KISS).

## Implementation Steps

1. [ ] Scaffold `packages/web`: `package.json` (`@fm/web`, deps and devDeps from Key Changes), `tsconfig.json`, `vite.config.ts` (vue plugin, Vitest block), `index.html` (viewport meta, `lang` placeholder), `src/main.ts`.
2. [ ] Extend root `eslint.config.js` with `eslint-plugin-vue` flat `vue3-recommended` for `packages/web/**/*.vue`; `parserOptions.parser` for `.vue` set to `vue-eslint-parser` with `@typescript-eslint/parser`.
3. [ ] `src/styles/tokens.css` (PRD §16 values on `:root`, `body` background explicit, reduced-motion rule) and `src/styles/fonts.css` (`@font-face` ×4, `font-display: swap`, `unicode-range` for latin/latin-ext). Add the 6 woff2 files to `public/fonts/`.
4. [ ] `src/i18n/index.ts` with locale detection (try/catch on `localStorage`; `navigator.language` `pl*` → `pl`, else `en`), `setLocale(l)` that writes `fm-lang` in try/catch, sets `document.documentElement.lang`.
5. [ ] `src/i18n/pl.json` and `src/i18n/en.json` with the key groups listed in Key Changes (all PL/EN texts from prototype L197–249 and PRD §11 UF-001/UF-002/UF-006 and FR-018 privacy scope).
6. [ ] `src/i18n/locale-keys.test.ts`: identical flattened key sets; no empty string values. Plus `en-GB` → `en`, `pl-PL` → `pl` (FR-019 AC).
7. [ ] `src/auth/firebase.ts` (SDK init + optional emulator), `src/auth/session.ts` (reactive session status, `onAuthStateChanged`), `src/auth/errors.ts` (code → i18n key map, unit test for every mapped code and the unknown fallback).
8. [ ] `src/auth/actions.ts`: register, login, logout, resend, checkVerified (`user.reload()`), sendReset, changeNick (uses `isValidNick` from `@fm/shared`), deleteAccount (reauth + `deleteUser`), ensureNick (random `Trader-NNNN` via `randomNick(Math.random)` when `displayName` empty and verified). Unit test with mocked `firebase/auth` module: ensureNick only when empty; changeNick rejects `ab` before calling Firebase.
9. [ ] `src/router/index.ts`: routes and `beforeEach` guard per Key Changes (loading → wait; out → /login; unverified → /verify; verified blocks /login and /verify → /menu). Lazy-load views with dynamic `import()`. Unit test with `session` stub: the 3 status cases (FR-001 AC: logged-out sees login only; unverified sees verify only).
10. [ ] `src/views/LoginView.vue`: register/login toggle with `aria-pressed`, email and password fields with `autocomplete`, min-8 check on register (FR-001 AC: 7-char password → validation error shown), error region `role="alert"`, "Forgot password" inline form.
11. [ ] `src/views/VerifyView.vue`: resend (with cooldown label? no: plain button) and "I've verified" → `checkVerified()` → route to `/menu` when verified.
12. [ ] `src/views/MenuView.vue`: Single play, Rooms (`aria-disabled`, no route until M5), nickname, settings link, logout (FR-006 AC: verified user sees both modes).
13. [ ] `src/single/useSinglePlay.ts` + `src/single/history.ts`: state, 80 ms interval with `elapsed = min(now − last, 250)`, `tickHalt`, `speed` × `stepMarket`, bankruptcy → `liquidate` → `over`, buy/sell/close via shared portfolio functions, `restart()`, `dispose()`.
14. [ ] Unit tests `useSinglePlay` (fake timers, seeded RNG injected through an `options.rng` seam and `options.clock` seam):
    - FR-004 AC: speed 8× → 8 `stepMarket` calls per 80 ms interval (spy count).
    - BR-015/FR-005: TRADING_HALT → `buy()` is a no-op while halted; `close()` also no-op.
    - BR-005/FR-003: equity ≤ 0 → `over` true, position closed (margin call state).
    - FR-004 AC: "Play again" → initial state (`restart()`).
    - BR-006: no `localStorage`/`sessionStorage` writes from the composable (spy).
    - pause stops the interval's price steps; halt countdown paused with it (prototype edge case).
15. [ ] `src/components/priceChart.ts` (pure draw function) + `PriceChart.vue` (ResizeObserver, DPR, `role="img"`, `aria-label`). Unit test: `priceChart` computes the same window and scaling as prototype (`VIEW = 220`, `pad = 12%`, `lo/hi` including entry), using a stub `ctx` recording calls.
16. [ ] `src/components/NewsBar.vue`, `ChipGroup.vue`. Test: ChipGroup sets `aria-pressed` on the active value only; NewsBar class `hot` only within 90 ticks.
17. [ ] `src/views/SinglePlayView.vue`: layout per Key Changes at 360 px first (single column, stats in 2×2 grid), keyboard B/S/C (ignored in inputs), halt overlay with countdown (`aria-live`), margin call overlay with "Play again" button (UF-002), history empty state key (`single.histEmpty`).
18. [ ] `src/views/SettingsView.vue`: nickname form (`isValidNick`, error key on invalid), language switch (`setLocale`), privacy link, logout, delete account with password prompt (FR-018 AC: correct password → account deleted and logged out; wrong → error key).
19. [ ] `src/views/PrivacyView.vue` with `privacy.*` keys (PL + EN; email + nickname in Firebase, Cloudflare infrastructure, no result storage).
20. [ ] Wire `App.vue` (header with PL/EN chips via `ChipGroup`, `<RouterView>`), global focus-visible style, skip link to main content (WCAG 2.4.1).
21. [ ] Light component smoke test (happy-dom): mount `MenuView` as verified user → both mode buttons present, Rooms has `aria-disabled="true"` (FR-006 AC).
22. [ ] Docs: `docs/CODE_QUALITY.md` deps list gains `vue-router`; `docs/PRD.md` §19 M2 DoD amended ("deployed to Pages in M6"); `docs/PRD.md` §20 row 36 ("all deploy in M6").
23. [ ] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` green; all steps ticked; Implementation Log filled.

## Checkpoints (Todo List)

- [ ] CP1 — Shell: steps 1–6 (scaffold, tokens, fonts, i18n, locale test); `pnpm --filter @fm/web test` green for i18n; typecheck clean.
- [ ] CP2 — Auth and routing: steps 7–12 (firebase/session/actions/errors, guard, Login/Verify/Menu views); Vitest green for errors, actions and router guard.
- [ ] CP3 — Settings, privacy, delete: steps 18–19; Vitest green for `changeNick` validation and deleteAccount path (mocked).
- [ ] CP4 — Single play: steps 13–17; Vitest green for `useSinglePlay` (FR-004 AC), chart helper, ChipGroup, NewsBar; typecheck clean.
- [ ] CP5 — App wiring and docs: steps 20–23; lint, typecheck and all Vitest green.

## Risks & Mitigations

- **Risk:** Single-play tick drifts when the tab is in background (browsers throttle `setInterval` to ≥1 s). Elapsed is capped at 250 ms (prototype), so price history would be short but prices stay consistent with time.
  - Mitigation: keep the prototype's 250 ms elapsed cap, so time in the background is not replayed as a burst. Single play is not time-critical; multiplayer time lives on the server.
  - Mitigation if it matters later: move the loop into a dedicated Web Worker timer. Not done now (KISS).
- **Risk:** Firebase SDK pushes the bundle over 300 KB gzip (NFR-005).
  - Mitigation: import only `firebase/app` + `firebase/auth` (modular, tree-shaken). Login is the first screen, so the auth module cannot be lazy-loaded. Measured in M6; if over budget, the first fallback is to move the reauth + `deleteUser` code (Settings only) into a lazy chunk. Record the measured gzip size in the M6 review.
- **Risk:** Emulator config leaks into production build.
  - Mitigation: `VITE_AUTH_EMULATOR_URL` is read only in `auth/firebase.ts`; `.env.example` lists it commented; `.env.*` is gitignored (already). Production build (M6) asserts the var is unset via a grep check.
- **Risk:** Route guard races with `onAuthStateChanged` on first load (flash of wrong screen).
  - Mitigation: `session.status === 'loading'` renders a neutral splash; guard waits for the first auth event (`await ready` promise).
- **Risk:** Font files bloat the repo (≈ 300 KB of woff2).
  - Mitigation: latin + latin-ext subsets only, weights 500/700 only. Accepted.
- **Risk:** Downloading the woff2 files (step 3) needs network access, which the implementer may not have.
  - Mitigation: if the download fails, stop at step 3, record the failure in the Implementation Log, and continue with steps 4–23 using the system font stack (`font-family` fallback). Step 3 is then re-run later. Tests do not depend on the font files.

## Test Strategy

**Light (during implementation):**
- Vitest, `packages/web` (`node` env for pure modules, `happy-dom` for components):
  - `locale-keys.test.ts`: PL/EN key parity, no empty values, locale detection cases.
  - `auth/errors.test.ts`: every mapped Firebase code → key; unknown → fallback.
  - `auth/actions.test.ts` (mocked `firebase/auth`): ensureNick, changeNick validation before any network call, deleteAccount reauth.
  - `router/guard.test.ts`: FR-001 AC (logged-out sees login only; unverified sees verify only), verified → menu.
  - `single/useSinglePlay.test.ts`: FR-004 AC (8× → 8 steps per 80 ms), halt blocks trades, bankruptcy → over, restart, no storage writes (BR-006), pause.
  - `components/priceChart.test.ts`, `components/chip-group.test.ts`, `components/news-bar.test.ts`.
  - `views/menu.test.ts`: FR-006 AC, Rooms disabled until M5.
- `pnpm lint`, `pnpm typecheck`.

**Heavy (review only, not here):** production build and bundle size (NFR-005), Lighthouse, axe audit at 360 px (NFR-003), Playwright single-play e2e (written in M6). Manual check at 360 px is recommended during review.

## Success Checklist
- [ ] All success criteria met, with evidence
- [ ] Lint, typecheck, Vitest green in `packages/web`
- [ ] Firebase imported only in `src/auth/`; no `v-html`; no literal UI text (grep check in review)
- [ ] Docs updated (CODE_QUALITY deps, PRD §19 M2 DoD, PRD §20 row 36)
- [ ] Code review approved (`first-million-review`, heavy checks included there)
- [ ] No regressions (M1 engine tests still green)

## Timeline & Estimates
- Phase 1 (scaffold, i18n, tokens, fonts): ~4 h
- Phase 2 (auth, router, login/verify/menu): ~6 h
- Phase 3 (single play engine, chart, view, tests): ~8 h
- Phase 4 (settings, privacy, delete, docs, review): ~4 h
- **Total**: ~22 h (rough, plus buffer)

## Open Questions
- [ ] Firebase emulator URL convention for the dev script (`http://127.0.0.1:9099`) — assumed default; confirm when setting up the emulator locally.

## Implementation Log
(Empty. first-million-implement appends one line per step event here.)
