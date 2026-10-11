# M1 — Skeleton and engine — Implementation Plan

Ticket 1 of 6 (PRD §19 M1). Index: [specs/README.md](README.md).

## Summary
Create the pnpm monorepo, tooling and CI gate (lint, typecheck, Vitest), then build the pure `shared` simulation engine: fixed BR values, tunable config, seeded RNG, netting/spread/equity/bankruptcy, price process, news, and nickname rules. Everything later depends on this package, so it is built first and tested hard. Implementation runs on its own git worktree branch (`feature/m1-skeleton-engine`). Local work not visible to the worktree: none (repo is clean, one commit `93a73c6`). The spec itself stays in the main checkout.

## Success Criteria
- `pnpm -r typecheck`, `pnpm lint`, `pnpm test` all green on a fresh clone after `pnpm install`.
- Engine covers FR-003 acceptance: netting example from FR-003 (with spread), bankruptcy flag, CLOSE with no position is a no-op.
- Type distribution over 10,000 seeded draws: each of 5 news types within 18–22% (FR-005).
- Same seed → identical price path over 5,000 ticks (determinism, ARCH invariant).
- No `Math.random`, `Date.now`, DOM, Workers or Firebase import anywhere in `packages/shared` (grep check in tests).

## Scope & Constraints
- **In scope:** FR-003 (engine), FR-005 (news logic only, UI is M2), BR-003, BR-004, BR-005, BR-015, nickname rule and random nickname (BR-016 logic, FR-002 validation core), monorepo scaffold, lint/typecheck/test tooling, CI workflow (light checks only).
- **Out of scope (later tickets):** protocol zod schemas (M3), room-form validation (M3, uses zod), UI (M2), Worker (M3), round loop/tick scheduling (M4). No deploy (M6, decision: deploy in M6).
- **Hard constraints:** `shared` pure and deterministic (ARCH invariant, CODE_QUALITY determinism); only dependency allowed in `shared` is `zod` (added in M3, not here); 0 PLN (no paid tooling); nothing persisted (BR-020).
- **Trade-offs:**
  - Raw float money (user decision): no rounding in engine, Intl formats in UI. Ties in equity are therefore exact only when values are bit-identical; acceptable per user.
  - Engine is **immutable**: every function returns a new value. Costs a few allocations per tick (speed ≤ 8 per 80 ms), well within budget; buys trivial unit tests and no shared-state bugs in the DO later.
  - Halt duration counted in **wall-clock ms** passed in by the caller (prototype parity: `HALT_MS` is real time while price steps run at speed). Deviates from "game ticks" only in how the caller passes elapsed time.

## Architecture & Design

### High-Level Flow
```
caller (web single / worker room)
  └─ rng: Rng (createRng(seed))
  └─ market = createMarket(rng)
  loop per interval:
     market = tickHalt(market, elapsedMs)          // counts down 5 s halt, wall ms
     repeat speed times: market = stepMarket(market, rng)   // GBM + regimes + news draws + effects
     portfolio = executeOrder(portfolio, side, qty, market.price)   // on order
     equity(portfolio, market.price)
     isBankrupt(portfolio, market.price) → liquidate(portfolio, market.price)
```
No I/O. Callers own timers and clocks.

### Key Changes

