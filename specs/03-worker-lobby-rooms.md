# M3 — Worker, lobby and rooms — Implementation Plan

Ticket 3 of 6 (PRD §19 M3). Index: [specs/README.md](README.md). Depends on ticket 1 (M1). Ticket 2 (M2) is independent and may run in parallel.

## Summary
Build the Cloudflare Worker and the two Durable Objects that carry multiplayer structure: Firebase ID-token verification with the WebSocket auth gate, the `Lobby` room registry with live list updates, and the `Room` lifecycle (create, join with role rules, host transfer, empty-room deletion, admin kick and close). This ticket also defines the whole WebSocket protocol as strict zod schemas in `shared/protocol`, so later tickets only implement handlers. No round engine yet (M4). Implementation runs on the current branch of the current checkout (no worktree). Local dev uses `wrangler dev` with the Firebase Auth emulator; no deploy (M6).

## Success Criteria
- Unverified account and bad token: socket closed with code **4401** (FR-007 AC); no `auth` within 5 s → 4401.
- Wrong `Origin` → HTTP **403** before upgrade (FR-007 AC).
- New room appears in a subscriber's list within ≤ 2 s of creation (FR-008 AC, measured in the Worker integration test).
- A room with no heartbeat for 3× the interval (90 s) is removed from the list (FR-008 AC, unit-tested with fake clock).
- Join rules (FR-010 AC): lobby with free player slot → player; running or full player slots → observer; 4 observers → `ROOM_FULL`.
- Empty room is deleted after 5 min and disappears from the list (FR-016 AC).
- Protocol rejects unknown fields (e.g. `price` in `order`) with `INVALID_PAYLOAD` (FR-012 AC, NFR-004).
- Zero paid resources used; no DO storage, KV, D1 or alarms (BR-020, ARCH invariant).

## Scope & Constraints
- **In scope:** FR-007 (WS authorization, Origin allowlist), FR-008 (lobby list, heartbeat, stale removal), FR-009 (room creation), FR-010 (joining and roles, `ROOM_FULL`, nick collision suffix), FR-016 (host transfer, empty-room removal), FR-017 server part (admin UID check, kick, close — the UI is M5), BR-011, BR-012 (lobby-state joining), BR-013, BR-014, BR-016 (nick validation in protocol), BR-017 (admin actions), BP-003 (room selection rules, server side), NFR-004 (schema validation, Origin, token not in URL).
- **Out of scope:** round start, ticks, orders, rate limit, end conditions, disconnect grace (M4). Web client (M5). Deploy (M6).
- **Hard constraints:**
  - ARCH invariant: `RoomLogic` and `LobbyLogic` are plain TypeScript with injected clock/timers/send; no `cloudflare:` imports there.
  - `shared` imports only `zod` (the only allowed dependency there).
  - Token verification only in `worker/src/auth/`.
  - No email, UID or token in any broadcast (ARCH privacy invariant). `auth.ok` carries a boolean `admin` only.
  - Server replies with `ErrorCode`, never free text (ARCH errors).
  - Memory only; no hibernation (decision row 37, see Key Changes).
- **Trade-offs:**
  - **No hibernation for `Lobby` or `Room` (user decision, after checking the docs):** hibernation resets in-memory state, so the room list would empty after each eviction. Lobby and Room stay alive while a room exists. Duration budget (13 000 GB-s/day free) is checked in M6.
  - **Heartbeat 30 s, stale after 90 s (FR-008 `3×`):** keeps Durable Object requests far below the 100 000/day free limit. Estimate: 10 live rooms × 2 880 heartbeats/day ≈ 29 k requests/day. The tick broadcast is outbound, so it is not counted as a request.
  - **Stale rooms only pruned while rooms exist** (the sweep timer is armed only while the registry is non-empty). Keeps the Lobby idle when nobody is playing.
  - **Lobby-state join is "player if free slot, else observer"** (BP-003), not "player only": full player slots make a visitor an observer rather than an error. `ROOM_FULL` only when observers are also full.

## Architecture & Design

### High-Level Flow
```
client WS  ──► Worker index.ts ──(Origin check)──► DO stub
                                                  │
DO (Lobby | Room) shell: acceptWebSocket-less (ws.accept)
   1. AuthGate: first message must be {type:'auth', token} within 5 s → verifyIdToken → admin flag
   2. Parse every later message with zod strict schema (shared/protocol)
   3. Call pure logic: LobbyLogic / RoomLogic (injected clock, send, timers, publish)
   4. Send ServerMessage back over the socket; publish summaries lobby-ward

Room ──POST /register (summary)──► Lobby   (on change + heartbeat every 30 s)
Room ──POST /deregister──────────► Lobby   (on delete)
Lobby ──lobby.rooms (full list)──► subscribed sockets (on change)
Lobby ──POST /init──► Room (on room.create, before reply)
```

