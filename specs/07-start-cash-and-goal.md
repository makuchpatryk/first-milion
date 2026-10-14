# Selectable starting capital and uncapped goal — Implementation Plan

Follow-up to ticket 6 (PRD decision 44). Touches `shared`, `worker`, `web`, `e2e`, PRD.

## Summary
Today every player starts with a fixed $10,000 and must set a profit target of at least $20,000. This change lets the player (single play) or the host (room) pick the starting capital, and turns the goal into a **target capital** (equity) with no upper limit and no fixed minimum except "above the starting capital". Both values are chosen on sliders with number fields. Written on branch `feature/goal-and-setup` at `328e033`. **That branch has uncommitted work from earlier today** (`back.ts`, `back.test.ts`, `RoomView.vue`, `SinglePlayView.vue`, `en.json`, `pl.json`: header, back links and layout changes). A worktree created from `HEAD` does not see it; commit it first or implement on the current branch. `SinglePlayView.vue` and both locale files are touched again here.

## Success Criteria
- Single-play setup shows a start slider ($1,000–$100,000, step $1,000, default $10,000) and a goal slider (start + $1,000 … $1,000,000, default $30,000), each with a number field; the goal field accepts any whole number above the start, also above the slider max.
- A goal ≤ start, a non-whole goal, or a start outside the range or off the $1,000 grid is rejected with a field error; the game does not start.
- A round (single and room) ends as a win when **equity ≥ goal**; bankruptcy stays at equity ≤ 0; the first equity of every player equals the chosen start.
- The host sets start and goal in the room form; the server rejects an invalid pair (`INVALID_PAYLOAD`); the room list and the lobby show start and goal; all players of a room start with the same capital.
- `START_CASH` and `PROFIT_TARGET_MIN` no longer exist; `grep` finds no hard-coded `10_000` start in code (defaults only in `rules.ts`).
- Lint, typecheck and Vitest green in `shared`, `worker`, `web`; PRD updated.

## Scope & Constraints
- **In scope:** BR-003, BR-005, BR-006, BR-008, BR-009, FR-003, FR-004, FR-008, FR-009, FR-011, FR-013 (PRD ids touched); protocol fields; engine; Room; both forms; panels; PL + EN texts; e2e fixtures; PRD sync.
- **Out of scope:** scaling order sizes to the capital (BR-003 sizes stay {10, 50, 100, 250} units); anything in PRD §10.3 (the list does not forbid a custom capital); changing the news, spread or price rules; the login tagline `app.goal` ("$10,000 → ?") stays flavour text.
- **Hard constraints:** server authority (BR-007: the client sends `startCash` and `goal` only at room creation, the server validates again, NFR-004); `shared` stays pure; no persistence (BR-020); PL + EN (FR-019); keyboard operable, 360 px, WCAG AA (NFR-003); bundle ≤ 300 KB gzip (no new dependency, native `<input type="range">`).
- **Trade-offs:** KISS native range + text field over a custom slider; one engine change (`startCash` inside `Portfolio`) over threading a parameter through every call; renaming `profitTarget` to `goal` (the meaning changed, the UI already says "Goal") over keeping a misleading name. No release is deployed yet, so no client/server version skew.

## Architecture & Design

### High-Level Flow
```
form (start, goal) --zod stakes check--> room.create / SingleRound
Room: seats = newPortfolio(startCash) --> every tick/order: settleSeat (equity <= 0 -> out)
                                          checkEnd: equity >= goal -> TARGET
view/summary carry { startCash, goal } --> web: progress = (equity - start) / (goal - start)
```

