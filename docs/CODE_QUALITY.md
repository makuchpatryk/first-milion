# Code quality

Rules First Million is written and reviewed against. **KISS and YAGNI first** (solo, ≤ 50 users, 0 PLN). Product: [PRD](./PRD.md). Structure: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Principles

- **KISS**: platform first (WebCrypto, `Intl`, `<canvas>`, native elements, `setInterval`). Runtime deps limited to Vue, vue-router, vue-i18n, Firebase Auth, zod. No chart/UI/state libraries. Dev-only tooling: Vitest, ESLint, Prettier, Playwright + `@axe-core/playwright` (e2e), `@lhci/cli` (Lighthouse), `smol-toml` and `yaml` (config and workflow tests).
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
| Lobby and room UI state, join labels, trade permission | `web/src/room/` reducers and `canTrade`, `joinPolicy` (mirrors the server's `assignRole`) |
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

- **M6 heavy checks were written, not run.** The Playwright specs, the axe spec, `check-bundle`, `check-no-emulator` on a real build, Lighthouse and both workflows have never run; their first run is in `first-million-review`. Assumptions to confirm there: the Auth emulator's project admin endpoint (`Bearer owner`) creates a verified user with a chosen `localId`; `page.routeWebSocket` proxies the room socket for the reconnect specs (the page is reloaded after installing it, and the in-page tap does not see that page's frames); `wrangler dev --var` accepts the three flags; the `firebase-auth` chunk split of Vite 8 (Rolldown `codeSplitting`).
- **Production values in `wrangler.toml` are the real release values** (Firebase project `first-milion`, Pages project and domain `https://first-milion.pages.dev`; the spelling with one `l` is the actual project name). Change them together with the Pages project name in `deploy.yml` and the Pages and Worker domains. `test/config.test.ts` only checks their shape.
- The login page is the only Lighthouse subject next to `/privacy`; the signed-in screens are covered by axe, not by Lighthouse (they need a session).

- `suffixNick` (`shared/validation.ts`) alone can exceed 16 characters; callers must use `uniqueNick` (`worker/room/roster.ts`), which cuts the base first. Fold the truncation into `suffixNick` if a second caller appears.
