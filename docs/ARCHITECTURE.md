# First Million — Architecture

**Based on:** [PRD v1.2](PRD.md) | **Code rules:** [CODE_QUALITY.md](CODE_QUALITY.md) | **Status:** M1 done (`shared` engine); M2 done (`web`: auth, router, i18n, single play; Pages deploy in M6); M3 done (`worker`: auth gate, `Lobby`, `Room` lifecycle, protocol); M4 done in code (`worker`: round engine in `Room`); M5 done in code (`web`: multiplayer screens, socket client, admin UI); M6 checks written (`e2e/`, bundle and config checks, CI and deploy workflows), heavy runs and the release pending

## Drivers

| Driver | Source | Consequence |
|---|---|---|
| One server price per room; client sends intent only | BR-007, NFR-004 | `Room` owns price, execution, equity, ranking |
| Same rules in single and multi | BR-003–005, BR-015 | One engine in `shared`, used by browser and `Room` |
| Nothing persisted | BR-020 | State in memory only: no DO storage, KV, D1 |
| 0 PLN, ≤ 50 users | NFR-002 | One stateless Worker, one `Lobby`, one `Room` per room |

## Packages

```
packages/shared   pure TS: rules.ts (BR-003 values), config.ts (tunables), engine/, protocol/ (zod), validation.ts
packages/worker   index.ts (Origin, routing, WS upgrade), env.ts, origin.ts, socket.ts (shared WS plumbing of both DO shells), internal.ts (Lobby↔Room request bodies), timers.ts,
                  auth/ (verify-token.ts, jwks.ts, auth-gate.ts), lobby/ (lobby.ts DO shell + lobby-logic.ts), room/ (room.ts DO shell + room-logic.ts + roster.ts + round.ts, ranking.ts, rate-limit.ts)
packages/web      Vue 3 (src/): auth/ (Firebase), net/ (the only WebSocket code: url.ts, ws-client.ts typed socket with backoff reconnect and token re-auth, lobby-socket.ts, room-socket.ts, token-refresh.ts),
                  room/ (pure state: lobby-state.ts reduceLobby + joinPolicy, room-state.ts reduceRoom + canTrade, error-map.ts, create-form.ts, countdown.ts), composables/ (use-lobby.ts, use-room.ts: socket → reducer → shallowRef),
                  router/, single/, views/ (Rooms, CreateRoom, Room), components/ (Canvas chart, LobbyPanel, RoundPanel, ResultsDialog, ModalDialog), i18n/, styles/
e2e/              Playwright (@fm/e2e): playwright.config.ts (3 servers), fixtures/ (auth.ts emulator accounts, four-players.ts seats and room helpers, ws-tap.ts in-page socket tap), tests/*.spec.ts
packages/web/scripts   check-bundle.mjs (gzip sum ≤ 300 KB), check-no-emulator.mjs; packages/web/lighthouserc.json
.github/workflows ci.yml (light job always, heavy job on main), deploy.yml (manual, environment production)
```

Dependency rules:
- `shared` imports no platform API (DOM, Workers, Firebase); only dependency `zod`.
- `web` and `worker` import `shared`, never each other. Protocol in `shared/protocol` is the only contract.
- Firebase SDK only in `web/auth`; token verification only in `worker/auth`; WebSocket only in `web/net` (it imports no `auth`, `views` or Firebase; the token comes in as `getToken`); runtime APIs only in DO shells and `index.ts`.
- `web` screens render state from the pure reducers in `web/room` and send intents; the server's `ready` fires once per connection (a refresh's `auth.ok` is not one), so `room.join` is sent once per connection.
- `RoomLogic`, `LobbyLogic` and `AuthGate` are plain TS with injected clock, timers, RNG and `send`, testable without the Workers runtime.

## Invariants

- **Engine** is pure: `rng` and elapsed ms passed in, never `Math.random()`/`Date.now()`. Tick = 80 ms, `speed` steps.
- **Server authority**: orders are `{side, qty}` or `close`; fill at last tick's price ± half spread. Zod schemas are strict; unknown fields (e.g. `price`) → `INVALID_PAYLOAD`.
- **Serialized**: a DO handles one event at a time; ticks and orders never interleave, no locks.
- **Time**: round end is server wall clock (`roundEndsAt`); end checks after every tick and every order (BR-009). The shell's 80 ms interval only calls `RoomLogic.tick()`; the logic reads the injected clock, runs `speed` price steps.
- **Memory only**: ordinary WebSockets + in-memory timers in `Room` and `Lobby`; no hibernation, storage or alarms (guard test `worker/test/no-storage.test.ts`).
- **Auth**: ID token in first `auth` message (never URL), within 5 s; RS256 via WebCrypto + cached JWKS, `email_verified`; `Origin` allowlist; admin UID checked on every admin action.
- **Privacy**: broadcasts carry nickname and numbers only; no email, UID or token.