### Key Changes

**`packages/shared`** (zod added as the only dependency):
- `src/config.ts` (new tunables): `AUTH_TIMEOUT_MS = 5_000` (FR-007), `HEARTBEAT_MS = 30_000`, `STALE_AFTER_MS = 3 * HEARTBEAT_MS` (FR-008), `LOBBY_SWEEP_MS = 30_000`, `JWKS_FALLBACK_TTL_MS = 3_600_000` (used when JWKS response has no `max-age`).
- `src/validation.ts` (extended from M1):
  ```ts
  export const roomFormSchema = z.object({
    name: z.string().trim().min(ROOM_NAME_MIN).max(ROOM_NAME_MAX),
    durationMin: z.union([z.literal(3), z.literal(5), z.literal(10)]),
    speed: z.union([z.literal(1), z.literal(3), z.literal(8)]),
    profitTarget: z.number().int().min(PROFIT_TARGET_MIN).nullable(),
  }).strict()
  export type RoomForm = z.infer<typeof roomFormSchema>
  export const nickSchema = z.string().regex(NICK_PATTERN)
  ```
  Notes: `profitTarget` may be `null` (or omitted by the client → the client always sends `null`; the schema requires the key, which keeps the message shape fixed). `target 99` → error, `target 1_000_000` → allowed (FR-009 edge).
- `src/protocol/errors.ts`:
  ```ts
  export const ERROR_CODES = ['RATE_LIMITED','HALTED','ELIMINATED','FORBIDDEN','INVALID_STATE',
    'INVALID_PAYLOAD','ROOM_FULL','ROOM_CLOSED','ROOM_NOT_FOUND'] as const
  export type ErrorCode = typeof ERROR_CODES[number]
  ```
  `ROOM_NOT_FOUND` is **added** to the ARCH list (BP-003 "the room disappeared" needs a code; ARCH had none). Recorded in the ARCH update below.
- `src/protocol/views.ts`:
  ```ts
  export interface RoomSummary {            // FR-008 entry fields
    id: string; name: string; hostNick: string | null
    players: number; observers: number; maxPlayers: 4
    durationMin: 3 | 5 | 10; profitTarget: number | null; speed: 1 | 3 | 8
    status: 'lobby' | 'running'
  }
  export interface MemberView { nick: string; status: 'active' | 'disconnected' | 'eliminated' }
  export interface RoomView {               // sent to one socket; `you` differs per socket
    id: string; name: string; hostNick: string | null
    durationMin: 3 | 5 | 10; profitTarget: number | null; speed: 1 | 3 | 8
    status: 'lobby' | 'running'
    players: MemberView[]                   // join order (FR-010, BR-013)
    observers: { nick: string }[]           // join order
    you: { role: 'player' | 'observer'; nick: string; isHost: boolean }
  }
  ```
  M4 extends `RoomView` with round fields (`round`, `price`, `ranking`), not now.
- `src/protocol/client.ts` — zod strict schemas, all messages defined now (handlers for M4 types are no-ops until M4 implements them; the parser must still accept them):
  ```ts
  auth:            { type: 'auth', token: string (1..4096 chars) }
  room.create:     { type: 'room.create', form: roomFormSchema }
  room.join:       { type: 'room.join', roomId: string, nick: nickSchema }
  room.leave:      { type: 'room.leave' }
  room.start:      { type: 'room.start' }                       // M4
  order:           { type: 'order', side: 'BUY'|'SELL', qty: 10|50|100|250 }   // M4; no price field allowed
  close:           { type: 'close' }                            // M4
  admin.kick:      { type: 'admin.kick', nick: nickSchema }
  admin.closeRoom: { type: 'admin.closeRoom', roomId: string }
  ```
  `parseClientMessage(raw: unknown): { ok: true; msg } | { ok: false }` — invalid JSON or schema fail → `error INVALID_PAYLOAD` (no close).
- `src/protocol/server.ts` — server messages:
  ```ts
  auth.ok:        { type: 'auth.ok', admin: boolean }          // admin flag only; never the UID
  lobby.rooms:    { type: 'lobby.rooms', rooms: RoomSummary[] }
  room.created:   { type: 'room.created', roomId: string }
  room.state:     { type: 'room.state', view: RoomView }       // every membership/status change
  kicked:         { type: 'kicked' }                           // followed by close
  error:          { type: 'error', code: ErrorCode }           // closed union, no text
  ```
  M4 adds `room.tick`, `order.ok`, `round.end`.
- `src/protocol/index.ts` — barrel; `export type ClientMessage = z.infer<…>`, `ServerMessage`.

