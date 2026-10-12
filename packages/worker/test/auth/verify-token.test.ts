import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTokenVerifier, type TokenVerifier } from '../../src/auth/verify-token'
import {
  NOW_MS,
  PROJECT_ID,
  createTestKey,
  signToken,
  toBase64Url,
  unsignedToken,
  validClaims,
  type TestKey,
} from './token-helpers'

let key: TestKey
let verify: TokenVerifier
let verifyEmulator: TokenVerifier

beforeAll(async () => {
  key = await createTestKey()
  const base = { projectId: PROJECT_ID, fetchJwks: () => Promise.resolve(key.jwks), now: () => NOW_MS }
  verify = createTokenVerifier({ ...base, emulator: false })
  verifyEmulator = createTokenVerifier({ ...base, emulator: true })
})

describe('createTokenVerifier (production)', () => {
  it('FR-007: a valid token yields the UID', async () => {
    expect(await verify(await signToken(key, validClaims()))).toEqual({ uid: 'uid-1' })
  })

  it('the result carries the UID only, never the email', async () => {
    const user = await verify(await signToken(key, validClaims({ email: 'a@b.c' })))
    expect(user).toEqual({ uid: 'uid-1' })
  })

  it('FR-007 AC, BR-002: email_verified false is refused', async () => {
    expect(await verify(await signToken(key, validClaims({ email_verified: false })))).toBeNull()
  })

  it('FR-007: a missing email_verified claim is refused', async () => {
    const claims = validClaims()
    delete claims.email_verified
    expect(await verify(await signToken(key, claims))).toBeNull()
  })

  it('FR-007: wrong audience is refused', async () => {
    expect(await verify(await signToken(key, validClaims({ aud: 'other-project' })))).toBeNull()
  })

  it('FR-007: wrong issuer is refused', async () => {
    const iss = 'https://securetoken.google.com/other-project'
    expect(await verify(await signToken(key, validClaims({ iss })))).toBeNull()
  })

  it('FR-007: an expired token is refused, one expiring in the future is accepted', async () => {
    const nowSec = NOW_MS / 1000
    expect(await verify(await signToken(key, validClaims({ exp: nowSec - 1 })))).toBeNull()
    expect(await verify(await signToken(key, validClaims({ exp: nowSec })))).toBeNull()
    expect(await verify(await signToken(key, validClaims({ exp: nowSec + 1 })))).not.toBeNull()
  })

  it('FR-007: iat more than 60 s in the future is refused, 60 s is tolerated', async () => {
    const nowSec = NOW_MS / 1000
    expect(await verify(await signToken(key, validClaims({ iat: nowSec + 61 })))).toBeNull()
    expect(await verify(await signToken(key, validClaims({ iat: nowSec + 60 })))).not.toBeNull()
  })

  it('FR-007: an empty or missing sub is refused', async () => {
    expect(await verify(await signToken(key, validClaims({ sub: '' })))).toBeNull()
    const claims = validClaims()
    delete claims.sub
    expect(await verify(await signToken(key, claims))).toBeNull()
  })

  it('NFR-004: a tampered payload fails the signature check', async () => {
    const [head, , signature] = (await signToken(key, validClaims())).split('.')
    const forged = toBase64Url(JSON.stringify(validClaims({ sub: 'admin-uid' })))
    expect(await verify(`${head}.${forged}.${signature}`)).toBeNull()
  })

  it('NFR-004: a token signed by another key is refused', async () => {
    const stranger = await createTestKey(key.kid)
    expect(await verify(await signToken(stranger, validClaims()))).toBeNull()
  })

  it('NFR-004: alg none is refused in production', async () => {
    expect(await verify(unsignedToken(validClaims()))).toBeNull()
  })

  it('NFR-004: an algorithm other than RS256 is refused', async () => {
    expect(await verify(await signToken(key, validClaims(), { alg: 'HS256' }))).toBeNull()
  })

  it('a kid missing from the JWKS is refused with a single JWKS lookup', async () => {
    const fetchJwks = vi.fn(() => Promise.resolve(key.jwks))
    const verifier = createTokenVerifier({ projectId: PROJECT_ID, emulator: false, fetchJwks, now: () => NOW_MS })
    expect(await verifier(await signToken(key, validClaims(), { kid: 'unknown' }))).toBeNull()
    expect(fetchJwks).toHaveBeenCalledTimes(1)
  })

  it('a rotated-in key is accepted once the JWKS carries it', async () => {
    const fresh = await createTestKey('key-2')
    const fetchJwks = vi.fn(() => Promise.resolve({ keys: [...key.jwks.keys, ...fresh.jwks.keys] }))
    const verifier = createTokenVerifier({ projectId: PROJECT_ID, emulator: false, fetchJwks, now: () => NOW_MS })
    expect(await verifier(await signToken(fresh, validClaims()))).toEqual({ uid: 'uid-1' })
  })

  it('PRD §15: a JWKS fetch failure refuses the token instead of throwing', async () => {
    const verifier = createTokenVerifier({
      projectId: PROJECT_ID,
      emulator: false,
      fetchJwks: () => Promise.reject(new Error('network down')),
      now: () => NOW_MS,
    })
    expect(await verifier(await signToken(key, validClaims()))).toBeNull()
  })

  it('malformed input is refused without throwing', async () => {
    for (const token of ['', 'abc', 'a.b', 'a.b.c', '!!!.???.***', 'a.b.c.d']) {
      expect(await verify(token)).toBeNull()
    }
  })
})

describe('createTokenVerifier (emulator)', () => {
  it('PRD §20 #35: an unsigned token is accepted in emulator mode', async () => {
    expect(await verifyEmulator(unsignedToken(validClaims()))).toEqual({ uid: 'uid-1' })
  })

  it('claims are still checked in emulator mode', async () => {
    expect(await verifyEmulator(unsignedToken(validClaims({ email_verified: false })))).toBeNull()
    expect(await verifyEmulator(unsignedToken(validClaims({ aud: 'other' })))).toBeNull()
    expect(await verifyEmulator(unsignedToken(validClaims({ exp: 1 })))).toBeNull()
  })

  it('a signed token still has its signature checked in emulator mode', async () => {
    const stranger = await createTestKey(key.kid)
    expect(await verifyEmulator(await signToken(stranger, validClaims()))).toBeNull()
  })
})
