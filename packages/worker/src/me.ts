import { createVerifier } from './auth/verifier'
import { parseEnv, type Env } from './env'
import { isAllowedOrigin } from './origin'

export const ME_PATH = '/api/me'

const BEARER = /^Bearer (\S+)$/

function json(status: number, body: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  })
}

/**
 * `GET /api/me`: tells a signed-in user whether they are an admin (BR-017), so the web app can
 * show admin-only chrome on pages that open no game socket. Same checks as a socket: `Origin`
 * allowlist first, then the ID token (FR-007), which travels in the `Authorization` header and
 * never in the URL. The answer is the caller's own flag only; no UID or list leaves the Worker.
 */
export async function handleMe(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin')
  if (origin === null || !isAllowedOrigin(origin, env.ALLOWED_ORIGINS)) {
    return new Response(null, { status: 403 })
  }
  const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '600',
      },
    })
  }
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: cors })

  const token = BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
  const config = parseEnv(env)
  const user = token === undefined ? null : await createVerifier(config)(token)
  if (user === null) return new Response(null, { status: 401, headers: cors })
  return json(200, { admin: config.adminUids.has(user.uid) }, cors)
}