### Key Changes
- **`shared/rules.ts`**: replace `START_CASH` by `DEFAULT_START_CASH = 10_000`; add `START_CASH_MIN = 1_000`, `START_CASH_MAX = 100_000`, `START_CASH_STEP = 1_000`, `DEFAULT_GOAL = 30_000`; delete `PROFIT_TARGET_MIN`.
- **`shared/engine/portfolio.ts`**: `Portfolio` gets `readonly startCash: number`; `emptyPortfolio` becomes `newPortfolio(startCash)`; `equity`, `isBankrupt`, `totalResult` read `p.startCash`, so their signatures do not change (CODE_QUALITY "pass what is used"). The compiler finds every site that built an empty portfolio.
- **`shared/validation.ts`**: `startCashSchema` (int, min, max, `multipleOf(START_CASH_STEP)`); `goalSchema` (positive safe int); `goalAboveStart(goal, startCash)`; `stakesSchema = z.object({startCash, goal}).strict().refine(goalAboveStart, { path: ['goal'] })` for single play; `roomFormSchema` gets the same two fields from one shared shape and the same refine (zod 4: build both from a shared shape, do not `.extend` a refined object).
- **`shared/protocol/views.ts`**: in `roomSummarySchema` and `roomViewSchema` replace `profitTarget` by `goal` and add `startCash` (both `z.number().int()`). `client.ts` / `internal.ts` pick the new form up through `roomFormSchema`. The room is built from the form (`...form`), so `RoomInit` follows.
- **`worker/room/room-logic.ts`, `round.ts`, `ranking.ts`**: `RoomInit` has `startCash`, `goal`; `newSeat(member, startCash)`; `startRound(seats, now, durationMin, seed, startCash)` resets portfolio and `lastEquity` to the start; `reachedTarget` becomes `equity >= goal` (drops the `totalResult` import); `summary()` and `viewFor()` carry both numbers. Ranking, tie-break and elimination (equity 0) are unchanged.
- **`web/room/goal.ts`**: `parseGoal` becomes `parseWholeNumber(text)`; slider scale constants `GOAL_SLIDER_MAX = 1_000_000`, `GOAL_SLIDER_STEP = 1_000` (UI only, so not in `shared`); `bumpGoal(startCash, goalText)` returns `String(startCash + step)` only when the goal text is not above the new start.
- **`web/components/MoneyRange.vue`** (new): label, `<input type="range">` and a text field (`inputmode="numeric"`) bound to one text value; slider position clamps to its min/max while the text may go beyond; props for min, max, step, hint, error; `aria-describedby`, `role="alert"` on the error. Used four times (start and goal in two forms).
- **`web/room/create-form.ts`, `CreateRoomView.vue`, `SingleSetup.vue`**: fields `startText`, `goalText`; errors map `startCash` → `create.error.start`, `goal` → `create.error.goal`; a start change calls `bumpGoal`.
- **`web/single/loop.ts`, `useSinglePlay.ts`**: `SingleRound = { durationMs, startCash, goal }`; `DEFAULT_SINGLE_ROUND` from the new defaults; `createSingle` uses `newPortfolio(round.startCash)` and `peak: round.startCash`; `reachedGoal` is `equity >= goal` on the true price. "Play again" keeps all three values.
- **`web/room/countdown.ts`**: `targetProgress(total, target)` becomes `goalProgress(equity, startCash, goal)` = clamp((equity − start)/(goal − start), 0, 1); `SinglePlayView.vue` and `RoundPanel.vue` show `equity / goal` and set `aria-valuemin=startCash`, `aria-valuemax=goal`, `aria-valuenow=equity`. `RoundPanel` computes `total` from `view.startCash`; the end text "Total result {r} of the goal {g}" becomes capital against goal.
- **`web/components/LobbyPanel.vue`, `views/RoomsView.vue`**: add a start-capital entry next to the goal.
- **i18n (PL + EN)**: update `single.setup.*`, `create.*`, `create.error.*`, `single.resultMsg`, `rooms.*`, `lobby.*`; add start-capital keys. The locale completeness test guards both files.
- **Config**: none in `config.ts`; fixed ranges live in `rules.ts`.
- **Dependencies**: none.

