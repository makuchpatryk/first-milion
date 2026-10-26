import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { ADMIN_UID, ORIGIN, emulatorToken } from './helpers'

const me = (headers: Record<string, string>, method = 'GET') =>
  exports.default.fetch('http://worker.test/api/me', { method, headers })

const bearer = (token: string) => ({ Origin: ORIGIN, Authorization: `Bearer ${token}` })

describe('GET /api/me (BR-017)', () => {
  it('tells an admin UID it is an admin, with CORS for the allowed origin only', async () => {
    const response = await me(bearer(emulatorToken(ADMIN_UID)))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ admin: true })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('tells any other verified user it is not an admin', async () => {
    const response = await me(bearer(emulatorToken('uid-1')))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ admin: false })
  })

  it('FR-007: a missing, malformed or unverified token is refused with 401', async () => {
    expect((await me({ Origin: ORIGIN })).status).toBe(401)
    expect((await me(bearer('not-a-token'))).status).toBe(401)
    expect((await me(bearer(emulatorToken('uid-1', { email_verified: false })))).status).toBe(401)
  })

  it('FR-007: a foreign or missing Origin is refused with 403 before the token is read', async () => {
    const token = emulatorToken(ADMIN_UID)
    expect((await me({ Origin: 'https://evil.example', Authorization: `Bearer ${token}` })).status).toBe(403)
    expect((await me({ Authorization: `Bearer ${token}` })).status).toBe(403)
  })

  it('answers the CORS preflight for the allowed origin', async () => {
    const response = await me({ Origin: ORIGIN, 'Access-Control-Request-Headers': 'authorization' }, 'OPTIONS')

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization')
  })

  it('refuses any other method', async () => {
    expect((await me(bearer(emulatorToken(ADMIN_UID)), 'POST')).status).toBe(405)
  })
})
