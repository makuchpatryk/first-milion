# M5 — Multiplayer UI and admin — Implementation Plan

Ticket 5 of 6 (PRD §19 M5). Index: [specs/README.md](README.md). Depends on tickets 2 (M2, web shell and single-play chart), 3 (M3, protocol and rooms) and 4 (M4, round messages).

## Summary
Connect the web app to the server: a typed WebSocket client with reconnect and token re-auth, pure reducers for lobby and room state, and the screens of the multiplayer flow (room list, room creation, lobby, round with live ranking and news, observer view, results, admin close and kick). The chart and news bar from M2 are reused. Implementation runs on the current branch of the current checkout (no worktree). Tested with Vitest; the full flow through the UI is verified by Playwright in M6 (review only).

## Success Criteria
- Room list updates live from `lobby.rooms` (BP-003); a new room appears without reload (FR-008 client side).
- Join rules in the UI match the server (BP-003): lobby + free player slot → "Join as player"; otherwise "Watch" (disabled when 4 observers are present).
- Observer sees chart, news, timer and ranking, with no trade buttons (UF-005); an eliminated player sees the ranking with buttons disabled (FR-014).
- Socket drop shows a "Reconnecting…" banner with a 30 s countdown (UF-004); reconnect re-sends `auth` and `room.join`; close code 4401 does not retry.
- Token refresh re-sends `auth` without interrupting the round (FR-007 edge).
- Admin sees "Close room" on the list and "Kick" in a room only when `auth.ok.admin` is true (FR-017); the server still checks every action.
- Every `ErrorCode` and every close code has PL and EN text (test); no literal UI text.
- All screens usable at 360 px with no horizontal scroll (FR-020) — checked manually in review.

## Scope & Constraints
- **In scope:** UF-003 (room list and creation), UF-004 (lobby, round, results), UF-005 (observer), FR-007 client side (auth message, refresh, 4401), FR-008 client side, FR-010 UI rules, FR-014 UI, FR-015 UI (reconnect banner, 30 s), FR-017 UI (admin), FR-019 (PL/EN for every new text, error map), FR-020, WCAG basics (keyboard, `aria-live`, focus in dialogs), NFR-003 by construction.
- **Out of scope:** server changes (M3, M4 are done); playwright e2e and axe (M6); deploy (M6); profile/stats (none in the PRD).
- **Hard constraints:**
  - WebSocket only in `web/src/net/` (ARCH dependency rule); Firebase only in `web/src/auth/`.
  - Server messages are `unknown` until parsed by the shared zod schemas (CODE_QUALITY boundary rule).
  - No `v-html`. No literal UI text.
  - No persistence of game data in the browser (BR-020). Only the language is stored.
  - `prefers-reduced-motion` respected for all transitions and the countdown animation (if any).
- **Trade-offs:**
  - **Pure reducers for lobby and room state (adopted from the cross-check):** `reduceLobby(state, msg)` and `reduceRoom(state, msg, now)` are plain functions, tested without a DOM or socket. Components only render state and send intents.
  - **Native `<dialog>` for confirmations** (close room, kick): focus trap and Esc are built in; no UI library.
  - **Reconnect backoff 500 ms → ×2 → cap 8 s, unlimited retries while the page is open:** a longer outage is shown by the banner's 30 s countdown, after which the seat is eliminated server-side (BR-019) and the UI says so.
  - **Single-play code reused**: the chart and news bar components come from M2 unchanged except for an optional `history` prop; no second chart.

## Architecture & Design

### High-Level Flow
```
views (RoomsView, CreateRoomView, RoomView → LobbyPanel | RoundPanel, ResultsDialog)
  ↑ render state, send intents
composables: useLobby(), useRoom(roomId)   (state from reducers)
  ↑ reduceLobby / reduceRoom (pure, tested)
net/ws-client.ts  (typed socket, reconnect, auth, parse with shared zod)
  ↓
Worker  /ws/lobby, /ws/room/:id
```

