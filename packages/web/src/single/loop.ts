import { HISTORY_MAX } from '@fm/shared/config'
import {
  createMarket,
  isTradingHalted,
  shownPrice,
  stepMarket,
  tickHalt,
  type Market,
} from '@fm/shared/engine/market'
import {
  bookedTrade,
  closedTradeOf,
  closePosition,
  emptyPortfolio,
  equity,
  executeOrder,
  isBankrupt,
  liquidate,
  totalResult,
  type BookedTrade,
  type Portfolio,
  type TradeSide,
} from '@fm/shared/engine/portfolio'
import type { Rng } from '@fm/shared/rng'
import {
  DEFAULT_ROUND_DURATION_MIN,
  PROFIT_TARGET_MIN,
  START_CASH,
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
  /** Total result (equity - start cash) that ends the round as a win (BR-009). */
  readonly goal: number
}

export const DEFAULT_SINGLE_ROUND: SingleRound = {
  durationMs: DEFAULT_ROUND_DURATION_MIN * 60_000,
  goal: PROFIT_TARGET_MIN,
}

/** Everything single play shows, as one immutable value (BR-006: never stored anywhere). */
export interface SingleSim {
  readonly market: Market
  readonly portfolio: Portfolio
  /** True price per step, newest last, capped at `HISTORY_MAX`. */
  readonly prices: readonly number[]
  /**
   * While a trading halt freezes the display, how many leading entries of `prices` are shown;
   * `null` when not halted (prototype `shownLen`). Not part of `shared`: the engine only knows
   * the frozen price, the chart needs the matching history slice (FR-005).
   */
  readonly frozenLen: number | null
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
    portfolio: emptyPortfolio,
    prices: [START_PRICE],
    frozenLen: null,
    history: [],
    peak: START_CASH,
    round,
    timeLeftMs: round.durationMs,
    end: null,
  }
}

const reachedGoal = (portfolio: Portfolio, price: number, goal: number): boolean =>
  totalResult(portfolio, price) >= goal

/** The part of the history the chart and the headline price show. */
export function shownPrices(sim: SingleSim): readonly number[] {
  return sim.frozenLen === null ? sim.prices : sim.prices.slice(0, sim.frozenLen)
}

/** Equity as displayed: open P&L at the (possibly frozen) shown price, like the prototype. */
export function shownEquity(sim: SingleSim): number {
  return equity(sim.portfolio, shownPrice(sim.market))
}

const withPeak = (sim: SingleSim): SingleSim => {
  const eq = shownEquity(sim)
  return eq > sim.peak ? { ...sim, peak: eq } : sim
}

/**
 * One 80 ms interval: count the halt and the round time down by wall-clock ms (BR-015, BR-009),
 * then `speed` fixed price steps with no catch-up (PRD §20 #33, FR-004). Bankruptcy and the goal
 * use the true price, the display uses the shown one. Stops stepping at the end of the round
 * (the prototype kept stepping at a margin call; harmless change).
 */
export function advanceSingle(
  sim: SingleSim,
  elapsedMs: number,
  speed: Speed,
  rng: Rng,
): SingleSim {
  if (sim.end !== null) return sim

  let market = tickHalt(sim.market, elapsedMs)
  let portfolio = sim.portfolio
  let history = sim.history
  let frozenLen = market.frozenPrice === null ? null : sim.frozenLen
  let end: SingleEnd | null = null
  const timeLeftMs = Math.max(0, sim.timeLeftMs - elapsedMs)
  const prices = sim.prices.slice()

  for (let i = 0; i < speed && end === null; i++) {
    const before = market
    market = stepMarket(market, rng)
    // A halt that starts on this step freezes the display at the price before the step moved it.
    if (before.frozenPrice === null && market.frozenPrice !== null) frozenLen = prices.length
    prices.push(market.price)
    if (prices.length > HISTORY_MAX) {
      prices.shift()
      if (frozenLen !== null) frozenLen = Math.max(1, frozenLen - 1)
    }

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

  if (end !== null) {
    // The end unfreezes the display so the final price is visible (BR-005).
    market = { ...market, haltMsLeft: 0, frozenPrice: null }
    frozenLen = null
  }

  return withPeak({ ...sim, market, portfolio, prices, frozenLen, history, timeLeftMs, end })
}

/** Orders are blocked after the end of the round and during a trading halt (BR-015, FR-005). */
const canTrade = (sim: SingleSim): boolean => sim.end === null && !isTradingHalted(sim.market)

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
