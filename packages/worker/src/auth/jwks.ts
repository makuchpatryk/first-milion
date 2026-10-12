import { JWKS_FALLBACK_TTL_MS } from '@fm/shared/config'
import { z } from 'zod'

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'

// The JWKS body is network data: `unknown` until parsed here.
const jwkSchema = z.object({
  kid: z.string().min(1),
  kty: z.literal('RSA'),
  n: z.string().min(1),
  e: z.string().min(1),
})
export type Jwk = z.infer<typeof jwkSchema>

export const jwksSchema = z.object({ keys: z.array(jwkSchema) })
export type Jwks = z.infer<typeof jwksSchema>

export type FetchFn = (url: string) => Promise<Response>

function maxAgeMs(response: Response): number {
  const match = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')
  return match?.[1] === undefined ? JWKS_FALLBACK_TTL_MS : Number(match[1]) * 1000
}

/**
 * Cached JWKS getter. The cache lives in memory only (BR-020 allows that: it is not state).
 * A failed refresh keeps serving the stale keys; with no keys at all it throws and the
 * verifier refuses the token (PRD §15).
 */
export function createJwksFetcher(fetchFn: FetchFn, now: () => number): () => Promise<Jwks> {
  let cached: { jwks: Jwks; expiresAt: number } | null = null
  let inflight: Promise<Jwks> | null = null

  async function refresh(): Promise<Jwks> {
    try {
      const response = await fetchFn(FIREBASE_JWKS_URL)
      if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)
      const jwks = jwksSchema.parse(await response.json())
      cached = { jwks, expiresAt: now() + maxAgeMs(response) }
      return jwks
    } catch (error) {
      if (cached !== null) return cached.jwks
      throw error
    }
  }

  return () => {
    if (cached !== null && now() < cached.expiresAt) return Promise.resolve(cached.jwks)
    inflight ??= refresh().finally(() => {
      inflight = null
    })
    return inflight
  }
}

export const fetchFirebaseJwks = createJwksFetcher(
  (url) => fetch(url),
  () => Date.now(),
)
