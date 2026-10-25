# Host grace, newest socket wins, keepalive (issue #14) — Implementation Plan

## Summary
GitHub issue #14: in a room lobby the host role moves to another player although nobody left. Root causes, confirmed in code at `main` @ `df00463` (clean tree, no dependency branch):

1. **Lobby**: any socket drop → `RoomLogic.onSocketClosed` → `leave` → `remove()` → the seat is deleted and `handOverHost` runs at once (PRD §20 #41 "a disconnect in the lobby removes the seat at once"). A page reload or network blip costs the host the role and the seat; on reconnect they rejoin at the end of the join order as a plain player.
2. **Round**: `disconnect()` calls `handOverHost` at once (`room-logic.ts:321`); `restore()` retakes the role only when the room has no host (`:341`), i.e. never.
3. **First socket wins**: `Room.onAuthed` stores a socket only if the UID has none (`room.ts:103`). A client that reconnects before the server sees the old socket die is ignored (its `room.join` gets `INVALID_STATE`); when the old socket finally closes, a leave runs and the new socket is never mapped.
4. **No keepalive**: lobby sockets carry no traffic between changes, so idle drops (mobile, NAT) are likely, which matches "sometimes, without reason".

The fix: a 30 s grace for every socket drop (lobby, round, observers) during which the host keeps the role; the role moves on grace expiry or an explicit leave; the newest socket of a UID replaces the old one (close `4409 REPLACED`); a client `ping`/`pong` keepalive detects dead sockets. Milestone: post-M6 bug fix.

## Success Criteria
- A host whose socket drops in the lobby and returns within 30 s has the same seat index in `view.players` and `you.isHost === true`; nobody else was host in between (room-logic Vitest).
- A host whose socket drops mid-round keeps the role for the grace; at 30 s + 1 tick the role is with the next connected member and the round continues (Vitest).
- An explicit `room.leave` by the host moves the role at once in lobby and round; in a round the seat still gets its 30 s grace (Vitest).
- A second room socket of the same UID replaces the first: the first gets close `4409`, no leave is recorded, the new socket's `room.join` receives `room.state` and no error (workerd integration Vitest).
- `ping` gets `pong` on Room and Lobby sockets and never reaches `RoomLogic` (no effect on the BR-018 rate limit); the web client reconnects when no `pong` arrives within 10 s, and treats `4409` as terminal with a PL + EN message (Vitest).

## Scope & Constraints
- **In scope**: BR-013 (host handover timing and successor), BR-019 / FR-015 (grace extended to the lobby and to observers), FR-016, UF-004 error states; protocol: `ping`, `pong`, `CLOSE_CODES.REPLACED`, observer view status; web keepalive, terminal 4409, observer status note, lobby-specific "could not return" banner text.
- **Out of scope**: server-side idle reaping of silent sockets (user decision); replacing sockets on the `Lobby` (room list) socket, which has no per-UID map; hibernation `setWebSocketAutoResponse` (needs hibernation, excluded by decision 37); anything in PRD §10.3; e2e spec rewrites (checked when the PR runs).
- **Hard constraints**: server authority (BR-007, `ping` carries no data); no storage, alarms or hibernation (BR-020, decision 37, ARCHITECTURE A2: grace timers are in-memory `schedule`); 0 PLN (NFR-002, ping cost below); order latency (NFR-001: ping is outside the order path); PL + EN (FR-019); WCAG 2.1 AA and 360 px (NFR-003: the 4409 message reuses `ModalDialog`); bundle ≤ 300 KB gzip (NFR-005: a few hundred bytes).
- **Trade-offs**:
  - A dropped member holds a seat or observer slot for 30 s, so a joiner can get `ROOM_FULL` meanwhile. Accepted for host and seat stability.
  - A host who vanishes without a TCP close (dead radio) stays "connected" on the server until their client reconnects (newest wins) or the runtime closes the socket. No server reaping, by user choice.
  - Newest wins means a second tab takes the room and the first tab ends with a modal. That is preferred over the stuck state.
  - The keepalive adds a client timeout. CODE_QUALITY says "no retries or timeouts beyond the PRD", so the plan adds it to the PRD as decision #48 rather than bending the rule.

## Architecture & Design

### High-Level Flow
```
socket close (mapped socket)     RoomLogic.onSocketClosed(uid) -> drop(uid)
                                   member.disconnectedAt = now; seat status 'disconnected' (unless 'eliminated')
                                   arm grace timer (DISCONNECT_GRACE_MS); host role unchanged; changed()

explicit room.leave              RoomLogic.leave(uid)
                                   handOverHost(uid) at once
                                   running round + seat -> drop(uid)   (decision 41: leaving cannot escape a loss)
                                   otherwise            -> remove(uid)

grace expiry                     RoomLogic.expire(uid)   (phase read when it fires)
                                   running round + seat -> eliminate if 'disconnected'; handOverHost; seat stays to round end; checkEnd
                                   lobby, or observer   -> remove(uid) (handover, empty-room timer)

room.join from a UID in the room RoomLogic.join -> resume(member)
                                   absent  -> clear timer, disconnectedAt = null, 'disconnected' -> 'active', changed()
                                   present -> (newer socket took over) room.state to this UID only
                                   both    -> sendHistory(uid)

start                            startRound keeps absent seats as 'disconnected' with disconnectedAt; timer keeps running
round end                        timers NOT cancelled; absent seat with a running timer stays (status 'disconnected');
                                   absent seat without a timer (grace already expired) is dropped as today

Room.onAuthed                    newest wins: map[uid] = conn; previous?.close(4409); its close event is ignored
socket.ts message listener       ping -> conn.send(pong), never reaches the DO handlers
web ws-client                    ready -> every 25 s send ping, arm 10 s pong timeout; timeout -> drop socket, reconnect
                                   4409 -> terminal like 4403/4410
```

### Key Changes
- **`packages/shared/src/config.ts`**: `PING_INTERVAL_MS = 25_000`, `PONG_TIMEOUT_MS = 10_000` next to `HEARTBEAT_MS` (tunables, decision #48). The grace reuses `DISCONNECT_GRACE_MS` in `rules.ts`, with no new constant.
- **`packages/shared/src/protocol/close-codes.ts`**: `REPLACED: 4409` ("a newer socket of the same user took over; terminal for the old one", decision #47).
- **`packages/shared/src/protocol/client.ts`**: `z.object({ type: z.literal('ping') }).strict()` in `clientMessageSchema`.
- **`packages/shared/src/protocol/server.ts`**: `z.object({ type: z.literal('pong') }).strict()` in `serverMessageSchema`.
- **`packages/shared/src/protocol/views.ts`**: observers become `{ nick, status: 'active' | 'disconnected' }`:
  ```ts
  export const observerViewSchema = z
    .object({ nick: z.string(), status: z.enum(['active', 'disconnected']) })
    .strict()
  // roomViewSchema: observers: z.array(observerViewSchema)
  ```
  Export from `protocol/index.ts` if other view schemas are exported there.
- **`packages/worker/src/socket.ts`**: `PostAuthMessage = Exclude<ClientMessage, { type: 'auth' | 'ping' }>`; after a successful parse, `if (parsed.msg.type === 'ping') { conn.send({ type: 'pong' }); return }`. Both DO switches keep their `assertNever` unchanged. A ping before auth stays fatal (`AuthGate.handle` fails a non-`auth` frame with 4401); the client only pings when ready.
- **`packages/worker/src/room/room.ts`** `onAuthed`:
  ```ts
  onAuthed: (session, conn) => {
    const previous = this.sockets.get(session.uid)
    this.sockets.set(session.uid, conn)
    // Newest wins (decision 47): a reconnect is never locked out by a socket the server still thinks is open.
    if (previous !== undefined && previous !== conn) previous.close(CLOSE_CODES.REPLACED)
  },
  ```
  `onClose` already ignores a socket that is not the mapped one, so the replaced socket's close is not a leave. `AuthGate` calls `onAuthed` only on the first auth, so a token refresh never triggers this. Update the class comment ("The one socket that speaks for a user"), and the `onMessage` guard comment.
- **`packages/worker/src/room/round.ts`** `startRound`: an absent seat keeps `disconnectedAt` and gets `status: 'disconnected'`; others `'active'`. Portfolio and BR-010 clock reset as now.
- **`packages/worker/src/room/roster.ts`** `nextHost`: signature unchanged; doc comment says callers pass connected members only, `null` when none.
- **`packages/worker/src/room/room-logic.ts`** (main change):
  - `interface Observer extends Member { disconnectedAt: number | null }`; `observers: Observer[]`; join pushes `disconnectedAt: null`.
  - `connectedSeats()`, `connectedObservers()`; `connected()` uses both (absent observers get no broadcasts).
  - `join`: `const member = this.find(uid); if (member !== null) return this.resume(member)` replaces the `restore` branch and the `INVALID_STATE` branch for present members. `resume` covers restore (absent) and takeover (present: `room.state` for this UID only, no broadcast); both send history.
  - `onSocketClosed(uid)` → `drop(uid)`; `drop` is a no-op when the member is unknown or already absent (one timer per absence). Every drop arms the grace timer, also for an eliminated seat (it holds the host role during its grace; expiry does not eliminate twice).
  - `leave(uid)`: `handOverHost(uid)` first, then `drop` (running round + seat) or `remove`.
  - `expire(uid)` replaces `eliminateDisconnected`; timer handle check kept.
  - `handOverHost(leavingUid)`: `nextHost(this.connectedSeats(), this.connectedObservers(), leavingUid)` (fixes today's bug where an absent observer could receive the role). The `if (this.hostMember() === null) this.hostUid = uid` fallback stays in `join` / `resume`, so with nobody connected the first member to return or join takes the role.
  - `endRound`: do not cancel the timers; keep seats with `disconnectedAt === null || this.disconnectTimers.has(seat.uid)`, absent kept seats get `status: 'disconnected'`; drop the rest. If the host is among the dropped (absent, grace expired) the role already moved at expiry.
  - `viewFor`: observers as `{ nick, status: disconnectedAt === null ? 'active' : 'disconnected' }`.
  - Rename the field `disconnectTimers` → `graceTimers` only if it reads better; not required.
- **`packages/web/src/net/ws-client.ts`**:
  - `SocketOptions.onMessage(msg: AppServerMessage)` with `type AppServerMessage = Exclude<ServerMessage, { type: 'pong' }>` (user choice: narrow the type, reducers untouched). `handleFrame` consumes `pong` and does not forward it.
  - Keepalive with the injected `schedule`/`cancel`: on the first `auth.ok` arm a ping after `PING_INTERVAL_MS`; sending it arms a `PONG_TIMEOUT_MS` timer; a `pong` cancels it and arms the next ping. Timeout: detach first (`ws = null`, `ready = false`, stop timers), then `socket.close()` and `reconnectLater()`; the old socket's late `onclose` is ignored by the existing `socket === ws` guard (a half-open socket's close event can take minutes).
  - Stop both timers in `handleClose`, `close()` and before `connect()`.
  - `handleClose`: `REPLACED` joins `KICKED` / `ROOM_CLOSED` as terminal.
- **`packages/web/src/room/error-map.ts`** `closeKey`: `CLOSE_CODES.REPLACED` → `'close.replaced'`.
- **`packages/web/src/views/RoomView.vue`**: banner key when the countdown hits 0 is `lobby.reconnectLost` while `state.view?.status !== 'running'`, else `round.reconnectLost` (the current text "You lost your player seat and can only watch" is wrong in the lobby, where the member is removed). The 4409 modal works through `closeKey`; `leaveClosed` routes it to `/rooms` (default branch).
- **`packages/web/src/components/LobbyPanel.vue`**: observers show `· {{ t(`lobby.status.${observer.status}`) }}` like players.
- **i18n** (`en.json`, `pl.json`, same keys):
  - `close.replaced`: EN "This room was opened in another tab or window, so this one was disconnected." / PL "Pokój otwarto w innej karcie lub oknie, dlatego to okno zostało rozłączone."
  - `lobby.reconnectLost`: EN "Could not return in time. You left the room." / PL "Nie udało się wrócić na czas. Opuściłeś pokój."
- **Data model**: in-memory only. `Observer.disconnectedAt` added; seats unchanged in shape. No database.
- **Dependencies**: none.

### Fit with Project Docs
- **PRD**: implements BR-013, BR-019, FR-015, FR-016, UF-004 error states. Bends BR-013's "next player by join order" to "next *connected* player by join order, else the earliest connected observer, else nobody until someone returns or joins". Extends BR-019 from "during a round" to every socket drop. Supersedes parts of decision #41. The ping costs Durable Object requests: 25 s interval ≈ 3,456 pings per socket per day ≈ 173 billable requests at 20:1; 100 sockets (50 users × room + list) ≈ 17,300/day. Re-check against the current free-plan allowance with ARCHITECTURE open item 1.
- **ARCHITECTURE.md**: changes stay in their packages. Protocol shapes live only in `shared/protocol` (A5). Rules stay in `RoomLogic` with injected clock and timers (A1). The DO shell owns sockets, so newest-wins sits in `room.ts`. Plumbing shared by both DOs sits in `socket.ts`, so ping is answered once. WebSocket code is only in `web/net`. Memory-only invariant kept (A2, `no-storage.test.ts`).
- **CODE_QUALITY.md**:
  - KISS: one grace timer per absent member, phase read at fire time; no new state machine.
  - YAGNI: no server reaping and no Lobby-socket replacement. The client timeout gets a PRD decision (#48) so it is not "beyond the PRD".
  - Single sources: constants in `config.ts` and `rules.ts`, codes in `shared/protocol`, texts in i18n.
  - Cleanup: ping and pong timers are stopped on close, dispose and reconnect; grace timers are cancelled by `dispose` and `closeRoom`.
- **Docs to update**:
  - `docs/PRD.md`: version 1.3 and date; BR-013; BR-019; FR-015 and FR-016 acceptance criteria (lobby return, host drop vs leave); UF-004 error states (banner also in the lobby); §13 data model if it lists observer fields; §20 new decisions #46 (grace everywhere, host timing, successor rule, start/round-end carry), #47 (newest socket wins, 4409), #48 (keepalive 25 s / 10 s, answered in the shared acceptor, no server reaping, cost note); #41 marked "partly superseded by #46 and #47".
  - `docs/ARCHITECTURE.md`: States line (lobby seats and observers can be `disconnected`; host moves at expiry or leave); Errors line adds 4409 `REPLACED`; Invariants: "one socket per user per room, newest wins (#47)", "client keepalive ping/pong (#48)".
  - `docs/CODE_QUALITY.md`: no change required.

### Alternative Approaches Considered
- **Lobby drop**:
  - Remove at once and give the role back to a returning original host: keeps decision #41, but the seat order is lost and two rules apply to one event.
  - Grace everywhere (chosen): one rule for every drop, and it reuses the BR-019 timer and banner.
- **Host timing in a round**:
  - Hand over at once and return the role on restore: the role flickers between members.
  - Hand over only at round end: a vanished host blocks nothing during a round, but in the lobby afterwards the role would sit with an absent member longer than the grace.
  - At grace expiry (chosen).
- **Second socket of a UID**:
  - First wins (today): this is the stuck state from the issue.
  - Newest wins with a plain close: two tabs steal the socket back and forth.
  - Newest wins with terminal 4409 (chosen).
- **Ping placement**:
  - Each DO's `onMessage`: the same code twice.
  - `socket.ts` (chosen): one place, it never reaches rules or the rate limit.
  - Hibernation auto-response: unavailable without hibernation (decision 37).
- **Pong in web**:
  - No-op case in `reduceRoom`: a dead branch.
  - Narrow the `onMessage` type (chosen): a `pong` cannot reach the reducers by construction.
- **Absent seat kept at round end**:
  - Keep the round status: an eliminated-then-dropped seat would read "eliminated" in the lobby.
  - Force `disconnected` (chosen): the lobby list shows who is away.
- **Server idle reaping**: rejected by the user; residual risk recorded in #48.

## Implementation Steps
1. [x] `packages/shared/src/config.ts`: add `PING_INTERVAL_MS = 25_000` and `PONG_TIMEOUT_MS = 10_000` with a comment citing decision #48.
2. [x] `packages/shared/src/protocol/close-codes.ts`: add `REPLACED: 4409` with a comment citing decision #47.
3. [x] `packages/shared/src/protocol/client.ts` and `server.ts`: add strict `ping` (client) and `pong` (server) to the discriminated unions.
4. [x] `packages/shared/src/protocol/views.ts`: `observerViewSchema` with `status: 'active' | 'disconnected'`, used by `roomViewSchema.observers`; export as the other view schemas are exported.
5. [x] Shared and worker schema tests: `packages/shared/test/protocol.test.ts` (ping and pong valid, extra field rejected, observer status accepts active/disconnected and rejects eliminated); `packages/worker/test/security.test.ts` `SAMPLES` gets `ping` and the bare-message list becomes `['room.leave', 'room.start', 'close', 'ping']`.
6. [x] `packages/worker/src/socket.ts`: `PostAuthMessage` excludes `ping`; answer `ping` with `pong` before `handlers.onMessage`.
7. [x] `packages/worker/src/room/room.ts` `onAuthed`: newest wins, previous socket closed with `CLOSE_CODES.REPLACED`; update the comments on `sockets` and the `onMessage` guard.
8. [x] Integration Vitest `packages/worker/test/integration/shell.test.ts`: rewrite "a second socket of the same user cannot act in the room" to "decision 47: a second socket of the same user replaces the first: the first gets 4409, the seat stays, the new socket's room.join gets room.state"; add "ping gets pong on a Room socket" and "ping gets pong on the Lobby socket".
9. [x] `packages/worker/src/room/room-logic.ts`: `Observer` type with `disconnectedAt`, `connectedSeats()` / `connectedObservers()`, `connected()` and `viewFor` (observer status) updated.
10. [x] `room-logic.ts`: `join` → `resume(member)` for any UID already in the room (restore when absent, takeover re-send when present); delete `restore` and the `INVALID_STATE` branch for present members.
11. [x] `room-logic.ts`: `drop(uid)` (socket drop, any phase, seats and observers, one timer per absence), `onSocketClosed` → `drop`; `leave(uid)` hands the host over first, then `drop` (round + seat) or `remove`; `expire(uid)` replaces `eliminateDisconnected` (round seat: eliminate if `disconnected`, hand over, `checkEnd`; otherwise `remove`); `handOverHost` passes connected members only.
12. [x] `packages/worker/src/room/roster.ts`: `nextHost` doc comment (connected members, `null` when none); `roster.test.ts` cases for connected-only input.
13. [x] room-logic Vitest (`packages/worker/test/room/room-logic.test.ts`, lobby): update "M3: a closed socket counts as a leave" and "a uid already in the room is refused with INVALID_STATE" to the new rules; add the lobby cases listed in Test Strategy.
14. [x] `packages/worker/src/room/round.ts` `startRound`: absent seats keep `disconnectedAt` and status `disconnected`; `round.test.ts` case.
15. [x] `room-logic.ts` `endRound`: keep grace timers; keep absent seats with a running timer as `disconnected`, drop absent seats without one.
16. [x] room-logic-round Vitest (`packages/worker/test/room/room-logic-round.test.ts`): update "BR-013: a host who drops mid-round hands the role…", "BR-012: an observer who leaves mid-round is removed at once, no grace" and "decision 41: an explicit room.leave in a round…"; add the round cases listed in Test Strategy.
17. [x] `packages/web/src/net/ws-client.ts`: `AppServerMessage` type for `onMessage`, `pong` consumed; keepalive timers; pong-timeout detach + reconnect; timers stopped on close, dispose and reconnect; `REPLACED` terminal. Fix callers' types (`lobby-socket.ts`, `room-socket.ts`, composables) if they name `ServerMessage`.
18. [x] `packages/web/src/net/ws-client.test.ts`: keepalive and 4409 cases from Test Strategy.
19. [x] `packages/web/src/room/error-map.ts`: `close.replaced` for 4409; `error-map.test.ts` case.
20. [x] i18n `en.json` and `pl.json`: `close.replaced`, `lobby.reconnectLost` (texts above).
21. [x] `packages/web/src/views/RoomView.vue`: lobby vs round "could not return" key; `room-view.test.ts` cases (4409 modal text key, lobby banner key).
22. [x] `packages/web/src/components/LobbyPanel.vue`: observer status note; `lobby-panel.test.ts` fixtures get `status`, new case for a disconnected observer. Update any other web fixture with `observers: [{ nick }]` (grep).
23. [x] `docs/PRD.md`: v1.3, BR-013, BR-019, FR-015, FR-016, UF-004, §13 if needed, decisions #46–#48, #41 note.
24. [x] `docs/ARCHITECTURE.md`: States line, Errors line (4409), Invariants (newest wins, keepalive).

## Checkpoints (Todo List)
- [x] CP1 — Protocol and config: steps 1-5; `pnpm --filter shared test` green, `pnpm typecheck` clean once worker/web compile (the web `onMessage` narrowing comes in CP4, so typecheck the shared package here if the workspace check fails on the new union). — code and tests written; Vitest/typecheck not run (not selected)
- [x] CP2 — Worker socket plumbing: steps 6-8; worker Vitest (unit + integration) green for `security`, `shell`. — code and tests written; not run (not selected)
- [x] CP3 — RoomLogic grace in the lobby and for observers: steps 9-13; worker Vitest `room-logic`, `roster` green. — code and tests written; not run (not selected)
- [x] CP4 — Round carry-in and round end: steps 14-16; worker Vitest `round`, `room-logic-round` green; `pnpm --filter worker typecheck` clean. — code and tests written; not run (not selected)
- [x] CP5 — Web: steps 17-22; web Vitest green (`ws-client`, `error-map`, `room-view`, `lobby-panel`, `locale-keys`), `pnpm lint` clean. — code and tests written; not run (not selected)
- [x] CP6 — Docs and final light verification: steps 23-24; lint, typecheck and all Vitest suites green (e2e left to the PR). — docs done; lint, typecheck and Vitest not run (no check selected), e2e left to the PR

### Risks & Mitigations
- **Half-open host socket on the server** (no reaping): the server thinks the host is connected, so the role never moves.
  - Mitigation: the host's own client detects it via the pong timeout and reconnects; newest wins swaps the socket at once.
  - Residual: a host who closes the laptop lid. The runtime's TCP close eventually fires `close`, then the 30 s grace. Recorded in #48.
- **Stale web bundle vs new Worker**: an old client does not know 4409 and reconnects, stealing the socket back from a new tab, so the two tabs loop.
  - Mitigation: Pages and Worker deploy from the same tag (deploy.yml).
  - Mitigation: the loop needs two tabs of one user, one of them on the old bundle; a reload ends it. Note it in the PR description.
- **Grace timers outliving a round, or firing in the wrong phase**: `expire` reads the phase when it fires.
  - Mitigation: the timer handle check stays, and `drop` never double-arms.
  - Mitigation: `dispose` and `closeRoom` cancel every timer.
  - Mitigation: tests cover expiry in the lobby after a round ended and expiry in a round after a lobby drop.
- **Takeover `join` masks a real double join**: a present UID's `room.join` is now accepted. It only re-sends state to that UID: no new seat, no broadcast. A test pins this.
- **e2e drift**: `e2e/tests/reconnect.spec.ts` and `e2e/fixtures/four-players.ts` may assume the old lobby removal, and a ping frame may show up in the `ws-tap`. Not run here; on the PR, fix the specs to the new rules if they fail.
- **Free-plan cost (NFR-002)**: ≈ 17,300 billable DO requests/day at 50 users with two sockets each. If the budget is short, raise `PING_INTERVAL_MS` (one constant).

## Test Strategy
**Light** (implementation, whichever the user selects): lint, typecheck, Vitest.

- **Shared** (`packages/shared/test/protocol.test.ts`):
  - `ping` and `pong` are valid; an extra field is rejected.
  - Observer status accepts `active` and `disconnected` and rejects `eliminated`.
- **Worker unit, `room-logic.test.ts` (lobby, FakeClock)**:
  - "BR-013, decision 46: a host whose socket drops in the lobby keeps the role and the seat during the grace"
  - "FR-015, decision 46: the host returning within 30 s has the same seat index and is host"
  - "decision 46: after 30 s the absent host is removed and the next connected player is host"
  - "BR-013, decision 46: the role skips an absent member; with nobody connected it waits for the first to return or join"
  - "BR-013: an explicit room.leave by the host hands the role over at once"
  - "decision 46: an observer whose socket drops keeps the slot as disconnected and is removed at expiry"
  - "decision 46: an observer host keeps the role during the grace"
  - "decision 47: a join from a UID already present re-sends room.state to that UID only, no error, no new seat"
  - "a second close for the same UID arms one timer"
  - "dispose cancels the grace timers"
- **Worker unit, `room-logic-round.test.ts`**:
  - "BR-013, decision 46: a host who drops mid-round keeps the role through the grace and hands it over at expiry; the round continues"
  - "decision 41, 46: the host's explicit leave mid-round hands the role over at once; the seat keeps its grace"
  - "decision 46: an observer whose socket drops mid-round keeps the slot; an explicit leave removes it at once"
  - "decision 46: a seat in lobby grace is carried into the round as disconnected; returning in time plays"
  - "decision 46, BR-019: a carried seat that does not return is eliminated at expiry"
  - "decision 46: a seat in grace when the round ends stays in the lobby as disconnected and is removed at expiry, the host role then moves"
  - "decision 41: a seat whose grace expired during the round is dropped at round end"
  - "BR-019: an eliminated player who drops keeps the host role for the grace, then hands it over"
- **Worker unit, `roster.test.ts` / `round.test.ts`**:
  - `nextHost` returns the first connected player, else the first connected observer, else null.
  - `startRound` keeps an absent seat `disconnected`.
- **Worker integration** (`shell.test.ts`, workerd):
  - Newest socket wins with 4409 and no leave.
  - Ping gets pong on the Room and Lobby sockets.
  - `security.test.ts` sample table includes `ping`.
- **Web**:
  - `ws-client.test.ts`:
    - ping is sent 25 s after `auth.ok`, never before ready
    - pong cancels the timeout and arms the next ping
    - no pong in 10 s → the socket is dropped and a reconnect is scheduled; a late `onclose` of the old socket is ignored
    - `close()` and a kick stop the timers
    - 4409 is terminal with status `closed`
    - pong is not forwarded to `onMessage`
  - `error-map.test.ts`: 4409 maps to `close.replaced`.
  - `room-view.test.ts`: the lobby banner key and the 4409 modal.
  - `lobby-panel.test.ts`: the observer status note.
  - `locale-keys.test.ts`: passes with the new keys.

**Heavy**:
- Playwright: run on the PR only. No new spec is required. Existing `reconnect.spec.ts` and `round-4-players.spec.ts` must still pass; if they assume the old lobby removal, fix them on the PR. Optional new spec "host reload in lobby keeps host", written only if the user asks.
- Production build and bundle check: in `first-million-review`. The UI change is small, so axe is optional there.

**Manual**:
- Reload the host tab in the lobby: the host marker stays and the seat order is unchanged.
- Open the same room in a second tab: the first tab shows the "opened elsewhere" modal, and the second tab plays.
- Turn on airplane mode for 15 s in the lobby: the banner counts down, the user returns, and the role is kept.
- Check the layout at 360 px.

## Success Checklist
- [ ] All success criteria met (with evidence)
- [ ] Lint, typecheck and Vitest clean in each touched package (implementation)
- [ ] Heavy checks green when run: production build, axe if UI changed (review); Playwright on the PR
- [ ] Code review approved
- [ ] Documentation updated (PRD BR-013, BR-019, FR-015, FR-016, UF-004, §20 #41/#46–#48; ARCHITECTURE states, errors, invariants)
- [ ] No regressions in single play (the socket client is not used there)

## Timeline & Estimates
- Phase 1 (implementation): ~7 h (shared 1 h, worker plumbing 1 h, RoomLogic 3 h, web 2 h)
- Phase 2 (testing): ~5 h (worker unit and integration 3 h, web 2 h)
- Phase 3 (review + polish, docs): ~2 h
- **Total**: ~14 h, plus buffer

## Open Questions
None. Decisions taken during planning:
- The lobby gets the 30 s grace (`DISCONNECT_GRACE_MS`).
- In a round, the host role moves at grace expiry; an explicit leave hands it over at once.
- A seat in grace is carried into a started round and kept at round end with status `disconnected`.
- Observers get the grace too, and the view shows their status.
- Newest socket wins, and the old socket is closed with terminal 4409.
- Keepalive: client ping every 25 s, 10 s pong timeout, on Room and Lobby sockets; no server reaping.
- The web client narrows the `onMessage` type to drop `pong`.

## Implementation Log
- Decision: workspace: worktree
- Decision: checks: none (no check selected)
- Base: main @ df00463, worktree `.claude/worktrees/10-host-grace-and-keepalive`, branch `feature/10-host-grace-and-keepalive`
- Step 1 — started
- Step 1 — done — files: packages/shared/src/config.ts — added PING_INTERVAL_MS, PONG_TIMEOUT_MS
- Step 2 — started
- Step 2 — done — files: packages/shared/src/protocol/close-codes.ts — added REPLACED: 4409
- Step 3 — started
- Step 3 — done — files: packages/shared/src/protocol/client.ts, server.ts — strict ping / pong
- Step 4 — started
- Step 4 — done — files: packages/shared/src/protocol/views.ts, index.ts — observerViewSchema + ObserverView type exported
- Step 5 — started
- Step 5 — done — files: packages/shared/test/protocol.test.ts, packages/worker/test/security.test.ts — ping/pong, observer status cases; SAMPLES + bare list
- Step 6 — started
- Step 6 — done — files: packages/worker/src/socket.ts — PostAuthMessage excludes ping; pong answered before onMessage
- Step 7 — started
- Step 7 — done — files: packages/worker/src/room/room.ts — newest wins, previous closed 4409; comments updated
- Step 8 — started
- Step 8 — done — files: packages/worker/test/integration/shell.test.ts — replaced 'second socket' case with decision 47 case; 2 ping/pong cases (the replace case needs step 10 to pass: takeover join)
- Step 9 — started
- Step 9 — done — files: packages/worker/src/room/room-logic.ts — Observer type, connectedSeats/connectedObservers, connected(), viewFor observer status
- Step 10 — started
- Step 10 — done — files: packages/worker/src/room/room-logic.ts — join → resume(member); restore + INVALID_STATE branch removed (resume uses setAway, added in step 11)
- Step 11 — started
- Step 11 — done — files: packages/worker/src/room/room-logic.ts — drop, setAway, leave (host first), expire, handOverHost on connected members; disconnectTimers field name kept
- Step 12 — started
- Step 12 — done — files: packages/worker/src/room/roster.ts, packages/worker/test/room/roster.test.ts — doc comment, connected-only case
- Step 13 — started
- Step 13 — done — files: packages/worker/test/room/room-logic.test.ts — observer status fixture, takeover join, 'M3 closed socket' replaced; 10 lobby grace cases (not run: no checks selected)
- Step 14 — started
- Step 14 — done — files: packages/worker/src/room/round.ts, packages/worker/test/room/round.test.ts — startRound keeps disconnectedAt, status disconnected; old reset case adjusted, new carry case
- Step 15 — started
- Step 15 — done — files: packages/worker/src/room/room-logic.ts — endRound keeps grace timers, keeps absent seats with a timer as disconnected, drops the rest
- Step 16 — started
- Step 16 — done — files: packages/worker/test/room/room-logic-round.test.ts, packages/worker/test/room/round-engine.test.ts — 3 old cases rewritten, 9 round cases added; round-engine 'no timer left after the round ends' case rewritten to the new rule (stale, not in the plan's list); not run (no checks selected)
- Step 17 — started
- Step 17 — done — files: packages/web/src/net/ws-client.ts — AppServerMessage (exported), pong consumed, ping/pong timers, dead-socket detach + reconnect, REPLACED terminal; composables/reducers keep `ServerMessage` (a wider handler param is assignable, no change needed)
- Step 18 — started
- Step 18 — done — files: packages/web/src/net/ws-client.test.ts — 8 keepalive cases + 4409 added to the terminal list; FakeSocket tracks `closed`
- Step 19 — started
- Step 19 — done — files: packages/web/src/room/error-map.ts, error-map.test.ts — 4409 → close.replaced
- Step 20 — started
- Step 20 — done — files: packages/web/src/i18n/en.json, pl.json — close.replaced, lobby.reconnectLost
- Step 21 — started
- Step 21 — done — files: packages/web/src/views/RoomView.vue, room-view.test.ts — reconnectLostKey (lobby vs round), lobby/running banner cases, 4409 modal case
- Step 22 — started
- Step 22 — done — files: packages/web/src/components/LobbyPanel.vue, lobby-panel.test.ts, packages/web/src/net/sockets.test.ts — observer status note + case; only other observers fixture was lobby-panel; sockets.test reconnect case now runs the last (backoff) timer because timers[0] is the ping
- Step 23 — started
- Step 23 — done — files: docs/PRD.md — v1.3 (2026-10-25), BR-013, BR-019, FR-015, FR-016, UF-004, §13 observer note, #41 note, decisions #46-#48
- Step 24 — started
- Step 24 — done — files: docs/ARCHITECTURE.md — PRD v1.3 link, invariants (newest wins, keepalive), States line, Errors line (4409)
