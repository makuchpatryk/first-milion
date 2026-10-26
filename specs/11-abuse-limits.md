# Abuse limits for Lobby and sockets (security audit H1–H3) — Implementation Plan

## Summary
The `/first-million-security` audit at `main` @ `77d8c7f` (v1.0.3, clean tree) found three High items, all denial-of-wallet or outage risks on the free plan (NFR-002):

- **H1**: `room.create` has no cap. Each frame creates a Room Durable Object that lives 5 min, and the lobby list has no size limit (`packages/worker/src/lobby/lobby.ts:94`, `lobby-logic.ts`).
- **H2**: after auth, a socket can send unlimited frames. Each `room.join`/`room.leave` runs `changed()` and a `/register` request to the Lobby, plus a broadcast to every lobby subscriber. The Lobby also keeps every socket a user opens (`socket.ts:81`, `room-logic.ts:182`, `lobby.ts:63`).
- **H3**: an anonymous upgrade is held by the Lobby (or a Room) for up to 5 s with no cap on how many can be pending (`index.ts:38-43`, `auth-gate.ts:38`).

The fix: room caps in `LobbyLogic`, a per-socket frame budget and a per-DO pending-socket cap in the shared socket acceptor, and newest-wins on the Lobby socket (as decision 47 already does for Rooms). Milestone: post-M6 security fix, before the next `vX.Y.Z` tag.

Base: `main` @ `77d8c7f`. The plan does not depend on any unmerged branch, but `feature/10-host-grace-and-keepalive` (6 ahead, unmerged) edits `socket.ts` too (see Risks).

## Success Criteria
- A host with 3 live rooms (registered or still pending) gets `RATE_LIMITED` on the 4th `room.create`; the socket stays open; no Room DO is initialised (LobbyLogic Vitest + workerd integration).
- With 20 live rooms in total, the next `room.create` from any host gets `RATE_LIMITED` (LobbyLogic Vitest).
- Two `room.create` frames sent together from a host with 2 rooms: exactly one passes (the reservation is synchronous, before the first `await`) (workerd integration).
- A failed `/init` or a deleted room frees its slot; a room with no `register` for `STALE_AFTER_MS` frees its reservation (LobbyLogic Vitest).
- A single socket sending 51 frames inside one second gets `RATE_LIMITED` on the excess frames, stays open, and sends a frame again after the window passes. `ping` counts toward the budget (workerd integration).
- The 101st simultaneous unauthenticated upgrade on one DO gets HTTP 503 before any socket is created; an authenticated socket frees its slot (workerd integration).
- A second Lobby socket of the same UID replaces the first: the first gets close `4409`, the new one gets `lobby.rooms` (workerd integration). The Lobby socket counts as a subscriber only after auth, as now.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (light checks; build and e2e are not run here).

## Scope & Constraints
- **In scope**: H1, H2, H3 of the 2026-10-26 audit. Protocol: no new message or close code; `RATE_LIMITED` reused for H1 and H2. Config: four tunables in `shared/config.ts`. Docs: PRD §20 decision 49, PRD §7 R1, ARCHITECTURE invariants and open item 1.
- **Out of scope**:
  - Findings M1–M4 and L1–L3 of the audit (headers, action SHA pinning, Dependabot, workflow permissions, grpc override, room-name characters, logging runbook). Separate plan.
  - Cloudflare WAF rate-limiting on `/ws/*` and `/api/me`. It needs a custom domain and lives in the dashboard, so it is listed under "Not verifiable from the repo" for the owner, not built.
  - `AUTH_TIMEOUT_MS` stays at 5 s (user decision; FR-007).
  - Per-IP limits. The Worker has no client IP in the code path, and the cap in this plan is global per DO.
  - Deduplicating Room→Lobby `register` requests (see Trade-offs).
  - Anything in PRD §10.3.
- **Hard constraints**:
  - Server authority: no client value is trusted; the limits count server-side only (BR-007).
  - Memory only: all counters and maps live in the DO instance; no storage, alarms or hibernation (BR-020, decision 37, ARCHITECTURE A2, guard `no-storage.test.ts`).
  - Errors are codes, never text (ARCHITECTURE Errors). `RATE_LIMITED` does not close the socket (decision 41, BR-018).
  - Privacy: the room owner UID never leaves the Lobby. `RoomSummary` gets no new field (ARCHITECTURE Privacy).
  - PL + EN for every changed text (FR-019; `locale-keys.test.ts`).
  - 0 PLN: nothing added that costs a request per frame beyond the budget check.
