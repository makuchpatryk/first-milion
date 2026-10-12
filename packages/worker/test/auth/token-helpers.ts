import type { Jwks } from '../../src/auth/jwks'

export const PROJECT_ID = 'first-million-test'
export const NOW_MS = 1_800_000_000_000

const nowSec = NOW_MS / 1000

const toBase64Url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let binary = ''
  for (const byte of raw) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface TestKey {
  kid: string
  privateKey: CryptoKey
  jwks: Jwks
}

export async function createTestKey(kid = 'key-1'): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  return { kid, privateKey: pair.privateKey, jwks: { keys: [{ kid, kty: 'RSA', n: jwk.n ?? '', e: jwk.e ?? '' }] } }
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'uid-1',
    iat: nowSec - 60,
    exp: nowSec + 3_600,
    email_verified: true,
    ...overrides,
  }
}

export async function signToken(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): Promise<string> {
  const head = toBase64Url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }))
  const body = toBase64Url(JSON.stringify(claims))
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  )
  return `${head}.${body}.${toBase64Url(new Uint8Array(signature))}`
}

/** An unsigned token, the shape the Firebase Auth emulator issues. */
export function unsignedToken(claims: Record<string, unknown>): string {
  return `${toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${toBase64Url(JSON.stringify(claims))}.`
}

export { toBase64Url }
