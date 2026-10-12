import { env } from 'cloudflare:workers'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { MAX_FRAME_CHARS } from '@fm/shared/config'
import { describe, expect, it } from 'vitest'
import { INTERNAL_ORIGIN, INTERNAL_PATHS } from '../../src/internal'
import { TestSocket, createRoom, emulatorToken, validForm } from './helpers'

const lobby = (uid: string) => TestSocket.authed('/ws/lobby', uid)
const roomSocket = (roomId: string, uid: string) => TestSocket.authed(`/ws/room/${roomId}`, uid)

describe('creator seat (BR-013, FR-009)', () => {
  it('another user cannot join a room, or take the host role, before its creator has joined', async () => {
    const roomId = await createRoom(await lobby('uid-creator'))

    const stranger = await roomSocket(roomId, 'uid-stranger')
    stranger.send({ type: 'room.join', roomId, nick: 'Ola' })
    expect(await stranger.nextError()).toBe('INVALID_STATE')

    const creator = await roomSocket(roomId, 'uid-creator')
    creator.send({ type: 'room.join', roomId, nick: 'Jan' })
    expect((await creator.next('room.state')).view.you.isHost).toBe(true)

    stranger.send({ type: 'room.join', roomId, nick: 'Ola' })
    const state = await stranger.next('room.state')
    expect(state.view).toMatchObject({ hostNick: 'Jan', you: { role: 'player', isHost: false } })
  })
})

describe('token refresh on a live socket (FR-007 edge)', () => {
  it('a second auth with the same uid is acknowledged and the socket stays open', async () => {
    const socket = await lobby('uid-1')
    socket.send({ type: 'auth', token: emulatorToken('uid-1') })
    expect((await socket.next('auth.ok')).admin).toBe(false)
    expect(socket.closeCode).toBeNull()
  })

  it('a second auth with another uid closes the socket with 4401', async () => {
    const socket = await lobby('uid-1')
    socket.send({ type: 'auth', token: emulatorToken('uid-2') })
    expect(await socket.closed()).toBe(CLOSE_CODES.AUTH_FAILED)
  })
})

describe('one socket per user per room', () => {
  it('a second socket of the same user cannot act in the room', async () => {
    const roomId = await createRoom(await lobby('uid-1'))
    const first = await roomSocket(roomId, 'uid-1')
    first.send({ type: 'room.join', roomId, nick: 'Jan' })
    await first.next('room.state')

    const second = await roomSocket(roomId, 'uid-1')
    second.send({ type: 'room.leave' })
    expect(await second.nextError()).toBe('INVALID_STATE')
    expect(second.closeCode).toBeNull()
  })
})

describe('frame size (NFR-004)', () => {
  it('an oversized frame from an authenticated socket is INVALID_PAYLOAD and the socket stays open', async () => {
    const socket = await lobby('uid-1')
    socket.sendRaw(`${JSON.stringify({ type: 'room.leave' })}${' '.repeat(MAX_FRAME_CHARS)}`)
    expect(await socket.nextError()).toBe('INVALID_PAYLOAD')
    expect(socket.closeCode).toBeNull()
  })

  it('an oversized first frame closes the socket with 4401', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.sendRaw(JSON.stringify({ type: 'auth', token: 'x'.repeat(MAX_FRAME_CHARS) }))
    expect(await socket.closed()).toBe(CLOSE_CODES.AUTH_FAILED)
  })
})

describe('Room internal requests', () => {
  const post = (id: DurableObjectId, path: string, body: unknown) =>
    env.ROOM.get(id).fetch(`${INTERNAL_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  it('/init works once; a second /init answers 409', async () => {
    const id = env.ROOM.newUniqueId()
    const body = { id: id.toString(), form: validForm, hostUid: 'uid-1' }
    expect((await post(id, INTERNAL_PATHS.init, body)).status).toBe(200)
    expect((await post(id, INTERNAL_PATHS.init, body)).status).toBe(409)
  })

  it('/init with an id that is not the Room own id answers 400 and leaves the Room uninitialised', async () => {
    const id = env.ROOM.newUniqueId()
    const other = env.ROOM.newUniqueId().toString()
    expect((await post(id, INTERNAL_PATHS.init, { id: other, form: validForm, hostUid: 'uid-1' })).status).toBe(400)
    expect((await post(id, INTERNAL_PATHS.close, { actorUid: 'uid-admin' })).status).toBe(404)
  })

  it('/close from a non-admin uid answers 403 and the Room stays open', async () => {
    const id = env.ROOM.newUniqueId()
    await post(id, INTERNAL_PATHS.init, { id: id.toString(), form: validForm, hostUid: 'uid-1' })
    expect((await post(id, INTERNAL_PATHS.close, { actorUid: 'uid-1' })).status).toBe(403)
    const socket = await roomSocket(id.toString(), 'uid-1')
    socket.send({ type: 'room.join', roomId: id.toString(), nick: 'Jan' })
    expect((await socket.next('room.state')).view.name).toBe(validForm.name)
  })
})
