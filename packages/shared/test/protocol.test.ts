import { describe, expect, it } from 'vitest'
import { MAX_FRAME_CHARS } from '../src/config'
import { ERROR_CODES, parseClientMessage, serverMessageSchema } from '../src/protocol'

const form = { name: 'Friday round', durationMin: 5, speed: 3, profitTarget: null }

describe('parseClientMessage', () => {
  it('accepts every client message type', () => {
    const messages = [
      { type: 'auth', token: 'abc' },
      { type: 'room.create', form },
      { type: 'room.join', roomId: 'a1b2', nick: 'Jan' },
      { type: 'room.leave' },
      { type: 'room.start' },
      { type: 'order', side: 'BUY', qty: 50 },
      { type: 'close' },
      { type: 'admin.kick', nick: 'Jan' },
      { type: 'admin.closeRoom', roomId: 'a1b2' },
    ]
    for (const msg of messages) expect(parseClientMessage(msg)).toEqual({ ok: true, msg })
  })

  it('NFR-004, FR-012 AC: an order carrying a price is rejected', () => {
    expect(parseClientMessage({ type: 'order', side: 'BUY', qty: 10, price: 1 })).toEqual({ ok: false })
  })

  it('FR-012: quantities outside the allowed set are rejected', () => {
    for (const qty of [75, 0, -10, '10']) {
      expect(parseClientMessage({ type: 'order', side: 'BUY', qty }).ok).toBe(false)
    }
    for (const qty of [10, 50, 100, 250]) {
      expect(parseClientMessage({ type: 'order', side: 'SELL', qty }).ok).toBe(true)
    }
  })

  it('FR-012: closing is its own message, `side: CLOSE` is not an order', () => {
    expect(parseClientMessage({ type: 'order', side: 'CLOSE', qty: 10 }).ok).toBe(false)
  })

  it('NFR-004: an auth token over 4096 characters is rejected, 4096 is accepted', () => {
    expect(parseClientMessage({ type: 'auth', token: 'x'.repeat(4_097) }).ok).toBe(false)
    expect(parseClientMessage({ type: 'auth', token: 'x'.repeat(4_096) }).ok).toBe(true)
    expect(parseClientMessage({ type: 'auth', token: '' }).ok).toBe(false)
  })

  it('NFR-004: a text frame over MAX_FRAME_CHARS is refused, a full-size auth frame is accepted', () => {
    const maxAuth = JSON.stringify({ type: 'auth', token: 'x'.repeat(4_096) })
    expect(maxAuth.length).toBeLessThanOrEqual(MAX_FRAME_CHARS)
    expect(parseClientMessage(maxAuth).ok).toBe(true)
    // Valid JSON and a valid message, refused only for its size.
    const padded = `${JSON.stringify({ type: 'room.leave' })}${' '.repeat(MAX_FRAME_CHARS)}`
    expect(parseClientMessage(padded)).toEqual({ ok: false })
    expect(parseClientMessage(JSON.stringify({ type: 'room.leave' })).ok).toBe(true)
  })

  it('NFR-004: unknown fields on any message are rejected', () => {
    expect(parseClientMessage({ type: 'room.leave', extra: 1 }).ok).toBe(false)
    expect(parseClientMessage({ type: 'auth', token: 'abc', email: 'a@b.c' }).ok).toBe(false)
  })

  it('FR-009: a room.create with an invalid form is rejected', () => {
    expect(parseClientMessage({ type: 'room.create', form: { ...form, profitTarget: 50 } }).ok).toBe(false)
  })

  it('BR-016: a room.join with an invalid nick is rejected', () => {
    expect(parseClientMessage({ type: 'room.join', roomId: 'a1b2', nick: 'jan#2' }).ok).toBe(false)
  })

  it('an unknown or missing type is rejected', () => {
    expect(parseClientMessage({ type: 'room.destroy' }).ok).toBe(false)
    expect(parseClientMessage({}).ok).toBe(false)
  })

  it('text frames are JSON-decoded; invalid JSON and non-objects are rejected', () => {
    expect(parseClientMessage('{"type":"room.leave"}')).toEqual({ ok: true, msg: { type: 'room.leave' } })
    expect(parseClientMessage('{not json').ok).toBe(false)
    expect(parseClientMessage('42').ok).toBe(false)
    expect(parseClientMessage(null).ok).toBe(false)
  })
})

describe('serverMessageSchema', () => {
  it('ARCH Errors: every error code is accepted, free text is not', () => {
    for (const code of ERROR_CODES) {
      expect(serverMessageSchema.safeParse({ type: 'error', code }).success).toBe(true)
    }
    expect(serverMessageSchema.safeParse({ type: 'error', code: 'oops' }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'error', message: 'oops' }).success).toBe(false)
  })

  it('ROOM_NOT_FOUND is part of the closed error union', () => {
    expect(ERROR_CODES).toContain('ROOM_NOT_FOUND')
  })

  it('ARCH Privacy: auth.ok carries a boolean admin flag and nothing else', () => {
    expect(serverMessageSchema.safeParse({ type: 'auth.ok', admin: true }).success).toBe(true)
    expect(serverMessageSchema.safeParse({ type: 'auth.ok', admin: true, uid: 'u1' }).success).toBe(false)
  })
})
