import type { ClientMessage, MeRound } from '@fm/shared/protocol'
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppServerMessage, SocketHandle, SocketStatus } from '../net/ws-client'

vi.mock('./socket-deps', () => ({ runtimeSocketDeps: () => ({}) }))

import { useLobby, type LobbyHandlers } from './use-lobby'
import { useRoom, type RoomHandlers } from './use-room'

class FakeHandle implements SocketHandle {
  sent: ClientMessage[] = []
  closes = 0
  send(msg: ClientMessage): void {
    this.sent.push(msg)
  }
  close(): void {
    this.closes += 1
  }
  refreshToken(): void {
    // Not used by the composables.
  }
}

function fakeOpen<H extends LobbyHandlers | RoomHandlers>() {
  const handle = new FakeHandle()
  let handlers: H | null = null
  return {
    handle,
    open: (h: H) => {
      handlers = h
      return handle
    },
    message: (msg: AppServerMessage) => handlers?.onMessage(msg),
    status: (s: SocketStatus, code?: number) => handlers?.onStatus(s, code),
  }
}

const me = (over: Partial<MeRound> = {}): MeRound => ({
  role: 'player',
  status: 'active',
  units: 0,
  avg: 0,
  realized: 0,
  equity: 10_000,
  closedTrades: 0,
  wins: 0,
  ...over,
})

const tick = (you: MeRound = me()): AppServerMessage => ({
  type: 'room.tick',
  prices: [100],
  price: 100,
  news: null,
  endsInMs: 1_000,
  ranking: [],
  you,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLobby', () => {
  it('FR-008: socket messages go through the reducer into state', () => {
    const t = fakeOpen<LobbyHandlers>()
    const lobby = useLobby(t.open)
    t.message({ type: 'auth.ok', admin: true })
    t.message({ type: 'lobby.rooms', rooms: [] })
    expect(lobby.state.value.isAdmin).toBe(true)
    lobby.dispose()
  })

  it('UF-003: createRoom and closeRoom send intents only', () => {
    const t = fakeOpen<LobbyHandlers>()
    const lobby = useLobby(t.open)
    const form = { name: 'Alpha', durationMin: 5, speed: 3, startCash: 10_000, goal: 30_000 } as const
    lobby.createRoom(form)
    lobby.closeRoom('r1')
    expect(t.handle.sent).toEqual([
      { type: 'room.create', form },
      { type: 'admin.closeRoom', roomId: 'r1' },
    ])
    lobby.dispose()
  })

  it('records the close code when the socket ends', () => {
    const t = fakeOpen<LobbyHandlers>()
    const lobby = useLobby(t.open)
    t.status('closed', 4401)
    expect(lobby.closeCode.value).toBe(4401)
    lobby.dispose()
  })

  it('cleanup: dispose, or the end of the scope, closes the socket exactly once', () => {
    const t = fakeOpen<LobbyHandlers>()
    const scope = effectScope()
    const lobby = scope.run(() => useLobby(t.open))
    scope.stop()
    lobby?.dispose()
    expect(t.handle.closes).toBe(1)
  })
})

describe('useRoom', () => {
  it('UF-004: socket messages go through the reducer into state', () => {
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open })
    t.message(tick())
    expect(room.state.value.price).toBe(100)
    room.dispose()
  })

  it('UF-005, FR-014: canTrade needs a ready socket and an active player', () => {
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open })
    t.message(tick())
    expect(room.canTrade.value).toBe(false) // not ready yet

    t.status('ready')
    expect(room.canTrade.value).toBe(true)

    t.message(tick(me({ role: 'observer' })))
    expect(room.canTrade.value).toBe(false)
    room.dispose()
  })

  it('UF-004: intents are sent as protocol messages, with no price', () => {
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open })
    room.start()
    room.order('BUY', 50)
    room.closePosition()
    room.kick('Bob')
    expect(t.handle.sent).toEqual([
      { type: 'room.start' },
      { type: 'order', side: 'BUY', qty: 50 },
      { type: 'close' },
      { type: 'admin.kick', nick: 'Bob' },
    ])
    room.dispose()
  })

  it('FR-015: the reconnect countdown runs from 30 s and stops when ready again', () => {
    vi.useFakeTimers()
    let clock = 0
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open, now: () => clock })
    expect(room.reconnectLeftS.value).toBeNull()

    t.status('reconnecting')
    expect(room.reconnectLeftS.value).toBe(30)

    clock = 10_000
    vi.advanceTimersByTime(1_000)
    expect(room.reconnectLeftS.value).toBe(20)

    clock = 45_000
    vi.advanceTimersByTime(1_000)
    expect(room.reconnectLeftS.value).toBe(0)

    t.status('ready')
    expect(room.reconnectLeftS.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    room.dispose()
  })

  it('BR-017: a kick (4403) or room close (4410) shows as the close code', () => {
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open })
    t.message({ type: 'kicked' })
    expect(room.closeCode.value).toBe(4403)

    const other = fakeOpen<RoomHandlers>()
    const room2 = useRoom('r2', 'Ann', { open: other.open })
    other.status('closed', 4401)
    expect(room2.closeCode.value).toBe(4401)
    room.dispose()
    room2.dispose()
  })

  it('cleanup: leave sends room.leave then closes once; later dispose does nothing more', () => {
    vi.useFakeTimers()
    const t = fakeOpen<RoomHandlers>()
    const scope = effectScope()
    const room = scope.run(() => useRoom('r1', 'Ann', { open: t.open }))
    t.status('reconnecting')
    room?.leave()
    scope.stop()
    room?.dispose()
    expect(t.handle.sent).toEqual([{ type: 'room.leave' }])
    expect(t.handle.closes).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clearError drops the shown error', () => {
    const t = fakeOpen<RoomHandlers>()
    const room = useRoom('r1', 'Ann', { open: t.open })
    t.message({ type: 'error', code: 'RATE_LIMITED' })
    expect(room.state.value.error).toBe('RATE_LIMITED')
    room.clearError()
    expect(room.state.value.error).toBeNull()
    room.dispose()
  })
})