**Monorepo scaffold (root):**
- `package.json` — `packageManager: pnpm@9`, `engines.node: ">=22"`, scripts: `lint`, `typecheck`, `test`, `format`.
- `pnpm-workspace.yaml` — `packages: ["packages/*", "e2e"]` (e2e folder created in M6; keep glob, empty workspace OK).
- `tsconfig.base.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `moduleResolution: "bundler"`, `target: ES2022`.
- `eslint.config.js` — flat config: `typescript-eslint` recommended-type-checked, `no-explicit-any`, `@typescript-eslint/no-non-null-assertion` error. No Vue plugin yet (added in M2).
- `.prettierrc.json` — `{ "semi": false, "singleQuote": true, "printWidth": 100 }`; `.prettierignore` (dist, coverage, pnpm-lock).
- `.nvmrc` — `22`.
- `.github/workflows/ci.yml` — on push/PR: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. No build, no e2e (ARCH decision 39).

**`packages/shared`:**
- `package.json` — name `@fm/shared`, `"type": "module"`, exports `./src/*.ts` (workspace source, no build step in M1–M5).
- `tsconfig.json` extends base, `include: ["src", "test"]`.
- `vitest.config.ts` — `environment: "node"`.
- `src/rules.ts` — fixed BR values, `as const`:
  - `START_CASH = 10_000`, `START_PRICE = 100`, `MIN_PRICE = 5`, `SPREAD = 0.06` (BR-003)
  - `ORDER_QTYS = [10, 50, 100, 250] as const`, `OrderQty` (BR-003)
  - `ROUND_DURATIONS_MIN = [3, 5, 10] as const` (BR-008), `SPEEDS = [1, 3, 8] as const` (BR-008)
  - `MAX_PLAYERS = 4`, `MAX_OBSERVERS = 4` (BR-011)
  - `ORDER_RATE_PER_SEC = 10` (BR-018)
  - `DISCONNECT_GRACE_MS = 30_000` (BR-019)
  - `EMPTY_ROOM_TTL_MS = 300_000` (BR-014)
  - `NICK_PATTERN = /^[A-Za-z0-9_-]{3,16}$/` (BR-016, FR-002)
  - `ROOM_NAME_MIN = 3`, `ROOM_NAME_MAX = 30` (BR-014 / BP-002)
  - `PROFIT_TARGET_MIN = 100` (BR-008)
- `src/config.ts` — tunables (ARCH decision 30; PRD §20 #30). `as const`:
  - `TICK_MS = 80`
  - `HALT_MS = 5_000`
  - `FLASH_RECOVER = 0.7`, `FLASH_TICKS = 20`
  - `VOL_MULT = 3`, `VOL_TICKS = 60`
  - `TREND_DRIFT = 0.0007`, `TREND_TICKS = 100`
  - `NEWS_FIRST_TICKS = [200, 400]`, `NEWS_GAP_TICKS = [250, 650]`
  - `SHOCK_MAG = [0.012, 0.032]`, `FLASH_DROP = [0.03, 0.08]`
  - `REGIME_TICKS = [40, 180]`, `DRIFT_RANGE = 0.0014`, `VOL_BASE = 0.0006`, `VOL_RANGE = 0.0018`
  - `NEWS_FADE_TICKS = 90` (FR-005)
  - `HISTORY_MAX = 2_400` (Data model §13)
  - `SHOCK_TEXT_COUNT = 4` (not text, index range for i18n keys)

  Note on values: the prototype uses exactly these values (`first-million.html` L191–193, L268–296). Copy them, do not re-tune.

- `src/rng.ts`
  - `export type Rng = () => number` (returns `[0, 1)`)
  - `export function createRng(seed: number): Rng` — mulberry32, 32-bit state.
  - `export function randn(rng: Rng): number` — Box–Muller, one draw pair per call (no cached second value, so the sequence stays a pure function of the seed).
  - `export function between(rng: Rng, lo: number, hi: number): number` → `lo + rng() * (hi - lo)`.
  - `export function pick<T>(rng: Rng, items: readonly T[]): T` — throws on empty input. Reads the index through an explicit `undefined` guard (no `!`, per CODE_QUALITY).

- `src/engine/portfolio.ts` — BR-004, BR-005.
  ```ts
  export interface Portfolio {
    readonly units: number        // signed: >0 long, <0 short, 0 flat
    readonly avg: number          // average entry price, 0 when flat
    readonly realized: number
    readonly closedTrades: number
    readonly wins: number
  }
  export const emptyPortfolio: Portfolio
  export type TradeSide = 'BUY' | 'SELL'
  export function fillPrice(price: number, side: TradeSide): number // price ± SPREAD/2
  export function executeOrder(p: Portfolio, side: TradeSide, qty: number, price: number): Portfolio
  export function closePosition(p: Portfolio, price: number): Portfolio  // no-op when flat
  export function unrealized(p: Portfolio, price: number): number
  export function equity(p: Portfolio, price: number): number            // START_CASH + realized + unrealized
  export function isBankrupt(p: Portfolio, price: number): boolean       // equity <= 0
  export function liquidate(p: Portfolio, price: number): Portfolio      // closePosition at market incl. spread (BR-005)
  export function totalResult(p: Portfolio, price: number): number       // equity - START_CASH
  ```
  Netting rules (BR-004), implemented exactly as prototype `trade()` (L354–368):
  - Same direction or flat → weighted average entry: `avg = (avg·|u| + fill·q)/(|u| + q)`.
  - Opposite → `closing = min(|u|, q)`, realize `(fill − avg)·sign(u)·closing`, `closedTrades += 1`, `wins += pnl > 0 ? 1 : 0`. Remainder `rest = q − closing`; `units += side·q`; if `units === 0` → `avg = 0`; else if `rest > 0` → `avg = fill` (reversal opens at execution price); else `avg` unchanged.
  - `closePosition`: close whole position at `price − sign(u)·SPREAD/2` (prototype L383–389); no-op when flat.
  - `liquidate` = `closePosition` (same fill rule, used for bankruptcy and disconnect timeout).
  - Pure: no mutation; return new object.

- `src/engine/market.ts` — FR-003 price step, BR-015 hooks.
  ```ts
  export interface Market {
    readonly price: number
    readonly drift: number          // current regime drift
    readonly vol: number            // current regime vol
    readonly regimeLeft: number     // ticks until new regime (counts down)
    readonly newsLeft: number       // ticks until next news draw
    readonly volLeft: number        // VOL_SPIKE ticks left
    readonly trend: { readonly left: number; readonly drift: number } | null
    readonly flash: { readonly left: number; readonly perTick: number } | null
    readonly haltMsLeft: number     // > 0 → trading halted (BR-015)
    readonly news: NewsEvent | null // last news drawn at this tick (null otherwise)
    readonly newsAge: number        // ticks since last news (for fade, FR-005)
    readonly frozenPrice: number | null // price shown while halted (prototype shownLen); null when not halted
  }
  export function createMarket(rng: Rng): Market        // START_PRICE, first news 200–400 ticks, first regime drawn
  export function stepMarket(m: Market, rng: Rng): Market   // one tick (prototype step() L333–347)
  export function tickHalt(m: Market, elapsedMs: number): Market // subtract wall ms; clears halt + frozenPrice at 0
  export function isTradingHalted(m: Market): boolean
  export function shownPrice(m: Market): number        // frozenPrice ?? price
  ```
  Tick order inside `stepMarket` mirrors prototype L334–346 exactly (regime check, news draw, drift choice, vol multiplier, GBM step with `Math.max(MIN_PRICE, …)`, flash recovery, newsAge++). Floor at `MIN_PRICE` after every price change.

  Halt subtlety (decided here): when a TRADING_HALT is drawn, `frozenPrice` is set to the price at that tick, the true `price` keeps moving; on halt end `frozenPrice = null` so the displayed price jumps (BR-015). Matches prototype `shownLen` behaviour.

- `src/engine/news.ts` — BR-015 draws and effects.
  ```ts
  export type NewsEvent =
    | { type: 'SHOCK'; dir: 1 | -1; mag: number; idx: number }
    | { type: 'FLASH_CRASH'; drop: number }
    | { type: 'VOL_SPIKE' }
    | { type: 'TRADING_HALT' }
    | { type: 'TREND'; dir: 1 | -1 }
  export function drawNewsGap(rng: Rng, first: boolean): number  // ticks until next draw
  export function drawNews(rng: Rng, m: Market): Market         // type 20% each, applies effect (prototype news() L285–313)
  ```
  Note: `TREND` replaces regime drift for 100 ticks; `VOL_SPIKE` multiplies vol ×3 for 60 ticks; FLASH applies immediate −drop% then `perTick` recovery for 20 ticks; SHOCK immediate ±mag; TRADING_HALT sets `haltMsLeft = HALT_MS`, `frozenPrice = price`.

- `src/validation.ts` — single source for nickname rules (CODE_QUALITY table).
  ```ts
  export function isValidNick(s: string): boolean          // NICK_PATTERN
  export function randomNick(rng: Rng): string             // `Trader-NNNN`, 4 digits, zero-padded
  export function suffixNick(nick: string, n: number): string // `${nick}#${n}` (FR-002 collision); caller ensures length ≤ 16 is NOT enforced here (see Risks)
  ```
  Room-form validation lives here too but is written in M3 (zod). Do not add it now.

- `test/` — Vitest files, one per module, plus `determinism.test.ts`, `no-platform-imports.test.ts` (greps `src/**` for `Math.random`, `Date.now`, `window`, `firebase`, `cloudflare`).

### Fit with Project Docs
- **PRD:** implements BR-003, BR-004, BR-005, BR-015 (logic), BR-016 (nick logic), FR-003, FR-005 (logic), FR-002 (validation core). No rule bent. Hard-coded rule values live in `rules.ts`, tunables in `config.ts` (decision 30).
- **ARCHITECTURE:** `shared` imports nothing platform; only `zod` allowed (not added here). Engine takes RNG and elapsed ms as arguments (decision 36). Invariant "engine pure" enforced by the grep test.
- **CODE_QUALITY:** KISS (plain functions, immutable values, no classes); YAGNI (no protocol, no room-form, no unused exports); single sources of truth (`rules.ts`, `config.ts`, `engine/`, `validation.ts`); `noUncheckedIndexedAccess` and `strict` per working agreements.
- **Docs to update:**
  - `docs/ARCHITECTURE.md` "Open items": mark 2 (tick drift) and 3 (money rounding) resolved, citing PRD §20 rows 33 and 34; mark 4 (Firebase in dev/e2e) resolved, citing row 35. Item 1 (broadcast cost) stays open until M6. The ARCH "Decisions (proposed)" table 33–39 is kept as is and not renumbered.
  - `docs/PRD.md` §20: append rows 33–35 for the user-visible decisions made while planning: 33 fixed speed steps per interval, 34 raw float money (format in UI), 35 Firebase Auth emulator in dev/e2e. Row 36 is the deploy decision (added in M2). Row 37 (no hibernation for Lobby or Room) is added in M3, when the Lobby code exists.
  - `docs/ARCHITECTURE.md` decision 34 (no hibernation) stays; add the note "applies to Lobby too" in M3.

### Alternative Approaches Considered
- **Mutable engine (class `Market` with methods, like prototype):** Pro: fewer allocations, closer to prototype. Con: shared mutable state between tests and the DO; harder to assert "same input → same output". Not chosen.
- **Immutable functional engine (chosen):** Pro: pure, trivially testable with seeded RNG; easy to snapshot. Con: object churn; negligible at ≤ 8 steps / 80 ms.
- **Put history inside `Market`:** Pro: one object. Con: copying a 2 400-element array per tick. Not chosen; history lives in the caller (`Room` and `SinglePlay`), append-only, capped at `HISTORY_MAX`.
- **Halt in game ticks instead of wall ms:** Pro: deterministic in tests without fake clock. Con: at 8× the halt would last 0.63 s wall, not 5 s as BR-015 states. Not chosen; wall ms is passed in and tests use fixed numbers.
- **Use `Math.random` seeded by a library (e.g. seedrandom):** Pro: well-known. Con: extra dependency; mulberry32 is 6 lines. Not chosen (KISS, deps limited).

## Implementation Steps

1. [x] Root scaffold: `package.json` (pnpm 9, `engines.node >=22`, scripts `lint`, `typecheck`, `test`, `format`), `pnpm-workspace.yaml` (`packages/*`, `e2e`), `.nvmrc` (`22`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ES2022, bundler resolution).
2. [x] Lint/format: `eslint.config.js` (flat, `typescript-eslint` type-checked, `no-explicit-any` error, `no-non-null-assertion` error), `.prettierrc.json` (`semi: false`, `singleQuote: true`, `printWidth: 100`), `.prettierignore`. Install `eslint`, `typescript-eslint`, `prettier`, `vitest`, `typescript` as root devDependencies.
3. [x] `packages/shared` scaffold: `package.json` (`@fm/shared`, `type: module`), `tsconfig.json` (extends base, includes `src` + `test`), `vitest.config.ts` (`environment: node`), empty `src/index.ts` barrel.
4. [x] `packages/shared/src/rules.ts` with all BR constants listed in Key Changes, `as const`, exported types (`OrderQty`, `RoundDuration`, `Speed`).
5. [x] `packages/shared/src/config.ts` with all tunables from Key Changes, values copied from prototype L191–193 and L268–296.
6. [x] `packages/shared/src/rng.ts`: `Rng`, `createRng` (mulberry32), `randn` (Box–Muller, no cached pair), `between`, `pick` (throws on empty). Test: same seed → same first 100 values; values in `[0,1)`; `randn` mean ≈ 0 and sd ≈ 1 over 100 000 draws (tolerance 0.02).
7. [x] `packages/shared/src/engine/portfolio.ts` per Key Changes. Tests (name states rule, cite BR):
   - BR-004: flat → BUY 50 @100 → avg = 100.03, units 50.
   - BR-004 FR-003 example: long 50 @ 100 (avg 100.03 after spread) → SELL 100 at price 101 → fill 100.97, realized `(100.97−100.03)·50`, units −50, avg = 100.97.
   - BR-004: order in same direction averages entry.
   - BR-004: CLOSE with no position → same object, no change.
   - BR-004: closedTrades increments on each reduction/close; wins only when pnl > 0.
   - BR-005: equity ≤ 0 → `isBankrupt` true; `liquidate` returns flat, realized includes loss incl. spread.
8. [x] `packages/shared/src/engine/market.ts`: `createMarket`, `stepMarket` (tick order per prototype L334–346), `tickHalt`, `isTradingHalted`, `shownPrice`. Tests: price never below `MIN_PRICE` over 10 000 ticks; regime countdown resets drift/vol within `REGIME_TICKS`; VOL_SPIKE multiplies vol ×3 while `volLeft > 0`; TREND replaces drift for 100 ticks.
9. [x] `packages/shared/src/engine/news.ts`: `drawNewsGap`, `drawNews` (type = `floor(rng()*5)` mapped to 5 types, dir ±1, effects per Key Changes). Tests:
   - FR-005: 10 000 seeded draws → each type 18–22%.
   - FR-005 acceptance: FLASH_CRASH drop in [3%, 8%]; after 20 `stepMarket` calls without other news, 70% of drop recovered (within 1% tolerance of the recovery target).
   - BR-015: TRADING_HALT sets `haltMsLeft = 5000`, `frozenPrice = price`; `tickHalt(m, 5000)` clears both; `tickHalt` never goes negative.
   - BR-015: first news gap in [200, 400], later gaps in [250, 650].
   - FR-005 edge: a new news event replaces the previous effect (e.g. new TREND replaces running regime drift).
10. [x] `packages/shared/src/validation.ts`: `isValidNick`, `randomNick(rng)`, `suffixNick`. Tests: `Trader-0042` format `Trader-\d{4}` (FR-002 AC); `ab` rejected, 16-char accepted, 17-char rejected (FR-002 AC for "ab"); special chars rejected; `suffixNick('Jan', 2) === 'Jan#2'` (FR-002 AC).
11. [x] Determinism test `test/determinism.test.ts`: seed 42, run `createMarket` + 5 000 `stepMarket` + `drawNews` paths twice → identical price arrays; different seed → different array.
12. [x] Purity guard test `test/no-platform-imports.test.ts`: reads all `src/**/*.ts`, asserts none contain `Math.random`, `Date.now`, `performance.now`, `window`, `document`, `firebase`, `cloudflare`, `@cloudflare`.
13. [x] Root `.github/workflows/ci.yml`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. No build, no e2e.
14. [x] Docs: `docs/PRD.md` §20 rows 33–35 (fixed speed steps, raw float money, Firebase emulator); `docs/ARCHITECTURE.md` Open items 2–4 marked resolved with those row numbers, item 1 stays open.
15. [x] Final light verification: `pnpm lint`, `pnpm typecheck`, `pnpm test` all green; mark all steps ticked; fill Implementation Log.

## Checkpoints (Todo List)

- [x] CP1 — Scaffold: steps 1–3 done; `pnpm install`, `pnpm lint`, `pnpm typecheck` clean on empty `shared`. — verified
- [x] CP2 — Rules and RNG: steps 4–6; `pnpm --filter @fm/shared test` green for rng. — 6 tests green
- [x] CP3 — Portfolio engine: step 7; Vitest green, FR-003 netting example covered. — 21 tests green
- [x] CP4 — Market and news: steps 8–9; Vitest green (distribution, recovery, halt, regimes). — 46 tests green
- [x] CP5 — Validation, purity and determinism: steps 10–12; Vitest green. — 66 tests green
- [x] CP6 — CI and docs: steps 13–15; lint, typecheck and all Vitest green. — 66 tests green

## Risks & Mitigations

- **Risk:** Float drift makes FR-003 example assertions brittle (e.g. `100.97` vs `100.9700000001`).
  - Mitigation: assert with `toBeCloseTo(x, 9)`; never `toBe` on computed floats except exact constructed values.
  - Mitigation: if a test flakes on float ordering, compare via helper `near(a, b)`; do not round the engine (user decision: raw floats).
- **Risk:** Prototype logic copied with a subtle deviation (e.g. close fill sign on shorts).
  - Mitigation: `closePosition` test covers long and short; each function cites its prototype line in a comment (why, not what).
  - Mitigation: no golden-file comparison is possible (the prototype uses `Math.random`). Rely on one table-driven test per BR-004 case plus hand spot checks against the prototype.
- **Risk:** `randomNick` collisions inside a room are handled by `suffixNick`, but a suffixed nick can exceed 16 chars (e.g. `Trader-1234#12`, 14 chars OK; a 16-char custom nick + `#2` = 18).
  - Mitigation: M1 does not enforce it (no room yet). M3 must validate the suffixed length: truncate base to fit, or reject the join. Recorded as an open question in M3.
