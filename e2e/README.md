# End-to-end checks (`@fm/e2e`)

Playwright specs for PRD §17 (NFR-001, NFR-003, NFR-006) and the acceptance criteria that need a real browser. **Heavy checks**: they run in `first-million-review` and in CI on `main`, never in implementation or on PRs (ARCHITECTURE A7).

## Run locally

```
pnpm install
pnpm --filter @fm/e2e exec playwright install chromium   # once
pnpm e2e                                                  # all specs, both projects
pnpm e2e -- tests/latency.spec.ts                         # one spec
```

`playwright.config.ts` starts three servers and stops them at the end (`reuseExistingServer` outside CI):

| Server                                   | Port | Notes                                                                                                                 |
| ---------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| Firebase Auth emulator (`pnpm dev:auth`) | 9099 | accounts are created through its admin API; nothing real is touched                                                   |
| `wrangler dev` (Worker)                  | 8787 | `AUTH_EMULATOR`, `FIREBASE_PROJECT_ID`, `ADMIN_UIDS` are passed with `--var`, not read from a file                    |
| `vite` dev server (web)                  | 5173 | dev, not preview: the emulator hook exists only in dev builds. Origin `http://localhost:5173` is in `ALLOWED_ORIGINS` |

Projects: `mobile` (Chromium 360×640) runs `a11y.spec.ts` and `single-play.spec.ts`; `desktop` (1280×800) runs the rest. One worker: specs run one after another so timing numbers are not disturbed.

## Specs

| Spec                      | Covers                                                                             | Time                                                  |
| ------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `auth.spec.ts`            | FR-001 logged out / unverified / 7-char password                                   | seconds                                               |
| `single-play.spec.ts`     | FR-004 keys, margin call, FR-020 no h-scroll                                       | ~1 min                                                |
| `round-4-players.spec.ts` | NFR-006: 4 contexts, 8×, identical price streams, `round.end`                      | **3 min** (10 min with `E2E_FULL_ROUND=1`)            |
| `latency.spec.ts`         | NFR-001: 50 orders, p95 ≤ 300 ms; numbers in the log and `latency.json` attachment | ~30 s                                                 |
| `rate-limit.spec.ts`      | FR-012: 11th order in 1 s → `RATE_LIMITED`                                         | ~30 s                                                 |
| `reconnect.spec.ts`       | FR-015: 10 s outage keeps the seat; 31 s outage eliminates                         | 10 s case ~40 s, **31 s case ~1.5 min (review only)** |
| `observer.spec.ts`        | UF-005: no trade buttons, no order sent                                            | ~30 s                                                 |
| `admin.spec.ts`           | FR-017: Close room, Kick, kicked player rejoins                                    | ~1 min                                                |
| `a11y.spec.ts`            | NFR-003: axe on every screen at 360 px                                             | ~2 min                                                |

Flags: `E2E_FULL_ROUND=1` runs the 10-minute NFR-006 round (run it once before a release). `CI=1` turns on one retry.

Selectors use roles and labels. `data-testid` exists only where they do not work:

| Test id       | Where                     | Why                                                         |
| ------------- | ------------------------- | ----------------------------------------------------------- |
| `auth-submit` | `LoginView` submit button | the mode chip "Log in" and the submit button share one name |

## Heavy checks outside Playwright

```
VITE_FIREBASE_API_KEY=x VITE_FIREBASE_PROJECT_ID=x pnpm build   # the SDK needs a key to start; any value
pnpm bundle:check      # gzip sum of all JS ≤ 300 KB (NFR-005) and no emulator trace in dist/
pnpm lighthouse        # LCP ≤ 2.5 s, performance ≥ 0.9, accessibility ≥ 0.95 (needs Chrome; set CHROME_PATH)
```

## Manual checks (not automated)

- Keyboard only: play one full round (Tab order, B / S / C keys, dialogs close with Esc, focus returns).
- Reconnect banner in a real browser (switch Wi-Fi off for 10 s).
- Read the privacy text in PL and EN (FR-018).

## Release checklist (PRD §19 M6, decision 36)

Not run by the implementation or the review. The user does it once the accounts exist.

1. **Before.** `pnpm e2e` green on the review output; one run with `E2E_FULL_ROUND=1` (NFR-006, 10 minutes); the manual checks above done; the PL and EN privacy text approved (FR-018, BR-021).
2. **Firebase project.** Create it; enable Email/Password sign-in; set the password policy to a minimum of 8 characters (PRD §19 M6: the client check alone can be bypassed); check the verification and reset email templates; note the Web API key and project id.
3. **Cloudflare.** Create the account's Workers and Pages access; create the Pages project `first-million` (direct upload); an API token with Workers Scripts:Edit and Cloudflare Pages:Edit; note the account id. Re-check the free-plan numbers and that Pages is still the right host (PRD §20 #27); if it is deprecated for this use, the switch to Workers static assets is its own ticket.
4. **Replace the placeholders** in `packages/worker/wrangler.toml` `[env.production.vars]`: `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGINS` (the Pages domain, `https://…`, no trailing slash). Commit.
5. **GitHub.** Environment `production` with a required reviewer; secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_WORKER_URL` (the deployed Worker URL, known after the first Worker deploy; deploy the Worker once by hand with `pnpm --filter @fm/worker exec wrangler deploy --env production`). Never set `VITE_AUTH_EMULATOR_URL` or `AUTH_EMULATOR`.
6. **Admin.** `pnpm --filter @fm/worker exec wrangler secret put ADMIN_UIDS --env production` with the admin Firebase UIDs, comma separated (BR-017).
7. **Deploy.** Run the `Deploy` workflow from `main` and approve it. It builds, runs `bundle:check`, deploys the Worker, then Pages.
8. **Smoke test.** Four real accounts: register, verify, log in, one round to the end, an admin close and kick, PL and EN.
9. **Budget (NFR-002).** After a day of use read the Cloudflare dashboard (Durable Object duration, Durable Object requests, Worker requests) and write the values into ARCHITECTURE.md Open item 1. Fallbacks if the duration is high are listed there.