### Key Changes

**`packages/web/src/net/`** (only WebSocket code in the app):
- `ws-client.ts`:
  ```ts
  export interface SocketOptions {
    url: string                          // from VITE_WORKER_URL
    getToken(): Promise<string>          // firebase getIdToken, from auth/session
    onMessage(msg: ServerMessage): void  // already zod-parsed
    onStatus(s: 'connecting' | 'ready' | 'reconnecting' | 'closed', closeCode?: number): void
    schedule(fn, ms): Handle; cancel(h): void   // injected for tests
  }
  export function createSocket(opts: SocketOptions): { send(msg: ClientMessage): void; close(): void; refreshToken(): void }
  ```
  - On open: send `{type:'auth', token}`; `ready` after `auth.ok`. Then the caller sends `room.join` (room socket).
  - Incoming: `JSON.parse` in try/catch → `parseServerMessage` (shared zod) → invalid → ignored and logged to console in dev only.
  - Reconnect: on close with code ≠ 4401/4403/4410 → backoff 500 ms, ×2, cap 8 s; `onStatus('reconnecting')`.
  - 4401 → one forced token refresh (`getToken(force)`), then reconnect; second 4401 → `onStatus('closed', 4401)` (UI sends the user to login).
  - 4403 (kicked) / 4410 (room closed) → `onStatus('closed', code)`, no reconnect.
  - `refreshToken()`: called from `onIdTokenChanged` in `auth/session.ts`; sends a new `auth` on the open socket (FR-007 edge). The server accepts it only for the same UID (M3 rule).
  - `send` while not ready → queued? **No queue** (YAGNI): messages sent while disconnected are dropped and the UI shows the banner; intents like `order` are disabled while not `ready`.
- `lobby-socket.ts` and `room-socket.ts` — thin factories: `/ws/lobby` (no join), `/ws/room/:id` (sends `room.join` with nick after `auth.ok`).
- `url.ts` — builds `wss://` / `ws://` from `VITE_WORKER_URL`; never puts the token in the URL (NFR-004).

**`packages/web/src/room/`** (pure state; tested without DOM):
- `lobby-state.ts`:
  ```ts
  export interface LobbyState { rooms: RoomSummary[]; isAdmin: boolean; createdRoomId: string | null }
  export function reduceLobby(s: LobbyState, msg: ServerMessage): LobbyState   // lobby.rooms, auth.ok, room.created
  export function joinPolicy(room: RoomSummary): 'player' | 'observer' | 'closed'   // BP-003 rules
  ```
  Rule: `status === 'lobby' && players < 4` → `player`; else `observers < 4` → `observer`; else `closed` (disabled "Full"). `RoomSummary` (M3) carries `players` and `observers` counts, so no extra fields are needed.
- `room-state.ts`:
  ```ts
  export interface RoomState {
    view: RoomView | null          // from room.joined / room.state
    history: number[]              // from room.history, then appended from room.tick.prices
    price: number | null; halt: { msLeft: number } | null
    news: NewsView | null; newsAgeTicks: number
    endsInMs: number | null; ranking: RankRow[]; you: MeRound | null
    lastResult: RoundEnd | null    // from round.end, cleared on next start
    error: ErrorCode | null; closeCode: number | null
  }
  export function reduceRoom(s: RoomState, msg: ServerMessage, nowMs: number): RoomState
  ```
  - `room.tick`: append `prices` (cap 2 400 mirroring the server), set `price`, `halt`, `news` (reset `newsAgeTicks` to 0 when `news` present, else +1 per tick, fade at 90 — FR-005), `endsInMs`, `ranking`, `you`.
  - `round.end`: `lastResult` set, `endsInMs = null`.
  - `error`: `error = code`; `kicked` → `closeCode = 4403`; error `ROOM_CLOSED` → `closeCode = 4410`.