- **Trade-offs**:
  - Caps and budgets are chosen by the user (3 rooms per host, 20 global, 50 frames/s). They are not measured. Open item 1 in ARCHITECTURE stays open for the real free-plan numbers.
  - The frame budget does not disconnect (decision 41). An attacker can still send 50 join/leave frames per second per socket, so the Lobby takes up to 50 `register` requests per second from one socket. That is bounded, not removed. A later option is to skip `register` when the summary has not changed, or to add a tighter budget on `room.join`/`room.leave` only.
  - H3 caps *held* sockets, not requests. A flood of rejected upgrades still costs a Worker request each. Only the WAF rule (dashboard) bounds that, so H3 is partly outside the repo.
  - Lobby newest-wins means a second tab takes the lobby list and the first tab shows the "replaced" message. This matches decision 47 and is accepted.
  - Pending-socket cap 100 is large enough that a deploy-time reconnect wave of honest clients fits, and small enough to bound the Lobby's memory.
  - Frames over the budget still arrive and are billed as incoming WebSocket messages (20:1, ARCHITECTURE open item 1). The budget bounds processing and `register` fan-out, not billing. Only a disconnect stops billing, and decision 41 excludes it.
  - The pending cap is per DO. An attacker holding all 100 slots makes honest upgrades get 503 for each 5 s auth window, and can refill them. No per-IP limit exists in the code path; the WAF rule (dashboard) is the remedy, as listed under "Not verifiable from the repo".

## Architecture & Design

### High-Level Flow
```
client ── upgrade ──► index.ts (Origin check, unchanged)
                        │
                        ▼
              DO (Lobby or Room) socket acceptor
                 ├─ pending count ≥ MAX_PENDING_SOCKETS? → 503, no socket
                 ├─ frame budget per socket (before parse, after auth)
                 │     over → error RATE_LIMITED, frame dropped, socket open
                 └─ AuthGate → RoomLogic / LobbyLogic

room.create (Lobby socket)
   LobbyLogic.reserve(uid, roomId)  ── sync, before any await
      over per-host (3) or global (20) cap? → RATE_LIMITED
   await /init ── fail → release(roomId)
   /register, /deregister, sweep → owners follow the rooms
```

