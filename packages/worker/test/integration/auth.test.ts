import { AUTH_TIMEOUT_MS } from '@fm/shared/config'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { TestSocket, emulatorToken } from './helpers'

describe('WebSocket auth gate (FR-007)', () => {
  it('a verified account gets auth.ok with admin false', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.send({ type: 'auth', token: emulatorToken('uid-1') })
    expect(await socket.next('auth.ok')).toEqual({ type: 'auth.ok', admin: false })
    socket.close()
  })

  it('BR-017: a UID on the admin list gets admin true, and no UID in the message', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.send({ type: 'auth', token: emulatorToken('uid-admin') })
    expect(await socket.next('auth.ok')).toEqual({ type: 'auth.ok', admin: true })
    socket.close()
  })

  it('FR-007 AC: an unverified account is closed with 4401', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.send({ type: 'auth', token: emulatorToken('uid-1', { email_verified: false }) })
    expect(await socket.closed()).toBe(CLOSE_CODES.AUTH_FAILED)
  })

  it('FR-007 AC: a garbage token is closed with 4401', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.send({ type: 'auth', token: 'not-a-token' })
    expect(await socket.closed()).toBe(4401)
  })

  it('FR-007: a first message other than auth is closed with 4401', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    socket.send({ type: 'room.leave' })
    expect(await socket.closed()).toBe(4401)
  })

  it('FR-007 AC: no auth within 5 s is closed with 4401', async () => {
    const socket = await TestSocket.open('/ws/lobby')
    const closeCode = await socket.closed(AUTH_TIMEOUT_MS + 2_000)
    expect(closeCode).toBe(4401)
  }, 15_000)

  it('NFR-004: a token carried in the URL is ignored; the socket still needs an auth message', async () => {
    const socket = await TestSocket.open(`/ws/lobby?token=${emulatorToken('uid-1')}`)
    socket.send({ type: 'room.leave' })
    expect(await socket.closed()).toBe(4401)
  })
})
