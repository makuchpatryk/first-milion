import { HISTORY_MAX } from '@fm/shared/config'
import {
  createMarket,
  stepMarket,
  tickHalt,
  type Market,
} from '@fm/shared/engine/market'
import type { NewsEvent } from '@fm/shared/engine/news'
import {
  emptyPortfolio,
  equity,
  isBankrupt,
  liquidate,
  type Portfolio,
} from '@fm/shared/engine/portfolio'
import type { MemberStatus } from '@fm/shared/protocol'
import { START_CASH } from '@fm/shared/rules'
import { createRng, type Rng } from '@fm/shared/rng'

export interface Seat {
  uid: string
  nick: string
  status: MemberStatus
  portfolio: Portfolio
  /** Server time the equity last changed value (BR-010). */
  reachedEquityAt: number
  /** Equity at the last check, to see when the value changes. */
  lastEquity: number | null
  /** Server time the player's socket went away; null while they are connected (BR-019). */
  disconnectedAt: number | null
}

export interface Round {
  market: Market
  /** Seeded per round; the only source of randomness (ARCHITECTURE A4). */
  rng: Rng
  startedAt: number
  /** Wall clock end (BR-008). */
  endsAt: number
  /**
   * Every price so far, newest last, at most `HISTORY_MAX` (FR-015 history for a returning
   * player). One buffer per round, appended in place by `stepRound` so a tick allocates nothing;
   * copy it before handing it out.
   */
  readonly history: number[]
  /** News drawn during the latest step, `null` when none; the tick message carries it once. */
  lastNews: NewsEvent | null
}

const MS_PER_MIN = 60_000

/**
 * Begins a round: every seat is active with an empty portfolio, and the BR-010 clock starts at
 * `now` (seats reset at each start, decision 38). Observers have no seat and are not passed in.
 */
export function startRound(
  seats: readonly Seat[],
  now: number,
  durationMin: number,
  seed: number,
): { round: Round; seats: Seat[] } {
  const rng = createRng(seed)
  const market = createMarket(rng)
  const round: Round = {
    market,
    rng,
    startedAt: now,
    endsAt: now + durationMin * MS_PER_MIN,
    history: [market.price],
    lastNews: null,
  }
  const fresh = seats.map(
    (seat): Seat => ({
      ...seat,
      status: 'active',
      portfolio: emptyPortfolio,
      reachedEquityAt: now,
      lastEquity: START_CASH,
      disconnectedAt: null,
    }),
  )
  return { round, seats: fresh }
}

/**
 * Closes the position at market incl. spread and marks the seat eliminated (BR-005, BR-019).
 * `disconnectedAt` stays: it records that the player's socket is gone, so they can come back to
 * watch (FR-015 AC).
 */
export function eliminateSeat(seat: Seat, price: number): Seat {
  return { ...seat, status: 'eliminated', portfolio: liquidate(seat.portfolio, price) }
}

/**
 * Bankruptcy check (BR-005) and equity tracking for BR-010: `reachedEquityAt` moves only when
 * the equity value changes, so it is the moment the seat's final value was last reached. Runs
 * after every tick and every order.
 */
export function settleSeat(seat: Seat, price: number, now: number): Seat {
  if (seat.status === 'eliminated') return seat
  if (isBankrupt(seat.portfolio, price)) return eliminateSeat(seat, price)
  const current = equity(seat.portfolio, price)
  if (current === seat.lastEquity) return seat
  return { ...seat, lastEquity: current, reachedEquityAt: now }
}

/**
 * One tick interval (decision 33): `speed` price steps, the halt counted down in wall-clock ms
 * (decision 39), then every seat settled at the true price. The shown price during a halt is
 * `shownPrice(market)`; equity always uses the true one (BR-015).
 */
export function stepRound(
  round: Round,
  seats: readonly Seat[],
  elapsedMs: number,
  now: number,
  speed: number,
): { round: Round; seats: Seat[]; newPrices: number[] } {
  let market = tickHalt(round.market, elapsedMs)
  const newsBefore = market.news
  const newPrices: number[] = []
  for (let i = 0; i < speed; i++) {
    market = stepMarket(market, round.rng)
    newPrices.push(market.price)
  }
  const { history } = round
  history.push(...newPrices)
  if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
  const next: Round = {
    ...round,
    market,
    lastNews: market.news !== newsBefore ? market.news : null,
  }
  return {
    round: next,
    seats: seats.map((seat) => settleSeat(seat, market.price, now)),
    newPrices,
  }
}
