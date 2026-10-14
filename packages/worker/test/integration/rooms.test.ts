import { env } from 'cloudflare:workers'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { TestSocket, createRoom, validForm } from './helpers'

const lobby = (uid: string) => TestSocket.authed('/ws/lobby', uid)
const roomSocket = (roomId: string, uid: string) => TestSocket.authed(`/ws/room/${roomId}`, uid)

/** Joins `roomId` as `uid` and returns the socket plus its first room.state. */
async function join(roomId: string, uid: string, nick: string) {
  const socket = await roomSocket(roomId, uid)
  socket.send({ type: 'room.join', roomId, nick })
  return { socket, state: await socket.next('room.state') }
}

describe('lobby list (FR-008)', () => {
  it('FR-008 AC: a new room shows up in another subscriber list within 2 s', async () => {
    const watcher = await lobby('uid-watch')
    await watcher.next('lobby.rooms') // the snapshot on subscribe
    const creator = await lobby('uid-creator')

    const startedAt = Date.now()
    const roomId = await createRoom(creator)
    let listed
    do {
      const { rooms } = await watcher.next('lobby.rooms', 2_000)
      listed = rooms.find((room) => room.id === roomId)
    } while (listed === undefined)

    expect(Date.now() - startedAt).toBeLessThan(2_000)
    expect(listed).toMatchObject({
      name: validForm.name,
      players: 0,
      observers: 0,
      maxPlayers: 4,
      durationMin: 5,
      speed: 1,
      startCash: 10_000,
      goal: 30_000,
      status: 'lobby',
      hostNick: null,
    })
    watcher.close()
    creator.close()
  })

  it('a late subscriber gets the current list as its first lobby.rooms', async () => {
    const creator = await lobby('uid-creator')
    const roomId = await createRoom(creator)
    const late = await lobby('uid-late')
    const { rooms } = await late.next('lobby.rooms')
    expect(rooms.map((room) => room.id)).toContain(roomId)
  })
})

describe('room creation and joining (FR-009, FR-010)', () => {
  it('FR-009 AC: create then join gives room.state with you.isHost true', async () => {
    const creator = await lobby('uid-creator')
    const roomId = await createRoom(creator)
    const { state } = await join(roomId, 'uid-creator', 'Jan')
    expect(state.view).toMatchObject({
      id: roomId,
      name: validForm.name,
      hostNick: 'Jan',
      status: 'lobby',
      you: { role: 'player', nick: 'Jan', isHost: true },
    })
  })

  it('FR-009 AC: a goal not above the start capital is INVALID_PAYLOAD and creates no room', async () => {
    const creator = await lobby('uid-creator')
    const before = (await creator.next('lobby.rooms')).rooms.length
    creator.send({ type: 'room.create', form: { ...validForm, goal: validForm.startCash } })
    expect(await creator.nextError()).toBe('INVALID_PAYLOAD')
    const observer = await lobby('uid-obs')
    expect((await observer.next('lobby.rooms')).rooms).toHaveLength(before)
  })

  it('FR-010 AC: 4 players, then observers, then ROOM_FULL', async () => {
    const creator = await lobby('uid-1') // the creator joins first, as uid-1
    const roomId = await createRoom(creator)

    const roles: string[] = []
    for (let n = 1; n <= 8; n++) {
      const { state } = await join(roomId, `uid-${n}`, `Nick${n}`)
      roles.push(state.view.you.role)
    }
    expect(roles).toEqual([...Array<string>(4).fill('player'), ...Array<string>(4).fill('observer')])

    const late = await roomSocket(roomId, 'uid-9')
    late.send({ type: 'room.join', roomId, nick: 'Nick9' })
    expect(await late.nextError()).toBe('ROOM_FULL')
  })

  it('FR-002 AC: a duplicate nickname gets #2', async () => {
    const creator = await lobby('uid-1')
    const roomId = await createRoom(creator)
    await join(roomId, 'uid-1', 'Jan')
    const { state } = await join(roomId, 'uid-2', 'Jan')
    expect(state.view.you.nick).toBe('Jan#2')
  })

  it('a join with an invalid nick is INVALID_PAYLOAD', async () => {
    const creator = await lobby('uid-creator')
    const roomId = await createRoom(creator)
    const socket = await roomSocket(roomId, 'uid-1')
    socket.send({ type: 'room.join', roomId, nick: 'no good!' })
    expect(await socket.nextError()).toBe('INVALID_PAYLOAD')
  })

  it('a valid room id that was never initialised answers ROOM_NOT_FOUND and closes', async () => {
    // Same situation as connecting before the Lobby's /init finished (spec Risks).
    const uninitialised = env.ROOM.newUniqueId().toString()
    const socket = await TestSocket.open(`/ws/room/${uninitialised}`)
    expect(await socket.nextError()).toBe('ROOM_NOT_FOUND')
    expect(await socket.closed()).toBe(1000)
  })

  it('FR-016: a host leaving hands the host role over and the list follows', async () => {
    const creator = await lobby('uid-1')
    const watcher = await lobby('uid-watch')
    const roomId = await createRoom(creator)
    const first = await join(roomId, 'uid-1', 'Jan')
    const second = await join(roomId, 'uid-2', 'Ola')

    first.socket.send({ type: 'room.leave' })
    const state = await second.socket.next('room.state')
    expect(state.view.players.map((p) => p.nick)).toEqual(['Ola'])
    expect(state.view.you.isHost).toBe(true)

    let listed
    do {
      const { rooms } = await watcher.next('lobby.rooms')
      listed = rooms.find((room) => room.id === roomId && room.hostNick === 'Ola')
    } while (listed === undefined)
    expect(listed.players).toBe(1)
  })
})

