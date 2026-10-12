# M6 — Quality and release — Implementation Plan

Ticket 6 of 6 (PRD §19 M6). Index: [specs/README.md](README.md). Depends on ticket 5 (M5).

## Summary
Prepare everything needed to verify and release the game: Playwright e2e specs (4 browser contexts, full round, observer, admin, reconnect, rate limit, latency), an axe audit spec for every screen at 360 px, a production build with a bundle-size check, a Lighthouse CI config, the `wrangler` production configuration and deploy workflow, and the final documentation sync. The implementer writes all of this and runs only the light checks. The heavy runs (Playwright, build, Lighthouse, axe) and the real deployment belong to `first-million-review` and to the release step, after the user has set up the Cloudflare and Firebase accounts (user decision: accounts later). Implementation runs on its own git worktree branch (`feature/06-quality-release`), created from the current `HEAD` (ticket 5 merged first); local uncommitted work is not visible there and is flagged at implementation start.

## Success Criteria
- All e2e, axe, latency and build checks are **written** and type-check cleanly; their results are produced in review (not in this ticket).
- Bundle check script exists and fails when gzip JS > 300 KB (NFR-005); its test passes on a fixture.
- Production config test: `AUTH_EMULATOR` and `ADMIN_UIDS` are absent from `wrangler.toml` `[vars]`; the verifier rejects `alg: none` without the emulator flag (NFR-004).
- Deploy workflow exists and is gated (`main` branch + manual approval); it is not run during implementation.
- Docs synchronised: PRD §19/§20/§21, ARCHITECTURE open items (broadcast cost stays open with measurement plan), CODE_QUALITY known debt.
- Free-plan budget measurement plan written: DO duration, DO requests, WebSocket messages, per NFR-002 (measured after the first real run, in the release step).

## Scope & Constraints
- **In scope:** NFR-001 (latency test spec), NFR-002 (budget check plan and dashboard steps), NFR-003 (axe spec + manual keyboard checklist), NFR-004 (config and security tests), NFR-005 (bundle + Lighthouse config), NFR-006 (4-player round e2e), FR-018 (privacy text final review by user), deploy config (Pages + Worker), CI extension.
- **Out of scope for implementation:** running any heavy check, creating Cloudflare/Firebase projects, DNS, production secrets, the actual deploy. These are the release step, run by the user with the review output in hand.
- **Hard constraints:**
  - Workflow rule: implementation runs only lint, typecheck and Vitest. Heavy specs are written and marked "run in review only".
  - Heavy checks in CI only from the `main` branch or on demand (ARCH decision 39). PR CI stays light.
  - No production secret committed. Production values come from GitHub Actions secrets and `wrangler secret put`.
  - No emulator flag in production config (decision 35, M3 test).
- **Trade-offs:**
  - **NFR-006 default: 3-minute e2e round, 10-minute run behind `E2E_FULL_ROUND=1` (user decision).** Reviews stay fast; the full 10-minute proof is run before release.
  - **Latency measured end-to-end in Playwright (NFR-001)**: includes browser and network; it is a stronger check than server-side timing alone.
  - **Lighthouse only in CI on `main` (NFR-005)**: too slow and noisy for every PR.
  - **Pages kept (decision 27, Pages status check):** Cloudflare now favours Workers static assets for new projects. Re-verified at release; switch only if Pages is deprecated for this use.

## Architecture & Design

### High-Level Flow
```
implement (light):  write specs + configs → lint, typecheck, Vitest (config tests, bundle script fixture)
review (heavy):     pnpm build → bundle-check → Playwright (e2e, 4 contexts) → axe → Lighthouse (CI on main)
release (manual):   user creates Cloudflare + Firebase projects → secrets → wrangler deploy (Worker) → Pages deploy → smoke test → budget check
```

### Key Changes

