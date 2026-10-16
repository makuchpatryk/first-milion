# Android app (Capacitor, sideloaded APK) — Implementation Plan

Milestone M7 "Mobile app", part 2 of 2. **Depends on `specs/08-pwa.md` being merged** (`src/pwa/register.ts` is skipped in the APK, amended BR-001 and offline single play are reused, icons come from 08's work). Touches `shared`, `worker`, `web`, new `packages/mobile`, both workflows, PRD, ARCHITECTURE, CODE_QUALITY.

## Summary
Ship a real installable Android app at 0 PLN: a Capacitor shell around the existing Vue app with bundled assets (no remote URL), application id `com.firstmillion.app`, signed in GitHub Actions on the same `vX.Y.Z` tag that deploys production and attached to a GitHub Release for sideloading (no Google Play: NFR-002). Because a bundled APK cannot update itself, the client sends a protocol version in `auth` and the Worker closes outdated clients with a new code 4426, shown as an "Update required" screen. Native touches: Android back button, keep-awake in a round, status bar + splash, haptics on fills and margin call. Planned on `main` at `d50def0`; see 08's Summary for the uncommitted router/view work (this spec also edits `App.vue`, `RoomView.vue`, `main.ts`).

## Success Criteria
- Release: a `vX.Y.Z` tag on `main` produces `first-million-vX.Y.Z.apk` + `.sha256` on the GitHub Release; `apksigner verify` passes in the job; `versionName` = `X.Y.Z`, `versionCode` = `X*10000 + Y*100 + Z`. `workflows.test.ts` asserts the APK jobs run only on the tag (no branch, PR or manual trigger).
- Protocol skew: `auth` without `protocolVersion` or with any value ≠ `PROTOCOL_VERSION` closes with 4426 before token verification; the client does not reconnect and shows "Update required" (shared, worker, web Vitest).
- Pages build untouched: `check-no-native` finds no `@capacitor` code or `virtual:native-bridge` in `packages/web/dist`; web JS gzip total unchanged by this spec except the bridge stub, wake-lock and update screen (≤ 2 KB).
- Native behaviour (manual on the user's Android phone): installs from the APK; works offline to the menu after one online login; back on `/menu` exits, back on a sub-screen goes back, a dialog closes first; screen stays on during a round; status bar `#07090d`, splash hides after mount; vibration on fills and margin call; portrait only. Pure `backAction` covered by Vitest.
- Light checks: lint, typecheck, Vitest green in `shared`, `worker`, `web`, `mobile`.

## Scope & Constraints
- **In scope:** new FR-023 (Android app, APK via GitHub Release), new FR-024 (protocol version + update screen; amends FR-007 close codes and origin allowlist), new FR-025 (native touches), new BR-022 (a client whose protocol version differs is refused and asked to update); `packages/mobile`; `web/src/native/` seam; Worker allowlist; `deploy.yml` release jobs; `ci.yml` heavy debug build.
- **Out of scope:** iOS native app, Google Play, App Store, any fee (iOS stays on the PWA from 08); push notifications; in-app updater / Capacitor Live Updates / remote URL; Firebase native SDKs (web SDK in the WebView); keyboard plugin (`adjustResize` first); keep-awake plugin (Web Wake Lock API chosen).
- **Hard constraints:** NFR-002 0 PLN (public repo: GitHub Actions and Releases free); BR-007 server authority unchanged; BR-020 (WebView stores only language + Firebase session, as on web); deploy only from tags (Claude never creates tags or runs `wrangler deploy`); NFR-004 (release keystore only in `production` environment secrets, never in files or logs; Origin check stays, one origin added); NFR-005 (Capacitor code only in the APK build, guarded by `check-no-native`); FR-019 PL + EN; ARCHITECTURE: `web` imports no `@capacitor/*` and nothing from `packages/mobile`.
- **Trade-offs:**
  - Plugins only in `packages/mobile`, injected through a `virtual:native-bridge` Vite alias (stub in the Pages build) over `@capacitor/*` in web deps with dynamic import: web keeps its runtime-dependency list and a verifiable zero-Capacitor Pages build, at the cost of one alias and a mobile Vite config that wraps the web one.
  - Keep-awake via the Web Wake Lock API over a community plugin: no dependency, and it also helps PWA/browser players (deliberately not a no-op on web).
  - Exact version match (`!==`) over "refuse only older": simplest rule; a Worker rollback would also refuse newer APKs (acceptable: bump only on breaking protocol changes).
  - Debug APK build in the `ci.yml` heavy job on `main`: catches Gradle breakage before a tag, ~5 min extra on main pushes (free, public repo).

## Architecture & Design

### High-Level Flow
```
tag vX.Y.Z on main -> deploy.yml
  verify (unchanged) -> deploy (Worker + Pages, unchanged)
                     -> android: build web (mode native) -> packages/mobile/www -> cap sync
                                 -> check-no-emulator on www -> keystore from secret
                                 -> gradlew assembleRelease -PversionName -PversionCode -> apksigner verify -> artifact
  release (needs deploy, android): gh release create $TAG --verify-tag  apk + sha256

APK at runtime: WebView https://localhost serves www/ (bundled)
  Firebase web SDK (REST) | WebSocket -> prod Worker, Origin https://localhost (allowlisted)
  auth {token, protocolVersion} -> AuthGate: version !== PROTOCOL_VERSION -> close 4426
  ws-client: 4426 terminal -> UpdateRequired (native: open releases page; web: Reload)
  native seam: web/src/native/bridge.ts (interface) <- virtual:native-bridge
               Pages build: bridge-stub.ts | APK build: packages/mobile/src/native-bridge.ts (@capacitor/*)
```

### Key Changes
- **`packages/shared/src/config.ts`**: `export const PROTOCOL_VERSION = 1` (comment: bump only on an incompatible protocol change; FR-024, BR-022).
- **`packages/shared/src/protocol/close-codes.ts`**: add `CLIENT_OUTDATED: 4426`.
- **`packages/shared/src/protocol/client.ts`** (`auth` schema, l.97): add `protocolVersion: z.number().int().min(0).optional()`; stays `.strict()`. Optional on purpose: today's clients send no field and must get 4426, not a parse failure that becomes 4401. Absent = 0.
- **`packages/worker/src/auth/auth-gate.ts`**: `fail()` becomes `failWith(code)` (existing callers pass `AUTH_FAILED`); in `handle`, after parse and before `verify`, `if ((msg.protocolVersion ?? 0) !== PROTOCOL_VERSION) return this.failWith(CLOSE_CODES.CLIENT_OUTDATED)`. Applies to refresh `auth` as well.
- **`packages/web/src/net/ws-client.ts`**: `sendAuth` adds `protocolVersion: PROTOCOL_VERSION` (from `@fm/shared`); `handleClose` treats `CLIENT_OUTDATED` like `KICKED`/`ROOM_CLOSED` (terminal, `onStatus('closed', code)`, no retry).
- **`packages/web/src/room/error-map.ts`**: `closeKey(4426)` → `close.clientOutdated`.
- **`packages/web/src/native/bridge.ts`** (new): `export interface NativeBridge { onBackButton(handler: () => void): () => void; exitApp(): void; haptic(kind: 'fill' | 'margin'): void; openExternal(url: string): void; ready(): void }`; `export const isNative = import.meta.env.VITE_NATIVE === 'true'`; `installNativeBridge(): Promise<NativeBridge | null>` (null on web, else `(await import('virtual:native-bridge')).createBridge()`); `getBridge(): NativeBridge | null`.
- **`packages/web/src/native/bridge-stub.ts`** (new): `createBridge()` throws (never called on web; lets the Pages build resolve the import).
- **`packages/web/src/native/links.ts`** (new): `RELEASES_URL = 'https://github.com/makuchpatryk/frist-milion/releases/latest'`.
- **`packages/web/src/native/back-button.ts`** (new, pure): `backAction({ path, status, dialogOpen }): 'close-dialog' | 'router-back' | 'exit'` — dialog open wins; `backFor(path, status)` (`router/back.ts`) non-null → router back; else exit. A running round keeps the existing leave behaviour (no silent exit mid-round from a sub-screen).
- **`packages/web/src/native/haptics.ts`** (new): `pulse(kind)` → `getBridge()?.haptic(kind)`. Called from `composables/use-room.ts` on `order.ok` and on own status becoming `eliminated`, and from `single/useSinglePlay.ts` on a local fill and on a margin-call end. Reducers stay pure.
- **`packages/web/src/native/wake-lock.ts`** (new): `useKeepAwake(active: Readonly<Ref<boolean>>)` — requests `navigator.wakeLock.request('screen')` while active, releases when inactive or on scope dispose, re-requests on `visibilitychange` to visible; feature-detected, errors swallowed (lock is best effort). Used in `views/RoomView.vue` (round running) and `views/SinglePlayView.vue` (round started, not ended).
- **`packages/web/src/components/UpdateRequired.vue`** (new): title + body; native → button `bridge.openExternal(RELEASES_URL)`; web → Reload button. Rendered by `views/RoomsView.vue` and `views/RoomView.vue` when `closeCode === CLOSE_CODES.CLIENT_OUTDATED`.
- **`packages/web/src/main.ts`**: `await installNativeBridge()` before `createApp`; `getBridge()?.ready()` after mount (hides splash).
- **`packages/web/src/App.vue`**: when a bridge exists, register `onBackButton` → `backAction(...)` with router, `session.status`, `document.querySelector('[role="dialog"],[role="alertdialog"]') !== null`; unregister on unmount.
- **`packages/web/src/pwa/register.ts`** (from 08): return early when `isNative`.
- **`packages/web/src/env.d.ts`**: `VITE_NATIVE?: string`; `declare module 'virtual:native-bridge' { export function createBridge(): import('./native/bridge').NativeBridge }`.
- **`packages/web/vite.config.ts`**: `resolve.alias` `virtual:native-bridge` → `src/native/bridge-stub.ts`; production key guard extended from `mode === 'production'` to every mode except `development`/`test`, so the `native` build fails without Firebase values.
- **`packages/web/scripts/check-no-native.mjs`** (new): fail if any file in `dist` contains `@capacitor` or `Capacitor.`; appended to `check:dist`.
- **`packages/mobile/`** (new package `@fm/mobile`):
  - `package.json`: scripts `build:web` (`vite build --config vite.native.config.ts --mode native`), `sync` (`cap sync android`), `build:debug` (`build:web && sync && cd android && ./gradlew assembleDebug`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Deps: `@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/browser`, `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/splash-screen`; dev: `@capacitor/cli`, `@capacitor/assets`, `vite`, `vitest`, `typescript`. Pin Capacitor 8.x releases ≥ 2 weeks old at implementation (no nightlies).
  - `capacitor.config.ts`: `appId: 'com.firstmillion.app'`, `appName: 'First Million'`, `webDir: 'www'`, `server: { androidScheme: 'https' }`, `android: { allowMixedContent: false }`, `backgroundColor: '#07090d'`, `plugins.SplashScreen: { launchAutoHide: false, backgroundColor: '#07090d' }`, `plugins.StatusBar: { style: 'DARK', backgroundColor: '#07090d', overlaysWebView: false }`.
  - `vite.native.config.ts`: loads the web config (`../web/vite.config.ts`) with `mergeConfig`: `root` `../web`, `define` `import.meta.env.VITE_NATIVE` = `"true"`, `build.outDir` `../mobile/www` (`emptyOutDir`), alias `virtual:native-bridge` → `packages/mobile/src/native-bridge.ts` placed first, VitePWA plugin filtered out by name (no `sw.js` in the APK). Verify alias precedence in a test.
  - `src/native-bridge.ts`: `createBridge(): NativeBridge` wiring `App.addListener('backButton')`/`App.exitApp`, `Haptics.impact` (fill: `Light`, margin: `Heavy`), `Browser.open`, `StatusBar` on start, `SplashScreen.hide` on `ready`. `import type { NativeBridge }` from `../../web/src/native/bridge` (the only cross-package import, type-only).
  - `tsconfig.json`, `vitest.config.ts`, `test/config.test.ts`.
  - `assets/` (committed): icon + splash sources from 08's `packages/web/public/icons/icon-512.png` / `favicon.svg`; generated Android resources via `npx capacitor-assets generate --android`.
  - `android/` (from `cap add android`, committed with Gradle wrapper): `AndroidManifest.xml` label "First Million", `android:screenOrientation="portrait"`, `android:windowSoftInputMode="adjustResize"`, no extra permissions (`VIBRATE` added by the haptics plugin manifest merge); `app/build.gradle` `signingConfigs.release` from env `FM_KEYSTORE_PATH`, `FM_KEYSTORE_PASSWORD`, `FM_KEY_ALIAS`, `FM_KEY_PASSWORD` (release task fails if missing), `versionName`/`versionCode` from `-P` properties with dev defaults.
- **`.gitignore`**: `packages/mobile/www/`, `packages/mobile/android/app/build/`, `packages/mobile/android/.gradle/`, `packages/mobile/android/local.properties`, `*.jks`, `*.keystore`. **`eslint.config.js`** ignores and `.prettierignore`: `packages/mobile/www/**`, `packages/mobile/android/**`.
- **`packages/worker/wrangler.toml`** (l.34, `[env.production.vars]`): `ALLOWED_ORIGINS = "https://first-milion.pages.dev,https://localhost"`; dev default (l.22) unchanged.
- **`.github/workflows/ci.yml`** heavy job: add Java 21 setup and `pnpm --filter @fm/mobile build:debug` (placeholder `VITE_*` the job already sets).
- **`.github/workflows/deploy.yml`**: new `android` job (`needs: verify`, `environment: production`, `permissions: contents: read`; setup Java 21 + Android SDK via the runner's preinstalled SDK; build web native with `vars.VITE_*`; `cap sync`; `check-no-emulator` on `www`; keystore decoded from `secrets.ANDROID_KEYSTORE_BASE64` to `$RUNNER_TEMP` via env, never echoed; `assembleRelease` with `VERSION=${GITHUB_REF_NAME#v}` and computed code; `apksigner verify`; rename + `sha256sum`; `upload-artifact`) and `release` job (`needs: [deploy, android]`, `permissions: contents: write`; `gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes` with APK + checksum and an install-steps note). `verify` and `deploy` unchanged, so existing `workflows.test.ts` cases still hold.
- **Protocol / API**: close 4426 `CLIENT_OUTDATED`; `auth.protocolVersion` optional int. No new error code, no server text.
- **Data model**: none.
- **Config**: `shared/config.ts` `PROTOCOL_VERSION = 1`; Worker var `ALLOWED_ORIGINS` (production); GitHub `production` environment secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (set by the user).
- **i18n / UI (PL + EN)**:
  - `close.clientOutdated`: "This version is too old. Update to keep playing." / "Ta wersja jest za stara. Zaktualizuj, aby grać dalej."
  - `update.title`: "Update required" / "Wymagana aktualizacja"
  - `update.webBody`: "A newer version is available. Reload the page." / "Dostępna jest nowsza wersja. Odśwież stronę."
  - `update.nativeBody`: "Download the latest APK from the release page and install it over this app." / "Pobierz najnowszy plik APK ze strony wydania i zainstaluj go na tę aplikację."
  - `update.download`: "Open release page" / "Otwórz stronę wydania"
  - `update.reload`: "Reload" / "Odśwież"
- **Dependencies**: Capacitor packages listed above, only in `packages/mobile` (web bundle impact 0, checked). Wake lock: platform API, no dep. Free plan: GitHub Actions/Releases free for a public repo; Firebase web API key has no referrer restrictions (confirmed by the user), so the WebView needs no key change.

### Fit with Project Docs
- **PRD**: §10.3 "Native apps" → "Native apps other than the sideloaded Android APK (FR-023); app stores". §16 platforms add the Android app. §18 repo structure adds `packages/mobile` (deviation from the three-package layout: native shell and Gradle project must not live in `web`). FR-007 adds close 4426 and the `https://localhost` origin. New FR-023, FR-024, FR-025, BR-022. NFR-002 note: APK distributed via GitHub Releases. NFR-004 note: release key in environment secrets. §19 M7 part 2. §20 decisions #48 (Capacitor, bundled assets, plugins only in `packages/mobile` via `virtual:native-bridge`), #49 (`PROTOCOL_VERSION`, exact match, 4426), #50 (APK built on the release tag, GitHub Release, debug build in CI heavy), #51 (`https://localhost` in production `ALLOWED_ORIGINS`), #52 (keep-awake via Web Wake Lock on all platforms; portrait lock).
- **ARCHITECTURE.md**: Packages add `packages/mobile` and `web/src/native/`; dependency rules: `mobile` imports the web Vite config and the `NativeBridge` type only; `web` imports no `@capacitor/*` or `packages/mobile`; `virtual:native-bridge` imported only by `web/src/native/bridge.ts`. Errors: 4426. Testing: debug APK in heavy CI, release APK in deploy. Decision A8 (native shell = Capacitor, bundled). New "Release" note: keystore created by the user outside the repo, backed up offline, four secrets, protocol bump policy.
- **CODE_QUALITY.md**: runtime-dependency line: "Capacitor packages only in `packages/mobile`"; single sources: app version = git tag, protocol version = `shared/config.ts`; working agreement: release secrets only in the `production` environment; known debt: Gradle/APK verified only by CI build and device checks; YAGNI: no in-app updater, live updates or keyboard plugin.
- **Docs to update**: PRD §5, §10.3, §12, §16, §17, §18, §19, §20; ARCHITECTURE (status, Packages, Dependency rules, Errors, Testing, Decisions, release note); CODE_QUALITY (Principles, Single sources, Working agreements, Known debt).

### Alternative Approaches Considered
- Plugins in `web` with dynamic import: simpler wiring, but Capacitor becomes a web runtime dep and the Pages build may carry core code. Rejected (user).
- Keep-awake community plugin, native only: matches "no-op on web" literally, extra non-official dep. Rejected (user).
- Refuse only older clients (`<`): a newer APK against an older Worker gets a schema 4401 instead of a clear screen. Rejected (user).
- Release-only APK build: faster CI, Gradle breakage found at tag time. Rejected (user).
- TWA (Trusted Web Activity): remote URL + Digital Asset Links, no bundled assets. Rejected.
- React Native / Flutter: UI rewrite; Flutter cannot import `shared`. Rejected in grilling.

## Implementation Steps
1. [ ] Add `PROTOCOL_VERSION = 1` to `packages/shared/src/config.ts` and `CLIENT_OUTDATED: 4426` to `packages/shared/src/protocol/close-codes.ts`.
2. [ ] Add optional `protocolVersion` to the `auth` schema in `packages/shared/src/protocol/client.ts`; extend `packages/shared/test/protocol.test.ts` (accepts absent, accepts int ≥ 0, rejects string/negative/float).
3. [ ] `packages/worker/src/auth/auth-gate.ts`: `failWith(code)` + version check before `verify`. Tests in `packages/worker/test/auth/auth-gate.test.ts` ("BR-022: absent version closes 4426 without verifying"; "0 closes 4426"; "equal proceeds"; "newer closes 4426") and one case in `test/integration/auth.test.ts`.
4. [ ] `packages/web/src/net/ws-client.ts`: send `protocolVersion`; 4426 terminal. Tests in `net/ws-client.test.ts` (auth frame carries the version; no reconnect after 4426; `closed` with the code).
5. [ ] `packages/web/src/room/error-map.ts`: `closeKey(4426)`; test. Add all i18n keys to `en.json`/`pl.json`; locale completeness green.
6. [ ] Create `packages/web/src/native/bridge.ts`, `bridge-stub.ts`, `links.ts`; update `env.d.ts`; add the alias and widen the key guard in `vite.config.ts`.
7. [ ] `packages/web/src/components/UpdateRequired.vue` + test (web shows Reload; with a fake bridge shows the release button calling `openExternal(RELEASES_URL)`); render it in `RoomsView.vue` and `RoomView.vue` on 4426.
8. [ ] `packages/web/src/native/back-button.ts` + `back-button.test.ts` (dialog open → close-dialog; sub-screen → router-back; `/menu`, `/login`, `/verify` → exit).
9. [ ] `packages/web/src/native/haptics.ts`; hook into `composables/use-room.ts` and `single/useSinglePlay.ts`; tests with a fake bridge (fill pulses once per `order.ok`; margin pulses on margin end; no bridge → no throw).
10. [ ] `packages/web/src/native/wake-lock.ts` + test (fake `navigator.wakeLock`: request when active, release when inactive and on dispose, re-request on visible, missing API is a no-op); use in `RoomView.vue` and `SinglePlayView.vue`.
11. [ ] `packages/web/src/main.ts` + `App.vue`: install bridge, `ready()` after mount, back-button wiring with cleanup; `pwa/register.ts` skips when `isNative` (+ test).
12. [ ] `packages/web/scripts/check-no-native.mjs` + `test/check-no-native.test.ts`; add to `check:dist`.
13. [ ] Create `packages/mobile/` (`package.json`, `tsconfig.json`, `vitest.config.ts`, `capacitor.config.ts`, `vite.native.config.ts`, `src/native-bridge.ts`); `pnpm install`.
14. [ ] `packages/mobile/test/config.test.ts`: appId, `webDir`, `androidScheme`, splash/status-bar colours = `#07090d`; native Vite config defines `VITE_NATIVE`, outputs to `www`, resolves `virtual:native-bridge` to the mobile bridge, has no PWA plugin; `native-bridge.ts` imports only `@capacitor/*` and a type from web.
15. [ ] Add `.gitignore`, `eslint.config.js` and `.prettierignore` entries; ensure root `lint`/`typecheck`/`test` include `@fm/mobile`.
16. [ ] Generate `packages/mobile/assets/` and run `cap add android`; commit `packages/mobile/android/`; edit `AndroidManifest.xml` (label, portrait, `adjustResize`) and `app/build.gradle` (env signing, `-P` version props).
17. [ ] `packages/worker/wrangler.toml` production `ALLOWED_ORIGINS` adds `https://localhost`; update `packages/worker/test/config.test.ts` (production list = Pages + `https://localhost`; dev unchanged) and `test/origin.test.ts` if it pins the list.
18. [ ] `.github/workflows/ci.yml` heavy job: Java 21 + `build:debug`; extend `packages/worker/test/workflows.test.ts` (heavy job builds the debug APK; light job still has nothing heavy).
19. [ ] `.github/workflows/deploy.yml`: `android` and `release` jobs; extend `workflows.test.ts` ("android needs verify and production"; "release needs deploy and android, contents: write"; "keystore only from secrets"; "no workflow_dispatch, branch or PR trigger" still holds).
20. [ ] Update docs: PRD, ARCHITECTURE, CODE_QUALITY sections listed in "Fit with Project Docs".
21. [ ] User actions (not Claude; record in the Implementation Log): create the keystore with `keytool` outside the repo and back it up offline; set the four `production` secrets; after the first tagged release, sideload the APK and run the device checks from Success Criteria, incl. "Update required" against a build with `PROTOCOL_VERSION` bumped locally.

## Checkpoints (Todo List)
- [ ] CP1 — Protocol version: steps 1–3; `pnpm --filter @fm/shared test` and `pnpm --filter @fm/worker test` green; typecheck clean.
- [ ] CP2 — Web skew handling: steps 4–5, 7 (after 6's types); `ws-client`, `error-map`, `UpdateRequired`, locale tests green; lint clean.
- [ ] CP3 — Native seam in web: steps 6, 8–12; `back-button`, `haptics`, `wake-lock`, `register`, `check-no-native`, `architecture.test.ts` green; web typecheck clean.
- [ ] CP4 — Mobile package: steps 13–16; `pnpm --filter @fm/mobile test` green; lint and typecheck clean with the new package and ignores (Gradle build is not evidence here; it first runs in CI heavy on `main`).
- [ ] CP5 — Worker config and workflows: steps 17–19; worker `config.test.ts`, `origin.test.ts`, `workflows.test.ts` green.
- [ ] CP6 — Docs and final light verification: step 20 (21 is the user's); lint, typecheck and all Vitest suites green.

### Risks & Mitigations
- Deploying a protocol bump strands every installed APK until users install the new one.
  - Mitigation: bump `PROTOCOL_VERSION` only on breaking changes; the APK is released by the same tag as the Worker, so the new APK exists the moment old ones are refused; the update screen links straight to it.
  - Mitigation: prefer additive, optional protocol fields so most releases need no bump.
- WebView WebSocket `Origin` is not `https://localhost` on a device → 403.
  - Mitigation: device check after the first release; `wrangler tail` to read the origin; adjust `ALLOWED_ORIGINS` (config only).
- Keystore lost (no update path for installs) or leaked (public repo).
  - Mitigation: generated and kept by the user outside the repo, offline backup, secrets only in the `production` environment with manual approval; a lost key costs users only a reinstall (no game data, BR-020).
- Capacitor 8 / Gradle / JDK / min-SDK requirements differ from the plan's assumptions.
  - Mitigation: read the generated `variables.gradle`; CI heavy debug build on `main` catches breakage before a tag.
- Capacitor code leaks into the Pages build via the alias.
  - Mitigation: `check-no-native` in `check:dist` (CI heavy + deploy); mobile config test pins alias precedence.
- WebView lacks the Wake Lock API → screen sleeps mid-round, socket drops (30 s grace, FR-015).
  - Mitigation: device check; Android System WebView supports it (Chromium ≥ 84); fallback plugin only if the check fails (new decision).

## Test Strategy
**Light** (implementation, whichever the user selects):
- Vitest shared: `auth` schema with/without `protocolVersion`.
- Vitest worker: `auth-gate` version cases, integration 4426, `config.test.ts` origins, `workflows.test.ts` (android, release, ci heavy).
- Vitest web: `ws-client` 4426, `error-map`, `UpdateRequired`, `back-button`, `haptics`, `wake-lock`, `register` native skip, `check-no-native`, locale completeness, `architecture.test.ts`.
- Vitest mobile: `config.test.ts`.
- Lint, typecheck across all packages.

**Heavy**:
- CI heavy on `main`: `build:debug` (Gradle), production web build + `bundle:check` + `check-no-emulator` + `check-no-native` (review/CI).
- Release run on the user's tag: signed APK, `apksigner verify`, GitHub Release.
- Playwright: no new spec (WebView not reachable from Playwright); existing suites on the PR guard the web flow after the `auth` change (run on PR only).
- Manual on the Android phone: install, login, offline start, back button, keep-awake, haptics, status bar/splash, portrait, update screen with a bumped local build.

## Success Checklist
- [ ] All success criteria met (with evidence)
- [ ] Lint, typecheck and Vitest clean in `shared`, `worker`, `web`, `mobile`
- [ ] Heavy checks green when run: production build + `check-no-native`, CI debug APK (review/CI); Playwright on the PR
- [ ] Code review approved
- [ ] Documentation updated (sections listed in "Fit with Project Docs")
- [ ] No regressions in single play or multiplayer on web

## Timeline & Estimates
- Phase 1 (implementation): ~12 hours
- Phase 2 (testing): ~3 hours
- Phase 3 (review + device checks + first release): ~3 hours
- **Total**: ~18 hours (rough estimate, plus buffer)

## Open Questions
None. Decided during planning: Capacitor with bundled assets; `packages/mobile`; `com.firstmillion.app`; APK via GitHub Release on the tag; debug build in CI heavy; exact protocol match with 4426; plugins only in `packages/mobile`; Web Wake Lock; portrait lock; no push; no stores; Firebase API key unrestricted.

## Implementation Log