- **Risk:** Lint config drift between root and packages (type-aware rules need `parserOptions.project`).
  - Mitigation: root `eslint.config.js` sets `parserOptions.projectService: true`; packages have their own `tsconfig.json`. Verified at CP1.
- **Risk:** Engine performance at speed 8 (8 × `stepMarket` per 80 ms, object churn).
  - Mitigation: order of magnitude fine (≈100 small allocations/s). Re-measure only if M6 CPU budget is hit (ARCH open item 1).

## Test Strategy

**Light (run during implementation):**
- Vitest, `packages/shared`:
  - `rng.test.ts`: determinism, range, `randn` moments.
  - `portfolio.test.ts`: BR-004 netting table, BR-005 equity/bankruptcy/liquidate, CLOSE no-op.
  - `market.test.ts`: GBM floor, regime, vol spike, trend, halt freeze.
  - `news.test.ts`: distribution 18–22% (10 000 draws), FLASH recovery, halt timing, gap ranges.
  - `validation.test.ts`: nick regex, `Trader-NNNN`, `#n` suffix.
  - `determinism.test.ts`, `no-platform-imports.test.ts`.
- `pnpm lint`, `pnpm typecheck`.

**Heavy (review only, not in this ticket):** none apply to M1 (no UI, no Worker). Build and bundle checks come in M2/M6.

