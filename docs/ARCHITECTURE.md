# First Million — Architecture

**Based on:** [PRD v1.2](PRD.md) | **Code rules:** [CODE_QUALITY.md](CODE_QUALITY.md) | **Status:** Draft (no code yet; layout below the package level is a proposal)

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
packages/worker   index.ts (Origin, routing, WS upgrade), auth/, lobby.ts (Lobby DO), room/ (room.ts DO shell + room-logic.ts)
packages/web      Vue 3: auth/ (Firebase), net/ (WebSocket), single/, views/, components/ (Canvas chart), i18n/
e2e/              Playwright
```

Dependency rules:
- `shared` imports no platform API (DOM, Workers, Firebase); only dependency `zod`.
- `web` and `worker` import `shared`, never each other. Protocol in `shared/protocol` is the only contract.
- Firebase SDK only in `web/auth`; token verification only in `worker/auth`; WebSocket only in `web/net`; runtime APIs only in DO shells and `index.ts`.
- `RoomLogic` is plain TS with injected clock, RNG and `send`, testable without the Workers runtime.

## Invariants

- **Engine** is pure: `rng` and elapsed ms passed in, never `Math.random()`/`Date.now()`. Tick = 80 ms, `speed` steps.
- **Server authority**: orders are `{side, qty}` or `close`; fill at last tick's price ± half spread. Zod schemas are strict; unknown fields (e.g. `price`) → `INVALID_PAYLOAD`.
- **Serialized**: a DO handles one event at a time; ticks and orders never interleave, no locks.
- **Time**: round end is server wall clock (`roundEndsAt`); end checks after every tick and every order (BR-009).
- **Memory only**: ordinary WebSockets + in-memory interval in `Room`; no hibernation, storage or alarms.
- **Auth**: ID token in first `auth` message (never URL), within 5 s; RS256 via WebCrypto + cached JWKS, `email_verified`; `Origin` allowlist; admin UID checked on every admin action.
- **Privacy**: broadcasts carry nickname and numbers only; no email, UID or token.

States: room `lobby → running → lobby`, deleted after 5 min empty or admin close. Player `active → disconnected (≤ 30 s) → active | eliminated`; `active → eliminated` at equity ≤ 0; eliminated stays as observer.

## Errors

Server replies with a code, never text or a thrown exception; `web/i18n` maps codes to PL/EN.

`RATE_LIMITED | HALTED | ELIMINATED | FORBIDDEN | INVALID_STATE | INVALID_PAYLOAD | ROOM_FULL | ROOM_CLOSED`. Bad auth → close 4401. Bad `Origin` → 403.

## Testing

| Weight | Checks | Where |
|---|---|---|
| Light | ESLint, `tsc`, Vitest (engine with seeded RNG, `RoomLogic` with fake clock, locale completeness) | implementation |
| Heavy | Playwright 4 contexts, axe, production build + bundle size, Lighthouse | review + CI |

## Decisions (proposed, continue PRD log)

| # | Decision |
|---|---|
| 33 | `RoomLogic` plain class; DO only owns sockets and timers |
| 34 | No WebSocket hibernation, storage or alarms in `Room` |
| 35 | `Lobby` singleton DO; rooms push updates + heartbeat |
| 36 | Engine takes RNG and elapsed ms as arguments |
| 37 | Strict zod schemas in `shared/protocol` are the only message definition |
| 38 | Error codes closed union; server sends no text |
| 39 | Heavy checks only in review and CI |

## Open items

1. Free-plan cost of per-tick broadcasts (12.5 msg/s per socket).
2. Tick drift: catch up steps by wall time or fixed `speed` steps.
3. Money rounding rule (price, P&L, half spread).
4. Firebase in dev/e2e: emulator or test accounts.
