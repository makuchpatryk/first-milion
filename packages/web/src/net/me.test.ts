import { describe, expect, it, vi } from 'vitest'
import { fetchIsAdmin } from './me'

const reply = (status: number, body: unknown): typeof fetch =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))

describe('fetchIsAdmin (BR-017)', () => {
  it('sends the token in the Authorization header, not in the URL', async () => {
    const fetchFn = reply(200, { admin: true })

    expect(await fetchIsAdmin('http://127.0.0.1:8787', 'tok', fetchFn)).toBe(true)

    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? []
    expect(url instanceof URL ? url.href : '').toBe('http://127.0.0.1:8787/api/me')
    expect(init?.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('returns false for a non-admin', async () => {
    expect(await fetchIsAdmin('http://w.test', 'tok', reply(200, { admin: false }))).toBe(false)
  })

  it('throws on a refusal or an unexpected body, so the caller keeps its state', async () => {
    await expect(fetchIsAdmin('http://w.test', 'tok', reply(401, {}))).rejects.toThrow()
    await expect(fetchIsAdmin('http://w.test', 'tok', reply(200, { admin: 'yes' }))).rejects.toThrow()
    await expect(fetchIsAdmin('http://w.test', 'tok', reply(200, null))).rejects.toThrow()
  })
})
