import { HISTORY_MAX } from '@fm/shared/config'
import { createMarket, stepMarket } from '@fm/shared/engine/market'
import { executeOrder, equity } from '@fm/shared/engine/portfolio'
import { createRng } from '@fm/shared/rng'
import { DEFAULT_START_CASH, START_PRICE } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import {
  advanceSingle,
  closeOrder,
  createSingle,
  DEFAULT_SINGLE_ROUND,
  placeOrder,
  type SingleRound,
  type SingleSim,
} from './loop'

const SEED = 42
/** A non-default capital, so a site that still assumes $10,000 fails (BR-003). */
const START = 5_000

const round = (over: Partial<SingleRound> = {}): SingleRound => ({
  durationMs: 60_000,
  startCash: START,
  goal: 30_000,
  ...over,
})

describe('createSingle: starting capital (BR-003)', () => {
  it('the default round starts with the default capital and goal', () => {
    const sim = createSingle(createRng(SEED))
    expect(sim.round).toBe(DEFAULT_SINGLE_ROUND)
    expect(sim.portfolio.startCash).toBe(DEFAULT_START_CASH)
    expect(equity(sim.portfolio, sim.market.price)).toBe(DEFAULT_START_CASH)
  })

  it('the first equity and the equity record equal the chosen start', () => {
    const sim = createSingle(createRng(SEED), round({ startCash: 1_000, goal: 2_000 }))
    expect(sim.portfolio.startCash).toBe(1_000)
    expect(equity(sim.portfolio, sim.market.price)).toBe(1_000)
    expect(sim.peak).toBe(1_000)
  })
})

describe('advanceSingle: timing (FR-004)', () => {
  it.each([1, 3, 8] as const)(
    'FR-004 AC: speed %i appends exactly that many price steps',
    (speed) => {
      const rng = createRng(SEED)
      const sim = createSingle(rng)
      const next = advanceSingle(sim, 80, speed, rng)
      expect(next.prices).toHaveLength(1 + speed)
    },
  )

  it('FR-004 AC: 8 steps equal 8 direct stepMarket calls with the same seed', () => {
    const rngA = createRng(SEED)
    const advanced = advanceSingle(createSingle(rngA), 80, 8, rngA)

    const rngB = createRng(SEED)
    let market = createMarket(rngB)
    const expected: number[] = [START_PRICE]
    for (let i = 0; i < 8; i++) {
      market = stepMarket(market, rngB)
      expected.push(market.price)
    }

    expect(advanced.prices).toEqual(expected)
    expect(advanced.market).toEqual(market)
  })

  it('FR-004: the price history is capped at HISTORY_MAX', () => {
    const rng = createRng(SEED)
    let sim = createSingle(rng)
    for (let i = 0; i < HISTORY_MAX / 8 + 20; i++) sim = advanceSingle(sim, 80, 8, rng)
    expect(sim.prices).toHaveLength(HISTORY_MAX)
  })

  it('FR-004: a finished game does not advance', () => {
    const rng = createRng(SEED)
    const sim = { ...createSingle(rng), end: 'MARGIN' as const }
    expect(advanceSingle(sim, 80, 8, rng)).toBe(sim)
  })
})

describe('advanceSingle: margin call (FR-003, BR-005)', () => {
  /** Long 250 @ ~100 while the market sits at 55: equity is far below zero. */
  function bankruptSim(rng: () => number): SingleSim {
    const sim = createSingle(rng, round())
    return {
      ...sim,
      market: { ...sim.market, price: 55 },
      portfolio: executeOrder(sim.portfolio, 'BUY', 250, 100),
    }
  }

  it('BR-005: equity <= 0 flattens the position, books the trade and ends the game as MARGIN', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(bankruptSim(rng), 80, 1, rng)

    expect(next.end).toBe('MARGIN')
    expect(next.portfolio.units).toBe(0)
    expect(next.portfolio.closedTrades).toBe(1)
    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.pnl).toBeLessThan(0)
    expect(equity(next.portfolio, next.market.price)).toBeLessThanOrEqual(0)
  })

  it('BR-005: stepping stops at the margin call even with steps left in the interval', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(bankruptSim(rng), 80, 8, rng)
    expect(next.prices).toHaveLength(2)
  })

  it('BR-005: a flat portfolio is never bankrupt, however far the price falls', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng)
    const low = { ...sim, market: { ...sim.market, price: 5 } }
    expect(advanceSingle(low, 80, 8, rng).end).toBeNull()
  })
})

