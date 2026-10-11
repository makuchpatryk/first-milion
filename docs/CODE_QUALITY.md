# Code quality

Rules First Million is written and reviewed against. **KISS and YAGNI first** (solo, ≤ 50 users, 0 PLN). Product: [PRD](./PRD.md). Structure: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Principles

- **KISS**: platform first (WebCrypto, `Intl`, `<canvas>`, native elements, `setInterval`). Deps limited to Vue, vue-router, vue-i18n, Firebase Auth, zod. No chart/UI/state libraries.
- **YAGNI**: only PRD scope; nothing from PRD §10.3. No retries or timeouts beyond the PRD. Interfaces only as test seams (clock, RNG, socket, token verifier). Delete code with no caller.
- **DRY**: one source of truth (table below). Types via `z.infer`. Extract on the third copy.
- **Separation**: rules live in `shared` or `RoomLogic`, never in components, stores or `index.ts`. Client sends intent only.
- **Small units**: one job per function, consumer-declared types, pass what is used (`equity(player, price)`), no reaching through objects.
- **Composition**: functions and composables; no class hierarchies or mixins; no boolean-flag functions.

## Single sources of truth

| Knowledge | Lives in |
|---|---|
| Fixed rule values (BR-003) | `shared/rules.ts` |
| Tunables, tick length | `shared/config.ts` |
| Netting, equity, price, news | `shared/engine/` |
| Message shapes, error codes | `shared/protocol` |
| Nickname and room-form rules | `shared/validation.ts` |
| Ranking, end conditions | `worker/room/` |
| Admin UIDs, origins | Worker vars |
| UI text, error and news messages | `web/src/i18n/pl.json`, `en.json` |
| Design tokens | `web/src/styles/tokens.css` |

## Working agreements

- **TS**: `strict`; no `any`, `@ts-ignore` or unexplained `!`; exhaustive `switch` on unions.
- **Boundaries**: socket, `localStorage`, Firebase data is `unknown` until zod-parsed.
- **Errors**: server replies with `ErrorCode`, never throws across the socket; never match message text.
- **Determinism**: no `Math.random()`/`Date.now()` in `shared` or `RoomLogic`.
- **No persistence**: no DO storage, KV, D1, R2; browser stores only language.
- **Cleanup**: every interval, listener and animation frame stopped on end, close and unmount.
- **Privacy/safety**: never log or broadcast email, UID, token; no `v-html`.
- **UI**: no literal text (i18n keys, PL + EN); keyboard operable; `prefers-reduced-motion`; 360 px.
- **Vue**: `<script setup lang="ts">`; logic in composables or `shared`.
- **Comments**: why, not what; cite BR/FR or decision number.
- **Tests**: one behaviour per case, name states the rule, cite BR/FR; seeded RNG, fake clock, no sleeps.

## Review checklist

1. Simpler way? Platform already does it?
2. Every line serves a PRD requirement?
3. Knowledge in two places? Literal that belongs in `rules.ts`, `config.ts` or i18n?
4. Right package? Import boundaries kept?
5. Server authority, strict schemas, role/state checks kept?
6. Timers/listeners cleaned; nothing sensitive logged; no persistence?
7. PL + EN keys, keyboard, 360 px?
8. Tests for the logic; lint and typecheck clean; heavy checks run in review if flow, protocol or UI changed.

## Known debt

- `suffixNick` (`shared/validation.ts`) can exceed 16 characters; room join must truncate or reject (M3).
