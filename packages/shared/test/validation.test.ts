import { describe, expect, it } from 'vitest'
import { createRng } from '../src/rng'
import {
  isValidNick,
  nickSchema,
  randomNick,
  roomFormSchema,
  stakesSchema,
  suffixNick,
} from '../src/validation'

const validForm = { name: 'Friday round', durationMin: 5, speed: 3, startCash: 10_000, goal: 30_000 }
const parseForm = (patch: Record<string, unknown>) =>
  roomFormSchema.safeParse({ ...validForm, ...patch })

const validStakes = { startCash: 10_000, goal: 30_000 }
const parseStakes = (patch: Record<string, unknown>) =>
  stakesSchema.safeParse({ ...validStakes, ...patch })

/** Paths of the issues of a failed parse. */
const failedPaths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? []

describe('roomFormSchema', () => {
  it('BR-009: a valid form is accepted', () => {
    expect(roomFormSchema.safeParse(validForm).success).toBe(true)
  })

  it('BR-009: a null goal is rejected, the goal is required', () => {
    expect(parseForm({ goal: null }).success).toBe(false)
  })

  it('FR-009 AC: name of 2 characters is rejected, 3 and 30 are accepted, 31 is rejected', () => {
    expect(parseForm({ name: 'ab' }).success).toBe(false)
    expect(parseForm({ name: 'abc' }).success).toBe(true)
    expect(parseForm({ name: 'a'.repeat(30) }).success).toBe(true)
    expect(parseForm({ name: 'a'.repeat(31) }).success).toBe(false)
  })

  it('FR-009: the name is trimmed before the length check', () => {
    expect(parseForm({ name: '  ab  ' }).success).toBe(false)
    const parsed = parseForm({ name: '  abc  ' })
    expect(parsed.success && parsed.data.name).toBe('abc')
  })

  it('BR-009: the goal must be above the start; equal or below is rejected on the goal field', () => {
    expect(failedPaths(parseForm({ startCash: 10_000, goal: 10_000 }))).toEqual(['goal'])
    expect(failedPaths(parseForm({ startCash: 10_000, goal: 9_000 }))).toEqual(['goal'])
    expect(parseForm({ startCash: 10_000, goal: 10_001 }).success).toBe(true)
  })

  it('BR-009: the goal has no upper limit, also far above the slider range', () => {
    expect(parseForm({ goal: 1_000_000 }).success).toBe(true)
    expect(parseForm({ goal: 5_000_000_000 }).success).toBe(true)
    expect(parseForm({ goal: Number.MAX_SAFE_INTEGER }).success).toBe(true)
  })

  it('BR-009: an unsafe integer, a non-finite or a non-positive goal is rejected', () => {
    for (const goal of [2 ** 60, Infinity, NaN, 0, -5]) expect(parseForm({ goal }).success).toBe(false)
  })

  it('FR-009: a fractional goal is rejected', () => {
    expect(parseForm({ goal: 30_000.5 }).success).toBe(false)
  })

  it('BR-003 AC: start 1,000 and 100,000 are accepted, 0, 500 and 101,000 are rejected', () => {
    expect(parseForm({ startCash: 1_000, goal: 2_000 }).success).toBe(true)
    expect(parseForm({ startCash: 100_000, goal: 200_000 }).success).toBe(true)
    for (const startCash of [0, 500, 101_000]) expect(parseForm({ startCash }).success).toBe(false)
  })

  it('BR-003: a start off the 1,000 grid or fractional is rejected', () => {
    for (const startCash of [1_500, 10_001, 9_999.5]) {
      expect(failedPaths(parseForm({ startCash }))).toContain('startCash')
    }
  })

  it('FR-009: duration and speed must come from the allowed sets', () => {
    expect(parseForm({ durationMin: 4 }).success).toBe(false)
    expect(parseForm({ speed: 2 }).success).toBe(false)
    for (const durationMin of [3, 5, 10]) expect(parseForm({ durationMin }).success).toBe(true)
    for (const speed of [1, 3, 8]) expect(parseForm({ speed }).success).toBe(true)
  })

  it('NFR-004: an unknown key is rejected', () => {
    expect(parseForm({ price: 1 }).success).toBe(false)
  })

  it('the startCash and goal keys are required; the old profitTarget key is unknown', () => {
    for (const key of ['startCash', 'goal']) {
      const without: Record<string, unknown> = { ...validForm }
      delete without[key]
      expect(roomFormSchema.safeParse(without).success).toBe(false)
    }
    expect(parseForm({ profitTarget: 20_000 }).success).toBe(false)
  })
})

describe('stakesSchema', () => {
  it('FR-003 / FR-004: the defaults and a goal above the slider range are accepted', () => {
    expect(stakesSchema.safeParse(validStakes).success).toBe(true)
    expect(parseStakes({ goal: 3_000_000 }).success).toBe(true)
  })

  it('FR-004: goal <= start is a goal error, a bad start is a startCash error', () => {
    expect(failedPaths(parseStakes({ goal: 10_000 }))).toEqual(['goal'])
    expect(failedPaths(parseStakes({ startCash: 1_500 }))).toEqual(['startCash'])
  })

  it('FR-004: a fractional goal and an unknown key are rejected', () => {
    expect(parseStakes({ goal: 30_000.5 }).success).toBe(false)
    expect(parseStakes({ price: 1 }).success).toBe(false)
  })
})

describe('nickSchema', () => {
  it('BR-016: accepts what isValidNick accepts and rejects the rest', () => {
    for (const nick of ['abc', 'Az09_-x', 'a'.repeat(16)]) expect(nickSchema.safeParse(nick).success).toBe(true)
    for (const nick of ['ab', 'a'.repeat(17), 'jan#2', 'abc\n']) {
      expect(nickSchema.safeParse(nick).success).toBe(false)
    }
  })
})

describe('isValidNick', () => {
  it('FR-002: "ab" is rejected (too short)', () => {
    expect(isValidNick('ab')).toBe(false)
  })

  it('FR-002: 3 and 16 characters are accepted, 17 is rejected', () => {
    expect(isValidNick('abc')).toBe(true)
    expect(isValidNick('a'.repeat(16))).toBe(true)
    expect(isValidNick('a'.repeat(17))).toBe(false)
  })

  it('BR-016: letters, digits, underscore and hyphen are allowed', () => {
    expect(isValidNick('Az09_-x')).toBe(true)
  })

  it('BR-016: other characters are rejected', () => {
    for (const bad of ['jan kowalski', 'jan#2', 'zażółć', 'a@b', 'name!', '']) {
      expect(isValidNick(bad)).toBe(false)
    }
  })

  it('BR-016: a trailing newline does not slip through', () => {
    expect(isValidNick('abc\n')).toBe(false)
  })
})

describe('randomNick', () => {
  it('FR-002 AC: matches Trader-NNNN and is itself a valid nick', () => {
    const rng = createRng(5)
    for (let i = 0; i < 1_000; i++) {
      const nick = randomNick(rng)
      expect(nick).toMatch(/^Trader-\d{4}$/)
      expect(isValidNick(nick)).toBe(true)
    }
  })

  it('zero-pads small numbers', () => {
    expect(randomNick(() => 0.0042)).toBe('Trader-0042')
    expect(randomNick(() => 0)).toBe('Trader-0000')
  })
})

describe('suffixNick', () => {
  it('FR-002 AC: second "Jan" becomes "Jan#2"', () => {
    expect(suffixNick('Jan', 2)).toBe('Jan#2')
  })
})
