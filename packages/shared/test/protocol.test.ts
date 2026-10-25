import { describe, expect, it } from 'vitest'
import { MAX_FRAME_CHARS } from '../src/config'
import { ERROR_CODES, parseClientMessage, serverMessageSchema } from '../src/protocol'

const form = { name: 'Friday round', durationMin: 5, speed: 3, startCash: 10_000, goal: 30_000 }

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
      { type: 'ping' },
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
    const bad = [{ goal: 5_000 }, { goal: 10_000 }, { goal: null }, { startCash: 1_500 }, { startCash: 200_000 }]
    for (const patch of bad) {
      expect(parseClientMessage({ type: 'room.create', form: { ...form, ...patch } }).ok).toBe(false)
    }
  })

  it('FR-009: a room.create with a custom start and a goal beyond the slider range is accepted', () => {
    const custom = { ...form, startCash: 5_000, goal: 2_500_000 }
    expect(parseClientMessage({ type: 'room.create', form: custom })).toEqual({
      ok: true,
      msg: { type: 'room.create', form: custom },
    })
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

  it('decision 48: pong is valid and carries nothing; ping takes no field either', () => {
    expect(serverMessageSchema.safeParse({ type: 'pong' }).success).toBe(true)
    expect(serverMessageSchema.safeParse({ type: 'pong', at: 1 }).success).toBe(false)
    expect(parseClientMessage({ type: 'ping', at: 1 })).toEqual({ ok: false })
  })

  it('ARCH Privacy: auth.ok carries a boolean admin flag and nothing else', () => {
    expect(serverMessageSchema.safeParse({ type: 'auth.ok', admin: true }).success).toBe(true)
    expect(serverMessageSchema.safeParse({ type: 'auth.ok', admin: true, uid: 'u1' }).success).toBe(false)
  })
})

describe('serverMessageSchema room messages carry the stakes (FR-004, FR-011)', () => {
  const summary = {
    id: 'a1b2',
    name: 'Friday round',
    hostNick: 'Jan',
    players: 1,
    observers: 0,
    maxPlayers: 4,
    durationMin: 5,
    startCash: 5_000,
    goal: 40_000,
    speed: 3,
    status: 'lobby',
  }
  const view = {
    id: 'a1b2',
    name: 'Friday round',
    hostNick: 'Jan',
    durationMin: 5,
    startCash: 5_000,
    goal: 40_000,
    speed: 3,
    status: 'lobby',
    players: [],
    observers: [],
    lastRound: null,
    you: { role: 'observer', nick: 'Ola', isHost: false },
  }

  it('lobby.rooms and room.state accept startCash and goal', () => {
    expect(serverMessageSchema.safeParse({ type: 'lobby.rooms', rooms: [summary] }).success).toBe(true)
    expect(serverMessageSchema.safeParse({ type: 'room.state', view }).success).toBe(true)
  })

  it('decision 46: an observer carries active or disconnected, never eliminated', () => {
    const withObserver = (status: string) => ({
      type: 'room.state',
      view: { ...view, observers: [{ nick: 'Kuba', status }] },
    })
    expect(serverMessageSchema.safeParse(withObserver('active')).success).toBe(true)
    expect(serverMessageSchema.safeParse(withObserver('disconnected')).success).toBe(true)
    expect(serverMessageSchema.safeParse(withObserver('eliminated')).success).toBe(false)
    expect(
      serverMessageSchema.safeParse({ type: 'room.state', view: { ...view, observers: [{ nick: 'Kuba' }] } })
        .success,
    ).toBe(false)
  })

  it('the old profitTarget field and a missing startCash or goal are rejected', () => {
    const omit = (o: object, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))
    const noGoal = omit(summary, 'goal')
    const noStart = omit(view, 'startCash')
    expect(serverMessageSchema.safeParse({ type: 'lobby.rooms', rooms: [{ ...summary, profitTarget: 20_000 }] }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'lobby.rooms', rooms: [noGoal] }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'room.state', view: noStart }).success).toBe(false)
  })
})

describe('serverMessageSchema round messages (FR-011..FR-015)', () => {
  const you = {
    role: 'player',
    status: 'active',
    units: 50,
    avg: 100.03,
    realized: 0,
    equity: 10_000,
    closedTrades: 0,
    wins: 0,
  }
  const ranking = [
    { nick: 'Jan', equity: 10_000, status: 'active', place: 1 },
    { nick: 'Ola', equity: 0, status: 'eliminated', place: 2 },
  ]
  const tick = {
    type: 'room.tick',
    prices: [100, 100.2, 99.9],
    price: 99.9,
    news: null,
    endsInMs: 180_000,
    ranking,
    you,
  }
  const messages = {
    'room.history': { type: 'room.history', prices: [100, 101] },
    'room.tick': tick,
    'order.ok': { type: 'order.ok', fill: 100.03, you },
    'round.end': { type: 'round.end', reason: 'TARGET', winners: ['Jan'], ranking },
  }

  it('accepts the documented shape of every round message', () => {
    for (const msg of Object.values(messages)) {
      expect(serverMessageSchema.safeParse(msg).success).toBe(true)
    }
  })

  it('rejects unknown fields on every round message', () => {
    for (const msg of Object.values(messages)) {
      expect(serverMessageSchema.safeParse({ ...msg, uid: 'u1' }).success).toBe(false)
    }
  })

  it('FR-012: a close with no position answers order.ok with a null fill', () => {
    expect(serverMessageSchema.safeParse({ type: 'order.ok', fill: null, you }).success).toBe(true)
  })

  it('FR-005 / BR-015: a tick carries every news type with its parameters', () => {
    const news = [
      { type: 'SHOCK', dir: -1, mag: 0.02, idx: 3 },
      { type: 'FLASH_CRASH', drop: 0.05 },
      { type: 'VOL_SPIKE' },
      { type: 'TREND', dir: 1 },
    ]
    for (const item of news) {
      const msg = { ...tick, news: item }
      expect(serverMessageSchema.safeParse(msg).success).toBe(true)
    }
    expect(serverMessageSchema.safeParse({ ...tick, news: { type: 'TRADING_HALT' } }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ ...tick, news: { type: 'SHOCK', dir: 2, mag: 1, idx: 0 } }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ ...tick, news: { type: 'VOL_SPIKE', engine: {} } }).success).toBe(false)
  })

  it('BR-009: round.end names its reason from a closed set', () => {
    for (const reason of ['TARGET', 'TIME', 'ALL_ELIMINATED']) {
      expect(serverMessageSchema.safeParse({ ...messages['round.end'], reason }).success).toBe(true)
    }
    expect(serverMessageSchema.safeParse({ ...messages['round.end'], reason: 'QUIT' }).success).toBe(false)
  })

  it('ARCH Privacy: ranking rows carry nickname, equity, status and place only', () => {
    const row = { nick: 'Jan', equity: 1, status: 'active', place: 1 }
    expect(serverMessageSchema.safeParse({ ...messages['round.end'], ranking: [{ ...row, uid: 'u1' }] }).success).toBe(false)
  })
})
