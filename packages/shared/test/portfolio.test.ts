import { describe, expect, it } from 'vitest'
import {
  bookedTrade,
  closedTradeOf,
  closePosition,
  equity,
  executeOrder,
  fillPrice,
  isBankrupt,
  liquidate,
  newPortfolio,
  totalResult,
  unrealized,
} from '../src/engine/portfolio'
import { DEFAULT_START_CASH } from '../src/rules'

const emptyPortfolio = newPortfolio(DEFAULT_START_CASH)

describe('fillPrice', () => {
  it('BR-003: buys pay half the spread above, sells receive half below', () => {
    expect(fillPrice(100, 'BUY')).toBeCloseTo(100.03, 9)
    expect(fillPrice(100, 'SELL')).toBeCloseTo(99.97, 9)
  })
})

describe('executeOrder', () => {
  it('BR-004: flat + BUY 50 @100 opens long 50 at 100.03', () => {
    const p = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    expect(p.units).toBe(50)
    expect(p.avg).toBeCloseTo(100.03, 9)
    expect(p.closedTrades).toBe(0)
  })

  it('FR-003 / BR-004: long 50 then SELL 100 @101 realizes 50 units and reverses at the fill', () => {
    const long = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    const p = executeOrder(long, 'SELL', 100, 101)
    expect(p.realized).toBeCloseTo((100.97 - 100.03) * 50, 9)
    expect(p.units).toBe(-50)
    expect(p.avg).toBeCloseTo(100.97, 9)
    expect(p.closedTrades).toBe(1)
  })

  it('BR-004: an order in the position direction averages the entry price', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    const p = executeOrder(a, 'BUY', 50, 110)
    expect(p.units).toBe(100)
    expect(p.avg).toBeCloseTo((100.03 + 110.03) / 2, 9)
    expect(p.closedTrades).toBe(0)
  })

  it('BR-004: opposite order smaller than the position reduces it and keeps the entry', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 100, 100)
    const p = executeOrder(a, 'SELL', 50, 102)
    expect(p.units).toBe(50)
    expect(p.avg).toBeCloseTo(100.03, 9)
    expect(p.realized).toBeCloseTo((101.97 - 100.03) * 50, 9)
  })

  it('BR-004: exact offset flattens the position and resets avg to 0', () => {
    const a = executeOrder(emptyPortfolio, 'SELL', 50, 100)
    const p = executeOrder(a, 'BUY', 50, 100)
    expect(p.units).toBe(0)
    expect(p.avg).toBe(0)
  })

  it('BR-004: short profit is realized with the right sign', () => {
    const a = executeOrder(emptyPortfolio, 'SELL', 10, 100)
    const p = executeOrder(a, 'BUY', 10, 90)
    expect(p.realized).toBeCloseTo((90.03 - 99.97) * -1 * 10, 9)
    expect(p.realized).toBeGreaterThan(0)
  })

  it('BR-004: closedTrades counts every reduction, wins only when pnl > 0', () => {
    let p = executeOrder(emptyPortfolio, 'BUY', 100, 100)
    p = executeOrder(p, 'SELL', 50, 110) // win
    p = executeOrder(p, 'SELL', 50, 90) // loss
    expect(p.closedTrades).toBe(2)
    expect(p.wins).toBe(1)
  })

  it('does not mutate its input', () => {
    const before = { ...emptyPortfolio }
    executeOrder(emptyPortfolio, 'BUY', 10, 100)
    expect(emptyPortfolio).toEqual(before)
  })
})

describe('closePosition', () => {
  it('BR-004: CLOSE with no position returns the same object', () => {
    expect(closePosition(emptyPortfolio, 100)).toBe(emptyPortfolio)
  })

  it('BR-004: closes a long at price minus half spread', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    const p = closePosition(a, 105)
    expect(p.units).toBe(0)
    expect(p.avg).toBe(0)
    expect(p.realized).toBeCloseTo((104.97 - 100.03) * 50, 9)
    expect(p.closedTrades).toBe(1)
    expect(p.wins).toBe(1)
  })

  it('BR-004: closes a short at price plus half spread', () => {
    const a = executeOrder(emptyPortfolio, 'SELL', 50, 100)
    const p = closePosition(a, 95)
    expect(p.realized).toBeCloseTo((99.97 - 95.03) * 50, 9)
    expect(p.units).toBe(0)
  })
})