**`packages/worker`** (new package; `wrangler` + Workers types + `@cloudflare/vitest-pool-workers`):
- `wrangler.toml`:
  - `main = "src/index.ts"`, `compatibility_date` pinned to the day of implementation, `compatibility_flags = ["nodejs_compat"]` only if needed (not planned).
  - `[[durable_objects.bindings]]` `ROOM` → `Room`, `LOBBY` → `Lobby`.
  - `[[migrations]]` `tag = "v1"`, `new_sqlite_classes = ["Room", "Lobby"]` (required on free plan; no storage used).
  - `[vars]` (public values only): `FIREBASE_PROJECT_ID = "first-million-dev"`, `ALLOWED_ORIGINS = "http://localhost:5173"`.
- `.dev.vars.example` (committed template) and `.dev.vars` (gitignored, local): `AUTH_EMULATOR = "true"`, `ADMIN_UIDS = "<local emulator uid>"`. `AUTH_EMULATOR` must never be in `wrangler.toml`, so it never reaches production.
- `.gitignore` fix: the existing pattern `.dev.vars.*` also matches `.dev.vars.example`, so add `!.dev.vars.example` under it (verified against the current file).
- `protocol/close-codes.ts` (new, shared): `AUTH_FAILED = 4401` (FR-007 AC), `KICKED = 4403`, `ROOM_CLOSED = 4410`. Custom codes live in the 4000–4999 range (WebSocket spec). Clients map them to i18n keys in M5.
- `src/env.ts` — `interface Env { ROOM: DurableObjectNamespace; LOBBY: DurableObjectNamespace; FIREBASE_PROJECT_ID: string; ALLOWED_ORIGINS: string; ADMIN_UIDS: string; AUTH_EMULATOR?: string }`. `parseEnv` splits comma lists; `AUTH_EMULATOR` accepted only as the exact string `"true"`.
- `src/index.ts`:
  - `GET /ws/lobby` and `GET /ws/room/:roomId`; any other path → 404.
  - Non-upgrade request → 426.
  - Origin: `isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)` → missing or not in list → **403** (FR-007 AC).
  - Forward the request to the DO stub: `env.LOBBY.get(env.LOBBY.idFromName('lobby'))` or `env.ROOM.get(env.ROOM.idFromString(roomId))`. An invalid `roomId` (not a hex id) → 404 (`idFromString` throws; caught).
  - `export { Room } from './room/room'`, `export { Lobby } from './lobby/lobby'`.
- `src/origin.ts` — `isAllowedOrigin(origin: string | null, allowlist: string): boolean` (exact match, comma list, no wildcard).
- `src/auth/verify-token.ts`:
  ```ts
  export interface VerifiedUser { uid: string }   // email never leaves this module
  export type TokenVerifier = (token: string) => Promise<VerifiedUser | null>
  export function createTokenVerifier(opts: { projectId: string; emulator: boolean; fetchJwks: () => Promise<Jwks>; now: () => number }): TokenVerifier
  ```
  - Parse header/payload with zod (`unknown` boundary). `alg` must be `RS256` (reject `none` unless `emulator`).
  - Find key by `kid` in JWKS (refetch once if missing); `crypto.subtle.importKey('jwk', …, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'})` then `verify`.
  - Claims: `iss === 'https://securetoken.google.com/' + projectId`; `aud === projectId`; `exp*1000 > now`; `iat*1000 <= now + 60_000`; `sub` non-empty string; `email_verified === true` (BR-002, FR-007).
  - Emulator mode (`AUTH_EMULATOR === "true"`): skip signature check and accept `alg: "none"`; claims still checked. Production mode never sets this flag.
- `src/auth/jwks.ts` — `fetchFirebaseJwks(fetchFn, now)`: `GET https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`. Caches in a module variable with TTL from `Cache-Control: max-age` (fallback `JWKS_FALLBACK_TTL_MS`). In-memory cache is not persistent state (allowed, ARCH: memory only). Fetch failure → verify returns `null` → `auth` refused (PRD §15 failure handling).
- `src/auth/auth-gate.ts` — pure class:
  ```ts
  export interface AuthGateDeps { verify: TokenVerifier; isAdmin(uid: string): boolean; schedule(fn, ms): Handle; cancel(h): void; close(code: number): void; sendAuthOk(admin: boolean): void; onAuthed(session: Session): void }
  export class AuthGate {
    constructor(deps)    // starts the 5 s timer (AUTH_TIMEOUT_MS)
    handle(raw: unknown): Promise<void>  // first valid auth → verify; any other first message → close 4401
    get session(): Session | null        // { uid, admin } once authed
  }
  ```
  Rules: timer fires before auth → close 4401 (FR-007); bad token / unverified → close 4401; valid → `sendAuthOk(admin)` and `onAuthed(session)`. A second `auth` on the same socket re-verifies the new token (FR-007 edge: refresh mid-session) and is accepted **only if its `uid` matches the current session**; a different UID closes with 4401 (default from the planning cross-check: a socket must not change identity).
