import { describe, expect, it } from 'vitest'
import { FLASH_RECOVER, FLASH_TICKS, TREND_DRIFT, TREND_TICKS } from '../src/config'
import { createMarket, stepMarket } from '../src/engine/market'
import { drawNews, drawNewsGap, type NewsEvent } from '../src/engine/news'
import { createRng } from '../src/rng'
import { MIN_PRICE } from '../src/rules'
import { quietMarket, sequence } from './helpers'

// rng() values that select a news type: floor(v * 4)
const TYPE = { SHOCK: 0.1, FLASH_CRASH: 0.3, VOL_SPIKE: 0.5, TREND: 0.9 }
const UP = 0.2 // rng() < 0.5 → dir +1
const DOWN = 0.8

const base = () => quietMarket(createMarket(createRng(1)))

describe('drawNewsGap', () => {
  it('BR-015: first gap is 200-400 ticks, later gaps 250-650', () => {
    const rng = createRng(11)
    for (let i = 0; i < 2_000; i++) {
      const first = drawNewsGap(rng, true)
      expect(first).toBeGreaterThanOrEqual(200)
      expect(first).toBeLessThanOrEqual(400)
      const later = drawNewsGap(rng, false)
      expect(later).toBeGreaterThanOrEqual(250)
      expect(later).toBeLessThanOrEqual(650)
    }
  })
})

describe('drawNews', () => {
  it('FR-005: 10000 seeded draws put every type within 23-27%', () => {
    const rng = createRng(31337)
    const counts = new Map<NewsEvent['type'], number>()
    for (let i = 0; i < 10_000; i++) {
      const type = drawNews(rng, base()).news?.type
      if (!type) throw new Error('drawNews returned no news')
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    expect(counts.size).toBe(4)
    for (const n of counts.values()) {
      expect(n / 10_000).toBeGreaterThanOrEqual(0.23)
      expect(n / 10_000).toBeLessThanOrEqual(0.27)
    }
  })

  it('BR-015: drawing news schedules the next one 250-650 ticks out and resets the age', () => {
    const m = drawNews(createRng(2), { ...base(), newsAge: 40 })
    expect(m.newsLeft).toBeGreaterThanOrEqual(250)
    expect(m.newsLeft).toBeLessThanOrEqual(650)
    expect(m.newsAge).toBe(0)
  })

  it('BR-015: SHOCK moves the price immediately by 1.2-3.2% in the drawn direction', () => {
    const up = drawNews(sequence([TYPE.SHOCK, UP, 0.5, 0, 0]), base())
    const down = drawNews(sequence([TYPE.SHOCK, DOWN, 0.5, 1 - 1e-9, 0.99]), base())
    expect(up.news).toMatchObject({ type: 'SHOCK', dir: 1 })
    expect(up.price / 100).toBeGreaterThanOrEqual(Math.exp(0.012) - 1e-9)
    expect(down.news).toMatchObject({ type: 'SHOCK', dir: -1, idx: 3 })
    expect(down.price / 100).toBeCloseTo(Math.exp(-0.032), 6)
  })

  it('BR-015 / FR-005: FLASH_CRASH drops the price 3-8%', () => {
    for (const r of [0, 0.5, 1 - 1e-9]) {
      const m = drawNews(sequence([TYPE.FLASH_CRASH, UP, 0.5, r]), base())
      expect(m.price).toBeGreaterThanOrEqual(92 - 1e-6)
      expect(m.price).toBeLessThanOrEqual(97 + 1e-6)
    }
  })

  it('FR-005 AC: 20 ticks after a FLASH_CRASH, 70% of the drop is recovered', () => {
    let m = drawNews(sequence([TYPE.FLASH_CRASH, UP, 0.5, 0.5]), base())
    const crashed = m.price
    const drop = 100 - crashed
    const rng = createRng(1)
    for (let i = 0; i < FLASH_TICKS; i++) m = stepMarket(m, rng)
    expect(m.price).toBeCloseTo(crashed + FLASH_RECOVER * drop, 9)
    expect(m.flash).toBeNull()
    // recovery stops after 20 ticks
    expect(stepMarket(m, rng).price).toBeCloseTo(m.price, 9)
  })

  it('FLASH_CRASH never pushes the price under the minimum', () => {
    const m = drawNews(sequence([TYPE.FLASH_CRASH, UP, 0.5, 1]), { ...base(), price: MIN_PRICE })
    expect(m.price).toBe(MIN_PRICE)
    expect(m.flash?.perTick).toBe(0)
  })

  it('BR-015: VOL_SPIKE sets 60 ticks of tripled volatility without moving the price', () => {
    const m = drawNews(sequence([TYPE.VOL_SPIKE, UP, 0.5]), base())
    expect(m.volLeft).toBe(60)
    expect(m.price).toBe(100)
  })

  it('BR-015: TREND sets +-0.0007 drift for 100 ticks', () => {
    const up = drawNews(sequence([TYPE.TREND, UP, 0.5]), base())
    const down = drawNews(sequence([TYPE.TREND, DOWN, 0.5]), base())
    expect(up.trend).toEqual({ left: TREND_TICKS, drift: TREND_DRIFT })
    expect(down.trend).toEqual({ left: TREND_TICKS, drift: -TREND_DRIFT })
  })

  it('FR-005 edge: a new TREND replaces the running trend', () => {
    const running = { ...base(), trend: { left: 10, drift: -TREND_DRIFT } }
    const m = drawNews(sequence([TYPE.TREND, UP, 0.5]), running)
    expect(m.trend).toEqual({ left: TREND_TICKS, drift: TREND_DRIFT })
  })
})