## Success Checklist
- [ ] All success criteria met, with evidence (Vitest output)
- [ ] Lint, typecheck, Vitest green
- [ ] No platform API in `shared` (purity test green)
- [ ] Docs updated (ARCH open items, PRD §20)
- [ ] Code review approved (`first-million-review`)
- [ ] No regressions (N/A, first ticket)

## Timeline & Estimates
- Phase 1 (scaffold, rules, config, rng): ~3 h
- Phase 2 (portfolio, market, news, tests): ~6 h
- Phase 3 (validation, CI, docs, review): ~2 h
- **Total**: ~11 h (rough, plus buffer)

## Open Questions
- [ ] None blocking. The `#n` suffix length rule is deferred to M3 (see Risks).

## Implementation Log
- Worktree: /home/patryk/projects/frist-milion/.claude/worktrees/m1-skeleton-engine — branch worktree-m1-skeleton-engine
- Step 1 — started
- Step 1 — done — files: package.json, pnpm-workspace.yaml, .nvmrc, tsconfig.base.json — added noEmit/skipLibCheck/isolatedModules/allowImportingTsExtensions to base tsconfig (typecheck-only, no build); packageManager pnpm@9.15.9
- Step 2 — started
- Step 2 — done — files: eslint.config.js, .prettierrc.json, .prettierignore, package.json, pnpm-lock.yaml — devDeps installed; typescript pinned ~6.0 (typescript-eslint 8 rejects TS 7); added @types/node (purity test reads files); .prettierignore also skips docs/ specs/
- Step 3 — started
- Step 3 — done — files: packages/shared/{package.json,tsconfig.json,vitest.config.ts,src/index.ts} — tsconfig includes vitest.config.ts so type-aware lint covers it; exports also expose `./*` for deep imports
- CP1 — ticked: pnpm install, lint, typecheck clean
- Step 4 — started
- Step 4 — done — files: packages/shared/src/rules.ts — BR constants + OrderQty/RoundDuration/Speed types
- Step 5 — started
- Step 5 — done — files: packages/shared/src/config.ts — prototype values copied
- Step 6 — started
- Step 6 — done — files: packages/shared/src/rng.ts, packages/shared/test/rng.test.ts — 6 tests green
- CP2 — ticked: rng tests green (6), typecheck + lint clean
- Step 7 — started
- Step 7 — done — files: packages/shared/src/engine/portfolio.ts, packages/shared/test/portfolio.test.ts — 15 tests, FR-003 netting example covered; shared `realize` helper used by netting and close
- CP3 — ticked: 21 tests green total
- Step 8 — started
- Step 8 — done — files: packages/shared/src/engine/market.ts, packages/shared/test/market.test.ts, packages/shared/test/helpers.ts — 9 tests; deviation: `Market.news` keeps the LAST news (not null after the draw tick) so newsAge/fade (FR-005) has something to fade; `news.ts` (step 9 module) written alongside because stepMarket depends on it
- Step 9 — started
- Step 9 — done — files: packages/shared/src/engine/news.ts, packages/shared/test/news.test.ts — 15 tests (distribution 18-22%, flash 70% recovery, halt, gaps, trend replace); draw order type, dir, gap, then type-specific as in prototype
- CP4 — ticked: 46 tests green total
- Step 10 — started
- Step 10 — done — files: packages/shared/src/validation.ts, packages/shared/test/validation.test.ts — 9 tests; `#n` length rule left to M3 as planned
- Step 11 — started
- Step 11 — done — files: packages/shared/test/determinism.test.ts — seed 42 x 5000 ticks identical, news present, other seed differs
- Step 12 — started
- Step 12 — done — files: packages/shared/test/no-platform-imports.test.ts — scans src/**/*.ts with comments stripped (so docs may mention the forbidden names)
- CP5 — ticked: 66 tests green total
- Step 13 — started
- Step 13 — done — files: .github/workflows/ci.yml — checkout, pnpm/action-setup (reads packageManager), setup-node from .nvmrc, frozen install, lint, typecheck, test; no build/e2e
- Step 14 — started
- Step 14 — done — files: docs/PRD.md, docs/ARCHITECTURE.md — PRD §20 rows 33-35 added; ARCH open items 2-4 struck through with row refs, item 1 stays open
- Step 15 — started (checks launched in background subagents)
- Step 15 — check: pnpm test PASS (7 files, 66 tests); pnpm lint PASS; pnpm typecheck PASS (background subagents)
- Step 15 — done — files: none (verification only); Success Checklist left for review
- CP6 — ticked: lint, typecheck, test green
- Spec note: working copy of this spec lives in the worktree (`specs/01-skeleton-engine.md`, untracked); the harness blocked edits at the main-checkout path. Main copy is stale until copied back.
