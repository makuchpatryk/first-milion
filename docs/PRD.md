# First Million — PRD

**Version:** 1.2 | **Date:** 2026-10-11 | **Status:** Ready for implementation

Product name: **First Million** (previously the working title "Szybka Giełda"). Reference for simulation rules: the existing prototype `Szybka Giełda.html` (single play, plain JS). The product is built from scratch; the prototype serves as a pattern for rules, while the look is new (section 16). Values marked as "tunable" in the Decisions Log are constants in `shared/config.ts`.

# Part I — Business

## 1. Problem & Goal
- **Who has the problem:** The project author (solo developer) needs a public, working demo of a real-time application. Friends and portfolio viewers have no simple stock-trading game for quick competition.
- **Current solution / workaround:** A single-player prototype in one HTML file, with no accounts, no multiplayer, and no publication.
- **Cost of the problem:** No way to play with friends or to present the project as a running application.
- **Goal / target outcome:** A public web application with single play and multiplayer (rooms of up to 4 players), email + password login, a list of open rooms, run at 0 PLN cost.
- **Why now:** The prototype exists and has confirmed the mechanics; the author wants to move to the multiplayer version.

## 2. Value Proposition
- **For:** the author's friends and portfolio viewers (up to 50 concurrent users).
- **Who need:** a short, competitive stock-market game with no waiting and no financial risk.
- **The product:** a web game simulating a market with one shared price for all players in a room.
- **Unlike current solution:** (the prototype) it allows playing with others, has a round ranking, a server-computed price, and a choice of open rooms.

## 3. Users & Roles
| Role / Persona | Goals | Pays / Uses | Permissions |
|----------------|-------|-------------|-------------|
| Player | Play solo or in a room, win a round | Uses, does not pay | Single play; create a room (becomes host); join rooms; change own nickname; delete own account |
| Room host (player) | Configure and start a round | Uses | Sets name, duration, profit target, speed; starts a round; starts the next round |
| Observer | Watch a round | Uses | Sees the chart and ranking; cannot trade |
| Admin | Moderate | Uses | Closes any room; kicks a player from a room (no ban) |

The admin is defined by a list of account UIDs in server configuration (`ADMIN_UIDS` variable). There is no UI for assigning roles.

## 4. Business Model & Monetization
- **Revenue model:** none. The application is entirely free.
- **Pricing:** N/A — confirmed by user.
- **Trial / free plan:** the whole application is free.
- **Refunds / cancellation:** N/A — confirmed by user.
- **Cost drivers:** Cloudflare free plans (Workers, Durable Objects, Pages) and Firebase Auth. Target cost: 0 PLN per month.

## 5. Business Rules

### BR-001: Login required
- **Rule:** The system must require a logged-in account for every game mode (single play and multiplayer) and for viewing the room list.
- **Applies to:** all roles.
- **Exceptions:** none.

### BR-002: Email verification
- **Rule:** The system must block access to the game and to the real-time server for accounts with an unverified email address. The password must have at least 8 characters. An account must be able to reset its password by email.
- **Applies to:** Player, Admin.
- **Exceptions:** none.

### BR-003: Game parameters (shared by single and multi)
- **Rule:** Starting capital must be $10,000. Starting price must be $100. Minimum price must be $5. Order sizes must be chosen from {10, 50, 100, 250} units. The spread must be $0.06 per trade (half the spread added to the price on buys, subtracted on sells).
- **Applies to:** all modes.
- **Exceptions:** none.

### BR-004: Position netting
- **Rule:** Buy and sell operate on a single net position. An order opposite to the position reduces it; any excess opens the opposite position at the execution price. An order in the position's direction increases it and averages the entry price. "Close" closes the entire position. Closing or reducing a position realizes P&L and increments the closed-trades counter; a trade with a result > 0 counts as a win.
- **Applies to:** all modes.
- **Exceptions:** none.

### BR-005: Equity and bankruptcy
- **Rule:** Equity = 10,000 + realized P&L + open (unrealized) P&L. When equity ≤ 0, the system must close the position at market price (including spread) and mark the player as bankrupt. In single play, a "Margin call" screen is shown with a restart option. In multiplayer, the player is eliminated (BR-012).
- **Applies to:** all modes.
- **Exceptions:** none.

### BR-006: Single play
- **Rule:** Single play must run only in the browser (local simulation from the shared `shared` package), with no time limit, with 1×/3×/8× speed and pause as in the prototype. Single play results must not be stored anywhere.
- **Applies to:** Player.
- **Exceptions:** none.

### BR-007: Price and execution in multiplayer
- **Rule:** The server must generate one price for everyone in the room. The client sends only the order (side, size, or "close"). The execution price must be the server price at the moment the order is received, adjusted by the spread. The client must not send a price. The server computes positions, equity, and ranking.
- **Applies to:** multiplayer.
- **Exceptions:** none.

### BR-008: Round parameters
- **Rule:** When creating a room the host must choose: round duration {3, 5, 10} minutes (always mandatory, wall-clock time), speed {1×, 3×, 8×} fixed for the whole round, and optionally a profit target in dollars: an integer ≥ 100, with no upper limit. A room without a profit target is allowed. Pause and speed changes during a round must be unavailable.
- **Applies to:** Host.
- **Exceptions:** none.

