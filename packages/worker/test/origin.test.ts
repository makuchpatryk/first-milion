import { describe, expect, it } from 'vitest'
import { parseEnv, type Env } from '../src/env'
import { isAllowedOrigin } from '../src/origin'

describe('isAllowedOrigin', () => {
  const allowlist = 'http://localhost:5173,https://first-million.pages.dev'

  it('FR-007: an origin on the list is allowed', () => {
    expect(isAllowedOrigin('http://localhost:5173', allowlist)).toBe(true)
    expect(isAllowedOrigin('https://first-million.pages.dev', allowlist)).toBe(true)
  })

  it('FR-007 AC: a foreign origin is refused', () => {
    expect(isAllowedOrigin('https://evil.example', allowlist)).toBe(false)
  })

  it('FR-007: a missing Origin header is refused', () => {
    expect(isAllowedOrigin(null, allowlist)).toBe(false)
  })

  it('FR-007: matching is exact, with no prefix, suffix or wildcard match', () => {
    expect(isAllowedOrigin('http://localhost:5173.evil.example', allowlist)).toBe(false)
    expect(isAllowedOrigin('http://localhost:517', allowlist)).toBe(false)
    expect(isAllowedOrigin('http://localhost:5173/', allowlist)).toBe(false)
    expect(isAllowedOrigin('https://anything.example', '*')).toBe(false)
  })

  it('an empty allowlist refuses everything, including the empty origin', () => {
    expect(isAllowedOrigin('http://localhost:5173', '')).toBe(false)
    expect(isAllowedOrigin('', '')).toBe(false)
  })

  it('spaces around list entries are ignored', () => {
    expect(isAllowedOrigin('https://b.example', 'https://a.example , https://b.example')).toBe(true)
  })
})

describe('parseEnv', () => {
  const base = {
    ROOM: {},
    LOBBY: {},
    FIREBASE_PROJECT_ID: 'p',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    ADMIN_UIDS: 'a1, b2,,',
  } as unknown as Env

  it('BR-017: ADMIN_UIDS is split on commas, blanks dropped', () => {
    expect([...parseEnv(base).adminUids]).toEqual(['a1', 'b2'])
  })

  it('FR-007: AUTH_EMULATOR is on only for the exact string "true"', () => {
    expect(parseEnv({ ...base, AUTH_EMULATOR: 'true' }).emulator).toBe(true)
    for (const value of ['TRUE', '1', 'yes', 'true ', '']) {
      expect(parseEnv({ ...base, AUTH_EMULATOR: value }).emulator).toBe(false)
    }
    expect(parseEnv(base).emulator).toBe(false)
  })

  it('a missing ADMIN_UIDS means no admins', () => {
    const withoutAdmins: Partial<Env> = { ...base }
    delete withoutAdmins.ADMIN_UIDS
    expect(parseEnv(withoutAdmins as Env).adminUids.size).toBe(0)
  })
})
