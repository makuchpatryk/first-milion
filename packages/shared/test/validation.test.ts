import { describe, expect, it } from 'vitest'
import { createRng } from '../src/rng'
import { isValidNick, randomNick, suffixNick } from '../src/validation'

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