### BR-009: Round end and winner
- **Rule:** A round must end when (a) the round time elapses or (b) the first player reaches the profit target (total result = equity − 10,000 ≥ target). In case (b) that player is the winner. In case (a) the winner is the player with the highest equity. If several players reach the target on the same tick, the one with higher equity wins; equal equity = shared first place. The target is checked after every tick and after every order.
- **Applies to:** multiplayer.
- **Exceptions:** if all players are eliminated, the round ends immediately.

### BR-010: Tie-break
- **Rule:** With equal final equity, the player who reached that equity value earlier wins (server timestamp of the first moment from which equity holds the final value). Eliminated players have equity 0 and share the last places (the tie-break rule does not apply to them).
- **Applies to:** multiplayer.
- **Exceptions:** none.

### BR-011: Room capacity
- **Rule:** A room must hold at most 4 players and at most 4 observers at the same time. When slots are full, joining in that role must be rejected.
- **Applies to:** everyone.
- **Exceptions:** none.

### BR-012: Joining and elimination
- **Rule:** Joining as a player is possible only when the room is in the "lobby" state (before a round starts or after it ends). In the "running" state the joiner is an observer. An observer cannot become a player in the same visit; to play, they must leave and rejoin while the room is in the "lobby" state. An eliminated player (bankruptcy or disconnect timeout) stays in the room as an observer and sees the ranking. A kicked player may rejoin (no bans).
- **Applies to:** everyone.
- **Exceptions:** none.

### BR-013: Host
- **Rule:** The room creator is the host. Only the host can start a round (minimum 1 player in the room) and start the next one after returning to the lobby. When the host leaves, the host role must pass to the next player (by join order); a running round continues. When there are no players but there are observers, the earliest-joined observer receives the host role.
- **Applies to:** Host.
- **Exceptions:** none.

### BR-014: Room lifecycle
- **Rule:** After a round ends, the room must return to the "lobby" state with the last round's ranking visible (until the next one starts). A room with no people must be deleted after 5 minutes. All rooms are public and visible on the list; private rooms and room codes do not exist.
- **Applies to:** system.
- **Exceptions:** none.

### BR-015: News
- **Rule:** The system must draw news events in both modes. Interval to the next news: random 250–650 ticks (the first: 200–400 ticks). Type drawn with equal probability (20% each): SHOCK (random direction ±, size 1.2–3.2% immediate price change), FLASH_CRASH (sudden drop of 3–8%, recovering 70% of the drop over the next 20 ticks), VOL_SPIKE (volatility ×3 for 60 ticks, no direction), TRADING_HALT (5 s with no ability to place orders; displayed price frozen, simulation keeps running, after resume the price jumps to the current one), TREND (random direction, drift ±0.0007 per tick for 100 ticks, replaces the regime drift). In multiplayer the same news is sent to everyone.
- **Applies to:** system.
- **Exceptions:** none.

### BR-016: Nickname
- **Rule:** On first login the system must assign a random default nickname in the format `Trader-NNNN` (4 digits). The player can change it in settings and before entering a room. A nickname must be 3–16 characters from `A-Z a-z 0-9 _ -`. No profanity filter. The nickname is stored in the account profile (Firebase `displayName`). The email must not be visible to other players. On a nickname collision in a room, the system must append `#2`, `#3`, etc. to the later player's nickname.
- **Applies to:** Player.
- **Exceptions:** none.

### BR-017: Moderation
- **Rule:** The admin must be able to close any room (players are disconnected with a message) and kick a player from a room. There are no bans or persistent moderation records.
- **Applies to:** Admin.
- **Exceptions:** none.

### BR-018: Order rate limit
- **Rule:** The server must reject orders above 10 per second per player with the error code `RATE_LIMITED`, without disconnecting.
- **Applies to:** multiplayer.
- **Exceptions:** none.

### BR-019: Disconnection
- **Rule:** A player disconnected during a round keeps their position and equity on the server for 30 seconds (the simulation continues; the position is subject to price changes). Returning within 30 s restores play. After 30 s the player is eliminated as in BR-012 (position closed at market price, ranked after active players).
- **Applies to:** multiplayer.
- **Exceptions:** none.

### BR-020: No persistent storage
- **Rule:** The system must not store results, rankings, trade history, or any global ranking. Game data exists only in room memory and in the browser. The only persistent data is the Firebase account (email, UID, nickname).
- **Applies to:** system.
- **Exceptions:** none.

### BR-021: Privacy
- **Rule:** The system must provide a privacy policy (PL and EN) and an account deletion button (with re-authentication). Email is used only for authentication.
- **Applies to:** Player.
- **Exceptions:** none.

## 6. Business Processes

### BP-001: Registration and first entry
1. The user opens the site; without a session they see the login/registration screen.
2. They register an email + password account (≥ 8 characters). Firebase sends a verification email.
3. Until verified they see a "Verify your email" screen with a resend option; the game is unavailable.
4. After verification the system assigns a random nickname `Trader-NNNN` (if `displayName` is empty) and opens the main menu (Single play / Rooms).
- **Statuses & allowed transitions:** logged out → unverified → verified.
- **Exceptions:** wrong password, email taken, password reset by email.
- **Related rules:** BR-001, BR-002, BR-016.