- `error-map.ts` — `ErrorCode` → i18n key (exhaustive `switch` with `never`), close codes → i18n key. Tests: every key exists in `pl.json` and `en.json`.
- `join-policy.ts` — `canTrade(you, halted)`: `you.role === 'player' && you.status === 'active' && !halted` (UF-004, FR-014, FR-005).

**Views** (`packages/web/src/views/`):
- `RoomsView.vue` (UF-003): list with `role="list"`; each row: name, host (`hostNick ?? '—'`), players `x/4`, duration `N min`, target `$N` or `single.none`-style key `rooms.noTarget`, speed `N×`, status (`rooms.lobby` / `rooms.running`); actions by `joinPolicy`. Admin: "Close room" → `<dialog>` confirm → `admin.closeRoom`. Empty state key `rooms.empty` with a "Create room" button. "Create room" button always visible.
- `CreateRoomView.vue` (UF-003 form): name (3–30, live validation with `roomFormSchema`), duration chips `{3,5,10}` (`ChipGroup`, M2), speed chips `{1,3,8}`, profit target (optional number; empty → `null`; validation errors via `error-map` keys; 99 → error). Submit → `room.create` on the lobby socket → on `room.created` → navigate to `/rooms/:id`.
- `RoomView.vue` (route `/rooms/:id`): opens the room socket; sends `room.join` once `auth.ok` arrives with the nick from settings (`auth/session.ts`); renders `LobbyPanel` when `view.status === 'lobby'`, `RoundPanel` when `running`; shows the reconnect banner (`role="status"`, countdown 30 s) and the close/kick dialogs; leave button → `room.leave` then back to `/rooms`.
- `components/LobbyPanel.vue` (UF-004 step 1): name, parameters (duration, speed, target), players list (host marked, status), observers list, host-only "Start round" (`disabled` unless ≥1 player), admin "Kick" per row → `<dialog>` confirm → `admin.kick {nick}`. `lastRound` summary card when present.
- `components/RoundPanel.vue` (UF-004 step 2, UF-005): chart (reuse M2 `PriceChart` with `history`, `avg` from `you.avg`), price and change, equity/open/position/total stats (like single play), countdown (`endsInMs` formatted mm:ss), profit target progress bar (`role="progressbar"`, `aria-valuenow`) when `profitTarget` set, live ranking `<ol>` with nick, equity, status, place, news bar (M2 `NewsBar`), trade buttons with `canTrade` (hidden for observers, disabled when eliminated or halted), halt overlay (`aria-live="assertive"`), eliminated banner.
- `components/ResultsDialog.vue` (UF-004 step 3): `<dialog>` opened on `round.end`: reason text (`results.reason.TARGET|TIME|ALL_ELIMINATED`), winners (`results.winners`, plural: shared place), ranking table, "Back to lobby" button (closes the dialog; the lobby panel shows `lastRound`).
- `App.vue` (M2) gets a nav link "Rooms" (enabled now, `aria-disabled` removed). `router.ts` adds `/rooms`, `/rooms/new`, `/rooms/:id`, all behind the verified guard (M2).
- Keyboard: B/S/C in RoundPanel for players with `canTrade` (same guard as single play: ignore when focus is in input/textarea/select).

**Auth and settings glue:**
- `auth/session.ts` (M2): add `onIdTokenChanged` → `refreshToken()` on the open sockets (via a small subscriber list in `net/`), no UI change.
- Nickname for join comes from `session.user.nick` (M2). If the nick is invalid, the join is blocked and the user is sent to Settings with a message key (BR-016 "before entering a room").

**i18n (`pl.json`, `en.json`):** new key groups `rooms.*` (list, empty, columns, actions, closed/full), `create.*` (form labels, validation, duration/speed/target help), `lobby.*` (players, observers, host, start, leave, kick, confirm texts, last round), `round.*` (countdown, target, ranking, trade, observer hint, eliminated, halted, reconnecting, reconnect countdown), `results.*` (reasons, winners plural, back), `admin.*` (close room, kick, confirm texts), `error.*` (one key per `ErrorCode`), `close.*` (4401, 4403, 4410, network).

