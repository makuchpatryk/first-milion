import { describe, expect, it } from 'vitest'
import { createRng } from '../src/rng'
import { isValidNick, nickSchema, randomNick, roomFormSchema, suffixNick } from '../src/validation'

const validForm = { name: 'Friday round', durationMin: 5, speed: 3, profitTarget: null }
const parseForm = (patch: Record<string, unknown>) =>
  roomFormSchema.safeParse({ ...validForm, ...patch })

describe('roomFormSchema', () => {
  it('FR-009 AC: a valid form with no target is accepted', () => {
    expect(roomFormSchema.safeParse(validForm).success).toBe(true)
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

  it('FR-009 AC: target 99 and 50 are rejected, 100 and 1_000_000 are accepted', () => {
    expect(parseForm({ profitTarget: 50 }).success).toBe(false)
    expect(parseForm({ profitTarget: 99 }).success).toBe(false)
    expect(parseForm({ profitTarget: 100 }).success).toBe(true)
    expect(parseForm({ profitTarget: 1_000_000 }).success).toBe(true)
  })

  it('FR-009: a fractional target is rejected', () => {
    expect(parseForm({ profitTarget: 150.5 }).success).toBe(false)
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

  it('the profit target key is required', () => {
    const withoutTarget: Record<string, unknown> = { ...validForm }
    delete withoutTarget.profitTarget
    expect(roomFormSchema.safeParse(withoutTarget).success).toBe(false)
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