describe('bookedTrade', () => {
  it('BR-004: a partial reduction books only the reduced units, with the same P&L as the order', () => {
    const long = executeOrder(emptyPortfolio, 'BUY', 100, 100)
    const trade = bookedTrade(long, 'SELL', 50, 102)
    expect(trade).toEqual({
      dir: 1,
      units: 50,
      entry: long.avg,
      exit: expect.closeTo(101.97, 9) as number,
      pnl: expect.closeTo((101.97 - 100.03) * 50, 9) as number,
    })
    const after = executeOrder(long, 'SELL', 50, 102)
    expect(after.realized - long.realized).toBeCloseTo(trade?.pnl ?? NaN, 9)
  })

  it('BR-004: a reversal books only the closed part, not the new opposite position', () => {
    const long = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    const trade = bookedTrade(long, 'SELL', 250, 101)
    expect(trade?.units).toBe(50)
    expect(trade?.dir).toBe(1)
    const after = executeOrder(long, 'SELL', 250, 101)
    expect(after.realized - long.realized).toBeCloseTo(trade?.pnl ?? NaN, 9)
    expect(after.closedTrades).toBe(long.closedTrades + 1)
  })

  it('BR-004: a short reduced by a buy reports dir -1 and a positive pnl when the price fell', () => {
    const short = executeOrder(emptyPortfolio, 'SELL', 50, 100)
    const trade = bookedTrade(short, 'BUY', 10, 90)
    expect(trade?.dir).toBe(-1)
    expect(trade?.units).toBe(10)
    expect(trade?.pnl).toBeGreaterThan(0)
  })

  it('BR-004: orders that open or add to a position book nothing', () => {
    expect(bookedTrade(emptyPortfolio, 'BUY', 50, 100)).toBeNull()
    const long = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    expect(bookedTrade(long, 'BUY', 50, 101)).toBeNull()
  })
})

describe('closedTradeOf', () => {
  it('BR-004: close on a flat portfolio books nothing', () => {
    expect(closedTradeOf(emptyPortfolio, 100)).toBeNull()
  })

  it('BR-004: matches the P&L closePosition realizes for the same price', () => {
    for (const side of ['BUY', 'SELL'] as const) {
      const open = executeOrder(emptyPortfolio, side, 100, 100)
      const trade = closedTradeOf(open, 97)
      const closed = closePosition(open, 97)
      expect(trade?.units).toBe(100)
      expect(closed.realized - open.realized).toBeCloseTo(trade?.pnl ?? NaN, 9)
    }
  })

  it('BR-005: also describes a liquidation at market incl. spread', () => {
    const long = executeOrder(emptyPortfolio, 'BUY', 250, 100)
    const trade = closedTradeOf(long, 59)
    expect(trade?.exit).toBeCloseTo(58.97, 9)
    expect(trade?.pnl).toBeCloseTo((58.97 - 100.03) * 250, 9)
  })
})

describe('equity and bankruptcy', () => {
  it('BR-005: equity = start cash + realized + open P&L', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 50, 100)
    expect(unrealized(a, 102)).toBeCloseTo((102 - 100.03) * 50, 9)
    expect(equity(a, 102)).toBeCloseTo(DEFAULT_START_CASH + (102 - 100.03) * 50, 9)
    expect(totalResult(a, 102)).toBeCloseTo((102 - 100.03) * 50, 9)
  })

  it('BR-003 / BR-005: equity starts at the chosen capital and the result is measured from it', () => {
    for (const start of [1_000, 5_000, 100_000]) {
      const flat = newPortfolio(start)
      expect(flat.startCash).toBe(start)
      expect(equity(flat, 100)).toBe(start)
      expect(totalResult(flat, 100)).toBe(0)
      const a = executeOrder(flat, 'BUY', 50, 100)
      expect(a.startCash).toBe(start)
      expect(equity(a, 102)).toBeCloseTo(start + (102 - 100.03) * 50, 9)
      expect(totalResult(a, 102)).toBeCloseTo((102 - 100.03) * 50, 9)
    }
  })

  it('BR-005: a smaller capital goes bankrupt on a smaller move', () => {
    const small = executeOrder(newPortfolio(1_000), 'BUY', 250, 100)
    expect(isBankrupt(small, 100)).toBe(false)
    expect(isBankrupt(small, 95)).toBe(true) // -5.03 * 250 = -1257.5 <= -1000
    const big = executeOrder(newPortfolio(100_000), 'BUY', 250, 100)
    expect(isBankrupt(big, 60)).toBe(false)
  })

  it('BR-005: equity <= 0 is bankrupt, above 0 is not', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 250, 100)
    expect(isBankrupt(a, 100)).toBe(false)
    expect(isBankrupt(a, 60)).toBe(true) // -40 * 250 = -10000 (+ spread) <= 0
  })

  it('BR-005: the capital survives netting, close and liquidation', () => {
    const a = executeOrder(newPortfolio(5_000), 'BUY', 50, 100)
    expect(executeOrder(a, 'SELL', 100, 101).startCash).toBe(5_000)
    expect(closePosition(a, 101).startCash).toBe(5_000)
    expect(liquidate(a, 50).startCash).toBe(5_000)
  })

  it('BR-005: liquidate returns flat and books the loss including spread', () => {
    const a = executeOrder(emptyPortfolio, 'BUY', 250, 100)
    const p = liquidate(a, 59)
    expect(p.units).toBe(0)
    expect(p.realized).toBeCloseTo((58.97 - 100.03) * 250, 9)
    expect(equity(p, 59)).toBeLessThanOrEqual(0)
    expect(p.wins).toBe(0)
  })
})