### BP-002: Multiplayer round
1. The host creates a room (name 3–30 characters, duration, optional target, speed). The room appears on the list with status "lobby".
2. Players (up to 4) join. Observers (up to 4) can join at any time.
3. The host starts the round. Status → "running". The server generates the price and news and computes positions.
4. Players place orders; the ranking updates live.
5. End: per BR-009. The server sends the final ranking and the winner.
6. The room returns to "lobby"; the host can start the next round.
- **Statuses & allowed transitions:** room: lobby → running → lobby; deleted after 5 min with no people (BR-014). Player: active → eliminated (bankruptcy / disconnect timeout).
- **Exceptions:** host leaves (BR-013), disconnection (BR-019), room closed by admin (BR-017).
- **Related rules:** BR-007–BR-015, BR-018, BR-019.

### BP-003: Browsing and choosing rooms
1. The player opens the room list (updated live).
2. For each room they see: name, host, players x/4, round duration, profit target (or "none"), speed, status (lobby / running).
3. They pick a room: in "lobby" with a free slot they join as a player; in "running" or with full player slots they join as an observer (if < 4 observers).
- **Exceptions:** the room disappeared or filled up during joining → message and list refresh.
- **Related rules:** BR-011, BR-012, BR-014.

## 7. Assumptions & Risks
### Assumptions (stated by user)
| # | Assumption | Validation method |
|---|------------|-------------------|
| A1 | The Cloudflare and Firebase free limits will be enough for about 50 players | Monitor usage in provider dashboards after launch |
| A2 | A quick game with a random price is engaging enough in multiplayer | Test with 4 friends |
| A3 | Required login will not discourage friends | Observe during first tests |

### Risks
| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| R1 | Exceeding free limits (cost > 0 PLN) | Cost or service shutdown | Limits: 4 players + 4 observers per room; order limit 10/s; empty rooms removed after 5 min; monitoring |
| R2 | Nicknames without a profanity filter on the public list | Offensive content | Admin closes the room and kicks the player |
| R3 | Multi-accounts and bots | Room clutter | Email verification; order rate limit; results are not stored |

## 8. Success Metrics
| KPI | Target | Timeframe | Measurement |
|-----|--------|-----------|-------------|
| Multiplayer stability | A 4-player round runs to the end without errors | 3 months after launch | Playwright e2e test (4 contexts) and manual test with 4 people |

## 9. Constraints
- Hosting cost: 0 PLN or close to zero.
- Team: solo, no fixed deadline.
- Scale: up to 50 concurrent users.
- No persistent storage of game data (BR-020).
- Legal: GDPR (email in Firebase), privacy policy, account deletion (BR-021).

# Part II — Product

## 10. Scope
### 10.1 MVP
- Email + password login, email verification, password reset, account deletion.
- Random nickname with the option to change it.
- Single play (browser) with all prototype mechanics and the new news events.
- Multiplayer: live room list, room creation, lobby, round, live ranking, results, observers.
- Admin controls in the UI: close room, kick player.
- PL + EN interface, WCAG 2.1 AA, mobile-first.
- Privacy policy.
### 10.2 Post-MVP
- No items defined (confirmed by user).
### 10.3 Out of Scope
- Private rooms and room codes.
- Persistent ranking, result history, account statistics.
- Payments, ads, premium.
- Profanity filter, account bans.
- Login via Google/GitHub.
- Native apps.
- Pause and speed change in multiplayer.
- Player trades influencing the price.
- Light theme (dark theme only in the MVP).

## 11. User Flows

### UF-001: Registration and login
1. Form: email, password, "Log in / Register" toggle, "Forgot password" link.
2. After registration, a "Verify your email" screen with "Resend" and "I've verified" buttons.
3. After verification, the main menu.
- **Error states:** wrong credentials, email taken, password < 8 characters, no network.
- **Empty states:** N/A.

### UF-002: Single play
1. Menu → "Single play". Screen as in the prototype: chart, stats, size, speed, pause, Buy/Close/Sell, history of the last 8 trades, footer (trades, win rate, equity record).
2. Margin call → "Play again".
- **Error states:** N/A.
- **Empty states:** history: "You haven't closed anything yet."

### UF-003: Room list and room creation
1. Menu → "Rooms": live list + "Create room" button.
2. Form: name (3–30), duration {3,5,10}, speed {1×,3×,8×}, profit target (optional, integer ≥ 100 $).
3. After creation the user enters the lobby as host.
- **Error states:** field validation; server error.
- **Empty states:** "No open rooms. Create your own."

### UF-004: Lobby and round
1. Lobby: name, parameters, list of players and observers (host marked). The host sees "Start".
2. Round: chart, equity, position, buttons, countdown timer, profit target (if set), live ranking, news bar.
3. Results: places, equity, winner; return to the lobby.
- **Error states:** disconnection ("Reconnecting…" banner, 30 s countdown), `RATE_LIMITED`, `HALTED`, room closed by admin.
- **Empty states:** N/A.

