# M4 — Server round engine — Implementation Plan

Ticket 4 of 6 (PRD §19 M4). Index: [specs/README.md](README.md). Depends on tickets 1 (M1) and 3 (M3). Ticket 3 must be done first: this ticket extends its `RoomLogic`, protocol and Room shell.

## Summary
Make a room play rounds on the server: the host starts a round, the `Room` runs a fixed-step tick loop on the `shared` engine, one server price serves everyone, orders execute at the server price ± spread and are rate-limited, bankruptcy eliminates players, disconnects get a 30 s grace period, and the round ends by wall-clock time, profit target or total elimination with the BR-010 tie-break. A test client plays full rounds through the logic without the Workers runtime. Implementation runs on its own git worktree branch (`feature/04-server-round-engine`), created from the current `HEAD` (ticket 3 merged first); local uncommitted work is not visible there and is flagged at implementation start.

## Success Criteria
- Host `room.start` moves the room to `running`; every player receives the same price stream (FR-011 AC); non-host → `FORBIDDEN`, start during round → `INVALID_STATE`.
- The 11th order within 1 s from one player is rejected with `RATE_LIMITED`; the connection stays open (FR-012 AC, BR-018).
- During TRADING_HALT the server rejects orders with `HALTED` (FR-005 AC); halt lasts 5 s wall time at any speed (user decision, BR-015).
- Target and tie-break rules: BR-009 and BR-010 test table passes (FR-013 AC: $500 target, time end → highest equity, equal equity → earlier reach).
- Disconnect for 10 s keeps position and equity; reconnect with the same UID restores the seat; 31 s → eliminated (FR-015 AC).
- A seeded test client plays a 4-player round to the end with no errors in logic tests (M4 DoD, FR-011–FR-015).
- Order acknowledgement (`order.ok`) is produced in the same logic call as execution: no extra round trip inside the server (NFR-001 is measured in M6).

## Scope & Constraints
- **In scope:** FR-011 (start, tick loop, broadcast), FR-012 (orders in multiplayer, rejection codes, rate limit), FR-013 (live ranking, end conditions, tie-break), FR-014 (elimination and watch-only seat), FR-015 (disconnect and return), BR-005 (multiplayer bankruptcy), BR-007 (server price, client sends intent only), BR-008 (round parameters applied), BR-009, BR-010, BR-012 (eliminated stays seated), BR-013 (host start rules), BR-015 (news in multiplayer), BR-018, BR-019.
- **Out of scope:** web client (M5), admin UI (M5), latency measurement (M6), deploy (M6).
- **Hard constraints:**
  - Engine from `shared` only (ARCH: one engine, used by browser and `Room`). No second engine in the Worker.
  - The engine is seeded per round; `RoomLogic` receives an injected `seed()` (shell: `crypto.getRandomValues`).
  - Clock and timers only in the shell; `RoomLogic` gets `now()` and `schedule()`.
  - No storage, no alarms, no hibernation (decision row 37). Disconnect timers are plain `setTimeout` in memory.
  - Price and fills are server-side only; `order` schema from M3 rejects any `price` field.
