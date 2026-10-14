import { describe, expect, it } from 'vitest'
import { bumpGoal, GOAL_SLIDER_STEP, parseWholeNumber } from './goal'

describe('parseWholeNumber (BR-009)', () => {
  it.each([
    ['30000', 30_000],
    ['  30000  ', 30_000],
    ['0', 0],
    ['5000000000', 5_000_000_000],
  ])('%j is %i', (text, value) => {
    expect(parseWholeNumber(text)).toBe(value)
  })

  it.each(['', '  ', 'abc', '12.5', '-100', '1e6', '1 000', `${2 ** 60}`])('%j is not a whole number', (text) => {
    expect(parseWholeNumber(text)).toBeNull()
  })
})

describe('bumpGoal (FR-004)', () => {
  it('moves a goal that is not above the new start to one step above it', () => {
    expect(bumpGoal(50_000, '30000')).toBe(String(50_000 + GOAL_SLIDER_STEP))
    expect(bumpGoal(30_000, '30000')).toBe('31000')
  })

  it('keeps a goal that is still above the new start', () => {
    expect(bumpGoal(10_000, '30000')).toBe('30000')
    expect(bumpGoal(10_000, '10001')).toBe('10001')
  })

  it('keeps text that is not a number yet, the field error handles it', () => {
    expect(bumpGoal(10_000, '')).toBe('')
    expect(bumpGoal(10_000, '3x')).toBe('3x')
  })
})