- `src/lobby/lobby-logic.ts` — pure:
  ```ts
  export interface LobbyDeps { now(): number; schedule(fn, ms): Handle; cancel(h): void; broadcast(rooms: RoomSummary[]): void }
  export class LobbyLogic {
    constructor(deps: LobbyDeps)
    register(summary: RoomSummary): void    // sets lastSeen = now; arms sweep if first room; broadcasts if changed
    remove(roomId: string): void            // deregister (room deleted or admin close)
    has(roomId: string): boolean
    list(): RoomSummary[]                   // sorted by creation order (Map insertion), stale rooms excluded
    sweep(): void                           // removes entries with now - lastSeen > STALE_AFTER_MS, broadcasts if any removed
  }
  ```
  - Sweep timer armed only while the registry is non-empty; cleared when empty (no idle timer, ARCH invariant).
  - `broadcast` only when the list actually changed (compare by JSON of the array).
- `src/lobby/lobby.ts` — `export class Lobby implements DurableObject`:
  - `fetch`: `/ws` upgrade → `ws.accept()`, `AuthGate`; after auth → `subscribers.add(socket)` and send `lobby.rooms` snapshot. `POST /register` (body: `RoomSummary`, zod-parsed) and `POST /deregister` (body: `{roomId}`) from Rooms only (internal, no auth; reachable only via DO binding, not from the public routes — index.ts never forwards these paths).
  - Messages: `room.create` → `roomFormSchema` already parsed → `const id = env.ROOM.newUniqueId()`; `POST /init` to the Room stub with `{id: id.toString(), form, hostUid}`; on success reply `room.created {roomId}`. `admin.closeRoom` → check `isAdmin(session.uid)` else `error FORBIDDEN`; room unknown in registry → `error ROOM_NOT_FOUND`; else `POST /close` to the Room; the Room deregisters itself (see below).
  - `broadcast` → every subscriber gets `lobby.rooms`. Closed sockets are removed on `webSocketClose`/`close` event.
  - No `storage` API calls (grep test).
