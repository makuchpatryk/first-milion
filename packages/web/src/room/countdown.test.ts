import { describe, expect, it } from 'vitest'
import { formatCountdown, goalProgress } from './countdown'

describe('formatCountdown (UF-004)', () => {
  it.each([
    [300_000, '5:00'],
    [59_001, '1:00'],
    [59_000, '0:59'],
    [1, '0:01'],
    [0, '0:00'],
    [-50, '0:00'],
  ])('%i ms shows %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text)
  })
})

describe('goalProgress (BR-009)', () => {
  it('is the share of the way from the start capital to the goal, clamped to 0..1', () => {
    expect(goalProgress(10_000, 10_000, 30_000)).toBe(0)
    expect(goalProgress(15_000, 10_000, 20_000)).toBe(0.5)
    expect(goalProgress(9_000, 10_000, 20_000)).toBe(0)
    expect(goalProgress(25_000, 10_000, 20_000)).toBe(1)
  })

  it('follows a non-default start capital', () => {
    expect(goalProgress(3_000, 1_000, 5_000)).toBe(0.5)
  })

  it('a goal that is not above the start gives 0', () => {
    expect(goalProgress(100, 10_000, 10_000)).toBe(0)
    expect(goalProgress(100, 10_000, 5_000)).toBe(0)
  })

  it('a huge goal stays inside 0..1', () => {
    const progress = goalProgress(20_000, 10_000, Number.MAX_SAFE_INTEGER)
    expect(progress).toBeGreaterThan(0)
    expect(progress).toBeLessThan(1)
  })
})