### Key Changes
- **`packages/shared/src/config.ts`**: four tunables under a new comment block "Abuse limits (security audit H1–H3, PRD §20 #49)":
  - `MAX_ROOMS_PER_HOST = 3`
  - `MAX_ROOMS = 20` (live rooms, pending included)
  - `FRAME_BUDGET_PER_SEC = 50`
  - `MAX_PENDING_SOCKETS = 100` (per DO instance)
  - Why `config.ts` and not `rules.ts`: these are cost tunables, not BR values (PRD §20 #30 rule).
- **`packages/worker/src/rate-limit.ts`** (moved from `worker/src/room/rate-limit.ts`): the sliding-window class is generic, but it is named `OrderRateLimit` and sits under `room/`. Rename the class to `SlidingWindowLimit` and move it, so `socket.ts` (shared plumbing) can use it without importing from `room/`. Callers: `room-logic.ts` (`rateLimitFor`), `test/room/rate-limit.test.ts`. No behaviour change; its tests keep their names with the new class name.
- **`packages/worker/src/lobby/lobby-logic.ts`** (H1): add ownership next to `rooms`.
  - `private readonly owners = new Map<string, { uid: string; reservedAt: number }>()`
  - `reserve(roomId: string, uid: string): RoomLimitResult` checks, in this order: `owners.size >= MAX_ROOMS` → refuse; count of `owners` with `uid` `>= MAX_ROOMS_PER_HOST` → refuse. On success it sets `owners` and returns ok. A refusal is `false` (boolean, not a flag-argument function: CODE_QUALITY).
  - `release(roomId)`: delete from `owners`.
  - `remove(roomId)` also deletes the owner (deregister, admin close, stale 404).
  - `sweep()` also drops owners whose room is not in `rooms` and whose `reservedAt` is older than `STALE_AFTER_MS` (covers a successful `/init` whose `/register` was lost).
  - `reservedAt` uses the injected `now()`.
  - The owner UID stays in `owners`, never in `RoomSummary` or any broadcast.
- **`packages/worker/src/lobby/lobby.ts`** (H1, H2 newest-wins):
  - `createRoom(hostUid, form, conn)`: mint the id (`newUniqueId()` is synchronous), call `logic.reserve(roomId, hostUid)`. Refused → `conn.send({ type: 'error', code: 'RATE_LIMITED' })` and return before any fetch. Then the existing `/init` fetch. If the response is not OK or the fetch throws, `logic.release(roomId)` before the `INVALID_STATE` reply.
  - `subscribers` becomes `Map<string, Connection>` keyed by UID. `onAuthed`: take the previous connection for that UID; set the new one; close the previous one with `CLOSE_CODES.REPLACED` (same as `room.ts:324`). `onClose`: remove only if the map still holds this connection (same guard as `room.ts:369`). `broadcast` iterates `values()`.
- **`packages/worker/src/socket.ts`** (H2 budget, H3 pending cap): the acceptor is created once per DO instance, so per-instance counters live in `createSocketAcceptor`.
  - `pending`: number of accepted sockets not yet authenticated. `accept()` returns `new Response(null, { status: 503 })` before creating the `WebSocketPair` when `pending >= MAX_PENDING_SOCKETS`. Increment on accept; decrement exactly once: on the gate's `onAuthed` (first auth) or in `onGone` if the socket never authenticated (use a per-socket `counted` flag so the decrement runs once).
  - Frame budget: after auth, each message from `server.addEventListener('message')` takes one attempt from a per-socket `SlidingWindowLimit(FRAME_BUDGET_PER_SEC, 1_000)` before `parseClientMessage`. Refused → `conn.send({ type: 'error', code: 'RATE_LIMITED' })`, return; the socket stays open. Pre-auth frames are not counted: `AuthGate` already closes on any non-auth frame.
  - `ping` counts (it is one frame and costs a send). One honest ping per 25 s is far below budget.
  - Clock: `Date.now()` is allowed in the socket shell (runtime clock lives there, per the existing comment).
- **`packages/worker/src/room/room-logic.ts`**: import `SlidingWindowLimit` from `../rate-limit`; `rateLimitFor` uses it.
- **Protocol**: no change. `RATE_LIMITED` is already in `ERROR_CODES`. `ERROR_CODES` and close codes stay as they are.
- **Web** (`packages/web/src/i18n/en.json:243`, `pl.json` equivalent): reword `error.rateLimited` so it fits room creation as well as orders. EN: "Too many requests at once. Slow down for a moment." PL: same meaning in Polish. Check the `locale-keys` test still passes. No component change.
- **Data model**: Lobby gains `owners` (roomId → uid, reservedAt). Socket acceptor gains `pending`. Both memory-only.
- **Config/CI**: none.
- **Dependencies**: none.

### Fit with Project Docs
- **PRD**:
  - Implements the abuse part of NFR-002 (free plan at 50 users) and R1 (limits and mitigation), and the planning default of BR-018 (refused attempts count).
  - Refines decision 41 only for the frame budget (no disconnect on `RATE_LIMITED`), so decision 41 is not bent.
  - Decision 47 is extended to the Lobby socket.
  - Adds decision 49 (below). No rule bent.
- **ARCHITECTURE.md**:
  - Invariants: add "Abuse limits" (caps and budgets in memory, `RATE_LIMITED` without disconnect, pending cap per DO). Change "One socket per user per room" to "One socket per user per room and for the lobby list".
  - Open item 1: record that room caps and the frame budget exist; the free-plan duration measurement is still open.
  - Errors: no change (`RATE_LIMITED` already listed).
- **CODE_QUALITY.md**: the sliding-window class moves out of `room/`, so shared socket plumbing does not import from a room (layering, Separation principle). One implementation serves both the order and the frame limit (single source). Known debt: none added.
- **Docs to update**:
  - `docs/PRD.md` §20: decision **49** (abuse limits: 3 rooms per host, 20 global including pending, 50 frames/s per socket with `RATE_LIMITED` and no disconnect, 100 pending sockets per DO, Lobby newest-wins). Note that the numbers are planning defaults, to be measured.
  - `docs/PRD.md` §7 R1 mitigation: add the room caps and the frame budget.
  - `docs/ARCHITECTURE.md`: invariants and open item 1 as above.
  - `docs/CODE_QUALITY.md`: no change.
  - `specs/11-abuse-limits.md`: implementation log.

### Alternative Approaches Considered
**H1 cap counting**
- Option A: count only registered rooms (what the Lobby sees). Simple, but a burst of creates before registration overshoots. Rejected.
- Option B (chosen): reservations before `/init`, released on failure or on removal. Synchronous, so no race on the `await`. Cost: one more map and a sweep rule.
- Option C: have Room DO enforce per-host caps by querying the Lobby. More round trips, more code, no gain. Rejected.

**H2 budget placement**
- Option A (chosen): per-socket budget in the shared acceptor, before parse. Covers both DOs, one place.
- Option B: budget in `RoomLogic` / `LobbyLogic`. Parsing and auth already ran, and Room-only. Rejected.
- Option C: disconnect on overflow (4429). Stronger, but conflicts with decision 41's "no disconnect on RATE_LIMITED". Rejected per user answer.

**H3 pending cap**
- Option A (chosen): counter in the shared acceptor, 503 before `WebSocketPair`. Covers Lobby and Room.
- Option B: shorten `AUTH_TIMEOUT_MS` to 2 s. Less hold time, but a PRD change and a false-failure risk on slow mobile. Rejected (user answer).
- Option C: only a WAF rule. Needs a custom domain; the Worker code would stay open. Kept as a dashboard item.

**Lobby socket per user**
- Option A (chosen): newest wins, as decision 47.
- Option B: N sockets per user. More code, the cap has to choose which socket closes. Rejected.

## Implementation Steps
1. [x] `packages/shared/src/config.ts`: add `MAX_ROOMS_PER_HOST = 3`, `MAX_ROOMS = 20`, `FRAME_BUDGET_PER_SEC = 50`, `MAX_PENDING_SOCKETS = 100` under an "Abuse limits" comment citing PRD §20 #49.
2. [x] Move `packages/worker/src/room/rate-limit.ts` to `packages/worker/src/rate-limit.ts`; rename `OrderRateLimit` to `SlidingWindowLimit`; update the import in `room/room-logic.ts`; move `test/room/rate-limit.test.ts` to `test/rate-limit.test.ts` with the new name. No behaviour change.
3. [x] `packages/worker/src/lobby/lobby-logic.ts`: add `owners` map, `reserve(roomId, uid): boolean` (global cap first, then per-host), `release(roomId)`; `remove` drops the owner; `sweep` drops orphan reservations older than `STALE_AFTER_MS`. `reserve` arms the sweep timer too, so a reservation with no registered room is still swept. Inject `now` (already present).
4. [x] `packages/worker/test/lobby/lobby-logic.test.ts`: cases for the per-host cap (3 pass, 4th refused), the global cap (20 pass, 21st refused across hosts), release on `/init` failure, remove frees the owner, sweep drops an orphan reservation and keeps a registered room's owner. Cite PRD §20 #49.
5. [x] `packages/worker/src/lobby/lobby.ts` `createRoom`: reserve synchronously before the fetch; `RATE_LIMITED` on refusal; release on a failed or thrown `/init`.
6. [x] `packages/worker/src/socket.ts`: `pending` counter; `accept()` returns 503 at `MAX_PENDING_SOCKETS`; decrement once on first auth or on close without auth (per-socket `counted` flag).
7. [x] `packages/worker/src/socket.ts`: per-socket `SlidingWindowLimit(FRAME_BUDGET_PER_SEC, 1_000)` on post-auth messages before parse; refused → `RATE_LIMITED`, socket open. Keep `auth` routed to the gate exactly as now.
8. [x] `packages/worker/src/lobby/lobby.ts`: `subscribers` keyed by UID; newest wins with `CLOSE_CODES.REPLACED`; `onClose` removes only the mapped connection; update the doc comment.
9. [x] `packages/worker/test/integration/rooms.test.ts`: 4th `room.create` by one host → `RATE_LIMITED`, socket open, no room listed; two concurrent creates from a host at 2 rooms → one `room.created`, one `RATE_LIMITED`.
10. [x] `packages/worker/test/integration/shell.test.ts` (or a new `abuse.test.ts`): 51 frames in one second → the 51st is `RATE_LIMITED`, socket open, a frame after the window works; `ping` counted; 101 unauthenticated upgrades → the 101st is 503; an authenticated socket releases its slot; a second Lobby socket of one UID closes the first with `4409` and the new one gets `lobby.rooms`.
11. [x] `packages/web/src/i18n/en.json` and `pl.json`: reword `error.rateLimited` (generic, both languages). `packages/web` `locale-keys.test.ts` still passes.
12. [x] `packages/worker/test/security.test.ts`: add a guard that the Lobby and Room acceptors use `createSocketAcceptor` (no direct `accept` bypass). Optional if it is already covered by integration; keep only if it is a real guard.
13. [x] `docs/PRD.md`: decision 49 in §20; R1 mitigation text in §7.
14. [x] `docs/ARCHITECTURE.md`: invariants ("Abuse limits"; lobby newest-wins line) and open item 1 status.
15. [x] `specs/11-abuse-limits.md`: tick the boxes and append the implementation log.

## Checkpoints (Todo List)
- [x] CP1 — Config and rate-limit move: steps 1-2; `pnpm --filter @fm/worker typecheck` clean; `pnpm test` in worker green for `rate-limit` and `room-logic`. — code and tests written; typecheck/Vitest not run (not selected)
- [x] CP2 — Lobby caps: steps 3-5; worker unit Vitest `lobby-logic` green; `pnpm typecheck` clean. — code and tests written; typecheck/Vitest not run (not selected)
- [x] CP3 — Socket plumbing: steps 6-7; worker Vitest (unit + integration) green for `auth-gate`, `shell`, `security`; `pnpm lint` clean. — code written; lint/Vitest not run (not selected); its integration cases come in steps 9-10
- [x] CP4 — Lobby newest-wins and web text: steps 8, 11; worker integration `rooms` and new cases green; web `locale-keys` and `error-map` green. — code written; Vitest not run (not selected)
- [x] CP5 — Integration coverage: steps 9-10, 12; all worker Vitest green. — tests written; Vitest not run (not selected)
- [x] CP6 — Docs and final light verification: steps 13-15; `pnpm lint`, `pnpm typecheck` and `pnpm test` all green. Build, bundle and e2e are not checkpoint evidence (review). — docs done; lint, typecheck and Vitest not run (no check selected)

## Risks & Mitigations
- **Risk: owner map leaks.** A lost `/deregister` or `/register` leaves a reservation with no room, which holds a cap slot forever.
  - Mitigation: `sweep` drops orphan reservations after `STALE_AFTER_MS`; the sweep timer already runs while any room exists. Also covered by the unit test in step 4.
  - Mitigation: `reserve` arms the sweep timer too, so a reservation with no registered room is still swept (step 3).
- **Risk: race on concurrent `room.create`.** Two frames from one host both pass the check during the `/init` await.
  - Mitigation: `reserve` is synchronous and runs before the first `await` (step 5). Covered by the integration case in step 9.
- **Risk: honest clients hit the pending cap after a deploy.** A reconnect wave may exceed 100 pending sockets briefly.
  - Mitigation: the client backs off (500 ms doubling, 8 s cap, `ws-client.ts`). A 503 is retried. Lower-risk than an unbounded hold.
- **Risk: frame budget does not stop join/leave amplification.** One socket can still cause up to 50 `register` requests per second.
  - Mitigation: accepted and written down in Trade-offs. Next step if the duration numbers show it: skip `register` when the summary is unchanged, or a tighter budget on `room.join`/`room.leave`.
- **Risk: merge conflict with `feature/10-host-grace-and-keepalive`.** That branch (6 ahead, unmerged) changes `socket.ts` (~10 lines), `room.ts`, `room-logic.ts`, `roster.ts`.
  - Mitigation: this plan touches `socket.ts` and `room-logic.ts` (import line only). Merge `feature/10` first or rebase on it; the implementer checks `git diff main...feature/10-host-grace-and-keepalive -- packages/worker/src/socket.ts` before step 6.
- **Risk: `RATE_LIMITED` copy change affects the order panel.** The new generic text is shown on orders as well.
  - Mitigation: the user chose the generic text (answered in planning). Check the order panel test if one covers the text.

## Test Strategy
**Light (run at implementation, only the ones the user selects):**
- Unit (Vitest, Node): `lobby-logic` (caps, release, orphan sweep), `rate-limit` (moved class, same cases), `room-logic` (import only), locale keys.
- Integration (Vitest, workerd): `rooms` (per-host cap, concurrent create), `shell` or `abuse` (frame budget, pending cap, Lobby newest-wins). No sleeps for the budget window: use the existing fake clock where the test seam allows it, otherwise send the frames in one burst (51 frames in a tight loop fit in 1 s).
- Lint and typecheck over all packages.

**Heavy (review only, not in this plan's checkpoints):** production build, `pnpm bundle:check`, e2e (the room-flow specs still pass with the reworded text), Lighthouse.

**Manual (review):** open the create-room form with a host at 3 rooms and read the message at 360 px; open the lobby in a second tab and check that the first tab shows the "replaced" message.

## Success Checklist
- [ ] All success criteria met, with the test name as evidence
- [ ] Lint, typecheck and Vitest clean in `shared`, `worker` and `web` (implementation)
- [ ] Heavy checks run in review: build, bundle, e2e, Lighthouse (review)
- [ ] Code review approved (`first-million-review`)
- [ ] Docs updated: PRD §20 #49, §7 R1; ARCHITECTURE invariants and open item 1
- [ ] Not verifiable items still listed for the owner (WAF rule, free-plan numbers)
- [ ] No regressions in single play

## Not verifiable from the repo (owner action, after the code ships)
- [ ] Cloudflare WAF rate-limiting rule on `/ws/*` and `/api/me` (needs a custom domain; Security > WAF > Rate limiting rules)
- [ ] Cloudflare usage alerts for Durable Object duration and requests (Billing > Usage)
- [ ] Measured Durable Object duration and request numbers after one day with 4 rooms × 4 players (ARCHITECTURE open item 1). Record them there; the caps are planning defaults until then

## Timeline & Estimates
Rough, for a solo developer:
- Phase 1 (config, rate-limit move, lobby caps, socket plumbing): ~4 hours
- Phase 2 (integration tests in workerd, Lobby newest-wins, web copy): ~3 hours
- Phase 3 (docs, review, fixes): ~2 hours
- **Total**: ~9 hours, plus buffer

## Open Questions
- [ ] None blocking. The caps and budgets are planning defaults, to be measured against free-plan usage (open item 1).

## Implementation Log
(Empty. first-million-implement appends one line per step event here, so work can resume in a new session.)
- Decision: Scope: H1-H3 only; M and L findings are a separate plan.
- Decision: H1 limits: 3 rooms per host, 20 global (pending included).
- Decision: H1 cap reply: RATE_LIMITED, socket stays open.
- Decision: H2 frame budget: 50 frames/s per socket, RATE_LIMITED, no disconnect (decision 41 kept).
- Decision: Lobby socket: newest wins per UID, close 4409 (as decision 47).
- Decision: H3: code cap per DO (100 pending sockets, 503), no timeout change (5 s stays); WAF rule stays a dashboard item.
- Decision: Priority: before the next release tag.
- Decision: RATE_LIMITED copy: reword error.rateLimited to a generic text (both languages), no new error code.
- Decision: workspace: worktree
- Decision: checks: none (user selected no check; no lint, typecheck or Vitest is run, checkpoints are ticked on code and tests written)
- Base: worktree `.claude/worktrees/11-abuse-limits`, branch `feature/11-abuse-limits`, from main @ 77d8c7f; main checkout clean apart from the untracked spec
- Step 1 — started
- Step 1 — done — files: packages/shared/src/config.ts — four abuse-limit tunables with comments citing PRD §20 #49
- Step 2 — started
- Step 2 — done — files: packages/worker/src/rate-limit.ts (moved), packages/worker/test/rate-limit.test.ts (moved), packages/worker/src/room/room-logic.ts — `SlidingWindowLimit`; also keeps at most `max + 1` attempts so a frame flood cannot grow the list (same result as before, one test added). feature/10 check: main already holds its `socket.ts` ping change, no conflict
- Step 3 — started
- Step 3 — done — files: packages/worker/src/lobby/lobby-logic.ts — `owners` map, `reserve` / `release`, `remove` and `sweep` drop owners, sweep timer also runs for reservations. Deviation: rooms listed without an owner (Lobby restarted, Room re-registered) count toward the global cap
- Step 4 — started
- Step 4 — done — files: packages/worker/test/lobby/lobby-logic.test.ts — 9 cases (per-host cap, global cap, unowned rooms, release, remove, orphan sweep, heartbeat keeps owner, stale room frees slot, sweep timer). Known gap: after a Lobby restart the per-host count of already listed rooms is lost until they are recreated; the global cap still counts them
- Step 5 — started
- Step 5 — done — files: packages/worker/src/lobby/lobby.ts — `createRoom` reserves before the first await (`RATE_LIMITED` on refusal, socket open), releases on a refused or thrown `/init`
- Step 6 — started
- Step 6 — done — files: packages/worker/src/socket.ts — `pending` counter per acceptor, 503 at `MAX_PENDING_SOCKETS` before the `WebSocketPair`, released once on first auth or on close
- Step 7 — started
- Step 7 — done — files: packages/worker/src/socket.ts — per-socket `SlidingWindowLimit(FRAME_BUDGET_PER_SEC, 1_000)` on post-auth frames before parse, `RATE_LIMITED` and no close; pre-auth frames untouched
- Step 8 — started
- Step 8 — done — files: packages/worker/src/lobby/lobby.ts — `subscribers` is a `Map<uid, Connection>`; `onAuthed` closes the previous socket with `REPLACED`; `onClose` removes only the mapped socket. Note for steps 9-10: existing integration tests create more than 3 rooms per UID (`uid-1`, `uid-creator`) in one file and the Lobby DO may keep state between tests, so they get an `afterEach` that closes every listed room as admin (helper `closeAllRooms`)
- Step 9 — started
- Step 9 — done — files: packages/worker/test/integration/helpers.ts (`closeAllRooms`), packages/worker/test/integration/rooms.test.ts and shell.test.ts (`afterEach(closeAllRooms)`), packages/worker/test/integration/abuse.test.ts (new) — per-host cap with socket still open and no room added, concurrent creates (one passes), admin close frees a slot. Deviation: cases live in the new `abuse.test.ts` (plan allowed it for step 10) so the 12 other creates of `rooms.test.ts` do not share the global cap
- Step 10 — started
- Step 10 — done — files: packages/worker/test/integration/abuse.test.ts — frame budget (50 pongs then RATE_LIMITED, open, works after 1.1 s; `ping` counts; per socket), pending cap (101st upgrade 503, auth frees a slot), Lobby newest-wins (4409, new socket keeps the list). Written, not run (no check selected); the 1.1 s wait and the 100-socket case are the likely timing risks
- Step 11 — started
- Step 11 — done — files: packages/web/src/i18n/en.json, packages/web/src/i18n/pl.json — `error.rateLimited` is generic ("requests" / "żądań"). Deviation: `close.replaced` no longer says "room" ("The game was opened in another tab or window…"), because the lobby list and create-room pages now show it for a replaced lobby socket. No test or e2e spec quotes either text (grep)
- Step 12 — started
- Step 12 — done — files: packages/worker/test/security.test.ts — two guards: only `socket.ts` creates a `WebSocketPair`, and it uses `MAX_PENDING_SOCKETS` and `FRAME_BUDGET_PER_SEC`
- Step 13 — started
- Step 13 — done — files: docs/PRD.md — v1.4; decision 49 added to §20; R1 mitigation in §7 names the caps, the frame budget and the pending cap
- Step 14 — started
- Step 14 — done — files: docs/ARCHITECTURE.md — based on PRD v1.4; invariants: Lobby newest-wins and "Abuse limits"; open item 1 names the existing caps as the first lever
- Step 15 — started
- Step 15 — done — files: specs/11-abuse-limits.md — all steps and checkpoints ticked. No lint, typecheck or Vitest was run (user selected no check); the integration cases of `abuse.test.ts` (1.1 s wait, 100 sockets) and the `afterEach(closeAllRooms)` in `rooms.test.ts` / `shell.test.ts` have never run in workerd