- `src/room/roster.ts` — pure membership rules (BR-011, BR-012, BR-013, FR-010, FR-016):
  ```ts
  export interface Member { uid: string; nick: string }
  export function assignRole(players: Member[], observers: Member[], roomStatus: 'lobby'|'running', maxPlayers: 4, maxObservers: 4): 'player' | 'observer' | 'full'
  export function uniqueNick(taken: readonly string[], base: string): string   // FR-002 `#2`, `#3`, …; truncates base so the suffix fits 16 chars
  export function nextHost(players: Member[], observers: Member[], leavingUid: string): string | null // BR-013: next player by join order, else earliest observer, else null
  ```
  `assignRole` in M3 is called with `status: 'lobby'` only; running → `observer` is wired in M4 (the function already has the param).
- `src/room/room-logic.ts` — pure class:
  ```ts
  export interface RoomInit { id: string; name: string; durationMin: 3|5|10; speed: 1|3|8; profitTarget: number|null; hostUid: string }
  export interface RoomDeps {
    now(): number
    send(uid: string, msg: ServerMessage): void
    close(uid: string, code: number): void
    schedule(fn: () => void, ms: number): Handle
    cancel(h: Handle): void
    publish(summary: RoomSummary | null): void    // null → room deleted
    isAdmin(uid: string): boolean
  }
  export class RoomLogic {
    constructor(init: RoomInit, deps: RoomDeps)
    summary(): RoomSummary
    join(uid: string, nick: string): void         // role per assignRole; errors via send(uid, error)
    leave(uid: string): void
    kick(actorUid: string, nick: string): void    // admin only (BR-017)
    closeRoom(actorUid: string): void             // admin only; ROOM_CLOSED to all, close sockets, publish(null)
    onSocketClosed(uid: string): void             // M3: same as leave
    dispose(): void                               // cancel timers
  }
  ```
  - Stores `players: Member[]`, `observers: Member[]`, `hostUid: string | null`, `status: 'lobby'`, `emptySince` deletion timer handle.
  - `join`: rejects a uid already in the room with `INVALID_STATE` (one socket per user per room; reconnect is M4). Full → `ROOM_FULL`. Nick: `uniqueNick(taken, nick)` (FR-002).
  - Host rule (documented decision): creator is host (BR-013). If the creator has not joined yet, the first joiner becomes host (`hostUid` is re-pointed while the creator is absent). Once the host leaves, `nextHost` applies.
  - `leave`: remove member; if host → `nextHost`; `publish(summary)` and `broadcast`; if the room is now empty → schedule `EMPTY_ROOM_TTL_MS` (BR-014) deletion timer. A join cancels the pending deletion.
  - Deletion: `publish(null)`, `dispose()`. The shell then stops heartbeats.
  - `kick(actor, nick)`: `isAdmin(actor)` else `FORBIDDEN`; target not found → `INVALID_STATE`; target gets `kicked` then `close(4000-range or 1000)`; they may rejoin (BR-017, FR-017 AC).
  - `closeRoom(actor)`: `isAdmin` else `FORBIDDEN`; send `error ROOM_CLOSED` to all members, close their sockets, `publish(null)`, `dispose()` (FR-017 AC).
  - `broadcast()`: after every change, `send(uid, {type:'room.state', view: viewFor(uid)})` for each member; `viewFor` builds `RoomView` with `you`. No UIDs in any view (ARCH privacy).
- `src/room/room.ts` — `export class Room implements DurableObject`:
  - Holds `logic: RoomLogic | null` (null until `POST /init`), `sockets: Map<uid, WebSocket>`, `heartbeat: setInterval(HEARTBEAT_MS)` started at init, cleared on dispose.
  - `fetch`: `POST /init` (only once; second init → 409); `POST /close` (admin path, from Lobby); `/ws` upgrade → `ws.accept()`, `AuthGate`, then on `room.join` etc. call `logic.*`. Unknown room (`logic === null`) → `error ROOM_NOT_FOUND` then close.
  - `publish` → `env.LOBBY` `POST /register` (summary) or `POST /deregister` (`{roomId}`). Requests are awaited with `ctx.waitUntil` so no state is lost.
  - Heartbeat: every `HEARTBEAT_MS` → `publish(summary())` while the room exists (keeps `lastSeen` fresh; FR-008).
  - Message handler: `parseClientMessage` → switch on `type` (exhaustive, `never` check).
  - Socket close: `logic.onSocketClosed(uid)`; `sockets.delete(uid)`.
- Clock and timers: `Date.now()` and `setTimeout` used only in the shells (`room.ts`, `lobby.ts`, `auth-gate` wiring), never in the logic classes (ARCH invariant, CODE_QUALITY).

**Dependency and file layout check (vs ARCH §Packages):** ARCH lists `lobby.ts` and `room/room.ts` + `room/room-logic.ts`. This ticket adds `lobby/lobby-logic.ts`, `room/roster.ts`, `auth/auth-gate.ts`, `auth/jwks.ts`, `origin.ts`, `env.ts` — each a single responsibility, mirroring the RoomLogic split. ARCH §Packages gets updated to match.

### Fit with Project Docs
- **PRD:** FR-007, FR-008, FR-009, FR-010, FR-016, FR-017 (server), NFR-004 (schema, Origin, token-not-in-URL: token is in the first `auth` message), BR-011–BR-014, BR-016 (nick validation), BR-017, BP-003 (server side). No rule bent. Decision row 37 records the no-hibernation rule.
- **ARCHITECTURE:** `worker` imports `shared` only. Token verification only in `worker/src/auth/`. DO shells own sockets and timers; logic classes take injected clock/send. Memory only. Errors via `ErrorCode`. Update in this ticket: decision 34 note "applies to Lobby as well"; error list gains `ROOM_NOT_FOUND`; packages block gains the new files listed above; Open item 1 stays open until M6.
- **CODE_QUALITY:** single source for nick rules (`validation.ts`) and room-form rules (`validation.ts`) and error codes (`protocol/errors.ts`); Membership rules in one pure module (`roster.ts`); strict zod at the boundary; no `any`.
- **Docs to update:** `docs/PRD.md` §20 row 37 (no hibernation for Lobby and Room, with the budget note); `docs/ARCHITECTURE.md` (error list, packages block, decision 34 note); `docs/CODE_QUALITY.md` deps list gains `zod` already listed (no change needed), add `@cloudflare/vitest-pool-workers` as a dev tool note under Testing if needed.

### Alternative Approaches Considered
- **Hibernation for Lobby with list in serialized WebSocket attachments (Option A):** Pro: duration cost near zero when idle. Con: attachments are per socket and stored by the platform, which conflicts with memory-only (BR-020); the room list is still reset on eviction. Not chosen (user chose no hibernation after the docs check).
- **One Room DO per room, Lobby as a plain registry in KV (Option B):** Pro: no DO for the list. Con: KV is forbidden (BR-020, CODE_QUALITY). Not chosen.
- **Room creation done in the client by calling `POST /rooms` over HTTP (Option C):** Pro: simpler than a WS message. Con: second auth path; the list is already on the WS. Not chosen (one auth path, one socket).
- **Lobby sends diffs instead of full snapshots (Option D):** Pro: smaller messages. Con: more code and drift risk; ≤ 20 rooms × ~200 bytes is tiny. Not chosen (YAGNI).
- **Heartbeat 10 s (Option E):** Pro: faster stale detection. Con: 3× more Lobby requests (≈ 86 k/day at 10 rooms), close to the 100 k/day free limit. Not chosen; 30 s stays (FR-008 says "interval", the number is ours).

## Implementation Steps

1. [ ] `packages/shared`: add `zod` dependency. Extend `src/config.ts` with `AUTH_TIMEOUT_MS`, `HEARTBEAT_MS`, `STALE_AFTER_MS`, `LOBBY_SWEEP_MS`, `JWKS_FALLBACK_TTL_MS` (values as in Key Changes).
2. [ ] `packages/shared/src/validation.ts`: add `roomFormSchema`, `RoomForm`, `nickSchema` (zod, using M1's `ROOM_NAME_*`, `PROFIT_TARGET_MIN`, `NICK_PATTERN`). Tests: name 2 chars rejected, 3 and 30 accepted, 31 rejected; target `null` ok, `99` rejected, `100` ok, `1_000_000` ok, `50` rejected (FR-009 AC); unknown key rejected (`.strict()`).
3. [ ] `packages/shared/src/protocol/errors.ts`: `ERROR_CODES` closed union including `ROOM_NOT_FOUND`.
4. [ ] `packages/shared/src/protocol/views.ts`: `RoomSummary`, `MemberView`, `RoomView` as in Key Changes.
4b. [ ] `packages/shared/src/protocol/close-codes.ts`: `AUTH_FAILED = 4401`, `KICKED = 4403`, `ROOM_CLOSED = 4410` (exported `as const`).
5. [ ] `packages/shared/src/protocol/client.ts`: all client schemas (`auth`, `room.create`, `room.join`, `room.leave`, `room.start`, `order`, `close`, `admin.kick`, `admin.closeRoom`), all `.strict()`; `parseClientMessage(raw: unknown)`. Tests: `order` with `price` → rejected (NFR-004, FR-012 AC); `qty: 75` rejected; `side: 'CLOSE'` rejected; `auth` token > 4096 chars rejected; unknown `type` rejected.
6. [ ] `packages/shared/src/protocol/server.ts` + `index.ts` barrel; `ServerMessage` and `ClientMessage` types via `z.infer`; `protocol/index.ts` re-exports `ERROR_CODES`.
7. [ ] `packages/worker` scaffold: `package.json` (`@fm/worker`, deps `@fm/shared`, devDeps `wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`), `tsconfig.json` (types `@cloudflare/workers-types`), `vitest.config.ts` (pool-workers config pointing at `wrangler.toml`), `wrangler.toml` (bindings, migrations, public vars), `.dev.vars.example`; add `!.dev.vars.example` to `.gitignore` so the template is committed.
8. [ ] `src/env.ts` (`Env`, `parseEnv`, `AUTH_EMULATOR` exact `"true"`), `src/origin.ts` (`isAllowedOrigin`). Tests: exact-match only; missing Origin → false; `https://evil.example` → false; comma list parsed.
9. [ ] `src/auth/verify-token.ts` (`createTokenVerifier`): RS256 path via WebCrypto, claim checks (iss, aud, exp, iat, sub, `email_verified`), emulator mode accepts `alg: none`, production rejects it. Tests with a locally generated RSA key pair (WebCrypto in test): valid token → `{uid}`; wrong `aud` → null; expired → null; `email_verified: false` → null (FR-007 AC, BR-002); `alg: none` in production → null; `alg: none` in emulator → `{uid}`; tampered payload → null.
10. [ ] `src/auth/jwks.ts` (`fetchFirebaseJwks` with TTL cache from `Cache-Control`, fallback TTL). Test: second call within TTL does not fetch; fetch failure → verifier returns null (PRD §15).
11. [ ] `src/auth/auth-gate.ts` (`AuthGate`): 5 s timeout → close 4401; first non-auth message → close 4401; bad token → 4401; valid → `auth.ok {admin}`; second `auth` re-verifies (FR-007 edge). Tests with fake timers: no auth within 5 000 ms → 4401; auth at 4 999 ms → ok; admin flag true only for UIDs in `ADMIN_UIDS` (`isAdmin`).
12. [ ] `src/lobby/lobby-logic.ts` (`LobbyLogic`): `register`, `remove`, `has`, `list`, `sweep`; sweep timer armed only while non-empty. Tests (fake clock): FR-008 AC — room with no heartbeat for 3× interval (90 s) removed, a room heartbeating every 30 s stays; broadcast only on change; list order = registration order; sweep timer not armed when empty.
13. [ ] `src/room/roster.ts`: `assignRole`, `uniqueNick` (FR-002 `Jan#2`, then `#3`; base truncated so the result ≤ 16 chars), `nextHost`. Tests: FR-010 AC (lobby with 3 players → player; 4 players → observer; 4 observers → `full`); BR-013 (host leaves → next player by join order; no players → earliest observer; empty → null); FR-002 AC (`Jan` twice → `Jan#2`).
14. [ ] `src/room/room-logic.ts` (`RoomLogic`, lobby state only): `join` (role, `ROOM_FULL`, duplicate uid → `INVALID_STATE`, nick suffix), `leave` (host transfer, empty → deletion timer), `kick` (admin, FORBIDDEN for non-admin, `kicked` + close, rejoin allowed), `closeRoom` (admin, `ROOM_CLOSED` to all, `publish(null)`), `summary()`, `viewFor(uid)` (no UIDs). Tests with fake clock and fake send (BR-011, BR-012 lobby join, BR-013, BR-014 5 min deletion, BR-017, FR-016 AC, FR-017 AC "kicked player can rejoin"; creator-not-present rule: first joiner becomes host).
15. [ ] `src/room/room.ts` (`Room` DO shell): `/init` (once; 409 on second), `/close`, WS upgrade with `AuthGate`, message switch with `never` exhaustiveness, `publish` via `LOBBY` stub (`/register`, `/deregister`) inside `ctx.waitUntil`, heartbeat `setInterval(HEARTBEAT_MS)`, socket close → `onSocketClosed`. Unknown room → `ROOM_NOT_FOUND` + close.
16. [ ] `src/lobby/lobby.ts` (`Lobby` DO shell): `/ws` upgrade with `AuthGate`, subscriber set, `lobby.rooms` snapshot on subscribe, `room.create` (`newUniqueId`, `POST /init`, reply `room.created`), `admin.closeRoom` (admin check, `ROOM_NOT_FOUND`, forward `/close`), internal `POST /register` and `POST /deregister` (zod-parsed body), broadcast on change, no `storage` use.
17. [ ] `src/index.ts`: routes `/ws/lobby`, `/ws/room/:roomId`; 426 for non-upgrade; 403 for bad Origin (before forwarding); invalid room id → 404; `export { Room, Lobby }`. Internal paths (`/register`, `/deregister`, `/init`, `/close`) are not forwarded from public routes.
18. [ ] Integration tests with `@cloudflare/vitest-pool-workers` (`test/integration/`):
    - FR-007 AC: unverified token → socket closed 4401; no auth in 5 s → 4401; wrong Origin → 403; token not in URL (route has no query parsing).
    - FR-008 AC: create room via lobby socket → a second subscriber sees the room within 2 s (real timer, short poll).
    - FR-009 AC: valid form → `room.created` then `room.join` → `room.state` with `you.isHost === true`; invalid form (`target 50`) → `INVALID_PAYLOAD`, no room created.
    - FR-010 AC: join routing (player vs observer vs `ROOM_FULL`) over real sockets.
    - FR-016 AC: empty room gone from list after the deletion TTL (use injected short TTL via `env` override in test only, or the fake clock path in `RoomLogic` and a single real-timer smoke test).
    - NFR-004: `order` with `price` field → `error INVALID_PAYLOAD`.
    - FR-017: non-admin `admin.closeRoom` → `FORBIDDEN`; admin → `ROOM_CLOSED` to members and room gone from list.