### UF-005: Observer
1. Joining a room during a round (or when no player slots remain).
2. Sees the chart, news, timer, and ranking; trading buttons hidden.

### UF-006: Account settings
1. Change nickname (BR-016 validation), PL/EN language switch, link to the privacy policy, "Delete account" (with password re-entry), "Log out".

## 12. Functional Requirements

### FR-001: Registration, login, verification, password reset
- **Implements:** BR-001, BR-002, BP-001
- **Description:** The system must use Firebase Auth (email + password), send a verification email, and support password reset.
- **Inputs / validation:** syntactically valid email; password ≥ 8 characters.
- **Edge cases:** expired token (refresh), unverified user trying to enter the game.
- **Acceptance criteria:**
  - Given a logged-out user, when they open the app, then they see the login form and do not see the game or room list.
  - Given an unverified account, when the user tries to enter the game, then they see the verification screen.
  - Given a 7-character password, when registering, then a validation error is shown.

### FR-002: Nickname
- **Implements:** BR-016
- **Description:** The system must assign a random nickname `Trader-NNNN` on first entry and allow changing it, saved in `displayName`. The client must send the nickname in the `join` message; the server must validate it with `^[A-Za-z0-9_-]{3,16}$`.
- **Inputs / validation:** as above.
- **Edge cases:** collision in a room (suffix `#2`).
- **Acceptance criteria:**
  - Given a new account, when first entry, then the nickname matches `Trader-\d{4}`.
  - Given the nickname "ab", when saving, then a validation error is shown.
  - Given two players named "Jan" in a room, when the second joins, then they see "Jan#2".

### FR-003: Simulation engine (`shared` package)
- **Implements:** BR-003, BR-004, BR-005, BR-015
- **Description:** The system must provide pure, deterministic (with an injected random generator) functions: price step (geometric Brownian motion with drift and volatility regimes as in the prototype: drift `(rand−0.5)·0.0014`, volatility `0.0006+rand·0.0018`, regime 40–180 ticks, minimum price 5), order execution with netting and spread, equity, news.
- **Inputs / validation:** side ∈ {BUY, SELL, CLOSE}; size ∈ {10, 50, 100, 250}.
- **Edge cases:** position reversal; bankruptcy; CLOSE with no position (no effect).
- **Acceptance criteria:**
  - Given position +50 @ 100, when SELL 100 at price 101, then P&L realized for 50 units, position −50, entry price = execution price.
  - Given equity ≤ 0, when tick, then the position is closed and the bankruptcy flag is set.

### FR-004: Single play
- **Implements:** BR-006, BR-015
- **Description:** The system must run the FR-003 engine in the browser every 80 ms with `speed` steps, with pause, B/S/C keys, and all UI elements from the prototype.
- **Edge cases:** pausing during TRADING_HALT stops the countdown.
- **Acceptance criteria:**
  - Given speed 8×, when 80 ms elapse, then 8 price steps execute.
  - Given a margin call, when "Play again", then the state is the initial one.
  - Given the tab is closed, when re-entering, then no saved results exist.

### FR-005: News
- **Implements:** BR-015
- **Description:** The system must draw and apply five news types (SHOCK, FLASH_CRASH, VOL_SPIKE, TRADING_HALT, TREND), show a message in the news bar (PL/EN, i18n keys, parameters passed from the server), and highlight it green/red by direction (neutral for VOL_SPIKE and TRADING_HALT). The news bar fades after 90 ticks.
- **Edge cases:** overlapping news (a new news event replaces the previous effect; interval ≥ 250 ticks).
- **Acceptance criteria:**
  - Given TRADING_HALT, when active, then the Buy/Sell/Close buttons are disabled for 5 s and the server rejects orders with `HALTED`.
  - Given FLASH_CRASH, when it occurs, then the price drops 3–8% and after 20 ticks 70% of the drop is recovered.
  - Given 10,000 draws, when checking the type distribution, then each type is within 18–22%.

### FR-006: Main menu
- **Implements:** BR-001
- **Description:** After login the system must show a choice of "Single play" and "Rooms", the nickname, settings, and logout.
- **Acceptance criteria:**
  - Given a verified user, when entering, then they see both modes.

### FR-007: WebSocket authorization
- **Implements:** BR-001, BR-002
- **Description:** The Worker must verify the Firebase ID token (RS256 signature against Firebase JWKS keys, `aud`, `iss`, `exp`) and the claim `email_verified = true`. The token must be sent in the first `auth` message after the WebSocket opens (not in the URL). Without valid authorization within 5 s the connection must be closed. The server must check the `Origin` header against an allowlist (the Pages domain).
- **Edge cases:** token expires mid-session (client refreshes and sends `auth` again without interrupting the game).
- **Acceptance criteria:**
  - Given a token of an unverified account, when `auth`, then the connection is closed with code 4401.
  - Given a wrong `Origin`, when upgrading, then it is rejected.