### Fit with Project Docs
- **PRD:** UF-003, UF-004, UF-005, FR-007 (client), FR-008 (client), FR-010 (UI rules), FR-014, FR-015 (UI), FR-017 (UI), FR-019, FR-020, BR-014 (last round visible), BR-016 (nick before join), BR-017 (admin UI), BP-003.
- **ARCHITECTURE:** WebSocket only in `web/src/net`; state from reducers; errors by code, mapped in `web/i18n`; Firebase only in `web/src/auth`.
- **CODE_QUALITY:** composables and pure reducers for logic; `<script setup lang="ts">`; `unknown` parsed at the socket boundary; intents disabled, not hidden, for accessibility where the UI explains why; cleanup of socket and timers on unmount (`onScopeDispose`).
- **Docs to update:** `docs/ARCHITECTURE.md` (packages block: `web/src/room/` and `web/src/net/` details as above); `docs/CODE_QUALITY.md` (no change expected; note that `room/` reducers are the state single source for the web); `docs/PRD.md` §19 M5 unchanged.

### Alternative Approaches Considered
- **Pinia store (Option A):** Pro: familiar. Con: a new dependency (CODE_QUALITY allows none). Not chosen: composables plus pure reducers do the same job.
- **Socket message queue during reconnect (Option B):** Pro: no lost intents. Con: a queued `order` could execute after a reconnect at a different price, which is confusing and unfair. Not chosen: intents are disabled while not ready.
- **Client-side ranking calculation (Option C):** Pro: fewer messages. Con: violates server authority (BR-007). Not chosen: the server sends the ranking every tick.
- **Single shared component for lobby and round (Option D):** Pro: fewer files. Con: the two states differ a lot (controls, ranking, news). Not chosen: two panels, shared pieces (`PriceChart`, `NewsBar`, `ChipGroup`).
- **Native `<dialog>` (chosen) vs custom modal:** Pro: built-in focus and Esc. Con: older browsers: all targets are modern (PRD §16). Chosen.

## Implementation Steps