19. [ ] Grep guard test `test/no-storage.test.ts`: `packages/worker/src/**` contains no `ctx.storage`, `state.storage`, `alarm`, `setAlarm`, `acceptWebSocket` (hibernation), `caches.default`, `KV`, `D1` (BR-020, decision 37).
20. [ ] Docs: `docs/PRD.md` §20 row 37 (no hibernation for Lobby or Room; duration budget checked in M6); `docs/ARCHITECTURE.md` (error list adds `ROOM_NOT_FOUND`; packages block lists new files; decision 34 note "applies to Lobby as well"); `docs/PRD.md` §21 unchanged.
21. [ ] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` (shared + worker incl. pool-workers) green; steps ticked; Implementation Log filled.

## Checkpoints (Todo List)

- [ ] CP1 — Protocol and validation: steps 1–6; `pnpm --filter @fm/shared test` green (room form, protocol strictness, `price` rejected).
- [ ] CP2 — Worker scaffold and auth: steps 7–11; worker Vitest green for origin, verifier, JWKS cache, auth gate (4401 and 5 s rule).
- [ ] CP3 — Pure logic: steps 12–14; Vitest green for `LobbyLogic`, `roster`, `RoomLogic` (FR-008, FR-010, FR-016, FR-017 AC).
- [ ] CP4 — Durable Objects and routing: steps 15–17; `pnpm typecheck` clean across `shared` and `worker`.
- [ ] CP5 — Integration and guards: steps 18–19; pool-workers integration suite and storage-guard test green.
- [ ] CP6 — Docs and final light verification: steps 20–21; lint, typecheck and all Vitest green.

## Risks & Mitigations

- **Risk:** In-memory room state is lost on DO eviction, silently emptying a room (BR-019 / FR-015 later depends on it).
  - Mitigation: Room is never idle-evicted while sockets are open or a timer is armed (heartbeat `setInterval` keeps it alive; decision 37). Eviction happens only after the room is empty and deleted, which is acceptable by design. Verified in M4 with a long-running test.
  - Mitigation: if an eviction is observed in M6, the lobby entry goes stale after 90 s and disappears, so the list self-heals; the user is asked to rejoin.
- **Risk:** Duration budget exceeded (13 000 GB-s/day free) because Lobby and Room never hibernate.
  - Mitigation: Lobby lives only while a room is registered; empty rooms are deleted after 5 min. Estimate: 4 concurrent rooms, 6 h/day each → 4 × 6 × 3600 × 0.125 ≈ 10 800 GB-s (~83 % of budget). Measured in M6 with the dashboard. Fallbacks, in order: (1) shorten `EMPTY_ROOM_TTL_MS`; (2) cap rooms per host; (3) reconsider hibernation for Room in lobby state (needs its own design, BR-019 impact).
- **Risk:** Lobby → Room init race: client connects to `/ws/room/:id` before `POST /init` finishes.
  - Mitigation: `room.created` is sent only after `/init` resolves; the client connects after that message. An early connect gets `ROOM_NOT_FOUND`.
- **Risk:** Trusting the client's `nick` and `roomId`.
  - Mitigation: zod-validated (`nickSchema`, `roomId` = hex id checked by `idFromString`); collisions handled server-side (`uniqueNick`); the server never trusts a client-supplied UID, only the verified token's `sub`. A socket's identity cannot change after auth (second `auth` must match the UID).
- **Risk:** Room creation has no cap on total rooms (abuse vector; PRD states none).
  - Mitigation: not added (YAGNI). Rooms are deleted after 5 min empty (BR-014). Revisit in M6 if the duration or request budget is hit.
- **Risk:** Suffixed nick exceeds 16 characters (open item from M1).
  - Mitigation (user decision, planning): `uniqueNick` truncates the base to `16 − len('#n')` characters, then appends `#n`. Example: base `Trader-123456789` (16 chars) with suffix `#2` → base cut to 14 chars `Trader-1234567` → `Trader-1234567#2` (16 chars). Tested in `roster.test.ts`.
