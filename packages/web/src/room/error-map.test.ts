import { CLOSE_CODES, ERROR_CODES } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import { closeKey, errorKey } from './error-map'

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null && part in node
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, messages)
}

const hasText = (messages: unknown, key: string) => {
  const value = lookup(messages, key)
  return typeof value === 'string' && value.trim() !== ''
}

describe('error map (FR-019)', () => {
  it.each(ERROR_CODES)('FR-019: error code %s has PL and EN text', (code) => {
    const key = errorKey(code)
    expect(hasText(pl, key), `pl ${key}`).toBe(true)
    expect(hasText(en, key), `en ${key}`).toBe(true)
  })

  it('every error code maps to its own key', () => {
    const keys = ERROR_CODES.map(errorKey)
    expect(new Set(keys).size).toBe(ERROR_CODES.length)
  })

  it.each(Object.values(CLOSE_CODES))('FR-019: close code %i has PL and EN text', (code) => {
    const key = closeKey(code)
    expect(hasText(pl, key), `pl ${key}`).toBe(true)
    expect(hasText(en, key), `en ${key}`).toBe(true)
  })

  it('an unknown close code is a network loss, with text', () => {
    expect(closeKey(1006)).toBe('close.network')
    expect(hasText(pl, 'close.network')).toBe(true)
    expect(hasText(en, 'close.network')).toBe(true)
  })
})
