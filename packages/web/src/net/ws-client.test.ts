import { PING_INTERVAL_MS, PONG_TIMEOUT_MS } from '@fm/shared/config'
import { describe, expect, it, vi } from 'vitest'
import { createSocket, type AppServerMessage, type SocketStatus, type WebSocketLike } from './ws-client'

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: unknown[] = []
  closed = false
  closedWith: number | undefined
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number): void {
    this.closed = true
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
  const messages: AppServerMessage[] = []
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
  /** The newest timer scheduled with this delay. */
  const timerOf = (ms: number): Timer | undefined => timers.filter((timer) => timer.ms === ms).at(-1)
  /** Connects, authenticates and receives `auth.ok`: the socket is ready. */
  const becomeReady = async () => {
    await connectAndAuth()
    last().receive({ type: 'auth.ok', admin: false })
  }
  return {
    handle,
    sockets,
    timers,
    statuses,
    messages,
    getToken,
    last,
    connectAndAuth,
    runLastTimer,
    timerOf,
    becomeReady,
  }
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

  it.each([4403, 4409, 4410])('BR-017, decision 47: close %i ends the socket without a reconnect', (code) => {
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

describe('createSocket keepalive (decision 48)', () => {
  it('a ping is sent PING_INTERVAL_MS after auth.ok, never before the socket is ready', async () => {
    const t = setup()
    await t.connectAndAuth()
    expect(t.timerOf(PING_INTERVAL_MS)).toBeUndefined()

    t.last().receive({ type: 'auth.ok', admin: false })
    const ping = t.timerOf(PING_INTERVAL_MS)
    expect(ping).toBeDefined()
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'tok' }])

    ping?.fn()
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'tok' }, { type: 'ping' }])
    expect(t.timerOf(PONG_TIMEOUT_MS)).toBeDefined()
  })

  it('a token refresh auth.ok does not arm a second ping', async () => {
    const t = setup()
    await t.becomeReady()
    t.last().receive({ type: 'auth.ok', admin: false })
    expect(t.timers.filter((timer) => timer.ms === PING_INTERVAL_MS)).toHaveLength(1)
  })

  it('a pong cancels the timeout and arms the next ping', async () => {
    const t = setup()
    await t.becomeReady()
    t.timerOf(PING_INTERVAL_MS)?.fn()
    const timeout = t.timerOf(PONG_TIMEOUT_MS)

    t.last().receive({ type: 'pong' })
    expect(timeout?.cancelled).toBe(true)
    expect(t.timers.filter((timer) => timer.ms === PING_INTERVAL_MS)).toHaveLength(2)
    expect(t.sockets).toHaveLength(1)
  })

  it('a pong is consumed here and never reaches onMessage', async () => {
    const t = setup()
    await t.becomeReady()
    t.timerOf(PING_INTERVAL_MS)?.fn()
    t.last().receive({ type: 'pong' })
    expect(t.messages).toEqual([{ type: 'auth.ok', admin: false }])
  })

  it('no pong within PONG_TIMEOUT_MS drops the socket and schedules a reconnect; a late onclose of the old socket is ignored', async () => {
    const t = setup()
    await t.becomeReady()
    const dead = t.last()
    t.timerOf(PING_INTERVAL_MS)?.fn()
    t.timerOf(PONG_TIMEOUT_MS)?.fn()

    expect(dead.closed).toBe(true)
    expect(t.statuses[t.statuses.length - 1]).toEqual(['reconnecting', undefined])
    expect((t.timers[t.timers.length - 1] as Timer).ms).toBe(500)
    t.handle.send({ type: 'room.start' })
    expect(dead.sent).not.toContainEqual({ type: 'room.start' })

    const timersBefore = t.timers.length
    dead.drop(1006)
    expect(t.timers).toHaveLength(timersBefore)
    expect(t.statuses.filter(([s]) => s === 'reconnecting')).toHaveLength(1)

    t.runLastTimer()
    expect(t.sockets).toHaveLength(2)
  })

  it('close() stops both timers', async () => {
    const t = setup()
    await t.becomeReady()
    t.timerOf(PING_INTERVAL_MS)?.fn()
    t.handle.close()
    expect(t.timerOf(PING_INTERVAL_MS)?.cancelled).toBe(true)
    expect(t.timerOf(PONG_TIMEOUT_MS)?.cancelled).toBe(true)
  })

  it.each([4403, 4409, 4410])('a terminal close %i stops the keepalive', async (code) => {
    const t = setup()
    await t.becomeReady()
    t.last().drop(code)
    expect(t.timerOf(PING_INTERVAL_MS)?.cancelled).toBe(true)
  })

  it('a close that reconnects stops the old keepalive and arms a new one after the next auth.ok', async () => {
    const t = setup()
    await t.becomeReady()
    const first = t.timerOf(PING_INTERVAL_MS)
    t.last().drop(1006)
    expect(first?.cancelled).toBe(true)

    t.runLastTimer()
    await t.becomeReady()
    expect(t.timers.filter((timer) => timer.ms === PING_INTERVAL_MS)).toHaveLength(2)
    expect(t.timerOf(PING_INTERVAL_MS)?.cancelled).toBe(false)
  })
})