- **Risk:** Heartbeat requests exceed the 100 000/day free limit as rooms grow.
  - Mitigation: 30 s heartbeat, one request per room per heartbeat; estimate in Trade-offs; WS messages are counted at 20:1 (incoming only; outbound broadcast is free).
- **Risk:** Firebase JWKS unavailable → every login refused.
  - Mitigation: in-memory cache with TTL from `Cache-Control`; a stale-but-valid cache is kept while a refresh is retried on the next `auth`; PRD §15 says refuse, which is what happens when there is no key at all.

## Test Strategy

**Light (during implementation):**
- Vitest, `packages/shared`: `validation.test.ts` (room form, nick), `protocol.test.ts` (strict schemas: unknown fields, `price` in `order`, `qty` set, `side` set, `auth` length).
- Vitest, `packages/worker` (plain Node env): `origin.test.ts`, `auth/verify-token.test.ts` (generated RSA keys), `auth/jwks.test.ts`, `auth/auth-gate.test.ts` (fake timers), `lobby/lobby-logic.test.ts` (fake clock), `room/roster.test.ts`, `room/room-logic.test.ts` (fake clock, fake send).
- Vitest with pool-workers: `test/integration/*.test.ts` (WS auth, Origin 403, list visibility ≤ 2 s, create/join/host, admin, invalid payload).
- Guard test: `no-storage.test.ts`.
- `pnpm lint`, `pnpm typecheck`.

