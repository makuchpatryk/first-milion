import { describe, expect, it } from 'vitest'
import { formatCountdown, targetProgress } from './countdown'

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

describe('targetProgress (BR-009)', () => {
  it('is the share of the target, clamped to 0..1', () => {
    expect(targetProgress(250, 500)).toBe(0.5)
    expect(targetProgress(-100, 500)).toBe(0)
    expect(targetProgress(900, 500)).toBe(1)
  })

  it('a missing target gives 0', () => {
    expect(targetProgress(100, 0)).toBe(0)
  })
})