### FR-008: Lobby (room list)
- **Implements:** BP-003, BR-014
- **Description:** The `Lobby` Durable Object must keep the room list in memory. Each `Room` must register on creation, send an update on every change (status, player/observer counts, host), and send a heartbeat. `Lobby` must remove rooms with no heartbeat and broadcast changes to clients subscribed to the list over WebSocket.
- **Inputs / validation:** entry fields: `roomId`, `name`, `hostNick`, `players`, `maxPlayers=4`, `observers`, `durationMin`, `profitTarget|null`, `speed`, `status`.
- **Edge cases:** `Lobby` restart — rooms re-register on the next heartbeat.
- **Acceptance criteria:**
  - Given a new room, when created, then within ≤ 2 s it is visible on the list to all subscribers.
  - Given a room with no heartbeat, when 3× the interval elapses, then it is removed from the list.

### FR-009: Room creation
- **Implements:** BR-008, BR-013, BR-014
- **Description:** The system must create a room (`Room` Durable Object) with the form parameters and set the creator as host.
- **Inputs / validation:** name 3–30 characters; duration ∈ {3,5,10}; speed ∈ {1,3,8}; profit target: empty or integer ≥ 100.
- **Edge cases:** target 99 → error; target 1,000,000 → allowed.
- **Acceptance criteria:**
  - Given a valid form, when "Create", then the user is in the lobby as host.
  - Given target 50, when "Create", then a validation error is shown and no room is created.

### FR-010: Joining a room
- **Implements:** BR-011, BR-012, BR-016
- **Description:** The system must assign the role per BR-012 and BR-011 and apply the nickname-collision suffix. Full slots → error `ROOM_FULL`.
- **Acceptance criteria:**
  - Given a lobby room with 3 players, when a user joins, then they are a player.
  - Given a "running" room, when a user joins, then they are an observer.
  - Given 4 observers, when another joins, then `ROOM_FULL`.

### FR-011: Round start and progression
- **Implements:** BR-007, BR-008, BR-009, BR-015, BP-002
- **Description:** On the host's command (`start`, min. 1 player) `Room` must set each player's equity to $10,000 and the price to $100, run a tick loop every 80 ms with `speed` steps, and broadcast state (price, own positions, ranking, news, remaining time). Round time is measured by wall clock.
- **Edge cases:** `start` from a non-host → `FORBIDDEN`; `start` during a round → `INVALID_STATE`.
- **Acceptance criteria:**
  - Given a lobby, when the host sends `start`, then the status is "running" and everyone receives the same price stream.
  - Given a non-host, when `start`, then `FORBIDDEN`.

### FR-012: Orders in multiplayer
- **Implements:** BR-003, BR-004, BR-007, BR-018
- **Description:** The server must accept `order {side, qty}` and `close`, execute at the server price at the moment of receipt (+/− half the spread), and respond with a confirmation or an error (`RATE_LIMITED`, `HALTED`, `ELIMINATED`, `INVALID_STATE`, `INVALID_PAYLOAD`).
- **Inputs / validation:** `qty ∈ {10,50,100,250}`; messages validated against a schema; unknown fields rejected.
- **Edge cases:** order from an observer or eliminated player → `FORBIDDEN`/`ELIMINATED`.
- **Acceptance criteria:**
  - Given 11 orders in 1 s from one player, when processed, then the 11th is rejected with `RATE_LIMITED`.
  - Given a client sends a `price` field, when validated, then `INVALID_PAYLOAD`.

### FR-013: Live ranking and round end
- **Implements:** BR-005, BR-009, BR-010
- **Description:** The server must broadcast the ranking (nickname, equity, status) every tick, detect end conditions, and send the final result. After the result the room returns to "lobby".
- **Edge cases:** all players eliminated; target reached by two players on the same tick.
- **Acceptance criteria:**
  - Given a $500 target and a player with total result ≥ 500, when tick, then the round ends and they are the winner.
  - Given time elapses without the target being reached, when the end occurs, then the winner is the highest equity.
  - Given equal equity, when the end occurs, then the player who reached that value earlier wins.

### FR-014: Elimination and spectating
- **Implements:** BR-005, BR-012
- **Description:** An eliminated player must become an observer in the same room, have buttons disabled, and see the ranking.
- **Acceptance criteria:**
  - Given equity ≤ 0, when tick, then the player is marked eliminated and the ranking shows them last with equity 0.

### FR-015: Disconnection and return
- **Implements:** BR-019
- **Description:** The system must keep the player's state for 30 s after disconnection, resume it after a new `auth` + `join` to the same room, and eliminate the player after 30 s.
- **Acceptance criteria:**
  - Given a 10 s disconnection, when returning, then position and equity are unchanged apart from price movement.
  - Given a 31 s disconnection, when returning, then the player is an observer.

### FR-016: Host and leaving a room
- **Implements:** BR-013, BR-014
- **Description:** When the host leaves, the role must pass per BR-013. An empty room must be deleted after 5 min and deregistered from `Lobby`.
- **Acceptance criteria:**
  - Given the host leaves, when other players remain, then the next player is host and the round continues.
  - Given a room empty for 5 min, when the time elapses, then the room disappears from the list.

