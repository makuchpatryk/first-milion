import { FRAME_BUDGET_PER_SEC, MAX_PENDING_SOCKETS, MAX_ROOMS_PER_HOST } from '@fm/shared/config'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ADMIN_UID,
  TestSocket,
  closeAllRooms,
  createRoom,
  emulatorToken,
  upgrade,
  validForm,
} from './helpers'

// Abuse limits (PRD §20 #49). A separate file, so its rooms and sockets do not share a Lobby with
// the other integration files.
afterEach(closeAllRooms)

const lobby = (uid: string) => TestSocket.authed('/ws/lobby', uid)

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Polls until `done()` holds; replies that arrive in a different order than sent need no fixed wait. */
async function until(done: () => boolean, within = 2_000): Promise<void> {
  const deadline = Date.now() + within
  while (!done()) {
    if (Date.now() >= deadline) throw new Error(`condition not met within ${within} ms`)
    await wait(10)
  }
}

const count = (socket: TestSocket, type: string) =>
  socket.messages.filter((msg) => msg.type === type).length

/** Waits until a new upgrade is accepted again; sockets closed by a test free their slot a moment later. */
async function untilAccepting(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const response = await upgrade(path)
    if (response.status === 101 && response.webSocket !== null) {
      response.webSocket.accept()
      response.webSocket.close(1000)
      return
    }
    if (Date.now() >= deadline) throw new Error(`upgrade still refused: ${response.status}`)
    await wait(20)
  }
}

describe('room caps (PRD §20 #49, NFR-002)', () => {
  it('a host gets MAX_ROOMS_PER_HOST rooms; the next create is RATE_LIMITED, the socket stays open, no room is added', async () => {
    const host = await lobby('uid-capped')
    const ids: string[] = []
    for (let i = 0; i < MAX_ROOMS_PER_HOST; i++) ids.push(await createRoom(host))

    host.send({ type: 'room.create', form: validForm })
    expect(await host.nextError()).toBe('RATE_LIMITED')

    host.send({ type: 'ping' })
    await host.next('pong') // still open and answering

    const other = await lobby('uid-other-host')
    ids.push(await createRoom(other)) // the cap is per host
    const late = await lobby('uid-late')
    const { rooms } = await late.next('lobby.rooms')
    expect(rooms.map((room) => room.id).sort()).toEqual([...ids].sort())
  })

  it('two creates sent together at the cap minus one: exactly one passes', async () => {
    const host = await lobby('uid-race')
    for (let i = 0; i < MAX_ROOMS_PER_HOST - 1; i++) await createRoom(host)
    const createdBefore = count(host, 'room.created')

    host.send({ type: 'room.create', form: validForm })
    host.send({ type: 'room.create', form: validForm })
    await until(() => count(host, 'room.created') === createdBefore + 1 && count(host, 'error') === 1)

    const errors = host.messages.flatMap((msg) => (msg.type === 'error' ? [msg.code] : []))
    expect(errors).toEqual(['RATE_LIMITED'])
  })

  it('a room the admin closes frees its host slot', async () => {
    const host = await lobby('uid-slot')
    const ids: string[] = []
    for (let i = 0; i < MAX_ROOMS_PER_HOST; i++) ids.push(await createRoom(host))

    const admin = await lobby(ADMIN_UID)
    admin.send({ type: 'admin.closeRoom', roomId: ids[0] ?? '' })
    await admin.nextWhere('lobby.rooms', (msg) => !msg.rooms.some((room) => room.id === ids[0]))

    await createRoom(host)
  })
})

describe('frame budget (PRD §20 #49)', () => {
  it('frames over FRAME_BUDGET_PER_SEC get RATE_LIMITED, the socket stays open, and works again after the window', async () => {
    const socket = await lobby('uid-flood')
    const extra = 10
    // `ping` counts too: it is a frame like any other.
    for (let i = 0; i < FRAME_BUDGET_PER_SEC + extra; i++) socket.send({ type: 'ping' })
    await until(() => count(socket, 'pong') + count(socket, 'error') === FRAME_BUDGET_PER_SEC + extra)

    expect(count(socket, 'pong')).toBe(FRAME_BUDGET_PER_SEC)
    const errors = socket.messages.flatMap((msg) => (msg.type === 'error' ? [msg.code] : []))
    expect(errors).toEqual(Array(extra).fill('RATE_LIMITED'))
    expect(socket.closeCode).toBeNull()

    await wait(1_100) // attempts leave the one-second window
    socket.send({ type: 'ping' })
    await until(() => count(socket, 'pong') === FRAME_BUDGET_PER_SEC + 1)
  })

  it('the budget is per socket: a flood on one does not slow another', async () => {
    const flooder = await lobby('uid-flood-2')
    const calm = await lobby('uid-calm')
    for (let i = 0; i < FRAME_BUDGET_PER_SEC * 2; i++) flooder.send({ type: 'ping' })
    calm.send({ type: 'ping' })
    await calm.next('pong')
    expect(calm.messages.some((msg) => msg.type === 'error')).toBe(false)
  })
})

describe('pending sockets (PRD §20 #49, FR-007)', () => {
  it('the upgrade after MAX_PENDING_SOCKETS unauthenticated sockets is 503; an authenticated socket frees its slot', async () => {
    const pending = await Promise.all(
      Array.from({ length: MAX_PENDING_SOCKETS }, () => TestSocket.open('/ws/lobby')),
    )
    try {
      expect((await upgrade('/ws/lobby')).status).toBe(503)

      const first = pending[0]
      if (first === undefined) throw new Error('no pending socket')
      first.send({ type: 'auth', token: emulatorToken('uid-pending') })
      await first.next('auth.ok')
      const accepted = await upgrade('/ws/lobby')
      expect(accepted.status).toBe(101)
      accepted.webSocket?.accept()
      accepted.webSocket?.close(1000)
    } finally {
      for (const socket of pending) socket.close()
      await untilAccepting('/ws/lobby')
    }
  })
})

describe('one lobby socket per user (decision 47, PRD §20 #49)', () => {
  it('a second lobby socket of the same user closes the first with 4409 and keeps getting the list', async () => {
    const first = await lobby('uid-twin')
    const second = await lobby('uid-twin')
    expect(await first.closed()).toBe(CLOSE_CODES.REPLACED)
    await second.next('lobby.rooms') // its snapshot on subscribe

    // The replaced socket's close must not unsubscribe the new one.
    const roomId = await createRoom(await lobby('uid-someone'))
    await second.nextWhere('lobby.rooms', (msg) => msg.rooms.some((room) => room.id === roomId))
  })
})
