import { describe, expect, it } from 'vitest'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import { AUTH_ERROR_CODES, authErrorKey, authErrorKeyOf, UNKNOWN_AUTH_ERROR_KEY } from './errors'

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return typeof node === 'object' && node !== null && part in node
      ? (node as Record<string, unknown>)[part]
      : undefined
  }, messages)
}

describe('authErrorKey', () => {
  it.each([
    ['auth/invalid-email', 'auth.error.invalidEmail'],
    ['auth/email-already-in-use', 'auth.error.emailInUse'],
    ['auth/weak-password', 'auth.error.weakPassword'],
    ['auth/invalid-credential', 'auth.error.invalidCredential'],
    ['auth/wrong-password', 'auth.error.wrongPassword'],
    ['auth/user-not-found', 'auth.error.invalidCredential'],
    ['auth/too-many-requests', 'auth.error.tooManyRequests'],
    ['auth/network-request-failed', 'auth.error.network'],
    ['auth/requires-recent-login', 'auth.error.requiresRecentLogin'],
  ])('FR-001: %s maps to %s', (code, key) => {
    expect(authErrorKey(code)).toBe(key)
  })

  it('FR-001: unknown and non-string codes map to auth.error.unknown', () => {
    expect(authErrorKey('auth/something-new')).toBe(UNKNOWN_AUTH_ERROR_KEY)
    expect(authErrorKey(undefined)).toBe(UNKNOWN_AUTH_ERROR_KEY)
    expect(authErrorKey(401)).toBe(UNKNOWN_AUTH_ERROR_KEY)
    expect(authErrorKey({ code: 'auth/invalid-email' })).toBe(UNKNOWN_AUTH_ERROR_KEY)
  })

  it('FR-001: the message text is never consulted', () => {
    expect(authErrorKeyOf({ code: 'auth/invalid-email', message: 'auth/weak-password' })).toBe(
      'auth.error.invalidEmail',
    )
    expect(authErrorKeyOf(new Error('auth/invalid-email'))).toBe(UNKNOWN_AUTH_ERROR_KEY)
    expect(authErrorKeyOf(null)).toBe(UNKNOWN_AUTH_ERROR_KEY)
  })

  it('FR-019: every mapped key exists in PL and EN', () => {
    const keys = [UNKNOWN_AUTH_ERROR_KEY, ...AUTH_ERROR_CODES.map((code) => authErrorKey(code))]
    for (const key of keys) {
      expect(typeof lookup(pl, key)).toBe('string')
      expect(typeof lookup(en, key)).toBe('string')
    }
  })
})