### FR-017: Admin controls in the UI
- **Implements:** BR-017
- **Description:** For UIDs in `ADMIN_UIDS` the UI must show "Close room" on the list and "Kick" next to a player in a room. The server must check the UID on every admin action.
- **Acceptance criteria:**
  - Given a non-admin, when they send `admin.closeRoom`, then `FORBIDDEN`.
  - Given an admin closes a room, when confirmed, then everyone in the room receives `ROOM_CLOSED` and the room disappears from the list.
  - Given a kicked player, when they try to rejoin, then they can join.

### FR-018: Account and privacy
- **Implements:** BR-021
- **Description:** The system must provide a privacy policy page (PL/EN; scope: email and nickname in Firebase, Cloudflare as infrastructure, no result storage) and account deletion with re-authentication.
- **Acceptance criteria:**
  - Given a logged-in user, when "Delete account" and the correct password, then the account is deleted and the user is logged out.

### FR-019: Internationalization
- **Implements:** goal (PL + EN)
- **Description:** All texts (including news and server errors by code) must be in `vue-i18n` with PL and EN. Default language from `navigator.language` (`pl*` → PL, otherwise EN); manual switch stored in `localStorage`. Numbers and currency are formatted per `pl-PL` in PL and `en-US` in EN.
- **Acceptance criteria:**
  - Given a browser set to `en-GB`, when first entry, then the UI is in English.

### FR-020: Theme and layout
- **Implements:** goal (mobile-first)
- **Description:** The UI must use the dark theme from section 16 (single-column layout) and work from 360 px width.
- **Acceptance criteria:**
  - Given a 360×640 viewport, when on the game screen, then there is no horizontal scrolling and all buttons are reachable.

# Part III — Technical

## 13. Data Model
There is no database (BR-020). The entities below exist only in memory.

### User (Firebase Auth, external)
| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| uid | string | yes | unique | |
| email | string | yes | | not visible to other players |
| emailVerified | boolean | yes | must be true | |
| displayName | string | yes | `^[A-Za-z0-9_-]{3,16}$` | nickname |

- **Retention / deletion:** until the user deletes the account.

### Room (Durable Object memory)
| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| id | string | yes | unique | |
| name | string | yes | 3–30 characters | |
| hostUid | string | yes | | |
| durationMin | 3\|5\|10 | yes | | |
| profitTarget | number\|null | yes | integer ≥ 100 or null | |
| speed | 1\|3\|8 | yes | | |
| status | `lobby`\|`running` | yes | | |
| players | Player[] | yes | ≤ 4 | |
| observers | Observer[] | yes | ≤ 4 | |
| price, priceHistory, tick, newsState | mixed | yes | history ≤ 2400 points | |
| roundEndsAt | timestamp\|null | no | | |

### Player
| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| uid, nick | string | yes | nick per BR-016 | |
| position, avgPrice | number | yes | | |
| realized | number | yes | | |
| closedTrades, wins | number | yes | | |
| status | `active`\|`eliminated`\|`disconnected` | yes | | |
| disconnectedAt | timestamp\|null | no | 30 s | |
| reachedEquityAt | timestamp | yes | for BR-010 | |

- **Relations:** Room 1—N Player, Room 1—N Observer; Lobby 1—N room entries.
- **Retention / deletion:** removed from memory when leaving the room or when the room is deleted.

## 14. Auth & Access Control
- **Method:** Firebase Auth, email + password. The Worker verifies the ID token (FR-007).
- **Session:** Firebase session on the client; token refreshed automatically; the WebSocket connection re-authenticated after refresh.
- **Access matrix:**
| Resource / Action | Logged out / unverified | Player | Host | Admin |
|-------------------|-------------------------|--------|------|-------|
| Single play | no | yes | yes | yes |
| Room list | no | yes | yes | yes |
| Create room | no | yes | yes | yes |
| Join room | no | yes | yes | yes |
| Start round | no | no | yes | no (unless they are the host) |
| Close any room | no | no | no | yes |
| Kick a player | no | no | no | yes |

## 15. Integrations
| Service | Purpose | Data exchanged | Failure handling |
|---------|---------|----------------|------------------|
| Firebase Auth | Accounts, email verification, password reset | email, password (handled by Firebase), ID token, displayName | Error message in UI, retry |
| Firebase JWKS | Verifying token signatures in the Worker | public keys | Key cache; if keys are unavailable, `auth` is refused |
| Cloudflare Workers + Durable Objects | WebSocket, rooms, lobby | game messages | Client: automatic reconnect with backoff |
| Cloudflare Pages | Frontend hosting | static files | N/A |

## 16. Platforms & UI
- **Platforms:** web (modern browsers).
- **Responsiveness:** mobile-first, minimum 360 px.
- **Languages:** Polish and English.
- **Accessibility:** WCAG 2.1 AA (contrast, keyboard operation, ARIA roles/attributes, `prefers-reduced-motion`).
- **Design:** dark theme, the only one in the MVP. Tokens: background `#07090d`, surface `#0f141b`, border `#1c2530`, text `#e6edf3`, muted text `#7d8a99`, up `#2ee59d`, down `#ff5d6c`, accent (gold) `#f5c451`. Fonts: Space Grotesk (UI and headings), JetBrains Mono (numbers). Canvas chart with right-hand price axis and entry line as in the prototype `Szybka Giełda.html`. Mockups: clickable "First Million" prototype.

