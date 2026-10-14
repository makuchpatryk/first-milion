import { HISTORY_MAX } from '@fm/shared/config'
import { createMarket, stepMarket, type Market } from '@fm/shared/engine/market'
import {
  bookedTrade,
  closedTradeOf,
  closePosition,
  equity,
  executeOrder,
  isBankrupt,
  liquidate,
  newPortfolio,
  type BookedTrade,
  type Portfolio,
  type TradeSide,
} from '@fm/shared/engine/portfolio'
import type { Rng } from '@fm/shared/rng'
import {
  DEFAULT_GOAL,
  DEFAULT_ROUND_DURATION_MIN,
  DEFAULT_START_CASH,
  START_PRICE,
  type OrderQty,
  type Speed,
} from '@fm/shared/rules'
import { pushTrade } from './history'

/** Why a single-play game ended: margin call (BR-005), goal (BR-009) or time (BR-009). */
export type SingleEnd = 'MARGIN' | 'TARGET' | 'TIME'

/** The settings of one single-play round, chosen on the setup screen. */
export interface SingleRound {
  readonly durationMs: number
  /** Capital the round starts with (BR-003). */
  readonly startCash: number
  /** Target equity that ends the round as a win (BR-009). */
  readonly goal: number
}

export const DEFAULT_SINGLE_ROUND: SingleRound = {
  durationMs: DEFAULT_ROUND_DURATION_MIN * 60_000,
  startCash: DEFAULT_START_CASH,
  goal: DEFAULT_GOAL,
}

/** Everything single play shows, as one immutable value (BR-006: never stored anywhere). */
export interface SingleSim {
  readonly market: Market
  readonly portfolio: Portfolio
  /** True price per step, newest last, capped at `HISTORY_MAX`. */
  readonly prices: readonly number[]
  /** Last closed trades, newest first. */
  readonly history: readonly BookedTrade[]
  /** Highest displayed equity seen (footer "equity record"). */
  readonly peak: number
  readonly round: SingleRound
  /** Wall-clock ms left in the round; paused time does not count. */
  readonly timeLeftMs: number
  /** Why the game ended, or `null` while it runs. */
  readonly end: SingleEnd | null
}

export function createSingle(rng: Rng, round: SingleRound = DEFAULT_SINGLE_ROUND): SingleSim {
  return {
    market: createMarket(rng),
    portfolio: newPortfolio(round.startCash),
    prices: [START_PRICE],
    history: [],
    peak: round.startCash,
    round,
    timeLeftMs: round.durationMs,
    end: null,
  }
}

const reachedGoal = (portfolio: Portfolio, price: number, goal: number): boolean =>
  equity(portfolio, price) >= goal

const withPeak = (sim: SingleSim): SingleSim => {
  const eq = equity(sim.portfolio, sim.market.price)
  return eq > sim.peak ? { ...sim, peak: eq } : sim
}

/**
 * One 80 ms interval: count the round time down by wall-clock ms (BR-009), then `speed` fixed
 * price steps with no catch-up (PRD §20 #33, FR-004). Stops stepping at the end of the round
 * (the prototype kept stepping at a margin call; harmless change).
 */
export function advanceSingle(
  sim: SingleSim,
  elapsedMs: number,
  speed: Speed,
  rng: Rng,
): SingleSim {
  if (sim.end !== null) return sim

  let market = sim.market
  let portfolio = sim.portfolio
  let history = sim.history
  let end: SingleEnd | null = null
  const timeLeftMs = Math.max(0, sim.timeLeftMs - elapsedMs)
  const prices = sim.prices.slice()

  for (let i = 0; i < speed && end === null; i++) {
    market = stepMarket(market, rng)
    prices.push(market.price)
    if (prices.length > HISTORY_MAX) prices.shift()

    if (isBankrupt(portfolio, market.price)) {
      const trade = closedTradeOf(portfolio, market.price)
      if (trade) history = pushTrade(history, trade)
      portfolio = liquidate(portfolio, market.price)
      end = 'MARGIN'
    } else if (reachedGoal(portfolio, market.price, sim.round.goal)) {
      end = 'TARGET'
    }
  }
  if (end === null && timeLeftMs === 0) end = 'TIME'

  return withPeak({ ...sim, market, portfolio, prices, history, timeLeftMs, end })
}

/** Orders are blocked only after the end of the round. */
const canTrade = (sim: SingleSim): boolean => sim.end === null

/** Buy or sell `qty` at the true price; the spread is applied inside `executeOrder` (BR-003). */
export function placeOrder(sim: SingleSim, side: TradeSide, qty: OrderQty): SingleSim {
  if (!canTrade(sim)) return sim
  const trade = bookedTrade(sim.portfolio, side, qty, sim.market.price)
  const portfolio = executeOrder(sim.portfolio, side, qty, sim.market.price)
  const history = trade ? pushTrade(sim.history, trade) : sim.history
  return withPeak(withGoal({ ...sim, portfolio, history }))
}

/** Close the whole position (no-op when flat). */
export function closeOrder(sim: SingleSim): SingleSim {
  if (!canTrade(sim)) return sim
  const trade = closedTradeOf(sim.portfolio, sim.market.price)
  if (!trade) return sim
  const portfolio = closePosition(sim.portfolio, sim.market.price)
  return withPeak(withGoal({ ...sim, portfolio, history: pushTrade(sim.history, trade) }))
}

/** An order that reaches the goal ends the round as a win (BR-009: checked after every order). */
const withGoal = (sim: SingleSim): SingleSim =>
  sim.end === null && reachedGoal(sim.portfolio, sim.market.price, sim.round.goal)
    ? { ...sim, end: 'TARGET' }
    : sim
