# Installable PWA and offline single play — Implementation Plan

Milestone M7 "Mobile app", part 1 of 2 (part 2: `specs/09-android-app.md`). Touches `web`, PRD, ARCHITECTURE, CODE_QUALITY. No `shared` or `worker` change.

## Summary
Users want the game as an app: home-screen icon, fullscreen, and single play without network. Native store apps are out for cost (NFR-002, 0 PLN: no Apple $99/yr, no Google $25) and the user has no Mac, so iOS gets an installable PWA ("Add to Home Screen") and Android Chrome gets the same; the Android APK follows in spec 09. This spec makes `packages/web` installable (manifest, icons, service worker precaching the static shell), adds an update prompt that never reloads mid-round, and lets a user who logged in once online start single play offline. Planned on `main` at `d50def0`. **The working tree has uncommitted changes** in `packages/web/src/App.vue`, `app.test.ts`, `router/back.ts`, `router/back.test.ts`, `router/guards.ts`, `router/guards.test.ts`, `router/index.ts`, `test-support.ts`, `views/LoginView.vue`, `views/RoomView.vue`. This spec edits `App.vue` and leans on the router guard; a worktree created from `HEAD` will not see that work, so commit it first or implement on the current branch.

## Success Criteria
- Installability: on iPhone Safari (Share → Add to Home Screen) and Android Chrome (Install app) the app installs, opens standalone (no browser bar) in portrait, with the gold logo icon and theme colour `#07090d`. Manual check on the user's iPhone and Android phone, recorded in the Implementation Log.
- Offline single play: after one online login and one load, with network off, a verified user reaches `/menu` (Rooms disabled with a notice), starts single play and plays a round to its end. Manual check on both devices; logic covered by Vitest (session, menu offline state).
- Budget: `pnpm bundle:check` counts `sw.js` too and stays ≤ 300 KB gzip; page JS (143 KB gzip today) grows ≤ 2 KB, because the page loads no Workbox code.
- Cache discipline (BR-020): the service worker precaches only `dist/` files and has no runtime cache routes; `pwa-config.test.ts` asserts it.
- Update flow: after a new deploy the "New version available" toast appears; the page reloads only on the user's "Reload" click (Vitest on the update reducer and register; manual two-build check).

