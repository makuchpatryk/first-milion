import type { ServerMessage } from '@fm/shared/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createSocket, type SocketStatus, type WebSocketLike } from './ws-client'

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: unknown[] = []
  closedWith: number | undefined
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number): void {
    this.closedWith = code
  }
  open(): void {
    this.onopen?.()
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) })
  }
  drop(code: number): void {
    this.onclose?.({ code })
  }
}

interface Timer {
  fn: () => void
  ms: number
  cancelled: boolean
}

function setup() {
  const sockets: FakeSocket[] = []
  const timers: Timer[] = []
  const statuses: Array<[SocketStatus, number | undefined]> = []
  const messages: ServerMessage[] = []
  const getToken = vi.fn((force: boolean) => Promise.resolve(force ? 'fresh' : 'tok'))
  const handle = createSocket({
    url: 'ws://x/ws/lobby',
    getToken,
    onMessage: (m) => messages.push(m),
    onStatus: (s, code) => statuses.push([s, code]),
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false }
      timers.push(timer)
      return timer
    },
    cancel: (h) => {
      ;(h as Timer).cancelled = true
    },
    openSocket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
  })
  const last = () => sockets[sockets.length - 1] as FakeSocket
  /** Opens the newest socket and lets the async token fetch settle. */
  const connectAndAuth = async () => {
    last().open()
    await Promise.resolve()
  }
  const runLastTimer = () => {
    const timer = timers[timers.length - 1] as Timer
    timer.fn()
  }
  return { handle, sockets, timers, statuses, messages, getToken, last, connectAndAuth, runLastTimer }
}

describe('createSocket', () => {
  it('FR-007: sends auth first on open, and is ready only after auth.ok', async () => {
    const t = setup()
    await t.connectAndAuth()
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'tok' }])
    expect(t.statuses.map(([s]) => s)).toEqual(['connecting'])

    t.last().receive({ type: 'auth.ok', admin: false })
    expect(t.statuses.map(([s]) => s)).toEqual(['connecting', 'ready'])
    expect(t.messages).toEqual([{ type: 'auth.ok', admin: false }])
  })

  it('FR-015: reconnect backoff is 500, 1000, 2000, 4000, 8000, 8000 ms', () => {
    const t = setup()
    const delays: number[] = []
    for (let i = 0; i < 6; i++) {
      t.last().drop(1006)
      delays.push((t.timers[t.timers.length - 1] as Timer).ms)
      t.runLastTimer()
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000])
    expect(t.statuses.filter(([s]) => s === 'reconnecting')).toHaveLength(6)
  })

  it('FR-015: a successful auth resets the backoff', async () => {
    const t = setup()
    t.last().drop(1006)
    t.runLastTimer()
    t.last().drop(1006)
    t.runLastTimer()
    await t.connectAndAuth()
    t.last().receive({ type: 'auth.ok', admin: false })
    t.last().drop(1006)
    expect((t.timers[t.timers.length - 1] as Timer).ms).toBe(500)
  })

  it('FR-007: a 4401 forces one token refresh and reconnects; a second 4401 closes for good', async () => {
    const t = setup()
    t.last().drop(4401)
    expect(t.sockets).toHaveLength(2)
    await t.connectAndAuth()
    expect(t.getToken).toHaveBeenLastCalledWith(true)
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'fresh' }])

    t.last().drop(4401)
    expect(t.sockets).toHaveLength(2)
    expect(t.statuses[t.statuses.length - 1]).toEqual(['closed', 4401])
  })

  it('FR-007: after a good auth.ok a later 4401 gets its own refresh', async () => {
    const t = setup()
    t.last().drop(4401)
    await t.connectAndAuth()
    t.last().receive({ type: 'auth.ok', admin: false })
    t.last().drop(4401)
    expect(t.sockets).toHaveLength(3)
  })

  it.each([4403, 4410])('BR-017: close %i ends the socket without a reconnect', (code) => {
    const t = setup()
    t.last().drop(code)
    expect(t.sockets).toHaveLength(1)
    expect(t.timers).toHaveLength(0)
    expect(t.statuses[t.statuses.length - 1]).toEqual(['closed', code])
  })

  it('NFR-004: invalid JSON and schema-invalid frames are ignored', async () => {
    const t = setup()
    await t.connectAndAuth()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    t.last().receive('{not json')
    t.last().receive({ type: 'nope' })
    t.last().receive({ type: 'auth.ok', admin: false, extra: 1 })
    expect(t.messages).toEqual([])
    expect(t.statuses.map(([s]) => s)).toEqual(['connecting'])
  })

  it('FR-007 edge: refreshToken sends one auth on the open socket and does not signal ready again', async () => {
    const t = setup()
    await t.connectAndAuth()
    t.last().receive({ type: 'auth.ok', admin: true })
    t.handle.refreshToken()
    await Promise.resolve()
    expect(t.last().sent).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'auth', token: 'tok' },
    ])
    t.last().receive({ type: 'auth.ok', admin: true })
    expect(t.statuses.filter(([s]) => s === 'ready')).toHaveLength(1)
  })

  it('refreshToken before ready sends nothing', async () => {
    const t = setup()
    await t.connectAndAuth()
    t.handle.refreshToken()
    await Promise.resolve()
    expect(t.last().sent).toHaveLength(1)
  })

  it('does not queue: send before ready is dropped, after ready it goes out', async () => {
    const t = setup()
    await t.connectAndAuth()
    t.handle.send({ type: 'room.leave' })
    t.last().receive({ type: 'auth.ok', admin: false })
    t.handle.send({ type: 'room.start' })
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'tok' }, { type: 'room.start' }])
  })

  it('close stops retries and closes the socket once', () => {
    const t = setup()
    t.last().drop(1006)
    t.handle.close()
    expect(t.timers[0]?.cancelled).toBe(true)
    t.handle.close()
    t.runLastTimer()
    expect(t.sockets).toHaveLength(1)
  })

  it('closing a live socket sends a normal closure and reports nothing', async () => {
    const t = setup()
    await t.connectAndAuth()
    const socket = t.last()
    t.handle.close()
    expect(socket.closedWith).toBe(1000)
    socket.drop(1000)
    expect(t.statuses.map(([s]) => s)).toEqual(['connecting'])
  })
})
