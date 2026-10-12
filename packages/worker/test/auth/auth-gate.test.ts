import { AUTH_TIMEOUT_MS } from '@fm/shared/config'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { AuthGate, type Session } from '../../src/auth/auth-gate'
import type { VerifiedUser } from '../../src/auth/verify-token'
import { FakeClock } from '../fake-clock'

const ADMINS = new Set(['admin-uid'])
const auth = (token: string) => JSON.stringify({ type: 'auth', token })

function setup(tokens: Record<string, VerifiedUser> = { good: { uid: 'u1' }, admin: { uid: 'admin-uid' } }) {
  const clock = new FakeClock()
  const closes: number[] = []
  const authOk: boolean[] = []
  const authed: Session[] = []
  const gate = new AuthGate({
    schedule: clock.schedule,
    cancel: clock.cancel,
    verify: (token) => Promise.resolve(tokens[token] ?? null),
    isAdmin: (uid) => ADMINS.has(uid),
    close: (code) => closes.push(code),
    sendAuthOk: (admin) => authOk.push(admin),
    onAuthed: (session) => authed.push(session),
  })
  return { clock, gate, closes, authOk, authed }
}

describe('AuthGate', () => {
  it('FR-007: a valid token answers auth.ok and opens the session', async () => {
    const { gate, closes, authOk, authed } = setup()
    await gate.handle(auth('good'))
    expect(authOk).toEqual([false])
    expect(authed).toEqual([{ uid: 'u1', admin: false }])
    expect(gate.session).toEqual({ uid: 'u1', admin: false })
    expect(closes).toEqual([])
  })

  it('FR-007 AC: no auth within 5 000 ms closes with 4401', () => {
    const { clock, closes } = setup()
    clock.advance(AUTH_TIMEOUT_MS - 1)
    expect(closes).toEqual([])
    clock.advance(1)
    expect(closes).toEqual([CLOSE_CODES.AUTH_FAILED])
  })

  it('FR-007: auth at 4 999 ms is accepted and the deadline no longer closes the socket', async () => {
    const { clock, gate, closes, authOk } = setup()
    clock.advance(AUTH_TIMEOUT_MS - 1)
    await gate.handle(auth('good'))
    clock.advance(10_000)
    expect(authOk).toEqual([false])
    expect(closes).toEqual([])
    expect(clock.pendingCount).toBe(0)
  })

  it('FR-007 AC: a bad or unverified token closes with 4401', async () => {
    const { gate, closes, authOk } = setup()
    await gate.handle(auth('forged'))
    expect(closes).toEqual([4401])
    expect(authOk).toEqual([])
    expect(gate.session).toBeNull()
  })

  it('FR-007: the first message must be auth, anything else closes with 4401', async () => {
    for (const first of [JSON.stringify({ type: 'room.leave' }), '{not json', JSON.stringify({ type: 'auth' })]) {
      const { gate, closes } = setup()
      await gate.handle(first)
      expect(closes).toEqual([4401])
    }
  })

  it('FR-007: a second frame pipelined behind a pending verify closes the socket', async () => {
    const { gate, closes, authOk } = setup()
    const first = gate.handle(auth('good'))
    await gate.handle(JSON.stringify({ type: 'room.leave' }))
    await first
    expect(closes).toEqual([4401])
    expect(authOk).toEqual([])
  })

  it('BR-017: admin is true only for UIDs on the admin list', async () => {
    const { gate, authOk } = setup()
    await gate.handle(auth('admin'))
    expect(authOk).toEqual([true])
    expect(gate.session).toEqual({ uid: 'admin-uid', admin: true })
  })

  it('FR-007 edge: a second auth with a fresh token for the same user is accepted', async () => {
    const { gate, closes, authOk, authed } = setup({ good: { uid: 'u1' }, fresh: { uid: 'u1' } })
    await gate.handle(auth('good'))
    await gate.handle(auth('fresh'))
    expect(authOk).toEqual([false, false])
    expect(authed).toHaveLength(1) // onAuthed fires once per socket
    expect(closes).toEqual([])
  })

  it('FR-007 edge: a second auth for a different user closes with 4401', async () => {
    const { gate, closes } = setup()
    await gate.handle(auth('good'))
    await gate.handle(auth('admin'))
    expect(closes).toEqual([4401])
  })

  it('FR-007 edge: a second auth with a bad token closes with 4401', async () => {
    const { gate, closes } = setup()
    await gate.handle(auth('good'))
    await gate.handle(auth('forged'))
    expect(closes).toEqual([4401])
  })

  it('non-auth messages after auth are left to the shell, not closed here', async () => {
    const { gate, closes } = setup()
    await gate.handle(auth('good'))
    await gate.handle(JSON.stringify({ type: 'room.leave' }))
    expect(closes).toEqual([])
  })

  it('dispose stops the deadline timer and ignores a verify still in flight', async () => {
    const { clock, gate, closes, authOk } = setup()
    const pending = gate.handle(auth('good'))
    gate.dispose()
    await pending
    clock.advance(AUTH_TIMEOUT_MS * 2)
    expect(authOk).toEqual([])
    expect(closes).toEqual([])
    expect(clock.pendingCount).toBe(0)
  })
})