**Heavy (review only):** Playwright multi-context flows (M6), production `wrangler deploy --dry-run`, bundle size of the Worker (not in this ticket). Latency NFR-001 measured in M6.

## Success Checklist
- [ ] All success criteria met, with evidence (Vitest output, especially ≤ 2 s list visibility and 4401/403 cases)
- [ ] Lint, typecheck, Vitest green in `shared` and `worker`
- [ ] No storage or hibernation APIs in `worker` (guard test green)
- [ ] Docs updated (PRD §20 row 37, ARCH error list and packages block)
- [ ] Code review approved (`first-million-review`)
- [ ] No regressions (M1 engine tests still green; M2 is independent)

## Timeline & Estimates
- Phase 1 (protocol, validation, config): ~3 h
- Phase 2 (auth verifier, JWKS, auth gate, origin): ~5 h
- Phase 3 (LobbyLogic, roster, RoomLogic): ~5 h
- Phase 4 (DO shells, routing, pool-workers integration): ~6 h
- Phase 5 (docs, review): ~2 h
- **Total**: ~21 h (rough, plus buffer)

## Open Questions
- [ ] None blocking. Host-when-creator-absent rule decided above (first joiner becomes host); if the user wants strict creator-only hosting, the room must wait for the creator, which needs a timeout rule not in the PRD.

## Implementation Log
(Empty. first-million-implement appends one line per step event here.)