1. [ ] `packages/web/src/net/url.ts` (build `ws`/`wss` URL from `VITE_WORKER_URL`; no token in URL). Test: URL has no query string; `http` → `ws`, `https` → `wss`.
2. [ ] `packages/web/src/net/ws-client.ts` (`createSocket`): auth on open, `auth.ok` → ready, `parseServerMessage` on incoming, backoff 500 ms ×2 cap 8 s, 4401 once-refresh then closed, 4403/4410 no reconnect, `refreshToken()`, no queue. Tests with a fake socket and fake timers: backoff sequence 500, 1000, 2000, 4000, 8000, 8000; 4401 → one refresh then second 4401 → closed; 4403 → no reconnect; invalid JSON / invalid schema → ignored; `refreshToken` sends one `auth`.
3. [ ] `packages/web/src/net/lobby-socket.ts`, `room-socket.ts` (room socket sends `room.join {roomId, nick}` after `auth.ok`; nick from `session.user.nick`). Tests: join sent exactly once per ready.
4. [ ] `packages/web/src/room/lobby-state.ts` (`reduceLobby`, `joinPolicy`). Tests (BP-003): lobby + 3 players → player; lobby + 4 players + 3 observers → observer; 4 observers → closed; running → observer or closed; `auth.ok.admin` sets `isAdmin`; `lobby.rooms` replaces the list.
5. [ ] `packages/web/src/room/room-state.ts` (`reduceRoom`): `room.joined`/`room.state` set view; `room.history` sets history; `room.tick` appends prices (cap 2 400), updates halt, news (fade at 90 ticks, FR-005), endsInMs, ranking, you; `round.end` sets lastResult; `error` and close codes set flags. Tests: history cap; news fade after 90 ticks; `canTrade` false for observer, eliminated and halted.
6. [ ] `packages/web/src/room/error-map.ts`: exhaustive `ErrorCode` and close code → i18n key. Test: every key present in PL and EN; `never` check compiles (typecheck).
7. [ ] `packages/web/src/i18n/*.json`: add key groups listed above (PL and EN), keeping parity; M2's locale test keeps passing.
8. [ ] `packages/web/src/composables/use-lobby.ts`, `use-room.ts`: wire socket → reducer state with `shallowRef`; `onScopeDispose` closes socket and cancels timers (CODE_QUALITY cleanup rule). Test: dispose closes the socket once.
9. [ ] `RoomsView.vue`: list, join actions via `joinPolicy`, empty state, "Create room", admin "Close room" with `<dialog>` confirm (sends `admin.closeRoom`, admin-only rendering from `isAdmin`). Component test: admin sees "Close room", non-admin does not; closed rows have disabled action.
10. [ ] `CreateRoomView.vue`: form with `roomFormSchema` validation (name 3–30; target `null` or integer ≥ 100; 99 → error key), chips for duration and speed, submit → `room.create` → navigate on `room.created`. Test: 99 → error key; empty target → `null`; invalid name → error key; valid form sends exactly the parsed object.
11. [ ] `RoomView.vue` (route `/rooms/:id`): open room socket, join on `auth.ok`, reconnect banner with 30 s countdown (`role="status"`), leave, close and kick dialogs, switch LobbyPanel/RoundPanel on `view.status`.
12. [ ] `components/LobbyPanel.vue`: parameters, players (host marked), observers, host "Start round" (`disabled` unless ≥1 player), admin "Kick" per row with confirm, last round summary card. Component test: start disabled with 0 players; kick button only for admin.
13. [ ] `components/RoundPanel.vue`: reuse M2 `PriceChart` (history prop), price/change/stats, countdown, profit target progress (`role="progressbar"`), live ranking `<ol>`, `NewsBar` (M2), trade buttons with `canTrade`, B/S/C keys with the single-play input guard, halt overlay (`aria-live="assertive"`), eliminated banner. Test: observer sees no trade buttons (UF-005 AC); halt disables buttons; keys ignored in inputs.
14. [ ] `components/ResultsDialog.vue`: opens on `round.end`; reason and winners text (plural/shared place); ranking table; "Back to lobby" closes. Test: winners list renders shared place with two names.
15. [ ] `router.ts`: add `/rooms`, `/rooms/new`, `/rooms/:id` behind the verified guard; `App.vue` nav "Rooms" enabled. Test: unverified user cannot open `/rooms/:id` (M2 guard).
16. [ ] `auth/session.ts` (M2) glue: `onIdTokenChanged` → `refreshToken()` for open sockets (FR-007 edge). Test: token change triggers exactly one `auth` send per open socket.
17. [ ] Accessibility pass (code level): `aria-live` on news and halt and results; focus moves to dialog title on open and back to trigger on close; ranking as `<ol>`; progress bar labelled; no information by colour alone (text with up/down markers); `prefers-reduced-motion` respected.
18. [ ] Docs: `docs/ARCHITECTURE.md` packages block updated for `web/src/room/` and `web/src/net/`.
19. [ ] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` green in `packages/web`; steps ticked; Implementation Log filled.

## Checkpoints (Todo List)

- [ ] CP1 — Socket layer: steps 1–3; Vitest green for backoff, 4401/4403 handling, refresh, URL.
- [ ] CP2 — Pure state: steps 4–6; Vitest green for `reduceLobby`, `joinPolicy`, `reduceRoom`, error map; locale parity green.
- [ ] CP3 — Lobby and rooms screens: steps 7–10, 15; component tests green (admin visibility, form validation, join policy).
- [ ] CP4 — Room screens: steps 11–14; component tests green (observer buttons hidden, start disabled, kick admin-only, results winners).
- [ ] CP5 — Glue and accessibility: steps 8, 16–18; `pnpm lint`, `pnpm typecheck`, all Vitest green.
- [ ] CP6 — Final light verification: step 19.

## Risks & Mitigations

- **Risk:** Client and server disagree on join rules, so a user is offered a button that the server rejects.
  - Mitigation: `joinPolicy` mirrors BP-003 and is tested against the same table as the server's `assignRole`; the server reply (`ROOM_FULL`) maps to a message and refreshes the list.
- **Risk:** Reconnect during a round sends `room.join` twice, or joins as an observer instead of restoring the seat.
  - Mitigation: join is sent after each `auth.ok`; the server restores the seat for the same UID (M4). Test: reconnect sends one `room.join` per `auth.ok`.
- **Risk:** Stale UI after a long reconnect, showing controls for a seat the server has eliminated.
  - Mitigation: on reconnect the server sends a full `room.joined` with the current `you` and `status`; the reducer replaces `view` and `you`; trade buttons follow `canTrade`.
- **Risk:** Token expiry mid-round causes a 4401 close and the player loses their seat.
  - Mitigation: `onIdTokenChanged` refreshes the token before expiry; a 4401 triggers one forced refresh and reconnect within the 30 s window (BR-019), so the seat survives.
- **Risk:** Large history on join (≤ 2 400 numbers) slows the first paint.
  - Mitigation: one `room.history` message on join only; the chart draws the last 220 points (prototype `VIEW`).
- **Risk:** Admin UI shown to non-admins if the flag is wrong.
  - Mitigation: flag is from the server's `auth.ok.admin`; actions are checked again on the server (FR-017 AC: non-admin → `FORBIDDEN`).

## Test Strategy

**Light (during implementation, Vitest only, `packages/web`):**
- `net/ws-client.test.ts` (fake socket, fake timers): backoff, 4401 once-refresh, 4403/4410 closed, invalid messages ignored, refresh sends one `auth`.
- `net/url.test.ts`.
- `room/lobby-state.test.ts`, `room/room-state.test.ts`, `room/join-policy.test.ts` (BP-003 table, FR-005 news fade, `canTrade`).
- `room/error-map.test.ts` and locale parity (every `ErrorCode` and close code has PL and EN keys).
- Component tests (`happy-dom`): `RoomsView` (admin button, join states), `CreateRoomView` (validation, submit payload), `LobbyPanel` (start disabled with 0 players, kick admin-only), `RoundPanel` (observer no trade buttons, halt disables buttons, keys ignored in inputs), `ResultsDialog` (shared place).
- `pnpm lint`, `pnpm typecheck`.

**Heavy (review only):** Playwright full flow list → create → lobby → round → results → next round, observer and admin flows (written in M6, run in review); axe at 360 px for every new screen (M6); manual check of the reconnect banner and keyboard-only play.

## Success Checklist
- [ ] All success criteria met, with evidence (Vitest output)
- [ ] Lint, typecheck, Vitest green in `packages/web`
- [ ] WebSocket only in `web/src/net`; no `v-html`; no literal UI text (grep check in review)
- [ ] Every new text has PL and EN keys (test green)
- [ ] Code review approved (`first-million-review`, heavy checks included)
- [ ] No regressions (M2 single-play and auth tests still green; M3/M4 server tests unchanged)

## Timeline & Estimates
- Phase 1 (socket layer, pure state, error map): ~6 h
- Phase 2 (lobby and rooms screens, create form): ~6 h
- Phase 3 (room screens: lobby, round, observer, results, admin dialogs): ~8 h
- Phase 4 (glue, accessibility pass, docs, review): ~4 h
- **Total**: ~24 h (rough, plus buffer)

## Open Questions
- [ ] Final PL wording of round and admin texts: drafted in the implementation; the user reviews them before release (also covers privacy text in M2).

## Implementation Log
(Empty. first-million-implement appends one line per step event here.)
