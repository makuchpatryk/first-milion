import { describe, expect, it } from 'vitest'
import {
  DRIFT_RANGE,
  REGIME_TICKS,
  TREND_TICKS,
  VOL_BASE,
  VOL_MULT,
  VOL_RANGE,
} from '../src/config'
import { createMarket, type Market, stepMarket } from '../src/engine/market'
import { createRng, randn } from '../src/rng'
import { MIN_PRICE, START_PRICE } from '../src/rules'
import { quietMarket } from './helpers'

describe('createMarket', () => {
  it('starts at the start price, first news in 200-400 ticks, regime in 40-180', () => {
    const m = createMarket(createRng(1))
    expect(m.price).toBe(START_PRICE)
    expect(m.newsLeft).toBeGreaterThanOrEqual(200)
    expect(m.newsLeft).toBeLessThanOrEqual(400)
    expect(m.regimeLeft).toBeGreaterThanOrEqual(REGIME_TICKS[0])
    expect(m.regimeLeft).toBeLessThanOrEqual(REGIME_TICKS[1])
    expect(m.news).toBeNull()
  })
})

describe('stepMarket', () => {
  it('FR-003: price never falls below the minimum over 10000 ticks', () => {
    const rng = createRng(2024)
    let m = createMarket(rng)
    for (let i = 0; i < 10_000; i++) {
      m = stepMarket(m, rng)
      expect(m.price).toBeGreaterThanOrEqual(MIN_PRICE)
    }
  })

  it('FR-003: a crushing downward drift is floored at the minimum price', () => {
    let m = { ...quietMarket(createMarket(createRng(1))), price: 6, drift: -0.5 }
    for (let i = 0; i < 20; i++) m = stepMarket(m, createRng(i))
    expect(m.price).toBe(MIN_PRICE)
  })

  it('FR-003: a new regime is drawn when the countdown ends, within the configured ranges', () => {
    const rng = createRng(5)
    const m = stepMarket({ ...createMarket(rng), regimeLeft: 1, newsLeft: 1e9 }, rng)
    expect(Math.abs(m.drift)).toBeLessThanOrEqual(DRIFT_RANGE / 2)
    expect(m.vol).toBeGreaterThanOrEqual(VOL_BASE)
    expect(m.vol).toBeLessThan(VOL_BASE + VOL_RANGE)
    expect(m.regimeLeft).toBeGreaterThanOrEqual(REGIME_TICKS[0])
    expect(m.regimeLeft).toBeLessThanOrEqual(REGIME_TICKS[1])
  })

  it('FR-003: regime countdown decreases by one per tick', () => {
    const rng = createRng(5)
    const m0 = { ...createMarket(rng), regimeLeft: 50, newsLeft: 1e9 }
    expect(stepMarket(m0, rng).regimeLeft).toBe(49)
  })

  it('BR-015: VOL_SPIKE multiplies volatility by 3 while volLeft > 0', () => {
    const base = { ...quietMarket(createMarket(createRng(1))), vol: 0.002 }
    const spiked = stepMarket({ ...base, volLeft: 5 }, createRng(77))
    const expected = base.price * Math.exp(base.vol * VOL_MULT * randn(createRng(77)))
    expect(spiked.price).toBeCloseTo(expected, 9)
    expect(spiked.volLeft).toBe(4)

    const calm = stepMarket(base, createRng(77))
    expect(calm.price).toBeCloseTo(base.price * Math.exp(base.vol * randn(createRng(77))), 9)
  })

  it('BR-015: TREND replaces the regime drift for 100 ticks, then the regime drift returns', () => {
    const base = { ...quietMarket(createMarket(createRng(1))), drift: 0.001 }
    let m: Market = { ...base, trend: { left: TREND_TICKS, drift: -0.0007 } }
    const rng = createRng(3)
    const before = m.price
    m = stepMarket(m, rng)
    expect(m.price).toBeCloseTo(before * Math.exp(-0.0007), 12)

    for (let i = 1; i < TREND_TICKS; i++) m = stepMarket(m, rng)
    expect(m.trend).toBeNull()
    const after = m.price
    expect(stepMarket(m, rng).price).toBeCloseTo(after * Math.exp(0.001), 12)
  })

  it('FR-005: newsAge counts ticks since the last news', () => {
    const rng = createRng(9)
    let m = quietMarket(createMarket(rng))
    for (let i = 0; i < 5; i++) m = stepMarket(m, rng)
    expect(m.newsAge).toBe(5)
  })

  it('does not mutate its input', () => {
    const rng = createRng(4)
    const m = createMarket(rng)
    const copy = structuredClone(m)
    stepMarket(m, rng)
    expect(m).toEqual(copy)
  })
})