## Scope & Constraints
- **In scope:** new FR-021 (installable web app: manifest, icons, standalone, portrait, safe-area insets, extends FR-020), new FR-022 (offline single play with a cached session, amends BR-001), update toast (NFR-003, FR-019), menu offline state, install hint on the menu, bundle check counting `sw.js` (NFR-005).
- **Out of scope:** Android APK, native plugins, protocol version and the "Update required" screen, keep-awake (all spec 09); push notifications (dropped for v1); background sync; offline rooms; caching any game data or Firebase responses (BR-020); a `beforeinstallprompt` install button (the hint text covers both platforms, YAGNI); offline e2e (manual only, decided).
- **Hard constraints:** NFR-002 0 PLN (dev-only tooling, Pages already hosts); BR-020 (SW caches built static files only; the architecture test's storage allowlist `auth/firebase.ts`, `i18n/locale.ts` stays unchanged, so the install-hint dismissal is in-memory); BR-006/BR-007 unchanged (single play is already local); NFR-005; NFR-003 (live region, keyboard, no focus theft, `prefers-reduced-motion`, 360 px); FR-019 PL + EN; ARCHITECTURE dependency rules (Firebase only in `auth/`, WebSocket only in `net/`).
- **Trade-offs:**
  - Precache the whole shell on first visit (≈ 143 KB gzip JS + fonts + icons) over lazy runtime caching: reliable offline play and no missing lazy chunk after a deploy, at the cost of one background download after `load`.
  - `injectManifest` with our own ~20-line `src/sw.ts` over `generateSW`: explicit `SKIP_WAITING` handler and an explicit "no runtime cache" rule.
  - Own ~40-line `src/pwa/register.ts` over `virtual:pwa-register`: the latter puts `workbox-window` into the page bundle (a runtime dependency outside the CODE_QUALITY list).
  - One hint text for both platforms, no user-agent sniffing.
  - Offline single play verified by hand only: e2e runs on the Vite dev server (SW disabled) and a production build cannot log in to the Auth emulator (decisions 35, 43); a special e2e build mode was rejected.

## Architecture & Design

### High-Level Flow
```
first online visit: index.html -> manifest link; main.ts -> registerServiceWorker() after load (PROD only)
   sw.js install: precache index.html, assets/*.js|css, fonts/*.woff2, icons/*, favicon.svg
install: iOS Share -> Add to Home Screen | Android Chrome -> Install app  => standalone, portrait, start_url "/"
offline launch: NavigationRoute -> precached index.html
   Firebase restores user from IndexedDB (no network) -> session 'verified' -> /menu
   /menu: Single play enabled, Rooms aria-disabled + "Rooms need a connection"
   /single: local engine (BR-006), unchanged
new deploy: new sw.js installs -> waiting (no auto skipWaiting)
   register.ts sees waiting -> updateState 'ready' -> UpdateToast
   Reload -> postMessage SKIP_WAITING -> controllerchange -> one location.reload()
   Later -> hidden for this visit (in memory)
```

### Key Changes
- **`packages/web/public/manifest.webmanifest`** (new): `id` "/", `name`/`short_name` "First Million", `start_url` "/", `scope` "/", `display` "standalone", `orientation` "portrait", `background_color` and `theme_color` `#07090d` (= `--bg` in `src/styles/tokens.css`, pinned by a test), icons 192, 512, 512 maskable. A static file, not plugin-generated (`manifest: false`), so it is readable and testable.
- **`packages/web/public/icons/`** (new, generated once, committed): `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (full-bleed `#07090d`/gold background, glyph in the 80 % safe zone), `apple-touch-icon.png` (180). Source `public/favicon.svg` (the only logo asset); generator config `packages/web/pwa-assets.config.ts` with `@vite-pwa/assets-generator`, not part of `build`.
- **`packages/web/public/_headers`** (new): `Cache-Control: no-cache` for `/sw.js` and `/manifest.webmanifest` (Pages copies `public/` to `dist/`).
- **`packages/web/index.html`**: add `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color" content="#07090d">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`; keep `viewport-fit=cover`.
- **`packages/web/src/sw.ts`** (new, service-worker source, not in the page bundle): `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches()`, one `NavigationRoute(createHandlerBoundToURL('index.html'))` with denylist `[/^\/ws\//]`, a `message` listener calling `self.skipWaiting()` only for `{ type: 'SKIP_WAITING' }`. No `clientsClaim`, no runtime routes.
- **`packages/web/tsconfig.sw.json`** (new): `lib` `["ES2022", "WebWorker"]`, includes `src/sw.ts`; the page tsconfig excludes `src/sw.ts`. `typecheck` script becomes `vue-tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.sw.json`. Check the root `eslint.config.js` `projectService` picks the new tsconfig (add it to `parserOptions` if not).
- **`packages/web/vite.config.ts`**: add `VitePWA({ strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', injectRegister: false, manifest: false, devOptions: { enabled: false }, injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] } })`. Production key guard unchanged. Option names checked against vite-plugin-pwa 1.3.0 docs at implementation.
- **`packages/web/src/pwa/update-state.ts`** (new, pure): `type UpdateState = 'idle' | 'ready' | 'applying' | 'dismissed'`; `reduceUpdate(state, event: 'ready' | 'apply' | 'dismiss'): UpdateState`; `applying` only from `ready` via `apply`.
- **`packages/web/src/pwa/register.ts`** (new): `registerServiceWorker(): void` returns early unless `import.meta.env.PROD` and `'serviceWorker' in navigator`; on `load` registers `/sw.js` (scope `/`); reports `ready` when `registration.waiting` exists or an `updatefound` worker reaches `installed` while a controller exists; exports a `shallowRef<UpdateState>` and `applyUpdate()` (posts `SKIP_WAITING`, reloads once on `controllerchange`). Listener-free after reload; no interval polling (browser checks on navigation).
- **`packages/web/src/components/UpdateToast.vue`** (new): `role="status"` + `aria-live="polite"`, "Reload" and "Later" buttons, above the bottom safe area, no animation under `prefers-reduced-motion`, does not move focus. Mounted once in `App.vue`.
- **`packages/web/src/components/InstallHint.vue`** (new): on `/menu` only when `matchMedia('(display-mode: standalone)')` does not match and `navigator.standalone !== true`; one text per platform line (iPhone / Android); "Hide" dismisses in memory for this visit.
- **`packages/web/src/composables/use-online.ts`** (new): `useOnline(): Readonly<Ref<boolean>>` from `navigator.onLine`, `online`/`offline` listeners removed in `onScopeDispose`.
- **`packages/web/src/views/MenuView.vue`**: offline → Rooms card rendered as a non-link with `aria-disabled="true"` and `menu.roomsOffline`; Single play unchanged; mounts `InstallHint`.
- **`packages/web/src/main.ts`**: `registerServiceWorker()` after `mount`.
- **`packages/web/src/App.vue`** + **`src/styles/base.css`**: `env(safe-area-inset-*)` added to the 16 px gutter (`max(16px, env(...))`); mount `UpdateToast`.
- **`packages/web/src/auth/session.ts`**: no code change expected; a test locks the offline first entry (cached verified user published as `verified` even if `ensureNick` rejects; `settle` already catches).
- **`packages/web/scripts/check-bundle.mjs`**: also sum root-level `dist/*.js` (`sw.js`); `check-no-emulator.mjs` already scans all of `dist`.
- **Protocol / API**: none.
- **Data model**: none. SW cache holds built files only; hint dismissal and update state are in-memory refs.
- **Config**: none in `shared/config.ts`.
- **i18n / UI (PL + EN, `en.json`/`pl.json`)**:
  - `pwa.updateAvailable`: "New version available" / "Dostępna nowa wersja"
  - `pwa.reload`: "Reload" / "Odśwież"
  - `pwa.later`: "Later" / "Później"
  - `pwa.installTitle`: "Install the app" / "Zainstaluj aplikację"
  - `pwa.installIphone`: "iPhone: Share, then Add to Home Screen" / "iPhone: Udostępnij, potem Do ekranu początkowego"
  - `pwa.installAndroid`: "Android: browser menu, then Install app" / "Android: menu przeglądarki, potem Zainstaluj aplikację"
  - `pwa.hide`: "Hide" / "Ukryj"
  - `menu.roomsOffline`: "Rooms need a connection." / "Pokoje wymagają połączenia."
- **Dependencies** (all dev, build-time): `vite-plugin-pwa@1.3.0` (peer `vite ^8`, released 2026-05-05; not 2.0.0, released 11 days ago), `workbox-precaching` + `workbox-routing` at the workbox version `vite-plugin-pwa@1.3.0` depends on (bundled into `sw.js` only, ~10–15 KB gzip, counted by the extended check), `@vite-pwa/assets-generator` (one-off icons). Not used: `workbox-window`. Runtime deps of the page: unchanged. Free plan: one precache download per install from Pages.
- **CI**: no workflow change; Vitest picks up the new tests; Pages deploys `sw.js`, manifest, `_headers` from `dist`.

### Fit with Project Docs
- **PRD**: BR-001 amended ("Exception, FR-022: a session cached by an earlier online login may open single play offline; login, registration, verification, the room list and multiplayer need the network"). BR-020 clarified (the service worker caches built static files only). FR-020 extended (safe areas, portrait). New FR-021, FR-022. §16 platforms: "web + installable web app (PWA)". §10.3 unchanged in this spec (spec 09 edits "Native apps"). §19: new M7 "Mobile app" (depends on M6; part 1 PWA, part 2 Android). §20: #46 (PWA: `injectManifest`, precache only, prompt update, own register, portrait), #47 (offline single play with a cached session, verified manually; no e2e build mode).
- **ARCHITECTURE.md**: Packages line for `web` adds `pwa/` (register, update-state), `sw.ts`, `composables/use-online.ts`, `public/` manifest, icons, `_headers`. Dependency rule: `sw.ts` imports Workbox only; page code imports no Workbox. Invariant "Memory only": add "the service-worker cache holds built static files only". Status line: M7 part 1.
- **CODE_QUALITY.md**: KISS dev-tooling list adds `vite-plugin-pwa`, `workbox-precaching`, `workbox-routing`, `@vite-pwa/assets-generator`; runtime list unchanged. Working agreement "No persistence": "browser stores only language and the Firebase session; the service worker caches built files only". Single sources: manifest colours pinned to `tokens.css` by test. YAGNI: no push, no background sync, no install button.
- **Docs to update**: PRD §5 (BR-001, BR-020), §12 (FR-020, FR-021, FR-022), §16, §19, §20; ARCHITECTURE (status, Packages, Dependency rules, Invariants); CODE_QUALITY (Principles, Working agreements).

### Alternative Approaches Considered
- Hand-written service worker, no plugin: zero deps, but we maintain the hashed precache list. Rejected.
- `generateSW` + `virtual:pwa-register`: less code, but `workbox-window` in the page and no clean `SKIP_WAITING` control. Rejected.
- `registerType: 'autoUpdate'`: silent reload mid-round. Rejected by requirement.
- Lazy runtime caching: smaller first download, but offline play may miss a lazy chunk and old chunks vanish after deploy. Rejected.
- Offline e2e via a `pwa-e2e` Vite mode: bends decisions 35/43 for one check. Rejected (user: manual only).

## Implementation Steps
1. [ ] Add dev deps to `packages/web/package.json`: `vite-plugin-pwa@1.3.0`, `workbox-precaching` and `workbox-routing` (same major as the plugin's workbox), `@vite-pwa/assets-generator`; `pnpm install`. If the plugin fails with Vite 8 / Rolldown in step 7, stop and return to planning (fallback: hand-written SW + precache-list script).
2. [ ] Create `packages/web/pwa-assets.config.ts`; generate `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` from `public/favicon.svg`; commit the PNGs.
3. [ ] Create `packages/web/public/manifest.webmanifest` (fields in Key Changes, `orientation: "portrait"`).
4. [ ] Edit `packages/web/index.html` head (manifest, apple-touch-icon, theme-color, apple-mobile-web-app meta).
5. [ ] Create `packages/web/public/_headers` (`no-cache` for `/sw.js`, `/manifest.webmanifest`).
6. [ ] Create `packages/web/src/sw.ts` and `packages/web/tsconfig.sw.json`; exclude `src/sw.ts` from `tsconfig.json`; extend the `typecheck` script; make ESLint see the SW tsconfig.
7. [ ] Configure `VitePWA` in `packages/web/vite.config.ts` (`injectManifest`, `injectRegister: false`, `manifest: false`, dev disabled).
8. [ ] Extend `packages/web/scripts/check-bundle.mjs` to sum root `dist/*.js`; add a case to `packages/web/test/check-bundle.test.ts` ("NFR-005: a root sw.js counts toward the budget").
9. [ ] Add `packages/web/test/pwa-config.test.ts`: manifest parsed with zod (required fields, `display`, `orientation: portrait`, colours equal `--bg` in `tokens.css`), icon files exist and PNG IHDR sizes match, `index.html` links, `_headers` lines, `src/sw.ts` uses only `precacheAndRoute`, `cleanupOutdatedCaches`, one `NavigationRoute` with `/ws/` denylisted, no `runtimeCaching` in `vite.config.ts`.
10. [ ] Add `packages/web/src/pwa/update-state.ts` + `update-state.test.ts` (idle→ready; apply only from ready; dismiss hides without applying).
11. [ ] Add `packages/web/src/pwa/register.ts` + `register.test.ts` (happy-dom, fake `navigator.serviceWorker`): no registration outside PROD; waiting worker → `ready`; `applyUpdate` posts `SKIP_WAITING` and reloads once on `controllerchange`.
12. [ ] Add `packages/web/src/components/UpdateToast.vue` + test (hidden when idle; Reload calls `applyUpdate`; Later hides; `role="status"`, `aria-live`). Mount in `App.vue`; call `registerServiceWorker()` in `main.ts` after `mount`.
13. [ ] Add safe-area padding in `App.vue` `.shell` and `src/styles/base.css` (gutter stays ≥ 16 px).
14. [ ] Add `packages/web/src/composables/use-online.ts` + test (initial value from `navigator.onLine`; updates on events; listeners removed on scope dispose).
15. [ ] Update `packages/web/src/views/MenuView.vue` (offline Rooms `aria-disabled` + note) and its test.
16. [ ] Add `packages/web/src/components/InstallHint.vue` + test (`matchMedia` stub: hidden in standalone; Hide dismisses in memory); mount on the menu.
17. [ ] Add the i18n keys to `en.json` and `pl.json`; locale completeness test green.
18. [ ] Add to `packages/web/src/auth/session.test.ts`: "FR-022: a cached verified user is published as verified when ensureNick rejects (offline first entry)".
19. [ ] Update docs: PRD, ARCHITECTURE, CODE_QUALITY sections listed in "Fit with Project Docs".
20. [ ] User manual checks (record in the Implementation Log): iPhone Safari Add to Home Screen → standalone portrait; Android Chrome install; offline single play on both after one online login; update toast with two deployed builds (never reloads without a click).

## Checkpoints (Todo List)
- [ ] CP1 — Installable shell: steps 1–5, 9 (manifest/icon/index/_headers cases); `pnpm lint`, `pnpm typecheck` clean, `pnpm --filter @fm/web test` green.
- [ ] CP2 — Service worker and budget guard: steps 6–8, 9 (route-audit cases); web typecheck incl. `tsconfig.sw.json` clean, `check-bundle.test.ts` and `pwa-config.test.ts` green.
- [ ] CP3 — Update flow: steps 10–12; `update-state`, `register`, `UpdateToast` tests green; lint clean.
- [ ] CP4 — Offline single play and menu: steps 13–18; `use-online`, menu, `InstallHint`, `session`, locale tests green; `architecture.test.ts` and `router/guards.test.ts` unchanged and green.
- [ ] CP5 — Docs and final light verification: step 19 (step 20 is the user's); lint, typecheck and all Vitest suites green.

### Risks & Mitigations
- Safari evicts site storage (incl. the Firebase IndexedDB session) after 7 days without use for non-installed sites; home-screen apps are exempt.
  - Mitigation: the offline promise is "installed app, after an online login on this device"; documented in FR-022.
- Stale SW: a user who ignores the toast keeps the old bundle and may talk to a newer Worker.
  - Mitigation: toast on every view while `ready`; spec 09 adds the protocol-version close (4426) which also covers PWA tabs.
- vite-plugin-pwa 1.3.0 with Vite 8 / Rolldown `codeSplitting` untested in this repo.
  - Mitigation: step 1/7 stop rule; fallback hand-written SW + precache-list script.
- `_headers` not applied by Pages → browser caches `sw.js`, updates delayed.
  - Mitigation: check the response header on the deployed site at release; browsers also cap SW script HTTP cache at 24 h.
- Offline launch blocks on `ready` if Firebase never fires `onAuthStateChanged` offline.
  - Mitigation: manual check on both devices in step 20; Firebase restores persisted users from IndexedDB without network (session test locks the `settle` path).

## Test Strategy
**Light** (implementation, whichever the user selects):
- Vitest web: `pwa-config.test.ts`, `update-state.test.ts`, `register.test.ts`, `UpdateToast` test, `use-online` test, menu offline test, `InstallHint` test, `session.test.ts` offline entry, `check-bundle.test.ts` root `sw.js`, locale completeness, `architecture.test.ts` (unchanged BR-020 allowlist).
- Lint, typecheck (incl. `tsconfig.sw.json`).

**Heavy** (`first-million-review` when selected; e2e on PR only):
- Production build + `bundle:check` (sw.js counted) + `check-no-emulator` over `dist` incl. `sw.js`.
- Lighthouse (existing LCP and score budgets; PWA category not asserted).
- axe via existing e2e on the menu (install hint and toast visible states).
- No new e2e spec (offline check is manual by decision).
- Manual: step 20 on iPhone and Android phone; keyboard-only on toast and hint; 360 px.

## Success Checklist
- [ ] All success criteria met (with evidence)
- [ ] Lint, typecheck and Vitest clean in `web`
- [ ] Heavy checks green when run: production build, bundle check with `sw.js`, axe/Lighthouse (review); Playwright on the PR
- [ ] Code review approved
- [ ] Documentation updated (sections listed in "Fit with Project Docs")
- [ ] No regressions in single play

## Timeline & Estimates
- Phase 1 (implementation): ~6 hours
- Phase 2 (testing): ~2 hours
- Phase 3 (review + device checks + polish): ~2 hours
- **Total**: ~10 hours (rough estimate, plus buffer)

## Open Questions
None. Decided during planning: PWA for iOS; portrait lock; offline single play checked manually; keep-awake and protocol version belong to spec 09; Safari 7-day eviction accepted for non-installed tabs.

## Implementation Log
