# First Million — implementation roadmap

Six tickets, one per PRD §19 milestone. Each ticket is a full spec with checkboxes, so `first-million-implement` can run it in its own session and resume from the first unticked checkpoint.

| # | Ticket | Milestone | Depends on | Spec |
|---|---|---|---|---|
| 1 | Skeleton and engine | M1 | — | [01-skeleton-engine.md](01-skeleton-engine.md) |
| 2 | Web: single play and auth | M2 | 1 | [02-web-single-play-auth.md](02-web-single-play-auth.md) |
| 3 | Worker, lobby and rooms | M3 | 1 | [03-worker-lobby-rooms.md](03-worker-lobby-rooms.md) |
| 4 | Server round engine | M4 | 1, 3 | [04-server-round-engine.md](04-server-round-engine.md) |
| 5 | Multiplayer UI and admin | M5 | 2, 3, 4 | [05-multiplayer-ui-admin.md](05-multiplayer-ui-admin.md) |
| 6 | Quality and release | M6 | 5 | [06-quality-release.md](06-quality-release.md) |

## Order

```
1 ──┬── 2 ──────────────────┐
    │                       ├── 5 ── 6
    └── 3 ── 4 ─────────────┘
```

- **Ticket 1 first.** Everything depends on the `shared` engine and tooling.
- **Tickets 2 and 3 can run in parallel** after 1 (separate packages: `web` and `worker`). Both touch `packages/shared` only through additive files (`validation.ts` is extended by 3, not 2).
- **Ticket 4 after 3** (it extends `RoomLogic`, the protocol and the Room shell).
- **Ticket 5 after 2, 3, 4** (needs the web shell, the protocol and the round messages).
- **Ticket 6 last.** Writes the heavy checks and release config; runs them only in review.

## Branch and spec rules

- Tickets are implemented on the current branch of the current checkout. No worktrees, no per-ticket branches; the user picks the branch and commits.
- `specs/` lives in the same checkout, so `first-million-implement` reads and ticks the spec in place.
- Docs changes listed in each ticket (PRD §20 rows, ARCH open items, CODE_QUALITY deps) are made in the same change as the code.
- PRD §20 row numbers are reserved per ticket: M1 uses rows 33–35, M2 uses 36, M3 uses 37, M4 uses 38–40. Parallel tickets 2 and 3 therefore touch different rows.

## Planning decisions (summary)

Decided with the user during planning. Each is in the ticket where it applies.

| Topic | Decision | Ticket |
|---|---|---|
| Tick pace | Fixed `speed` steps per 80 ms interval, no catch-up | 1, 4 |
| Money | Raw floats, formatted only in the UI | 1 |
| Halt length | 5 s wall-clock at any speed | 1, 4 |
| Firebase in dev and e2e | Auth emulator; dev-only flag, absent from production | 3, 6 |
| Broadcast | Every 80 ms tick, per-recipient `you` | 4 |
| Deploy | All in M6; M1–M5 run locally | 2, 6 |
| Routing | `vue-router` | 2 |
| Fonts | Self-hosted woff2 | 2 |
| Tooling | ESLint + Prettier, Node 22 | 1 |
| Durable Objects hibernation | None (Lobby and Room stay alive while a room exists) | 3 |
| Lobby heartbeat | 30 s, stale after 90 s | 3 |
| Nick collision suffix | Base truncated so the name stays ≤ 16 characters | 3 |
| Eliminated players | Watch-only seat, observer cap stays 4 | 4 |
| Order rate limit | Counts every valid order and close, accepted or rejected | 4 |
| Explicit leave during a round | Same as disconnect (30 s grace) | 4 |
| E2E round length | 3 min by default; 10 min behind `E2E_FULL_ROUND=1` | 6 |

## Budget note (NFR-002)

The free plan allows 13 000 GB-s of Durable Object duration per day and 100 000 requests per day. Lobby and Room are not hibernated, so duration grows with the time a room exists. Ticket 6 writes the measurement steps; the first real measurement happens at release.

## Next move

**Next move** — after you approve the plans, run:

```
/first-million-implement specs/01-skeleton-engine.md
```

Tickets 2 and 3 can run in parallel after ticket 1 is merged:

```
/first-million-implement specs/02-web-single-play-auth.md
/first-million-implement specs/03-worker-lobby-rooms.md
```