States: room `lobby → running → lobby`, deleted after 5 min empty or admin close. Player `active → disconnected (≤ 30 s) → active | eliminated`; `active → eliminated` at equity ≤ 0; an eliminated player keeps a watch-only seat until the next start (PRD §20 #38).

## Errors

Server replies with a code, never text or a thrown exception; `web/i18n` maps codes to PL/EN.

`RATE_LIMITED | ELIMINATED | FORBIDDEN | INVALID_STATE | INVALID_PAYLOAD | ROOM_FULL | ROOM_CLOSED | ROOM_NOT_FOUND`. Bad auth → close 4401 (kick 4403, admin room close 4410: `shared/protocol/close-codes.ts`). Bad `Origin` → 403.

## Testing

| Weight | Checks | Where |
|---|---|---|
| Light | ESLint, `tsc`, Vitest (engine with seeded RNG, `RoomLogic` with fake clock, locale completeness) | implementation |
| Heavy | Playwright 4 contexts (`pnpm e2e`, includes axe and the latency check), production build + bundle size and no-emulator check (`pnpm build`, `pnpm bundle:check`), Lighthouse (`pnpm lighthouse`) | review + CI on `main` (`ci.yml` job `heavy`); details and review-only cases in `e2e/README.md` |

**Firebase Auth in dev and e2e** (PRD §20 #35): the official Auth emulator, run from the `firebase-tools` CLI (Node, no Docker). Copy `packages/web/.env.example` to `packages/web/.env.development.local`, then `pnpm dev:auth` (config in `tools/auth-emulator/`; UI with verification and reset links at `http://127.0.0.1:4000`). Data is in memory and lost on stop (fits BR-020). Emulator ID tokens are unsigned: the Worker accepts `alg: none` only when `AUTH_EMULATOR="true"` is set in `.dev.vars` (copy `packages/worker/.dev.vars.example`); it is never in `wrangler.toml`. e2e instead passes the flag on the command line (`wrangler dev --var`) and runs against the Vite dev server (PRD §20 #43). Auth is created with `initializeAuth` (no popup/redirect resolver), so the login page loads no Google script or iframe. Worker tests: `unit` project in Node, `integration` project in workerd (`@cloudflare/vitest-plugin`). Vitest never uses the emulator; it mocks `firebase/auth`.

## Decisions (proposed; numbered A1–A7 so they do not clash with the PRD §20 log)

| # | Decision |
|---|---|
| A1 | `RoomLogic` plain class; DO only owns sockets and timers |
| A2 | No WebSocket hibernation, storage or alarms in `Room` or `Lobby` (PRD §20 #37) |
| A3 | `Lobby` singleton DO; rooms push updates + heartbeat |
| A4 | Engine takes RNG and elapsed ms as arguments |
| A5 | Strict zod schemas in `shared/protocol` are the only message definition |
| A6 | Error codes closed union; server sends no text |
| A7 | Heavy checks only in review and CI |

## Open items

1. Free-plan cost of per-tick broadcasts (12.5 msg/s per socket). Not measurable before a real deployment; measured in the release step (accounts later, PRD §20 #36). Plan: after one day with 4 rooms × 4 players, read the Cloudflare dashboard for (a) Durable Object duration, free limit 13,000 GB-s/day (a Durable Object alive for a day at 128 MB is about 11,000 GB-s, so the `Lobby` and the rooms must be evicted when nobody is connected), (b) Durable Object requests (incoming WebSocket messages count at 20:1; outgoing ticks are not billed requests), (c) Worker requests. Re-check the current free-plan numbers first. If duration is the problem, in order: shorter `EMPTY_ROOM_TTL_MS`, a limit of rooms per host, hibernation for a `Room` in the lobby state (its own design). Record the measured values here.
2. ~~Tick drift~~ Resolved: fixed `speed` steps per interval (PRD §20 #33).
3. ~~Money rounding rule~~ Resolved: raw float in the engine, `Intl` in the UI (PRD §20 #34).
4. ~~Firebase in dev/e2e~~ Resolved: Auth emulator (PRD §20 #35).
