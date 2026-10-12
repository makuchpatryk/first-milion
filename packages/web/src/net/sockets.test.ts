import { describe, expect, it } from 'vitest'
import { openLobbySocket, type SocketDeps } from './lobby-socket'
import { openRoomSocket } from './room-socket'
import { notifyTokenChanged } from './token-refresh'
import type { WebSocketLike } from './ws-client'

class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  sent: unknown[] = []
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    // Nothing to release in the fake.
  }
}

function setup() {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const timers: Array<() => void> = []
  const deps: SocketDeps = {
    baseUrl: 'https://api.example.com',
    getToken: () => Promise.resolve('tok'),
    onMessage: () => undefined,
    onStatus: () => undefined,
    schedule: (fn) => {
      timers.push(fn)
      return fn
    },
    cancel: () => undefined,
    openSocket: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  }
  const last = () => sockets[sockets.length - 1] as FakeSocket
  const authOk = async () => {
    last().onopen?.()
    await Promise.resolve()
    last().onmessage?.({ data: JSON.stringify({ type: 'auth.ok', admin: false }) })
  }
  return { deps, sockets, urls, timers, last, authOk }
}

const joins = (s: FakeSocket) => s.sent.filter((m) => (m as { type: string }).type === 'room.join')

describe('room and lobby sockets', () => {
  it('opens the lobby socket on /ws/lobby without joining anything', async () => {
    const t = setup()
    const handle = openLobbySocket(t.deps)
    await t.authOk()
    expect(t.urls).toEqual(['wss://api.example.com/ws/lobby'])
    expect(t.last().sent).toEqual([{ type: 'auth', token: 'tok' }])
    handle.close()
  })

  it('FR-007: the room socket sends room.join once per ready, after auth', async () => {
    const t = setup()
    const handle = openRoomSocket('r1', 'Ann', t.deps)
    await t.authOk()
    expect(t.urls).toEqual(['wss://api.example.com/ws/room/r1'])
    expect(t.last().sent).toEqual([
      { type: 'auth', token: 'tok' },
      { type: 'room.join', roomId: 'r1', nick: 'Ann' },
    ])
    handle.close()
  })

  it('FR-015: a token refresh does not send a second room.join', async () => {
    const t = setup()
    const handle = openRoomSocket('r1', 'Ann', t.deps)
    await t.authOk()
    notifyTokenChanged()
    await Promise.resolve()
    t.last().onmessage?.({ data: JSON.stringify({ type: 'auth.ok', admin: false }) })
    expect(joins(t.last())).toHaveLength(1)
    handle.close()
  })

  it('FR-015: a reconnect joins again, once per ready', async () => {
    const t = setup()
    const handle = openRoomSocket('r1', 'Ann', t.deps)
    await t.authOk()
    t.last().onclose?.({ code: 1006 })
    t.timers[0]?.()
    await t.authOk()
    expect(t.sockets).toHaveLength(2)
    expect(joins(t.sockets[0] as FakeSocket)).toHaveLength(1)
    expect(joins(t.sockets[1] as FakeSocket)).toHaveLength(1)
    handle.close()
  })

  it('FR-007 edge: a token change sends exactly one auth per open socket, none after close', async () => {
    const t = setup()
    const lobby = openLobbySocket(t.deps)
    const room = openRoomSocket('r1', 'Ann', t.deps)
    for (const socket of t.sockets) {
      socket.onopen?.()
      await Promise.resolve()
      socket.onmessage?.({ data: JSON.stringify({ type: 'auth.ok', admin: false }) })
    }
    const authsOf = (s: FakeSocket) =>
      s.sent.filter((m) => (m as { type: string }).type === 'auth').length

    notifyTokenChanged()
    await Promise.resolve()
    expect(t.sockets.map(authsOf)).toEqual([2, 2])

    room.close()
    notifyTokenChanged()
    await Promise.resolve()
    expect(t.sockets.map(authsOf)).toEqual([3, 2])
    lobby.close()
  })
})
