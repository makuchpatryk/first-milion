# First Million — Architecture

**Based on:** [PRD v1.2](PRD.md) | **Code rules:** [CODE_QUALITY.md](CODE_QUALITY.md) | **Status:** M1 done (`shared` engine); M2 in progress (`web`: auth, router, i18n, single play); M3 done in code (`worker`: auth gate, `Lobby`, `Room` lifecycle, protocol); round engine in `worker` is M4

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
                  auth/ (verify-token.ts, jwks.ts, auth-gate.ts), lobby/ (lobby.ts DO shell + lobby-logic.ts), room/ (room.ts DO shell + room-logic.ts + roster.ts)
packages/web      Vue 3 (src/): auth/ (Firebase), net/ (WebSocket, M5), router/, single/, views/, components/ (Canvas chart), i18n/, styles/
e2e/              Playwright
```

Dependency rules:
- `shared` imports no platform API (DOM, Workers, Firebase); only dependency `zod`.
- `web` and `worker` import `shared`, never each other. Protocol in `shared/protocol` is the only contract.
- Firebase SDK only in `web/auth`; token verification only in `worker/auth`; WebSocket only in `web/net`; runtime APIs only in DO shells and `index.ts`.
- `RoomLogic`, `LobbyLogic` and `AuthGate` are plain TS with injected clock, timers, RNG and `send`, testable without the Workers runtime.

## Invariants

- **Engine** is pure: `rng` and elapsed ms passed in, never `Math.random()`/`Date.now()`. Tick = 80 ms, `speed` steps.
- **Server authority**: orders are `{side, qty}` or `close`; fill at last tick's price ± half spread. Zod schemas are strict; unknown fields (e.g. `price`) → `INVALID_PAYLOAD`.
- **Serialized**: a DO handles one event at a time; ticks and orders never interleave, no locks.
- **Time**: round end is server wall clock (`roundEndsAt`); end checks after every tick and every order (BR-009).
- **Memory only**: ordinary WebSockets + in-memory timers in `Room` and `Lobby`; no hibernation, storage or alarms (guard test `worker/test/no-storage.test.ts`).
- **Auth**: ID token in first `auth` message (never URL), within 5 s; RS256 via WebCrypto + cached JWKS, `email_verified`; `Origin` allowlist; admin UID checked on every admin action.
- **Privacy**: broadcasts carry nickname and numbers only; no email, UID or token.

States: room `lobby → running → lobby`, deleted after 5 min empty or admin close. Player `active → disconnected (≤ 30 s) → active | eliminated`; `active → eliminated` at equity ≤ 0; eliminated stays as observer.

## Errors

Server replies with a code, never text or a thrown exception; `web/i18n` maps codes to PL/EN.

`RATE_LIMITED | HALTED | ELIMINATED | FORBIDDEN | INVALID_STATE | INVALID_PAYLOAD | ROOM_FULL | ROOM_CLOSED | ROOM_NOT_FOUND`. Bad auth → close 4401 (kick 4403, admin room close 4410: `shared/protocol/close-codes.ts`). Bad `Origin` → 403.

## Testing

| Weight | Checks | Where |
|---|---|---|
| Light | ESLint, `tsc`, Vitest (engine with seeded RNG, `RoomLogic` with fake clock, locale completeness) | implementation |
| Heavy | Playwright 4 contexts, axe, production build + bundle size, Lighthouse | review + CI |

**Firebase Auth in dev and e2e** (PRD §20 #35): the official Auth emulator, run from the `firebase-tools` CLI (Node, no Docker). Copy `packages/web/.env.example` to `packages/web/.env.development.local`, then `pnpm dev:auth` (config in `tools/auth-emulator/`; UI with verification and reset links at `http://127.0.0.1:4000`). Data is in memory and lost on stop (fits BR-020). Emulator ID tokens are unsigned: the Worker accepts `alg: none` only when `AUTH_EMULATOR="true"` is set in `.dev.vars` (copy `packages/worker/.dev.vars.example`); it is never in `wrangler.toml`. Worker tests: `unit` project in Node, `integration` project in workerd (`@cloudflare/vitest-plugin`). Vitest never uses the emulator; it mocks `firebase/auth`.

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

1. Free-plan cost of per-tick broadcasts (12.5 msg/s per socket).
2. ~~Tick drift~~ Resolved: fixed `speed` steps per interval (PRD §20 #33).
3. ~~Money rounding rule~~ Resolved: raw float in the engine, `Intl` in the UI (PRD §20 #34).
4. ~~Firebase in dev/e2e~~ Resolved: Auth emulator (PRD §20 #35).
