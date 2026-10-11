import { HALT_MS, HISTORY_MAX } from '@fm/shared/config'
import { createMarket, isTradingHalted, shownPrice, stepMarket } from '@fm/shared/engine/market'
import { executeOrder, emptyPortfolio } from '@fm/shared/engine/portfolio'
import { createRng } from '@fm/shared/rng'
import { START_CASH, START_PRICE } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import {
  advanceSingle,
  closeOrder,
  createSingle,
  placeOrder,
  shownEquity,
  shownPrices,
  type SingleSim,
} from './loop'

const SEED = 42

/** A sim with a trading halt already running and the display frozen at `price`. */
function haltedSim(rng: () => number, price = START_PRICE): SingleSim {
  const sim = createSingle(rng)
  return {
    ...sim,
    market: { ...sim.market, haltMsLeft: HALT_MS, frozenPrice: price },
    frozenLen: 1,
  }
}

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
    const sim = { ...createSingle(rng), over: true }
    expect(advanceSingle(sim, 80, 8, rng)).toBe(sim)
  })
})

describe('advanceSingle: trading halt (BR-015, FR-005)', () => {
  it('BR-015: the halt counts down only by elapsed wall-clock ms, not by steps', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(haltedSim(rng), 80, 8, rng)
    expect(next.market.haltMsLeft).toBe(HALT_MS - 80)

    const same = advanceSingle(haltedSim(createRng(SEED)), 0, 8, createRng(SEED))
    expect(same.market.haltMsLeft).toBe(HALT_MS)
  })

  it('FR-005: the shown price and chart slice stay frozen while the true price keeps moving', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(haltedSim(rng, START_PRICE), 80, 8, rng)

    expect(isTradingHalted(next.market)).toBe(true)
    expect(shownPrice(next.market)).toBe(START_PRICE)
    expect(next.prices).toHaveLength(9)
    expect(shownPrices(next)).toEqual([START_PRICE])
  })

  it('BR-015: when the halt ends the display jumps to the current price', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(haltedSim(rng), HALT_MS, 1, rng)

    expect(isTradingHalted(next.market)).toBe(false)
    expect(next.frozenLen).toBeNull()
    expect(shownPrices(next)).toHaveLength(next.prices.length)
  })

  it('FR-005: a halt drawn by the engine freezes the chart at the price before that step', () => {
    let checked = 0
    for (let seed = 1; seed <= 300 && checked < 3; seed++) {
      const rng = createRng(seed)
      let sim = createSingle(rng)
      for (let i = 0; i < 900; i++) {
        const wasFrozen = sim.frozenLen !== null
        sim = advanceSingle(sim, 80, 1, rng)
        if (!wasFrozen && sim.frozenLen !== null) {
          const frozen = shownPrices(sim)
          expect(frozen.at(-1)).toBe(sim.market.frozenPrice)
          expect(frozen.length).toBe(sim.prices.length - 1)
          checked++
          break
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})

describe('advanceSingle: margin call (FR-003, BR-005)', () => {
  /** Long 250 @ ~100 while the market sits at 55: equity is far below zero. */
  function bankruptSim(rng: () => number): SingleSim {
    const sim = createSingle(rng)
    return {
      ...sim,
      market: { ...sim.market, price: 55 },
      portfolio: executeOrder(emptyPortfolio, 'BUY', 250, 100),
    }
  }

  it('BR-005: equity <= 0 flattens the position, books the trade and sets over', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(bankruptSim(rng), 80, 1, rng)

    expect(next.over).toBe(true)
    expect(next.portfolio.units).toBe(0)
    expect(next.portfolio.closedTrades).toBe(1)
    expect(next.history).toHaveLength(1)
    expect(next.history[0]?.pnl).toBeLessThan(0)
    expect(shownEquity(next)).toBeLessThanOrEqual(0)
  })

  it('BR-005: stepping stops at the margin call even with steps left in the interval', () => {
    const rng = createRng(SEED)
    const next = advanceSingle(bankruptSim(rng), 80, 8, rng)
    expect(next.prices).toHaveLength(2)
  })

  it('BR-005: a margin call during a halt unfreezes the display', () => {
    const rng = createRng(SEED)
    const sim = bankruptSim(rng)
    const halted: SingleSim = {
      ...sim,
      market: { ...sim.market, haltMsLeft: HALT_MS, frozenPrice: 100 },
      frozenLen: 1,
    }
    const next = advanceSingle(halted, 80, 1, rng)
    expect(next.over).toBe(true)
    expect(next.frozenLen).toBeNull()
    expect(isTradingHalted(next.market)).toBe(false)
  })

  it('BR-005: a flat portfolio is never bankrupt, however far the price falls', () => {
    const rng = createRng(SEED)
    const sim = createSingle(rng)
    const low = { ...sim, market: { ...sim.market, price: 5 } }
    expect(advanceSingle(low, 80, 8, rng).over).toBe(false)
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

  it('FR-005 AC: orders and close are no-ops during a trading halt', () => {
    const rng = createRng(SEED)
    const open = placeOrder(createSingle(rng), 'BUY', 50)
    const halted: SingleSim = { ...open, market: { ...open.market, haltMsLeft: 3000 } }

    expect(placeOrder(halted, 'SELL', 100)).toBe(halted)
    expect(closeOrder(halted)).toBe(halted)
  })

  it('BR-005: orders and close are no-ops after the margin call', () => {
    const rng = createRng(SEED)
    const sim = { ...placeOrder(createSingle(rng), 'BUY', 50), over: true }
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
    const sim = placeOrder(createSingle(rng), 'BUY', 250)
    expect(sim.peak).toBe(START_CASH)

    const up: SingleSim = { ...sim, market: { ...sim.market, price: sim.market.price + 10 } }
    expect(closeOrder(up).peak).toBeGreaterThan(START_CASH)
  })
})