### Fit with Project Docs
- **PRD**: BR-003 (capital no longer fixed), BR-005 (equity formula), BR-006, BR-008, BR-009 (goal = equity target) and decision 30 (target on total result) change; FR-004, FR-009, FR-011, FR-013, UF-002, UF-003, §13 Room table, glossary (Equity, Total result, Profit target → Goal) follow. New decision 45 supersedes the fixed $10,000 in BR-003 and the $20,000 minimum in decisions 7, 10, 44.
- **ARCHITECTURE.md**: no structural change. Rules stay in `shared` and `worker/room`; `web` sends intent only. The invariants "Server authority" and "Strict zod schemas" hold; the new fields are strict and validated again by the server.
- **CODE_QUALITY.md**: one source per knowledge — ranges in `rules.ts`, pair validation in `validation.ts`, ranking/end in `worker/room/`, UI text in i18n. `MoneyRange` is extracted because it has four uses. No class, no flag parameter.
- **Docs to update**: PRD §5 (BR-003/005/006/008/009), §11 UF-002/003, §12 FR-004/009/011/013, §13, §20 (new #45), glossary; ARCHITECTURE "Status" line unchanged; CODE_QUALITY known debt: add the balance note (fixed order sizes vs capital range).

### Alternative Approaches Considered
- **Start capital location in the engine** — A: `startCash` parameter on `equity`/`totalResult` at every call (more churn in ranking, round, loop, panels; easy to forget one). B: `startCash` inside `Portfolio` (chosen; one constructor). C: store only a cash offset (hides the meaning).
- **Goal on the wire** — A: keep `profitTarget` as profit (no wire change, but UI and rule ask for capital). B: keep the name, change the meaning (misleading). C: rename to `goal`, capital meaning (chosen).
- **Slider** — A: custom component (a11y cost). B: native range + text field (chosen). C: presets only (cannot express "no upper limit").

## Implementation Steps
1. [x] `shared/rules.ts`: add `DEFAULT_START_CASH`, `START_CASH_MIN/MAX/STEP`, `DEFAULT_GOAL`; remove `START_CASH` and `PROFIT_TARGET_MIN`
2. [x] `shared/engine/portfolio.ts`: `startCash` in `Portfolio`, `newPortfolio(startCash)` replaces `emptyPortfolio`, `equity`/`totalResult` use `p.startCash`
3. [x] `shared/validation.ts`: `startCashSchema`, `goalSchema`, `goalAboveStart`, `stakesSchema`, new `roomFormSchema` with `startCash` + `goal` and the refine on `goal`
4. [x] `shared/protocol/views.ts`: `goal` replaces `profitTarget`, `startCash` added to summary and room view; check `protocol/index.ts` exports
5. [x] Vitest `shared`: portfolio with several start values, validation matrix (bounds, step, goal ≤ start, huge goal, unknown field), protocol schemas
6. [x] `worker/room/round.ts`: `startRound` takes `startCash`; seats reset to `newPortfolio(startCash)` and `lastEquity = startCash`
7. [x] `worker/room/room-logic.ts`: `RoomInit.startCash` / `goal`; `newSeat(member, startCash)`; `summary()` and `viewFor()` carry both; `checkEnd` passes `goal`
8. [x] `worker/room/ranking.ts`: `reachedTarget(seat, price, goal)` is `equity >= goal`
9. [x] Vitest `worker`: update `validForm` and test-client helpers; room starts every seat at `startCash`; goal reached at equity; bankruptcy at 0; summary/view carry both; server rejects goal ≤ start with `INVALID_PAYLOAD`
10. [x] `web/room/goal.ts`: `parseWholeNumber`, slider constants, `bumpGoal`; `room/countdown.ts`: `goalProgress`
11. [x] `web/components/MoneyRange.vue` (slider + text field, i18n labels from props, a11y wiring) and its component test
12. [x] `web/room/create-form.ts` and `CreateRoomView.vue`: start and goal fields, errors, `bumpGoal` on start change
13. [x] `web/single/loop.ts`, `useSinglePlay.ts`, `SingleSetup.vue`: `SingleRound.startCash`, `newPortfolio`, `equity >= goal`, setup uses `MoneyRange` and `stakesSchema`
14. [x] `SinglePlayView.vue` and `RoundPanel.vue`: capital against goal, `goalProgress`, aria values; end-of-round message
15. [x] `LobbyPanel.vue`, `RoomsView.vue`: show start capital next to the goal
16. [x] i18n PL + EN for every changed or new key; locale completeness test green
17. [x] Vitest `web`: `goal.ts`, `create-form`, `SingleSetup`, `CreateRoomView`, `loop` (win at goal, restart keeps start), `useSinglePlay`, `RoundPanel` progress, `LobbyPanel` and `RoomsView` text
18. [x] `e2e/`: update `fixtures/four-players.ts` (room creation helper), `single-play.spec.ts`, `reconnect.spec.ts`, `a11y.spec.ts` to the new fields; mark "run on PR only"
19. [x] PRD: BR-003/005/006/008/009, UF-002/003, FR-004/009/011/013, §13, glossary, new decision 45; CODE_QUALITY known debt (balance note)
20. [x] Grep guard: no `START_CASH`, `PROFIT_TARGET_MIN`, `profitTarget`, `emptyPortfolio` left in `packages/` and `e2e/`

## Checkpoints (Todo List)
- [x] CP1 — Shared: steps 1-5; `shared` typecheck + Vitest green — 110 tests green, typecheck and eslint clean
- [x] CP2 — Worker: steps 6-9; `worker` typecheck + Vitest green (unit project; integration project if the user selects it) — typecheck clean, 333 tests green (`pnpm test` also ran the integration project), eslint clean
- [x] CP3 — Web logic: steps 10, 12 (logic part), 13, 17 (logic tests); `web` typecheck + Vitest green for `room/` and `single/` — web typecheck clean, 381 tests green
- [ ] CP4 — Web UI and texts: steps 11, 12, 14-16, 17 (component tests); `pnpm lint` clean, locale completeness green, manual check at 360 px and with keyboard only — eslint (web, shared) clean, locale completeness green, component tests green; manual 360 px / keyboard check NOT done (needs a browser; left for review)
- [x] CP5 — E2E sources and docs: steps 18-20; lint and typecheck clean across the workspace (e2e is not run here) — workspace lint and typecheck clean (e2e project included)
- [x] CP6 — Final light verification: lint, typecheck and all Vitest suites green; grep guard clean — lint clean, typecheck clean, shared 110, web 387, worker 333 (incl. integration) green; grep guard: the removed exports are gone, only test-local `const emptyPortfolio = newPortfolio(...)` helpers remain

### Risks & Mitigations
- Risk: **Balance.** Order sizes are fixed (up to 250 units at $100), so a $1,000 start with 250 units is 25× leverage (about a $4 drop is bankruptcy), while $100,000 makes the grind slow.
  - Mitigation: accepted for this ticket and written in CODE_QUALITY known debt; a later ticket can scale sizes to the capital.
- Risk: a site keeps assuming $10,000 (ranking, panels, tests) and shows wrong totals.
  - Mitigation: removing `START_CASH` and `emptyPortfolio` turns each into a compile error; step 20 greps; tests use a non-default start (e.g. 5,000).
- Risk: zod 4 refinements break `.strict()` / `z.infer` or the message union in `client.ts`.
  - Mitigation: shared shape, refine on the final object, protocol tests in step 5 cover `room.create` accept/reject.
- Risk: the goal text is overwritten by `bumpGoal` and surprises the user.
  - Mitigation: bump only when the goal is not above the new start; covered by a unit test.
- Risk: a huge goal (e.g. 10^15) breaks formatting or the progress bar.
  - Mitigation: `goalProgress` clamps; `Intl` formats big integers; validation test with a large safe integer; unsafe integers are rejected by zod.
- Risk: a room view with the old field name from an old client.
  - Mitigation: nothing is deployed yet (M6 release pending) and no state persists (BR-020).

## Test Strategy
- **Unit (Vitest, light):** `shared` portfolio and validation; `worker` `RoomLogic` with fake clock (start equity, goal reached, bankruptcy, summary/view fields, invalid form rejected); `web` pure modules (`goal.ts`, `create-form.ts`, `countdown.ts`, `loop.ts`), components (`MoneyRange`, `SingleSetup`, `CreateRoomView`, `RoundPanel`, `LobbyPanel`, `RoomsView`), locale completeness.
- **Worker integration:** the workerd project exercises `room.create` with the new form through `validForm`; run it if the user selects it.
- **E2E (Playwright, heavy, run on PR only):** `four-players` room creation with explicit start and goal, `single-play` setup with sliders, `reconnect` and `a11y` (axe on both setup screens, including the slider and its error).
- **Manual:** slider and text stay in sync; goal above the slider max; start raised above the goal moves the goal; keyboard (arrow keys on the range, Tab order); 360 px; PL and EN.
- **Light:** lint, typecheck, Vitest (implementation). **Heavy:** build, bundle check, Lighthouse and axe in review; Playwright on the PR.

## Success Checklist
At launch, verify:
- [ ] All success criteria met (with evidence)
- [ ] Lint, typecheck and Vitest clean in each touched package (implementation)
- [ ] Heavy checks green when run: production build, bundle ≤ 300 KB, axe on the new setup screens (review); Playwright (on the PR)
- [ ] Code review approved
- [ ] PRD and CODE_QUALITY updated as listed in "Fit with Project Docs"
- [ ] No regressions in single play and in a four-player round

## Timeline & Estimates
- Phase 1 (implementation): ~7 hours
- Phase 2 (testing): ~3 hours
- Phase 3 (review + polish): ~2 hours
- **Total**: ~12 hours (rough estimate, plus buffer)

## Open Questions
- [ ] Assumed, shout if wrong: the login tagline `app.goal` ("$10,000 → ?") stays as flavour text.

## Implementation Log
(Empty. first-million-implement appends one line per step event here, so work can resume in a new session. When running via first-million-flow, decisions from `AskUserQuestion` answers are also recorded here as `- Decision: <question>: <answer>`)
- Decision: workspace: current-branch (`feature/goal-and-setup` at `328e033`; pre-existing uncommitted work in many files, several of which this plan edits again)
- Decision: checks: lint, typecheck, unit tests
- Step 1 — started
- Resume (new session): branch is `main` @ `e222eed` (not `feature/goal-and-setup`), working in place; decision workspace current-branch and checks lint/typecheck/unit tests re-confirmed
- Step 1 — done — files: packages/shared/src/rules.ts — verified in tree: new constants present, `START_CASH` / `PROFIT_TARGET_MIN` removed
- Step 2 — started
- Step 2 — done — files: packages/shared/src/engine/portfolio.ts — `startCash` in `Portfolio`, `newPortfolio(startCash)`, `equity`/`totalResult` read `p.startCash`
- Step 3 — started
- Step 3 — done — files: packages/shared/src/validation.ts — `startCashSchema`, `goalSchema` (int, positive), `goalAboveStart`, `stakesSchema` (+ `Stakes` type), `roomFormSchema` with `startCash`/`goal` from one shared shape and the refine on `goal`
- Step 4 — started
- Step 4 — done — files: packages/shared/src/protocol/views.ts — `profitTarget` replaced by `goal`, `startCash` added to `roomSummarySchema` and `roomViewSchema`; `protocol/index.ts` needs no change (exports by schema name)
- Step 5 — started
- Step 5 — done — files: packages/shared/test/portfolio.test.ts, packages/shared/test/validation.test.ts, packages/shared/test/protocol.test.ts — non-default starts (1k/5k/100k), validation matrix (bounds, step, goal ≤ start, huge/unsafe goal, unknown key), stakesSchema, room.create accept/reject, summary/view carry `startCash`+`goal`. CP1 checks (ran inline, small): shared typecheck, Vitest 110/110, eslint packages/shared clean
- Step 6 — started
- Step 6 — done — files: packages/worker/src/room/round.ts — `startRound(..., startCash)` resets portfolio via `newPortfolio(startCash)` and `lastEquity = startCash`
- Step 7 — started
- Step 7 — done — files: packages/worker/src/room/room-logic.ts — `RoomInit.startCash`/`goal`, `newSeat(member, startCash)`, `summary()`/`viewFor()` carry both, `start()` passes `startCash`, `checkEnd` passes `goal`. Room DO needs no change (`...form` spread feeds `RoomInit`)
- Step 8 — started
- Step 8 — done — files: packages/worker/src/room/ranking.ts — `reachedTarget(seat, price, goal)` is `equity >= goal`; dropped `totalResult` import
- Step 9 — started
- Step 9 — done — files: packages/worker/test/room/{round,ranking,room-logic,round-engine}.test.ts, packages/worker/test/{security.test.ts,lobby/lobby-logic.test.ts,support/test-client.ts,integration/helpers.ts,integration/rooms.test.ts} — non-default start 5,000 in round/engine/room-logic tests, goal measured on equity, seats reset to `startCash`, summary/view carry both, integration: goal = start → `INVALID_PAYLOAD`. CP2 checks (inline): worker typecheck, `pnpm test` 333/333, eslint packages/worker clean
- Step 10 — started
- Step 10 — done — files: packages/web/src/room/goal.ts, packages/web/src/room/countdown.ts, packages/web/src/room/goal.test.ts, packages/web/src/room/countdown.test.ts — `parseWholeNumber`, `GOAL_SLIDER_MAX/STEP`, `bumpGoal` (text that is not a number stays as typed), `goalProgress(equity, startCash, goal)`; tests for both written here (part of step 17)
- Step 11 — started
- Step 11 — done — files: packages/web/src/components/MoneyRange.vue, packages/web/src/components/money-range.test.ts — props `id,label,min,max,step,hint,error` + `v-model` text; slider clamps, text may go beyond; hint/error ids derive from `id`; 8 component tests green
- Step 12 — started
- Step 12 — done — files: packages/web/src/room/create-form.ts, packages/web/src/views/CreateRoomView.vue, packages/web/src/room/goal.ts — `startText`/`goalText` (prefilled with `DEFAULT_START_CASH`/`DEFAULT_GOAL`), errors `create.error.start`/`create.error.goal`, `bumpGoal` on start change, two `MoneyRange` fields (ids `room-start`, `room-goal`); new i18n keys used here (`create.start/startHint/goal/goalHint`) are added in step 16. Added in goal.ts beyond the plan: `goalSliderMin(start)` (goal slider floor) and `parseStakes(startText, goalText)` (single-play check through `stakesSchema`; reuses the `create.error.*` keys)
- Step 13 — started
- Step 13 — done — files: packages/web/src/single/loop.ts, packages/web/src/single/useSinglePlay.ts, packages/web/src/components/SingleSetup.vue — `SingleRound.startCash`, `newPortfolio(round.startCash)`, `peak: round.startCash`, `reachedGoal` = equity ≥ goal; setup uses two `MoneyRange` + `parseStakes`; i18n keys `single.setup.startCash/startCashHint` added in step 16
- Step 14 — started
- Step 14 — done — files: packages/web/src/views/SinglePlayView.vue, packages/web/src/components/RoundPanel.vue — `equity / goal` text, `goalProgress`, aria min=`startCash` max=`goal` now=equity clamped; end text `single.resultMsg` now takes equity `{r}` and goal `{g}` (wording changes in step 16); RoundPanel total from `view.startCash`, observers rest at the start
- Step 15 — started
- Step 15 — done — files: packages/web/src/components/LobbyPanel.vue, packages/web/src/views/RoomsView.vue — start capital shown next to the goal (keys `rooms.startCash`, `rooms.goal`, `lobby.startCash`, `lobby.goal`; added in step 16)
- Step 16 — started
- Step 16 — done — files: packages/web/src/i18n/en.json, packages/web/src/i18n/pl.json — new `single.setup.startCash/startCashHint`, `create.start/startHint/goal/goalHint`, `create.error.start/goal`, `rooms.startCash/goal`, `lobby.startCash/goal`; removed `single.setup.goalError` (single reuses `create.error.*`), `create.target*`, `create.error.target`, `rooms.target`, `lobby.target`; `single.resultMsg` now equity against goal
- Step 17 — started
- Step 17 — done — files: packages/web/src/room/{create-form,goal,countdown}.test.ts, packages/web/src/single/{loop,useSinglePlay}.test.ts, packages/web/src/components/{money-range,round-panel,lobby-panel}.test.ts, packages/web/src/views/{create-room-view,single-view,rooms-view,room-view}.test.ts, packages/web/src/room/{lobby-state,room-state}.test.ts, packages/web/src/composables/composables.test.ts — non-default start 5,000 in loop/useSinglePlay/RoundPanel/single view; `RoundPanel` progress + observer; `LobbyPanel`/`RoomsView` show both numbers. Also changed `unrealized` in shared/portfolio.ts to take `Pick<Portfolio,'units'|'avg'>` (a wire `MeRound` has no `startCash`). Checks (inline): web typecheck, `pnpm test` 381/381, eslint packages/web + packages/shared clean
- Step 18 — started
- Step 18 — done — files: e2e/fixtures/four-players.ts, e2e/tests/single-play.spec.ts, e2e/tests/a11y.spec.ts — `RoomForm.startCash/goal`, exported `startField`/`goalField` (text field by role, since slider and text share a label), 3 new single-setup specs, axe on both forms with an error showing; written, NOT run (e2e runs on the PR). e2e tsc + eslint clean. `reconnect`/`round-4-players`/`latency` needed no change (form defaults = old 20,000 profit)
- Extra (user request mid-run): "remove back btn in settings" — files: packages/web/src/router/back.ts, packages/web/src/router/back.test.ts, e2e/tests/a11y.spec.ts — `/settings` no longer has a back link (logo still leads to the menu); a11y spec clicks the logo instead
- Extra (user request mid-run): "remove the info tooltip with the icon" — files: packages/web/src/components/InfoTip.vue (deleted), packages/web/src/views/SinglePlayView.vue, packages/web/src/i18n/{en,pl}.json — the only use was the trading hint in the single-play footer; keys `single.hint`/`single.hintLabel` removed
- Extra (user request mid-run): "warn before leaving a running game, with confirmation" — files: packages/web/src/composables/use-leave-guard.ts (new), packages/web/src/views/SinglePlayView.vue, packages/web/src/views/RoomView.vue, packages/web/src/i18n/{en,pl}.json (`leaveGame.*`), packages/web/src/test-support.ts (`mountAsRoute`), single-view.test.ts, room-view.test.ts — `onBeforeRouteLeave` + `ConfirmDialog`: single play asks while a round runs; a room asks a player still in a running round (not the lobby, observers, eliminated players or a closed room). Browser tab close/reload is not covered
- Step 19 — started
- Step 19 — done — files: docs/PRD.md, docs/CODE_QUALITY.md — BR-003/005/008/009, BR-006 (single play), UF-002/003/004, BP-003, FR-004/008/009/011/013, §13 Room table, glossary (Equity, Total result, Goal), decision 30 reworded, new decision 45; CODE_QUALITY known debt: balance note. ARCHITECTURE.md had no stale text
- Step 20 — started
- Step 20 — done — grep `profitTarget|PROFIT_TARGET_MIN|\bSTART_CASH\b|emptyPortfolio` over packages/ and e2e/ (all files): clean; no hard-coded `10_000` start outside `rules.ts` defaults (non-test sources)
- Final verification (CP5, CP6): workspace lint, typecheck and `pnpm test` green — shared 110/110, web 387/387, worker 333/333 (a parallel review run saw 2 worker integration timeouts; a solo rerun was 333/333, flaky under load). Web production build passes with dummy `VITE_FIREBASE_*` / `VITE_WORKER_URL` (main chunks ~145 KB gzip, budget 300 KB). Not run: e2e (PR), Lighthouse, axe, `bundle:check`. CP4 manual 360 px / keyboard check still open
- Extra (found in review, unlogged until now): `backFor` no longer returns a back link for `/single`, `/rooms/new` and `/rooms/:id` (only `/rooms` and `/privacy` keep one), and the in-room "Leave" link shown during a running round was removed from `RoomView.vue`; the lobby panel keeps its Leave button, and leaving a running round goes through the logo or menu with the leave guard (a dropped socket, 30 s grace, decision 41). Kept as is
- Review follow-ups applied (first-million-review): PRD FR-005 AC now 23–27% per news type (matches `news.test.ts`); PRD decision 20 marked superseded by #39; `reachedTarget` renamed `reachedGoal` (ranking.ts, room-logic.ts, ranking.test.ts); single play pauses while the leave dialog is open and resumes on cancel, a pause the player set stays (`SinglePlayView.vue`, 2 new tests in `single-view.test.ts`)
