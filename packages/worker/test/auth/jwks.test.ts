import { JWKS_FALLBACK_TTL_MS } from '@fm/shared/config'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createJwksFetcher } from '../../src/auth/jwks'
import { createTokenVerifier } from '../../src/auth/verify-token'
import {
  NOW_MS,
  PROJECT_ID,
  createTestKey,
  signToken,
  validClaims,
  type TestKey,
} from './token-helpers'

let key: TestKey
beforeAll(async () => {
  key = await createTestKey()
})

const jwksResponse = (cacheControl?: string) =>
  new Response(JSON.stringify(key.jwks), {
    headers: cacheControl === undefined ? {} : { 'Cache-Control': cacheControl },
  })

function setup(responses: (() => Response | Promise<Response>)[]) {
  let time = NOW_MS
  const fetchFn = vi.fn(() => {
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected fetch')
    return Promise.resolve(next())
  })
  const fetchJwks = createJwksFetcher(fetchFn, () => time)
  return { fetchFn, fetchJwks, advance: (ms: number) => (time += ms) }
}

describe('createJwksFetcher', () => {
  it('a second call within the TTL does not fetch again', async () => {
    const { fetchFn, fetchJwks, advance } = setup([() => jwksResponse('public, max-age=3600')])
    await fetchJwks()
    advance(3_599_000)
    expect(await fetchJwks()).toEqual(key.jwks)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('the Cache-Control max-age sets the TTL', async () => {
    const { fetchFn, fetchJwks, advance } = setup([
      () => jwksResponse('public, max-age=60'),
      () => jwksResponse('public, max-age=60'),
    ])
    await fetchJwks()
    advance(60_000)
    await fetchJwks()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('without max-age the fallback TTL applies', async () => {
    const { fetchFn, fetchJwks, advance } = setup([() => jwksResponse(), () => jwksResponse()])
    await fetchJwks()
    advance(JWKS_FALLBACK_TTL_MS - 1)
    await fetchJwks()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    advance(1)
    await fetchJwks()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('concurrent calls share one request', async () => {
    const { fetchFn, fetchJwks } = setup([() => jwksResponse()])
    await Promise.all([fetchJwks(), fetchJwks(), fetchJwks()])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('a failed refresh keeps serving the stale keys', async () => {
    const { fetchJwks, advance } = setup([
      () => jwksResponse('max-age=10'),
      () => new Response('down', { status: 503 }),
    ])
    await fetchJwks()
    advance(10_000)
    expect(await fetchJwks()).toEqual(key.jwks)
  })

  it('PRD §15: with no keys at all a fetch failure rejects, and the next call retries', async () => {
    const { fetchFn, fetchJwks } = setup([() => new Response('down', { status: 503 }), () => jwksResponse()])
    await expect(fetchJwks()).rejects.toThrow()
    expect(await fetchJwks()).toEqual(key.jwks)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('a malformed JWKS body is treated as a failed fetch', async () => {
    const { fetchJwks } = setup([() => new Response(JSON.stringify({ keys: [{ kid: 1 }] }))])
    await expect(fetchJwks()).rejects.toThrow()
  })

  it('PRD §15: the verifier refuses the token when the JWKS cannot be fetched', async () => {
    const { fetchJwks } = setup([() => Promise.reject(new Error('offline'))])
    const verify = createTokenVerifier({
      projectId: PROJECT_ID,
      emulator: false,
      fetchJwks,
      now: () => NOW_MS,
    })
    expect(await verify(await signToken(key, validClaims()))).toBeNull()
  })
})