## 17. Non-Functional Requirements

### NFR-001: Multiplayer latency
- **Requirement:** Time from sending an order to confirmation ≤ 300 ms (p95) in a room with 4 players.
- **Verification:** e2e test measuring round-trip time.

### NFR-002: Cost
- **Requirement:** Everything must run within the Cloudflare and Firebase free plans at 50 concurrent users.
- **Verification:** review usage in dashboards after tests with 4 rooms × 4 players.

### NFR-003: Accessibility
- **Requirement:** WCAG 2.1 AA conformance.
- **Verification:** automated audit (axe) in Playwright + manual keyboard test.

### NFR-004: Security
- **Requirement:** the server trusts no numeric data from the client (prices, results); all messages validated against a schema; token not in the URL; `Origin` check; limit of 10 orders/s per player.
- **Verification:** unit tests of validation and e2e.

### NFR-005: Client performance
- **Requirement:** Largest Contentful Paint ≤ 2.5 s on a 4G connection; JS bundle ≤ 300 KB (gzip).
- **Verification:** Lighthouse in CI.

### NFR-006: Stability
- **Requirement:** a 4-player round (10 min, speed 8×) runs to the end with no errors and no loss of synchronization.
- **Verification:** Playwright e2e test with 4 contexts.

## 18. Tech Stack
| Layer | Choice | Version (if fixed) |
|-------|--------|--------------------|
| Language | TypeScript | — |
| Frontend | Vue 3 + Vite, vue-i18n, Canvas 2D (chart) | — |
| Backend | Cloudflare Workers + Durable Objects (`Room`, `Lobby`; SQLite-backed classes required on the free plan; state in memory, storage not used) | — |
| Database | None (BR-020) | — |
| Auth | Firebase Auth (email + password); JWT verification in the Worker | — |
| Hosting / Deployment | Frontend: Cloudflare Pages; backend: Cloudflare Workers (separate domain, CORS/Origin configured) | — |
| CI/CD | GitHub Actions: lint, typecheck, Vitest, Playwright, `wrangler` deploy (Pages and Worker) | — |
| Testing | Vitest (shared, Worker), Playwright (e2e, 4 contexts) | — |
- **Repo structure:** pnpm monorepo: `packages/web` (Vue), `packages/worker` (Workers/DO), `packages/shared` (simulation engine, types, protocol schemas, `config.ts`).

## 19. Implementation Plan

### M1: Skeleton and engine
- **Includes:** FR-003, FR-005 (logic)
- **Depends on:** —
- **Definition of done:** pnpm monorepo with CI; the `shared` engine covered by Vitest tests (netting, spread, bankruptcy, news, type distribution).

### M2: Web app single play + auth
- **Includes:** FR-001, FR-002, FR-004, FR-005 (UI), FR-006, FR-019, FR-020, FR-018 (part: policy, account deletion)
- **Depends on:** M1
- **Definition of done:** after login and email verification the user can play single play (PL/EN); deployed to Pages in M6 (see §20 row 36).

### M3: Worker, lobby, and rooms
- **Includes:** FR-007, FR-008, FR-009, FR-010, FR-016
- **Depends on:** M1
- **Definition of done:** Worker tests: authorization, room creation, live list, joining, host, removal of empty rooms.

### M4: Server round engine
- **Includes:** FR-011, FR-012, FR-013, FR-014, FR-015
- **Depends on:** M3
- **Definition of done:** rounds played by a test client; end conditions, tie-break, elimination, disconnection, and rate limit tested.

### M5: Multiplayer UI and admin
- **Includes:** FR-017, UF-003, UF-004, UF-005
- **Depends on:** M2, M4
- **Definition of done:** full flow through the UI: list → create → lobby → round → results → next round; observer; admin.

### M6: Quality and release
- **Includes:** NFR-001–NFR-006
- **Depends on:** M5
- **Definition of done:** Playwright e2e (4 players, full round), axe audit with no AA violations, Lighthouse within budget, production deployment, free-limit usage checked. The production Firebase project sets the Auth password policy to a minimum of 8 characters, because the client check alone (BR-002) can be bypassed.

# Appendix