**`e2e/` (new workspace package, `@fm/e2e`):**
- `package.json` (`@playwright/test`), `playwright.config.ts`: projects for Chromium at 360×640 (mobile) and desktop; `webServer` starts `wrangler dev` (Worker) and `vite preview` (web) with `AUTH_EMULATOR=true` in `.dev.vars` (test env file, gitignored); `use.baseURL`; `retries: 1` in CI only.
- `e2e/fixtures/auth.ts` — creates verified emulator accounts via the Auth emulator REST API (`accounts:signUp` then `accounts:update` with `emailVerified: true`), returns `{uid, idToken}` per context, injects the session into the page (no real Google account).
- `e2e/fixtures/four-players.ts` — four browser contexts, one room, roles assigned (host + 3 players or 3 players + 1 observer).
- `e2e/tests/`:
  - `round-4-players.spec.ts` — NFR-006 / PRD §8: 4 contexts, one room, speed 8×, duration **3 min by default**; `E2E_FULL_ROUND=1` runs 10 min. Asserts: no `error` except expected, all four receive identical price streams (`room.tick.prices`), `round.end` received with a reason, UI shows results.
  - `latency.spec.ts` — NFR-001: in a 4-player room, 50 orders from one player; measure time from `order` send to `order.ok` receive in the page (`performance.now()` around the socket); assert p95 ≤ 300 ms. Records the numbers in the test report.
  - `rate-limit.spec.ts` — FR-012 AC: 11 orders within 1 s → 11th `RATE_LIMITED`, socket open.
  - `reconnect.spec.ts` — FR-015 AC: close the socket for 10 s → reconnect banner → seat restored; 31 s → eliminated. The 31 s case uses a real 31 s wait, so it is review-only.
  - `admin.spec.ts` — FR-017: admin sees "Close room" and "Kick"; non-admin does not; close → everyone gets `ROOM_CLOSED` and the room disappears.
  - `observer.spec.ts` — UF-005: observer sees no trade buttons.
  - `single-play.spec.ts` — FR-004 e2e: single play runs, B/S/C keys work, margin call "Play again".
  - `auth.spec.ts` — FR-001 AC: logged out sees login; unverified sees verify screen; 7-char password error.