- **Trade-offs (decided with the user or with the planning cross-check, marked):**
  - **Halt in wall-clock ms (user decision):** `tickHalt(market, elapsedMs)` with elapsed per interval, capped at 250 ms (the prototype's cap, prevents a large jump after a stall). At 8× the halt still lasts 5 s on screen.
  - **Eliminated players stay seated (user decision):** status `eliminated`, watch-only, equity 0, shared last place. Observer cap stays at 4. Seats reset to `active` at the next start.
  - **Rate limit counts every schema-valid order and close, accepted or rejected (planning default, adopted):** a flood cannot hide rejected orders from the counter. Simple sliding window of 1 000 ms.
  - **Explicit `room.leave` during a running round = socket close (planning default, adopted):** the 30 s grace applies, so leaving cannot be used to escape a loss.
  - **Lobby-state disconnect removes the seat at once (BR-019 covers only running rounds, adopted).**
  - **Kick during a round removes the seat entirely** (position discarded, not in ranking); the UID may rejoin (BR-017, adopted).
  - **Observer may be host (BR-013 literal, adopted):** `start` still needs ≥ 1 seated player.
  - **Per-recipient tick:** each socket gets one `room.tick` per 80 ms interval with its own `you` block; ranking and prices are shared content. Outbound messages are not charged as Durable Object requests (Cloudflare pricing).

## Architecture & Design

### High-Level Flow
```
Room shell, every 80 ms (setInterval, only while running):
  elapsed = min(now − last, 250)
  logic.tick(elapsed)
    ├─ market = tickHalt(market, elapsed)
    ├─ speed × stepMarket(market, rng)            (shared engine)
    ├─ for each player: liquidate if equity ≤ 0   (BR-005 → eliminated)
    ├─ update reachedEquityAt on value change     (BR-010)
    ├─ check profit target, then round time       (BR-009)
    └─ send room.tick to each socket (per-recipient `you`)

client order {side, qty}  → logic.order(uid, side, qty)
   rate-limit → role/state → halt → executeOrder at market.price → order.ok
   → check target / bankruptcy / all eliminated immediately (BR-009 "after every order")

socket close (running) → status disconnected, 30 s timer → eliminated (liquidate)
auth + room.join same UID within 30 s → seat restored (same position, equity)
```

### Key Changes

**`packages/shared`:**
- `src/config.ts` (new tunables): `TICK_MS` (already M1), `HALT_TICK_CAP_MS = 250`, `ORDER_RATE_MAX = 10`, `ORDER_RATE_WINDOW_MS = 1_000` (BR-018 values, kept in `rules.ts` as BR values — `ORDER_RATE_PER_SEC` from M1 is reused; the window constant lives in `rules.ts`).
- `src/protocol/server.ts` (additions):
  ```ts
  room.history: { type: 'room.history', prices: number[] }             // on join/reconnect while running (≤ 2 400 points)
  room.tick:    { type: 'room.tick', prices: number[],                  // new prices this interval, length = speed
                  price: number,                                        // displayed price (frozen during halt)
                  halt: { msLeft: number } | null,
                  news: NewsView | null,                                // { type, dir?, mag?, idx? } — UI texts from i18n
                  endsInMs: number,
                  ranking: RankRow[],
                  you: MeRound }
  order.ok:     { type: 'order.ok', fill: number, you: MeRound }        // fill = execution price incl. spread; CLOSE with no position → fill = null
  round.end:    { type: 'round.end', reason: 'TARGET' | 'TIME' | 'ALL_ELIMINATED',
                  winners: string[],                                    // nicks; several = shared place
                  ranking: RankRow[] }
  ```
  `RankRow = { nick: string; equity: number; status: 'active'|'disconnected'|'eliminated'; place: number }`.
  `MeRound = { role: 'player'|'observer'; status: MemberStatus; units: number; avg: number; realized: number; equity: number; closedTrades: number; wins: number }`.
  `NewsView` is the discriminated union of the five `NewsEvent` types (M1), without any engine internals.
- `src/protocol/views.ts` (amendment to M3 `RoomView`): add `lastRound: { reason; winners: string[]; ranking: RankRow[] } | null` (shown in the lobby until the next start, BR-014). `players[].status` now `active|disconnected|eliminated`.
- `src/protocol/client.ts`: no change (the M3 schemas already contain `room.start`, `order`, `close`).

**`packages/worker/src/room/`** (pure logic; DO shell changes in `room.ts`):
- `room/round.ts` — pure round state:
  ```ts
  export interface Seat {
    uid: string; nick: string
    status: 'active' | 'disconnected' | 'eliminated'
    portfolio: Portfolio           // shared engine type
    reachedEquityAt: number        // ms, server clock (BR-010)
    lastEquity: number | null      // to detect value change
    disconnectedAt: number | null
  }
  export interface Round {
    market: Market                 // shared engine
    rng: Rng                       // seeded per round
    startedAt: number
    endsAt: number                 // startedAt + durationMin·60 000 (BR-008, wall clock)
    history: number[]              // capped at HISTORY_MAX (2 400)
    lastNews: NewsEvent | null
  }
  export function startRound(seats: Seat[], now: number, durationMin: number, seed: number): { round: Round; seats: Seat[] }
  export function stepRound(round: Round, seats: Seat[], elapsedMs: number, now: number, speed: number): { round: Round; seats: Seat[]; newPrices: number[] }
  ```
  - `startRound`: all seats → `active`, portfolio `emptyPortfolio`, `reachedEquityAt = now` (BR-010 starting point), `lastEquity = 10 000`. Observers untouched (seat-reset rule).
  - `stepRound`: `tickHalt(market, elapsedMs)`, `speed` × `stepMarket`, history append (cap), `lastNews` update, equity recompute with the true price, bankruptcy liquidation (`isBankrupt` → `liquidate` → `eliminated`, equity shown as 0), `reachedEquityAt` update when `equity !== lastEquity` (tie-break rule).
  - Shown price during halt = `shownPrice(market)` (frozen) — the true price still drives equity (prototype semantics).
- `room/ranking.ts` — pure:
  ```ts
  export function rankSeats(seats: Seat[], price: number): RankRow[]   // eliminated → equity 0, last; BR-010 tie-break
  export function reachedTarget(seat: Seat, price: number, target: number | null): boolean  // totalResult ≥ target (BR-009)
  export function winnersAtTime(ranking: RankRow[]): string[]         // place 1 (shared if equal)
  export function winnersAtTarget(seats: Seat[], price: number, target: number, reachedNow: string[]): string[]  // max equity among those reaching this tick; equal → shared
  ```
  Place is competition ranking: `place = 1 + count of rows strictly better`. Better = (active or disconnected beats eliminated), then higher equity, then earlier `reachedEquityAt`. Equal equity and equal `reachedEquityAt` → same place (shared). Eliminated rows all equal 0 → shared last place (BR-010).
- `room/rate-limit.ts` — pure sliding window:
  ```ts
  export class OrderRateLimit {
    constructor(max: number, windowMs: number)
    attempt(now: number): boolean   // records the attempt; false when the 11th within windowMs
  }
  ```
  Called for every schema-valid `order` and `close`, before any role/state checks (planning default: rejected attempts count).
- `room/room-logic.ts` (extends M3 class):
  - New state: `round: Round | null`, `seats` (players + disconnected/eliminated, replacing the M3 `players` list), `observers`, `lastRound`, per-uid `disconnectTimers`, `rateLimits: Map<uid, OrderRateLimit>`, `lastTickAt`.
  - `start(uid)`: `isHost` else `FORBIDDEN`; status `running` else `INVALID_STATE`; no seated player → `INVALID_STATE`; `startRound`, schedule nothing (shell owns the interval), broadcast.
  - `tick(now)`: calls `stepRound`, then `rankSeats`, target check (`reachedTarget` per seat, `reachedEquityAt` ties), time check (`now ≥ endsAt`), all-eliminated check → `endRound(reason, winners)`; otherwise send `room.tick` to each socket with its own `you`.
  - `order(uid, side: 'BUY'|'SELL', qty)` and `close(uid)`: rate limit first (`RATE_LIMITED`); observer → `FORBIDDEN`; eliminated → `ELIMINATED`; lobby → `INVALID_STATE`; halt → `HALTED`; execute with `executeOrder`/`closePosition` at `market.price` (fill with spread, BR-003); `close` without position → `fill: null`, no state change. Then send `order.ok`, then run the same target/elimination checks as `tick` (BR-009 "after every order").
  - `endRound(reason, winners)`: `round = null`; `lastRound = { reason, winners, ranking }`; status `lobby`; seats keep their final state until next `start`; clear disconnect timers; broadcast `round.end` and `room.state`; `publish(summary)`; the shell stops the interval.
  - `onSocketClosed(uid)` (overrides M3): lobby → remove seat now (lobby-disconnect rule, host transfer per BR-013); running → status `disconnected`, `disconnectedAt = now`, `schedule(30 s, () => eliminateDisconnected(uid))` (BR-019). Explicit `room.leave` during a round calls the same path (leave rule).
  - `eliminateDisconnected(uid)`: if still `disconnected` → `liquidate` at the current price (BR-019), status `eliminated`; then the usual end checks.
  - `join(uid, nick)` during running: if the UID has a `disconnected` seat → restore it to `active` and cancel its timer, send `room.history` and the current view (FR-015 AC). Otherwise → observer (BR-012), subject to `ROOM_FULL` (BR-011). `assignRole` gets `status: 'running'` (its M3 param) and returns `observer` for new UIDs.
  - Kick (M3 `kick`) during round: remove seat and observers entry, cancel timers, `kicked` + close 4403 (kick rule).
- `room/room.ts` (DO shell) changes: start `setInterval(TICK_MS)` on `start`, clear on `round.end`/`closeRoom`/dispose; compute `elapsed = min(now − last, HALT_TICK_CAP_MS)` (the cap is named for halt use, applied to every interval); `ctx.waitUntil` for `publish`; `seed` = `crypto.getRandomValues(new Uint32Array(1))[0]`.

### Fit with Project Docs
- **PRD:** FR-011, FR-012, FR-013, FR-014, FR-015, BR-005, BR-007, BR-008, BR-009, BR-010, BR-012 (watch-only seat), BR-013 (host start), BR-015, BR-018, BR-019. Rule bent: BR-012 literal "becomes an observer" is implemented as "watch-only seat", user decision, to keep BR-011's cap (flagged in the PRD log as decision row 38 below).
- **ARCHITECTURE:** serialized DO (one event at a time, no locks); engine from `shared`; timers only in the shell; memory only; server authority; errors by code.
- **CODE_QUALITY:** ranking and end conditions live in `worker/room/` (single-source table); `RoomLogic` plain TS with injected clock, seed and send; tests cite BR/FR ids; no `Math.random` in logic.
- **Docs to update:**
  - `docs/PRD.md` §20 row 38: "Eliminated players keep a watch-only seat (not an observer slot) to respect BR-011" (user decision). Row 39: "Halt in wall-clock ms" (user decision). Row 40: tie-break defined as "last value change of equity" (planning default, adopted).
  - `docs/PRD.md` §13 Player table: `status` values `active | disconnected | eliminated` (unchanged) — add note that eliminated players remain seated.
  - `docs/ARCHITECTURE.md` error list: no change (all codes already exist from M3).

### Alternative Approaches Considered
- **Eliminated player moved to observers list (BR-012 literal):** Pro: literal rule. Con: observer cap breaks (BR-011) or needs an exemption. User chose watch-only seat.
- **Halt in game ticks (63):** Pro: deterministic in tests without elapsed time. Con: at 8× the halt is 0.6 s wall time, not 5 s. User chose wall-clock.
- **Tie-break by "time of first reaching the final value" recorded once per seat (Option C):** Pro: literal. Con: equity moves every tick, so "final value" is only known at the end. "Last value change" (adopted) gives the same ordering in practice and is computable online.
- **Use `setInterval` with catch-up by wall time (Option D):** Pro: exact pace after stalls. Con: bursty broadcasts and more code. User chose fixed speed steps (decision 33).
- **Engine in a separate Durable Object per round (Option E):** Pro: isolation. Con: extra cross-DO hops per tick (latency NFR-001) and more free-plan requests. Not chosen.

## Implementation Steps

1. [x] `packages/shared/src/rules.ts`: add `ORDER_RATE_WINDOW_MS = 1_000` (BR-018). `config.ts`: add `HALT_TICK_CAP_MS = 250` (elapsed cap per interval).
2. [x] `packages/shared/src/protocol/views.ts`: `RankRow`, `MeRound`, `NewsView`, `RoomView.lastRound`, `MemberStatus` (`active|disconnected|eliminated`).
3. [x] `packages/shared/src/protocol/server.ts`: add `room.history`, `room.tick`, `order.ok`, `round.end` with zod schemas (server messages are validated in tests only) and types.
4. [x] `packages/worker/src/room/rate-limit.ts` (`OrderRateLimit`). Tests: 10 attempts in 1 000 ms accepted, 11th rejected (FR-012 AC); window slides (after 1 000 ms the 11th is accepted); rejected attempts count (planning default).
5. [x] `packages/worker/src/room/ranking.ts`: `rankSeats`, `reachedTarget`, `winnersAtTime`, `winnersAtTarget`. Tests (BR-009/BR-010 table): eliminated last with equity 0 and shared last place; higher equity wins; equal equity earlier `reachedEquityAt` wins; equal equity and equal time → shared place 1; target: two reach on same tick → higher equity wins, equal → shared (BR-009).
6. [x] `packages/worker/src/room/round.ts`: `startRound` (all seats active, portfolio empty, `reachedEquityAt = now`, observers untouched), `stepRound` (halt, speed steps, history cap 2 400, bankruptcy liquidation, equity change tracking). Tests: FR-011 AC (every seat gets the same price stream from one seed); FR-003 AC (equity ≤ 0 → liquidated, eliminated, equity shown 0) via seat; halt: `stepRound` with elapsed 250 ms ×20 = 5 s → halt ends (`tickHalt`); `reachedEquityAt` changes only when equity value changes.
7. [x] `packages/worker/src/room/room-logic.ts`: `start` (host, lobby, ≥1 seat), `tick` (broadcast per recipient with `you`), `order` / `close` (rate limit → role → state → halt → execute → `order.ok` → end checks), `endRound`, `onSocketClosed` (lobby → remove; running → disconnected + 30 s timer), `eliminateDisconnected`, `join` during running (restore vs observer), kick during round. Tests with fake clock/seed/send (see Test Strategy).
8. [x] `packages/worker/src/room/room-logic.ts`: `assignRole(…, 'running', …)` returns `observer` for new UIDs and the restore path is handled before `assignRole`.
9. [x] `packages/worker/src/room/room.ts` shell: `setInterval(TICK_MS)` on `start`, `elapsed = min(now − last, HALT_TICK_CAP_MS)`, `seed` from `crypto.getRandomValues`, stop on `round.end`, `closeRoom`, `dispose`; message switch handles `room.start`, `order`, `close`; `ctx.waitUntil` for `publish`.
10. [x] Test client `packages/worker/test/support/test-client.ts`: drives four `RoomLogic` seats with a scripted strategy (buy/sell/close with a seeded RNG, fake clock advancing 80 ms per tick, speed 8), collects messages per uid. Used by the round tests below.
11. [x] Round tests `packages/worker/test/room/round-engine.test.ts` (FR-011–FR-015 ACs):
    - FR-011: non-host `start` → `FORBIDDEN`; start during round → `INVALID_STATE`; start with no seats → `INVALID_STATE`.
    - FR-012: 11 orders within 1 000 ms → 11th `RATE_LIMITED`, connection not closed (no `close` call); observer order → `FORBIDDEN`; order in lobby → `INVALID_STATE`; `price` field → `INVALID_PAYLOAD` (schema, M3).
    - FR-012 execution: BUY 50 fills at `price + 0.03`; CLOSE with no position → `fill: null`, no state change.
    - FR-005/BR-015: order during halt → `HALTED`; `close` during halt → `HALTED`.
    - FR-013 AC: $500 target and a player with total result ≥ 500 at tick → round ends, that player wins; time end → highest equity wins; equal equity → earlier `reachedEquityAt` wins; equal equity and time → shared place.
    - BR-009: target checked after an order too (order that pushes total result ≥ target ends the round).
    - BR-005/FR-014: equity ≤ 0 → eliminated, equity 0, last place, still seated; all eliminated → `ALL_ELIMINATED` round end immediately.
    - FR-015 AC: disconnect 10 s → same UID rejoins (`room.join`) → same portfolio and equity except price moves; disconnect 31 s → eliminated (seat kept, status eliminated).
    - BR-019: disconnected player's equity still updates with price moves.
    - BR-012: lobby disconnect removes seat immediately; host transfers (M3 rule).
    - BR-017 in round: kick removes seat, kicked may rejoin (observer), `kicked` sent with close 4403.
    - Round end: room returns to `lobby`, `lastRound` shown; next `start` by host resets seats to `active` (seat-reset rule).
    - Explicit `room.leave` during round uses the 30 s grace (leave rule).
12. [x] Four-player seeded round test (M4 DoD): test client plays 4 players, speed 8, duration 3 min (fake clock), until `round.end`; asserts: no unexpected `error` messages, all four receive identical `prices` streams, `round.end` reason is one of TARGET/TIME/ALL_ELIMINATED, ranking sums are consistent. Runs in ≤ 2 s real time (fake clock, no sleeps).
13. [x] Disconnect and timer hygiene test: after `round.end` and after `dispose()`, no timers remain (fake timers count = 0). Disconnect timers cleared on round end.
14. [x] Determinism test: same seed + same scripted orders → identical message log for the four-player round (ARCH invariant, CODE_QUALITY tests rule).
15. [x] Protocol tests (`shared`): `room.tick`, `order.ok`, `round.end`, `room.history` schemas accept the documented shapes and reject extra fields (only validated in tests; server messages are not parsed by the server).
16. [x] Docs: `docs/PRD.md` §20 rows 38–40; `docs/PRD.md` §13 note on eliminated seats.
17. [x] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (shared + worker) green; steps ticked; Implementation Log filled.

## Checkpoints (Todo List)

- [x] CP1 — Rules and protocol: steps 1–3, 15; `pnpm --filter @fm/shared test` green. — 103 tests green
- [x] CP2 — Rate limit and ranking: steps 4–5; Vitest green (FR-012 AC, BR-009/BR-010 table). — 23 tests green
- [x] CP3 — Round state: step 6; Vitest green (FR-011 same stream, FR-003 bankruptcy via seat, halt timing). — 13 tests green
- [x] CP4 — RoomLogic round rules: steps 7–8; Vitest green for the FR-013–FR-015 ACs. — FR-013 in round-engine.test.ts, FR-014/FR-015 in room-logic-round.test.ts and round-engine.test.ts; worker unit suite 264 tests green
- [x] CP5 — Shell, test client and round tests: steps 9–14; four-player seeded round green; determinism green; no timers left. — shell over real sockets green in workerd (integration project)
- [x] CP6 — Docs and final light verification: steps 16–17; lint, typecheck and all Vitest green. — lint clean, typecheck clean, 510 tests green (shared 103, web 143, worker 264)

## Risks & Mitigations

- **Risk:** Tick loop drifts when the Durable Object is busy, so the round clock and the price stream disagree.
  - Mitigation: round end uses wall clock `endsAt` checked each tick (BR-008, FR-011); price pace is fixed speed steps per interval (decision 33), so a late interval means fewer steps, not a burst. Measured in M6 with the 10-min round.
  - Mitigation: `elapsed` for halt is capped at 250 ms, so a stall cannot end the halt early or late by more than the cap.
- **Risk:** Client-side ordering race: an order arrives at the same time as a tick. The Durable Object is single-threaded, so each event runs to completion (ARCH invariant); order and tick never interleave.
  - Mitigation: state changes happen only inside `RoomLogic` calls; a test sends an order between two `tick` calls and checks the fill uses the price of the latest tick.
- **Risk:** Eliminated and disconnected players keep their seat and their equity computations, which costs CPU for big rooms.
  - Mitigation: max 4 seats; per-tick work is O(seats). Negligible.
- **Risk:** Target tie-break is wrong when equity values are exactly equal only by coincidence (raw floats, decision 34).
  - Mitigation: documented as "equal value" with float equality; the test table covers both equal and different values. Exact equality is rare except for flat players (both 10 000 from the start), which share the place by design.
- **Risk:** Disconnect timer fires after the seat was restored (race between timer and reconnect).
  - Mitigation: `eliminateDisconnected` checks the seat status is still `disconnected` and the timer handle matches; restoring cancels the timer.
- **Risk:** Free-plan duration: a 10-min round keeps the Room awake ~10 min (small).
  - Mitigation: included in the M6 duration budget.

## Test Strategy

**Light (during implementation, Vitest only):**
- `packages/shared`: protocol schemas (server messages) and views.
- `packages/worker`:
  - `room/rate-limit.test.ts`, `room/ranking.test.ts` (BR-009/BR-010 table), `room/round.test.ts`.
  - `room/room-logic.test.ts` (round rules, FR-011–FR-015 ACs, BR-012 watch-only; leave, seat-reset, lobby-disconnect and kick rules).
  - `test/room/round-engine.test.ts`: test-client driven rounds (orders, halt, target, time, elimination, disconnect, rate limit, four-player seeded round).
  - Determinism test (same seed → same message log).
  - Timer hygiene test (no timers left after round end and dispose).
- `pnpm lint`, `pnpm typecheck`.

**Heavy (review only):** Playwright four-context round in M6; latency NFR-001 measured in M6 (`order` → `order.ok`, p95 ≤ 300 ms); 10-minute NFR-006 run (flag `E2E_FULL_ROUND=1`, user decision: 3 min by default, 10 min before release).

## Success Checklist
- [ ] All success criteria met, with evidence (Vitest output: rate-limit, tie-break table, four-player round)
- [ ] Lint, typecheck, Vitest green in `shared` and `worker`
- [ ] No storage, alarms or hibernation in the round code (M3 guard test still green)
- [ ] Docs updated (PRD §20 rows 38–40, §13 note)
- [ ] Code review approved (`first-million-review`)
- [ ] No regressions (M3 tests still green; M1 engine tests still green)

## Timeline & Estimates
- Phase 1 (rules, protocol, rate limit, ranking): ~4 h
- Phase 2 (round state, RoomLogic round rules): ~8 h
- Phase 3 (shell, test client, round tests, determinism): ~6 h
- Phase 4 (docs, review): ~2 h
- **Total**: ~20 h (rough, plus buffer)

## Open Questions
- [ ] None blocking. Decisions taken in planning (halt wall-clock, watch-only seats, rate-limit counting, leave = disconnect, observer host, lobby disconnect, kick semantics) are recorded in PRD §20 rows 38–40 and the trade-offs above.

## Implementation Log
- Base: `main` @ 19739e3 (M3 merged), worktree `.claude/worktrees/04-server-round-engine`
- Step 1 — started
- Step 1 — done — files: packages/shared/src/rules.ts, packages/shared/src/config.ts — added `ORDER_RATE_WINDOW_MS`, `HALT_TICK_CAP_MS`
- Step 2 — started
- Step 2 — done — files: packages/shared/src/protocol/views.ts, packages/shared/src/protocol/index.ts, packages/worker/src/room/room-logic.ts — `memberStatusSchema`, `rankRowSchema`, `meRoundSchema`, `newsViewSchema` (same shape as `NewsEvent`, incl. FLASH_CRASH `drop`), `lastRoundSchema`, `roundEndReasonSchema`; `RoomView.lastRound`; M3 `viewFor` returns `lastRound: null` until step 7
- Step 3 — started
- Step 3 — done — files: packages/shared/src/protocol/server.ts — `room.history`, `room.tick`, `order.ok`, `round.end` schemas; `room.tick.news` is set only on the interval the event was drawn
- Step 15 — started (done early to close CP1)
- Step 15 — done — files: packages/shared/test/protocol.test.ts — 6 tests: documented shapes, extra fields rejected, null fill, news types, round.end reasons, ranking privacy
- Step 4 — started
- Step 4 — done — files: packages/worker/src/room/rate-limit.ts, packages/worker/test/room/rate-limit.test.ts — `OrderRateLimit`, 4 tests (11th refused, window slides, refused attempts count, steady rate passes)
- Step 5 — started
- Step 5 — done — files: packages/worker/src/room/ranking.ts, packages/worker/test/room/ranking.test.ts — `rankSeats`, `reachedTarget`, `winnersAtTime`, `winnersAtTarget`, 19 tests. Deviations: functions take a consumer-declared `RankableSeat` (no import of `Seat`, CODE_QUALITY "pass what is used"); `winnersAtTarget(reachers, price)` receives the seats that reached the target (the caller filters with `reachedTarget`), so `target`/`reachedNow` params are gone; `winnersAtTime` skips eliminated rows (all eliminated → no winners); added `shownEquity`
- Step 6 — started
- Step 6 — done — files: packages/worker/src/room/round.ts, packages/worker/test/room/round.test.ts — `Seat`, `Round`, `startRound`, `stepRound`, plus exported `settleSeat` (bankruptcy + `reachedEquityAt`, reused after every order) and `eliminateSeat` (reused by the disconnect timeout). `Round.lastNews` = news drawn in the latest step (null otherwise), so `room.tick` sends it once. Round `history` starts with the $100 start price. 13 tests
- Step 7 — started
- Step 7 — done — files: packages/worker/src/room/room-logic.ts, packages/worker/src/room/round.ts, packages/worker/src/room/room.ts (only `now`/`seed` wiring so it typechecks; rest in step 9), packages/worker/test/room/room-logic.test.ts (deps), packages/worker/test/room/room-logic-round.test.ts, packages/worker/test/support/test-client.ts — `RoomLogic` extended with start/tick/order/close/endRound/disconnect/restore/kick-in-round. 36 new tests (start, orders, rate limit, halt, news, disconnect/return, observers, kick). Decisions inside the plan's lines: (a) `tick()` takes no argument: logic owns `lastTickAt` and the 250 ms cap through `deps.now()`, the shell only calls `tick()` (so a fake clock tests it); (b) `RoomDeps` gains `now()` and `seed()`; (c) a seat whose socket is gone keeps `disconnectedAt` (also once eliminated), so the UID can return and watch (FR-015 AC "returning, observer"); (d) host role passes at disconnect, not after the grace, to the next connected member (BR-013: a running round continues); (e) at round end, seats of players who are gone are dropped (they stay in `lastRound.ranking`), so a room with nobody left can arm the 5 min timer; (f) round tests live in `room-logic-round.test.ts` to keep M3 `room-logic.test.ts` unchanged; (g) gate order in `order`/`close`: stranger → FORBIDDEN, rate limit, observer → FORBIDDEN, lobby → INVALID_STATE, eliminated → ELIMINATED, halt → HALTED
- Step 8 — started
- Step 8 — done — files: packages/worker/src/room/room-logic.ts — `join` passes the room state to `assignRole` (existing `roster.test.ts` covers `running` → observer) and handles the returning UID before `assignRole`; tests in room-logic-round.test.ts ("BR-012 joiner during a round is an observer")
- Step 10 — started (built with step 7, which needed it)
- Step 10 — done — files: packages/worker/test/support/test-client.ts — `createHarness` (RoomLogic + fake clock + recorded messages, `tick`, `runToEnd`), `joinPlayers`, `scriptedPlayers` (seeded random orders)
- Step 9 — started
- Step 9 — done — files: packages/worker/src/room/room.ts, packages/worker/test/integration/round.test.ts — `setInterval(TICK_MS)` started after `room.start` while `logic.running`, cleared by the interval itself once the round is over and on room deletion (`publish(null)`); `room.start`/`order`/`close` routed; `seed` from `crypto.getRandomValues`; `publish` already used `ctx.waitUntil`. The elapsed cap lives in `RoomLogic.tick()` (see step 7 note a). 1 workerd test over real sockets (start, same stream, order.ok, FORBIDDEN/INVALID_STATE)
- Step 11 — started
- Step 11 — done — files: packages/worker/test/room/round-engine.test.ts, packages/worker/test/support/test-client.ts (`latestTick`, `leverage`, bots skip halt/eliminated) — 25 tests with the room-logic-round.test.ts ones: target, shared target, time end to the tick, ranking consistency, elimination by leverage (position size is unlimited in the rules), ALL_ELIMINATED, lobby return, seat reset, kick between rounds. Notes: (a) the plan's "order that pushes total result ≥ target" cannot happen with a real engine (every fill costs spread, so an order never raises equity), so "end checks after an order" is shown with the time running out between two ticks; (b) "equal equity, earlier `reachedEquityAt` wins" is not reachable through real trades either, so it is covered on seats (ranking.test.ts, round.test.ts); (c) target tests use $100 (the minimum), the ranking table covers $500
- Step 12 — started
- Step 12 — done — files: packages/worker/test/room/round-engine.test.ts — 4 scripted players, speed 8, 3 min, seed 42: no `error` messages, identical price streams (the interval that ends the round sends `round.end` instead of a tick), same `round.end` for all, consistent ranking; ~50 ms real time
- Step 13 — started
- Step 13 — done — files: packages/worker/test/room/round-engine.test.ts — no pending timer after round end (a disconnect timer pending at the end is cancelled) and after `dispose()`; no empty-room timer while a round runs
- Step 14 — started
- Step 14 — done — files: packages/worker/test/room/round-engine.test.ts — same seeds → identical message log, other seed → different log
- Step 16 — started
- Step 16 — done — files: docs/PRD.md, docs/ARCHITECTURE.md — PRD §20 rows 38–40 as planned, plus row 41 for the other planning defaults and the rules fixed during implementation (host handover at disconnect, dropped players leave the seats at round end); §13 notes on `disconnectedAt`, `reachedEquityAt` and watch-only seats. ARCHITECTURE: status line, `room/` file list, Time invariant (tick owned by `RoomLogic`), player states
- Step 17 — started
- Step 17 — done — `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 510 passed (background subagents on the final tree); M3 no-storage guard test still green; heavy checks (e2e, build, Lighthouse, axe) not run, left to review
