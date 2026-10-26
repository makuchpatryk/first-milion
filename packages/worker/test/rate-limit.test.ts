import { ORDER_RATE_PER_SEC, ORDER_RATE_WINDOW_MS } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import { SlidingWindowLimit } from '../src/rate-limit'

const limiter = () => new SlidingWindowLimit(ORDER_RATE_PER_SEC, ORDER_RATE_WINDOW_MS)

describe('SlidingWindowLimit (BR-018)', () => {
  it('FR-012 AC: 10 attempts within 1 000 ms pass, the 11th is refused', () => {
    const limit = limiter()
    const results = Array.from({ length: 11 }, (_, i) => limit.attempt(i * 50))
    expect(results.slice(0, 10)).toEqual(Array(10).fill(true))
    expect(results[10]).toBe(false)
  })

  it('the window slides: an 11th attempt just inside the window is refused, one window later it passes', () => {
    const inside = limiter()
    for (let i = 0; i < 10; i++) inside.attempt(0)
    expect(inside.attempt(ORDER_RATE_WINDOW_MS - 1)).toBe(false)

    const outside = limiter()
    for (let i = 0; i < 10; i++) outside.attempt(0)
    expect(outside.attempt(ORDER_RATE_WINDOW_MS)).toBe(true) // attempts exactly one window old are out
  })

  it('planning default: refused attempts count, so a flood keeps the window full', () => {
    const limit = limiter()
    for (let t = 0; t < 2_000; t += 50) limit.attempt(t) // 40 attempts, 20 per second
    expect(limit.attempt(2_000)).toBe(false)
  })

  it('PRD §20 #49: a long flood is refused until one full window passes without attempts', () => {
    const limit = limiter()
    for (let i = 0; i < 1_000; i++) limit.attempt(i) // 1 000 attempts in 1 s
    expect(limit.attempt(1_000)).toBe(false)
    expect(limit.attempt(1_000 + ORDER_RATE_WINDOW_MS + 1)).toBe(true)
  })

  it('a steady 5 per second never trips the limit', () => {
    const limit = limiter()
    for (let t = 0; t < 10_000; t += 200) expect(limit.attempt(t)).toBe(true)
  })
})