describe('advanceSingle: round time and goal (FR-004, BR-009)', () => {
  it('BR-009: the round time runs down by the elapsed ms and never below zero', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng, round({ durationMs: 1000 }))
    expect(advanceSingle(sim, 300, 1, rng).timeLeftMs).toBe(700)
    expect(advanceSingle(sim, 5000, 1, rng).timeLeftMs).toBe(0)
  })

  it('BR-009: the time running out ends the game as TIME, and the next interval does nothing', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng, round({ durationMs: 80 }))
    const next = advanceSingle(sim, 80, 8, rng)
    expect(next.end).toBe('TIME')
    expect(next.timeLeftMs).toBe(0)
    expect(advanceSingle(next, 80, 8, rng)).toBe(next)
  })

  // Long 250 at the true price 100; a market at 150 lifts equity by about 12,500 above the start.
  function aheadSim(goal: number, rng: () => number): SingleSim {
    const sim = createSingle(rng, round({ goal }))
    return {
      ...sim,
      market: { ...sim.market, price: 150 },
      portfolio: executeOrder(sim.portfolio, 'BUY', 250, 100),
    }
  }

  it('BR-009: equity reaching the goal on a step ends the game as TARGET', () => {
    const rng = createRng(SEED)
    expect(advanceSingle(aheadSim(START + 100, rng), 80, 1, rng).end).toBe('TARGET')
  })

  it('BR-009: equity below the goal keeps the game going, however high the profit', () => {
    const rng = createRng(SEED)
    // Equity is about 17,500 here, far below a goal of 1,000,000.
    expect(advanceSingle(aheadSim(1_000_000, rng), 80, 1, rng).end).toBeNull()
  })

  it('BR-009: the goal is checked after every order, so an order that reaches it ends the game', () => {
    const rng = createRng(SEED)
    const ahead = aheadSim(START + 100, rng)
    expect(placeOrder(ahead, 'SELL', 10).end).toBe('TARGET')
    expect(closeOrder(ahead).end).toBe('TARGET')
  })

  it('BR-009: an order below the goal does not end the game', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng, round({ goal: 20_000 }))
    expect(placeOrder(sim, 'BUY', 50).end).toBeNull()
  })
})

describe('placeOrder and closeOrder', () => {
  it('BR-003: fills at the true price with the spread applied once', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng)
    const next = placeOrder(sim, 'BUY', 50)
    expect(next.portfolio.units).toBe(50)
    expect(next.portfolio.avg).toBeCloseTo(sim.market.price + 0.03, 9)
  })

  it('BR-005: orders and close are no-ops after the margin call', () => {
    const rng = createRng(SEED)
    const sim = { ...placeOrder(createSingle(rng), 'BUY', 50), end: 'MARGIN' as const }
    expect(placeOrder(sim, 'SELL', 50)).toBe(sim)
    expect(closeOrder(sim)).toBe(sim)
  })

  it('UF-002: a reducing order and a close each add a history entry; opening adds none', () => {
    const rng = createRng(SEED)
    let sim = placeOrder(createSingle(rng), 'BUY', 100)
    expect(sim.history).toHaveLength(0)

    sim = placeOrder(sim, 'SELL', 50)
    expect(sim.history).toHaveLength(1)
    expect(sim.history[0]?.units).toBe(50)

    sim = closeOrder(sim)
    expect(sim.history).toHaveLength(2)
    expect(sim.portfolio.units).toBe(0)
    expect(sim.portfolio.closedTrades).toBe(2)
  })

  it('BR-004: closing a flat position changes nothing', () => {
    const sim = createSingle(createRng(SEED))
    expect(closeOrder(sim)).toBe(sim)
  })

  it('UF-002: the equity record follows displayed equity upwards only', () => {
    const rng = createRng(SEED)
    const sim = placeOrder(createSingle(rng, round()), 'BUY', 250)
    expect(sim.peak).toBe(START)

    const up: SingleSim = { ...sim, market: { ...sim.market, price: sim.market.price + 10 } }
    expect(closeOrder(up).peak).toBeGreaterThan(START)
  })
})