- `e2e/tests/a11y.spec.ts` — NFR-003: axe (`@axe-core/playwright`) on every screen: login, verify, menu, single play, rooms list, create room, lobby, round, results dialog, settings, privacy; **0 violations of serious or critical impact** (WCAG 2.1 AA tags). Run at 360 px.
- `e2e/README.md` — short: how to run locally; which tests are review-only; `E2E_FULL_ROUND` flag.
- Test IDs: `data-testid` attributes added in web components only where roles/labels are insufficient (added during this ticket's steps; no visual change).

**`packages/web` (production build and bundle check):**
- `vite.config.ts`: production build settings — `build.sourcemap: false`, `build.target: 'es2022'`, `build.rollupOptions` manual chunk for `firebase/auth` (keeps the login chunk separate), `define` assert none.
- `scripts/check-bundle.mjs` — reads `dist/assets/*.js`, gzips each (node `zlib`), sums, fails if > 300 KB (`300 * 1024`); prints the table. Fixture test in Vitest for the function (`checkBundle(sizes)`), the CLI wrapper is run in review.
- `scripts/check-no-emulator.mjs` — greps `dist/` for the emulator URL env name and `connectAuthEmulator`; fails if found (production build must not contain the emulator hook path). Run in review.
- `lighthouserc.json` — Lighthouse CI config: URL list (login, menu), budgets: LCP ≤ 2.5 s on simulated 4G (NFR-005), performance ≥ 0.9, accessibility ≥ 0.95 (axe is the hard gate). Run in CI on `main` only.

**`packages/worker`:**
- `wrangler.toml` production section: `[env.production]` with `vars` (`FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS` = Pages domain). **No** `AUTH_EMULATOR`, **no** `ADMIN_UIDS` (set by `wrangler secret put ADMIN_UIDS`, secret).
- `test/config.test.ts` — parses `wrangler.toml` (with a TOML parser, dev dependency `smol-toml`) and asserts: `AUTH_EMULATOR` and `ADMIN_UIDS` absent from every `vars` table; `ALLOWED_ORIGINS` present for production; the verifier rejects `alg: none` when the emulator flag is absent (NFR-004).
- `test/security.test.ts` — NFR-004: every client message rejects unknown fields (table over all client schemas); `order` with `price` → `INVALID_PAYLOAD`; Origin check cases; token never read from the URL (route handler test: `?token=` ignored and rejected).

**`.github/workflows/`:**
- `ci.yml` (M1) extended: on push to `main` and manual dispatch — `pnpm build`, `scripts/check-bundle.mjs`, `scripts/check-no-emulator.mjs`, Playwright (3-min round, axe) against `wrangler dev` + `vite preview`, Lighthouse CI. PR runs stay light (lint, typecheck, Vitest) — ARCH decision 39.
- `deploy.yml` (new) — `workflow_dispatch` only, with an `environment: production` gate (manual approval). Steps: `pnpm build` (web), `wrangler deploy` (Worker, `--env production`), Pages deploy (`wrangler pages deploy dist`). Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FIREBASE_*` web config (public values, passed as build env). Not run during implementation.

**Web production config:**
- `VITE_FIREBASE_*` public config and `VITE_WORKER_URL` from GitHub environment `production`; `.env.example` lists keys (commented values). `VITE_AUTH_EMULATOR_URL` must be unset in production (checked by `check-no-emulator.mjs`).

**Privacy and legal (FR-018, BR-021):**
- Final PL and EN privacy text is reviewed by the user before release (open question carried from M2/M5). The implementation does not publish it.

**Docs (final sync):**
- `docs/PRD.md`: §19 status per milestone (M1–M5 "implemented", M6 "release pending user accounts"); §20 rows 33–40 complete; §21 open questions: "None" unless the user's privacy review opens one; §23 materials unchanged.
- `docs/ARCHITECTURE.md`: Open items 1 (broadcast cost) resolved as "measured in release step; plan in Risks"; 2–4 resolved in M1 already; packages block final; testing table: heavy checks list final.
- `docs/CODE_QUALITY.md`: Known debt section filled from the implementation logs (any step left open); deps list final.

### Fit with Project Docs
- **PRD:** NFR-001–NFR-006, FR-018, BR-021, §8 success metric (4-player round), §9 constraints (cost), §19 DoD for M6: "Playwright e2e (4 players, full round), axe audit with no AA violations, Lighthouse within budget, production deployment, free-limit usage checked." Mapping: e2e and axe and Lighthouse are written here and run in review; production deployment and free-limit check are the release step (accounts later, per user).
- **ARCHITECTURE:** heavy checks only in review and CI (decision 39); no production secrets in repo; emulator only in dev (decision 35).
- **CODE_QUALITY:** tests cite FR/NFR ids; no sleeps in logic tests (heavy e2e uses real time, documented); e2e uses `data-testid` only where semantics are missing.
- **Docs to update:** listed above.

### Alternative Approaches Considered
- **Run heavy checks in implementation (Option A):** Pro: earlier failures. Con: violates the workflow rule (CLAUDE.md, planning skill); slow loops. Not chosen.
- **Cypress instead of Playwright (Option B):** Pro: familiar to some. Con: PRD §18 fixes Playwright. Not chosen.
- **Full 10-minute NFR-006 run on every review (Option C):** Pro: literal. Con: ~10 min per review. User chose 3 min default + flag.
- **Deploy from PR branches (Option D):** Pro: previews. Con: needs production-like secrets on PRs; cost/complexity for a solo project. Not chosen: deploy only on manual dispatch from `main`.
- **Firebase real test accounts in e2e (Option E):** Pro: production path. Con: secrets, network, quota (decision 35 chose the emulator). Not chosen.

## Implementation Steps

1. [ ] `e2e/` workspace package: `package.json` (`@fm/e2e`, `@playwright/test`, `@axe-core/playwright`), `tsconfig.json`, `playwright.config.ts` (Chromium 360×640 and desktop projects, `webServer` for `wrangler dev` and `vite preview`, retries 1 in CI only).
2. [ ] `e2e/fixtures/auth.ts`: emulator account creation (signUp + update emailVerified) and session injection; typed helpers. Light test: none (typecheck only); the fixture is exercised in review.
3. [ ] `e2e/fixtures/four-players.ts`: four contexts, one room, roles; typed.
4. [ ] `e2e/tests/auth.spec.ts`, `single-play.spec.ts` (FR-001, FR-004 e2e).
5. [ ] `e2e/tests/round-4-players.spec.ts` (NFR-006): 3-min default; `E2E_FULL_ROUND=1` → 10 min; identical price-stream assertion; `round.end` assertion.
6. [ ] `e2e/tests/latency.spec.ts` (NFR-001): 50 orders, p95 ≤ 300 ms, numbers printed to the report.
7. [ ] `e2e/tests/rate-limit.spec.ts`, `reconnect.spec.ts` (FR-012, FR-015 AC; 31 s case in review only), `observer.spec.ts` (UF-005), `admin.spec.ts` (FR-017).
8. [ ] `e2e/tests/a11y.spec.ts`: axe on every screen at 360 px, WCAG 2.1 AA tags, fail on serious and critical violations.
9. [ ] `e2e/README.md`: how to run locally, which tests are review-only, flags (`E2E_FULL_ROUND`).
10. [ ] `data-testid` attributes added only where the e2e cannot select by role or label (list in the e2e README); no visual change. Typecheck green.
11. [ ] `packages/web/scripts/check-bundle.mjs` (gzip sum ≤ 300 KB, prints table) and `scripts/check-no-emulator.mjs`; `packages/web/test/check-bundle.test.ts` (fixture sizes: 299 KB passes, 301 KB fails — gzip size computed from a fixture buffer).
12. [ ] `packages/web/vite.config.ts` production settings (`sourcemap: false`, `target es2022`, manual chunk for `firebase/auth`).
13. [ ] `lighthouserc.json` (URLs, budgets: LCP ≤ 2.5 s, performance ≥ 0.9, accessibility ≥ 0.95).
14. [ ] `packages/worker/wrangler.toml`: `[env.production]` with public vars only (no `AUTH_EMULATOR`, no `ADMIN_UIDS`); `smol-toml` dev dependency for the config test.
15. [ ] `packages/worker/test/config.test.ts`: parses `wrangler.toml`, asserts emulator and admin UIDs absent from every `vars` table; `ALLOWED_ORIGINS` present in production env; verifier rejects `alg: none` without the flag.
16. [ ] `packages/worker/test/security.test.ts` (NFR-004): every client schema rejects an unknown field; `order` with `price` → `INVALID_PAYLOAD`; token in `?token=` is not read (rejected).
17. [ ] `.github/workflows/ci.yml` extension: `main` push and manual dispatch run build, bundle check, no-emulator check, Playwright, axe, Lighthouse; PR runs unchanged (light).
18. [ ] `.github/workflows/deploy.yml`: `workflow_dispatch`, `environment: production` (manual approval), `wrangler deploy --env production`, Pages deploy, uses secrets listed in Key Changes. Lint of the YAML only (actionlint in CI is optional; not added: YAGNI).
19. [ ] `.env.example` for web (`VITE_FIREBASE_*`, `VITE_WORKER_URL`, commented emulator URL).
20. [ ] Docs final sync: `docs/PRD.md` §19 status and §20 completion; `docs/ARCHITECTURE.md` open item 1 and testing table; `docs/CODE_QUALITY.md` known debt from the logs.
21. [ ] Release checklist written into `e2e/README.md` (or `docs/RELEASE.md`, decided at implementation: prefer `e2e/README.md`, no new docs file): accounts to create, secrets to set, review commands to run, budget checks to read, privacy text to approve. Step not run now.
22. [ ] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` green across all packages including config and security tests; steps ticked; Implementation Log filled. **Heavy checks (Playwright, build, Lighthouse, axe) are NOT run here: they are for `first-million-review`.**

## Checkpoints (Todo List)

- [ ] CP1 — e2e scaffold and fixtures: steps 1–3; `pnpm typecheck` clean including `e2e/`.
- [ ] CP2 — e2e specs written: steps 4–10; typecheck and lint clean (specs are not run here).
- [ ] CP3 — Build and bundle tooling: steps 11–13; Vitest green for `check-bundle` fixture; typecheck clean.
- [ ] CP4 — Config and security tests: steps 14–16; Vitest green (`config.test.ts`, `security.test.ts`).
- [ ] CP5 — CI and deploy definitions: steps 17–19; YAML parses (`yq`/node YAML parse in a Vitest test or a script); no secret in files.
- [ ] CP6 — Docs and release checklist, final light verification: steps 20–22; lint, typecheck and all Vitest green.

## Risks & Mitigations

- **Risk:** Latency p95 over 300 ms in real use (NFR-001), found only in review.
  - Mitigation: the latency spec measures the real path; if it fails, the first lever is the Worker location and the number of hops (both DOs in the same colo); second lever: remove the extra `await` in `Room.fetch` for orders. Not changed in this ticket.
- **Risk:** Duration budget exceeded (13 000 GB-s/day) because the Room and Lobby never hibernate (decision 37).
  - Mitigation: measure in the first release week in the Cloudflare dashboard (DO duration, requests, WebSocket messages). Fallbacks in order: (1) shorter `EMPTY_ROOM_TTL_MS`; (2) limit rooms per host; (3) hibernation for Room in lobby state (needs its own design). Record measured values in `docs/ARCHITECTURE.md` Open item 1.
- **Risk:** Bundle over 300 KB gzip (NFR-005) because of Firebase.
  - Mitigation: `check-bundle.mjs` in review; first fallback: lazy-load reauth and `deleteUser` (Settings) into a separate chunk (M2 Risk). Record the measured gzip size in the review.
- **Risk:** Emulator leaks into production (decision 35).
  - Mitigation: config test (wrangler), `check-no-emulator.mjs` on `dist/`, production secrets without emulator variables, `alg: none` rejected by default.
- **Risk:** Flaky e2e with real timers (the 31 s disconnect, the 3-min round).
  - Mitigation: deterministic emulator accounts; assertions on messages and final states, not on wall-clock thresholds; the 31 s case and the 10-min run are opt-in flags; retries 1 in CI only.
- **Risk:** Accounts not ready at release (user will create them later).
  - Mitigation: release checklist in `e2e/README.md` lists the accounts and secrets; deploy workflow is manual; nothing in the repo depends on the accounts during implementation (emulator everywhere).
- **Risk:** Cloudflare changes free-plan rules or Pages status (Pages status check).
  - Mitigation: re-check the pricing and Pages status at release; the switch to Workers static assets is a separate ticket if needed.

## Test Strategy

**Light (during implementation, lint + typecheck + Vitest only):**
- `packages/worker/test/config.test.ts` (wrangler production vars, verifier flag behaviour).
- `packages/worker/test/security.test.ts` (schemas reject unknown fields, `price` rejected, token not in URL).
- `packages/web/test/check-bundle.test.ts` (bundle gzip function with fixtures).
- A YAML parse test for `.github/workflows/*.yml` (structure only: jobs, triggers, `environment: production` on deploy).
- Typecheck of `e2e/` (specs compile; not run).

**Heavy (review only, run by `first-million-review`; CI on `main` for the same set):**
- `pnpm --filter @fm/web build` → `node scripts/check-bundle.mjs` (NFR-005 ≤ 300 KB gzip) and `scripts/check-no-emulator.mjs`.
- `pnpm --filter @fm/e2e test` → all specs; 3-min round by default; `E2E_FULL_ROUND=1` for the 10-min NFR-006 run before release.
- Latency numbers from `latency.spec.ts` (NFR-001).
- `a11y.spec.ts` (axe, 0 serious/critical AA violations at 360 px).
- Lighthouse CI on `main` (LCP ≤ 2.5 s simulated 4G; accessibility ≥ 0.95).
- Manual: keyboard-only play through one full round; reconnect banner in a real browser; privacy text read by the user.

**Release step (user, after accounts exist; not part of implementation):** Firebase project (Auth email/password, verification, reset templates), Cloudflare (Worker, Pages, DO bindings), secrets (`ADMIN_UIDS`), `deploy.yml` manual run, smoke test with 4 real accounts, dashboard budget check (NFR-002) after one day of use.

## Success Checklist
- [ ] All success criteria met (written and typecheck-clean; heavy results come from review)
- [ ] Lint, typecheck, Vitest green across all packages (light)
- [ ] Config and security tests green (emulator absent from production, schemas strict)
- [ ] Heavy checks listed for review with commands in `e2e/README.md`
- [ ] Docs synced (PRD §19/§20/§21, ARCH open items and testing table, CODE_QUALITY known debt)
- [ ] Release checklist written; no production secret or account touched
- [ ] Code review approved (`first-million-review` runs all heavy checks)

## Timeline & Estimates
- Phase 1 (e2e fixtures and specs): ~8 h
- Phase 2 (build, bundle, Lighthouse, config and security tests): ~4 h
- Phase 3 (CI and deploy definitions, docs, release checklist): ~3 h
- Phase 4 (review, heavy run fixes, release step with user accounts): ~6 h (release excluded from implementation time)
- **Total (implementation + review)**: ~19 h (rough, plus buffer); release step is separate.

## Open Questions
- [ ] Privacy policy final PL and EN text: user approval before release (FR-018, BR-021).
- [ ] Production domains for Pages and Worker (needed for `ALLOWED_ORIGINS`): decided at release, when accounts exist.
- [ ] Budget thresholds for the release-week check: proposed in Risks; user confirms after the first measurement.

## Implementation Log
(Empty. first-million-implement appends one line per step event here.)