describe('protocol strictness (NFR-004)', () => {
  it('NFR-004, FR-012 AC: an order carrying a price is INVALID_PAYLOAD and the socket stays open', async () => {
    const creator = await lobby('uid-1')
    const roomId = await createRoom(creator)
    const { socket } = await join(roomId, 'uid-1', 'Jan')
    socket.send({ type: 'order', side: 'BUY', qty: 10, price: 1 })
    expect(await socket.nextError()).toBe('INVALID_PAYLOAD')
    expect(socket.closeCode).toBeNull()
  })

  it('malformed JSON is INVALID_PAYLOAD, not a close', async () => {
    const socket = await lobby('uid-1')
    // `send` stringifies, so a bare string becomes a JSON string value, not an object.
    socket.send('hello' as unknown as Record<string, unknown>)
    expect(await socket.nextError()).toBe('INVALID_PAYLOAD')
    expect(socket.closeCode).toBeNull()
  })
})

describe('admin actions (BR-017, FR-017)', () => {
  it('FR-017 AC: a non-admin admin.closeRoom is FORBIDDEN and the room stays', async () => {
    const user = await lobby('uid-1')
    const roomId = await createRoom(user)
    user.send({ type: 'admin.closeRoom', roomId })
    expect(await user.nextError()).toBe('FORBIDDEN')
    const check = await lobby('uid-2')
    expect((await check.next('lobby.rooms')).rooms.map((r) => r.id)).toContain(roomId)
  })

  it('an unknown room id gives ROOM_NOT_FOUND', async () => {
    const admin = await lobby('uid-admin')
    admin.send({ type: 'admin.closeRoom', roomId: 'f'.repeat(64) })
    expect(await admin.nextError()).toBe('ROOM_NOT_FOUND')
  })

  it('FR-017 AC: the admin closes a room: members get ROOM_CLOSED and 4410, the list drops it', async () => {
    const admin = await lobby('uid-admin')
    const roomId = await createRoom(await lobby('uid-1'))
    const member = await join(roomId, 'uid-1', 'Jan')
    const watcher = await lobby('uid-watch')
    expect((await watcher.next('lobby.rooms')).rooms.map((r) => r.id)).toContain(roomId)

    admin.send({ type: 'admin.closeRoom', roomId })
    expect(await member.socket.nextError()).toBe('ROOM_CLOSED')
    expect(await member.socket.closed()).toBe(CLOSE_CODES.ROOM_CLOSED)

    let rooms
    do {
      rooms = (await watcher.next('lobby.rooms')).rooms
    } while (rooms.some((room) => room.id === roomId))
    expect(rooms.map((room) => room.id)).not.toContain(roomId)
  })

  it('FR-017 AC: a kick closes the player with 4403 and they can rejoin', async () => {
    const admin = await lobby('uid-admin')
    const roomId = await createRoom(admin)
    const adminRoom = await join(roomId, 'uid-admin', 'Boss')
    const victim = await join(roomId, 'uid-1', 'Jan')

    adminRoom.socket.send({ type: 'admin.kick', nick: 'Jan' })
    await victim.socket.next('kicked')
    expect(await victim.socket.closed()).toBe(CLOSE_CODES.KICKED)

    const back = await join(roomId, 'uid-1', 'Jan')
    expect(back.state.view.you.role).toBe('player')
  })

  it('a non-admin admin.kick is FORBIDDEN', async () => {
    const creator = await lobby('uid-1')
    const roomId = await createRoom(creator)
    const host = await join(roomId, 'uid-1', 'Jan')
    await join(roomId, 'uid-2', 'Ola')
    host.socket.send({ type: 'admin.kick', nick: 'Ola' })
    expect(await host.socket.nextError()).toBe('FORBIDDEN')
  })
})
