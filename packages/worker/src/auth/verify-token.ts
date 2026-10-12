import { z } from 'zod'
import type { Jwks } from './jwks'

/** The email never leaves this module (ARCHITECTURE Privacy); only the UID is returned. */
export interface VerifiedUser {
  uid: string
}
export type TokenVerifier = (token: string) => Promise<VerifiedUser | null>

export interface TokenVerifierOptions {
  projectId: string
  /** Dev only: accept unsigned (`alg: none`) Firebase Auth emulator tokens. */
  emulator: boolean
  fetchJwks: () => Promise<Jwks>
  now: () => number
}

const CLOCK_SKEW_MS = 60_000

const headerSchema = z.object({ alg: z.string(), kid: z.string().optional() })
const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  sub: z.string().min(1),
  email_verified: z.boolean(),
})

function base64UrlToBytes(part: string): Uint8Array<ArrayBuffer> {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)))
}

/**
 * Verifies a Firebase ID token (FR-007, NFR-004): RS256 signature against the project JWKS,
 * issuer, audience, expiry and `email_verified` (BR-002). Any failure → `null`, never a throw.
 */
export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const { projectId, emulator, fetchJwks, now } = opts

  async function signatureValid(
    kid: string | undefined,
    signingInput: string,
    signature: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    if (kid === undefined) return false
    // No refetch on an unknown `kid`: the fetcher is TTL-cached, so a second call would return the
    // same keys. Google publishes a new key before it signs with it; the cache expiry picks it up.
    const jwk = (await fetchJwks()).keys.find((key) => key.kid === kid)
    if (jwk === undefined) return false
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(signingInput),
    )
  }

  return async (token) => {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

      const header = headerSchema.safeParse(decodeJson(headerPart))
      if (!header.success) return null
      const { alg, kid } = header.data
      // `alg: none` is accepted only for emulator tokens (dev); anything but RS256 otherwise.
      if (alg === 'none') {
        if (!emulator) return null
      } else if (alg !== 'RS256') {
        return null
      } else if (!(await signatureValid(kid, `${headerPart}.${payloadPart}`, base64UrlToBytes(signaturePart)))) {
        return null
      }

      const claims = claimsSchema.safeParse(decodeJson(payloadPart))
      if (!claims.success) return null
      const c = claims.data
      const nowMs = now()
      if (c.iss !== `https://securetoken.google.com/${projectId}`) return null
      if (c.aud !== projectId) return null
      if (c.exp * 1000 <= nowMs) return null
      if (c.iat * 1000 > nowMs + CLOCK_SKEW_MS) return null
      if (!c.email_verified) return null
      return { uid: c.sub }
    } catch {
      return null
    }
  }
}
