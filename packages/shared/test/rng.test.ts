import { describe, expect, it } from 'vitest'
import { between, createRng, pick, randn } from '../src/rng'

describe('rng', () => {
  it('same seed gives the same first 100 values', () => {
    const a = createRng(7)
    const b = createRng(7)
    for (let i = 0; i < 100; i++) expect(a()).toBe(b())
  })

  it('different seeds give different sequences', () => {
    expect(createRng(1)()).not.toBe(createRng(2)())
  })

  it('values stay in [0, 1)', () => {
    const rng = createRng(123)
    for (let i = 0; i < 10_000; i++) {
      const x = rng()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('randn has mean ~0 and sd ~1 over 100000 draws', () => {
    const rng = createRng(99)
    const n = 100_000
    let sum = 0
    let sumSq = 0
    for (let i = 0; i < n; i++) {
      const x = randn(rng)
      sum += x
      sumSq += x * x
    }
    const mean = sum / n
    const sd = Math.sqrt(sumSq / n - mean * mean)
    expect(Math.abs(mean)).toBeLessThan(0.02)
    expect(Math.abs(sd - 1)).toBeLessThan(0.02)
  })

  it('between maps [0, 1) onto [lo, hi)', () => {
    expect(between(() => 0, 5, 9)).toBe(5)
    expect(between(() => 0.5, 5, 9)).toBe(7)
  })

  it('pick returns an element and throws on empty input', () => {
    expect(pick(() => 0.99, ['a', 'b', 'c'])).toBe('c')
    expect(() => pick(createRng(1), [])).toThrow()
  })
})