## 20. Decisions Log
| # | Decision | Alternatives considered | Rationale |
|---|----------|-------------------------|-----------|
| 1 | Goal: portfolio + fun | Education; commercial | User's choice |
| 2 | No monetization | Donations; freemium | User's choice, cost ≈ 0 |
| 3 | Scale up to 50 concurrent | 500; 5000 | User's choice, free limits |
| 4 | Roles: Player + Admin | Room owner; player only | User's choice |
| 5 | Multi = same game, shared price | Player interaction | User's choice |
| 6 | Login required everywhere, no result storage | Single without login | User's choice |
| 7 | Round: time always, optional profit target (ends the game when reached); duration 3/5/10 min | Target only; time only | User's choice; no round without a time limit |
| 8 | Max 4 players and 4 observers | 8, 20 players; 10 observers | User's choice |
| 9 | Host sets room speed (1×/3×/8×) | Speed disabled | User's choice |
| 10 | Profit target: any amount, min. $100, no upper limit | Presets; range | User's choice |
| 11 | Bankruptcy = elimination, ranking spectating | Restart; last one standing | User's choice |
| 12 | Joining during a round only as an observer | None; up to 30 s | User's choice |
| 13 | Tie-break: earlier reaching of equity | Trade count; shared place | User's choice |
| 14 | Host leaves → next player takes over; after the round return to lobby | Room closes | User's choice |
| 15 | Public rooms only (change from the initial description with private codes) | Public + private | User's choice |
| 16 | Admin: close room, kick player; no bans; defined by UID list | Bans | User's choice |
| 17 | Login only by email + password, with verification, reset, min. 8 characters | Google, GitHub | User's choice |
| 18 | Nickname: random default, changeable, in `displayName`, no filter, collisions with `#n` | Nickname from email | User's choice |
| 19 | Trading rules and execution price as in single; server price at order receipt | Position limit; ±0.5% tolerance | User's choice |
| 20 | News: 5 types at 20% each, in both modes | Rarer new ones; multiplayer only | User's choice (selected all 4 new ones, random) |
| 21 | Language PL + EN | PL only | User's choice |
| 22 | Web mobile-first ≥ 360 px; latency ≤ 300 ms p95; WCAG 2.1 AA; privacy policy + account deletion | — | User's choice |
| 23 | Room list: name, host, x/4, duration, target, speed, status | — | User's choice |
| 24 | Disconnection: 30 s to return | Immediate drop | User's choice |
| 25 | Order limit 10/s per player | — | User's choice |
| 26 | Empty room deleted after 5 min; name 3–30 characters | 1 min | User's choice |
| 27 | Stack: TypeScript, Vue 3 + Vite, Workers + Durable Objects, Firebase Auth, Pages, GitHub Actions, pnpm monorepo, Vitest + Playwright | NestJS/Colyseus; Better Auth; React/Svelte; Workers Static Assets | User's choice |
| 28 | Single play in the browser with the shared `shared` package | On the server | User's choice |
| 29 | Solo, no deadline; built from scratch (prototype as pattern); metric: stable 4-player round | — | User's choice |
| 30 | Derived from answers (tunable constants in `shared/config.ts`): round time = wall clock; target computed on total result (equity − 10,000) including open P&L; same-tick target tie decided by equity; minimum 1 player to start; observer does not become a player in the same visit; player after disconnect timeout ranked like a bankrupt; kicked player may return; news parameters (70% recovery over 20 ticks, drift ±0.0007, ×3 for 60 ticks); default language from the browser; `Lobby`/`Room` heartbeat interval; `zod` for protocol schemas | — | Additions following from earlier choices |
| 31 | Product name: First Million. New look: dark theme (the only one in the MVP, no light theme), gold accent, Space Grotesk + JetBrains Mono fonts | Keeping the prototype's light/dark themes | User asked for a darker design; the specific palette was proposed by Claude |
| 32 | Added section 23 with links to the prototypes (playable and clickable) as reference materials | — | User's request |
| 33 | Tick drift: every interval runs a fixed `speed` number of price steps; no catch-up by wall time | Catch up steps by elapsed wall time | User's choice; same behaviour as the prototype, simplest, deterministic in tests |
| 34 | Money is a raw float in the engine (no rounding of price, P&L or half spread); the UI formats with `Intl` | Round to cents in the engine | User's choice; no rounding rule to maintain, exact ties only for bit-identical equity |
| 35 | Firebase Auth emulator in dev and e2e | Real test accounts | User's choice; no real email sent, no quota use, 0 PLN |
| 36 | All deployment (Pages, Worker, Firebase project setup) in M6; M1–M5 run locally | Deploy Pages at the end of M2 | User's choice; one deployment pass, no half-configured production environment |

## 21. Open Questions
None.

## 22. Glossary
| Term | Definition |
|------|------------|
| Tick | A single price simulation step (prototype: 80 ms × speed steps) |
| Net position | A player's single position (long > 0, short < 0) after offsetting orders against each other |
| Equity | 10,000 + realized P&L + open P&L |
| Total result | Equity − 10,000 |
| Profit target | Optional total-result threshold that ends a round |
| Host | The player managing a room and starting rounds |
| Observer | A room participant without trading rights |
| Lobby (state) | Room state before a round starts or after it ends |
| `Lobby` (object) | The Durable Object holding the room list |

## 23. Materials & Prototypes
| Material | Description | Link |
|----------|-------------|------|
| Playable prototype (single play) | Single-file HTML with the mechanics from BR-003–BR-006 and BR-015: five news types, trading halt, speed, pause, PL/EN, dark theme. Reference implementation for the `shared` package (FR-003, FR-004, FR-005) | https://claude.ai/artifact/J44oy8wvcAvoTnhoybnMKn |
| Clickable prototype (design) | Seven mobile screens: login, menu, room list, room creation, lobby, round, results. Reference for UF-001–UF-004 and section 16 | https://claude.ai/artifact/FpMquwSRiKMjc4fMkmUxY1 |

- The links are private until shared from the Share menu.
- Source files of both prototypes are in the `first-million-package.zip` package (`game/` and `design/` folders).
- The playable prototype has no login, rooms, or server. The multiplayer screens exist only as mockups.
