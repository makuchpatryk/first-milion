import { describe, expect, it } from 'vitest'
import { createMarket, stepMarket } from '../src/engine/market'
import { createRng } from '../src/rng'

function run(seed: number, ticks: number) {
  const rng = createRng(seed)
  let m = createMarket(rng)
  const prices = [m.price]
  const news: string[] = []
  for (let i = 0; i < ticks; i++) {
    const prev = m.news
    m = stepMarket(m, rng)
    if (m.news !== prev && m.news) news.push(m.news.type)
    prices.push(m.price)
  }
  return { prices, news }
}

describe('determinism', () => {
  it('ARCH invariant: same seed gives the identical price path and news over 5000 ticks', () => {
    const a = run(42, 5_000)
    const b = run(42, 5_000)
    expect(a.prices).toEqual(b.prices)
    expect(a.news).toEqual(b.news)
  })

  it('the path really contains news draws (not just regime noise)', () => {
    expect(run(42, 5_000).news.length).toBeGreaterThan(3)
  })

  it('a different seed gives a different path', () => {
    expect(run(43, 5_000).prices).not.toEqual(run(42, 5_000).prices)
  })
})
