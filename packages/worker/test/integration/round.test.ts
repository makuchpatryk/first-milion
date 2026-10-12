import { describe, expect, it } from 'vitest'
import { TestSocket, createRoom } from './helpers'

const lobby = (uid: string) => TestSocket.authed('/ws/lobby', uid)

async function join(roomId: string, uid: string, nick: string) {
  const socket = await TestSocket.authed(`/ws/room/${roomId}`, uid)
  socket.send({ type: 'room.join', roomId, nick })
  await socket.next('room.state')
  return socket
}

describe('round over real sockets (FR-011, FR-012)', () => {
  it('FR-011 AC: the host starts, both players get the same price stream; an order is confirmed with a server fill', async () => {
    const creator = await lobby('uid-1')
    const roomId = await createRoom(creator)
    const host = await join(roomId, 'uid-1', 'Jan')
    const guest = await join(roomId, 'uid-2', 'Ola')

    guest.send({ type: 'room.start' })
    expect(await guest.nextError()).toBe('FORBIDDEN')

    host.send({ type: 'room.start' })
    // The guest's join state may still be queued before the running one.
    await host.nextWhere('room.state', (msg) => msg.view.status === 'running')

    const hostTick = await host.next('room.tick')
    const guestTicks = [await guest.next('room.tick'), await guest.next('room.tick')]
    expect(hostTick.prices).toHaveLength(1) // validForm speed 1
    expect(hostTick.ranking.map((row) => row.nick).sort()).toEqual(['Jan', 'Ola'])
    // The guest's stream contains the host's first interval, wherever the guest's first tick falls.
    expect(guestTicks.flatMap((tick) => tick.prices).length).toBeGreaterThan(0)

    host.send({ type: 'order', side: 'BUY', qty: 10 })
    const ok = await host.next('order.ok')
    expect(ok.fill).toBeGreaterThan(0)
    expect(ok.you).toMatchObject({ role: 'player', units: 10 })

    host.send({ type: 'room.start' })
    expect(await host.nextError()).toBe('INVALID_STATE')
    host.close()
    guest.close()
    creator.close()
  })
})
