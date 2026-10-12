import { HALT_MS, TICK_MS } from '@fm/shared/config'
import { CLOSE_CODES } from '@fm/shared/protocol'
import { DISCONNECT_GRACE_MS, EMPTY_ROOM_TTL_MS, SPREAD } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import { ADMIN, createHarness, joinPlayers, type Harness } from '../support/test-client'

/** A started round of `players` players, seed 1 (a halt comes at interval 41). */
function running(players = 3, options: Parameters<typeof createHarness>[0] = {}) {
  const h = createHarness(options)
  joinPlayers(h, players)
  h.room.start('uid-1')
  return h
}

/** The true price of the latest tick: the last of its `prices`. */
function latestPrice(h: Harness, uid = 'uid-1'): number {
  const price = h.ofType(uid, 'room.tick').at(-1)?.prices.at(-1)
  if (price === undefined) throw new Error('no tick yet')
  return price
}

const lastTick = (h: Harness, uid: string) => h.ofType(uid, 'room.tick').at(-1)

describe('RoomLogic start (FR-011, BR-013)', () => {
  it('FR-011 AC: a non-host gets FORBIDDEN and the room stays in the lobby', () => {
    const h = createHarness()
    joinPlayers(h, 2)
    h.room.start('uid-2')
    expect(h.errorsTo('uid-2')).toEqual(['FORBIDDEN'])
    expect(h.room.running).toBe(false)
    expect(h.room.summary().status).toBe('lobby')
  })

  it('FR-011 AC: starting during a round gives INVALID_STATE', () => {
    const h = running(2)
    h.room.start('uid-1')
    expect(h.errorsTo('uid-1')).toEqual(['INVALID_STATE'])
  })

  it('BR-013: a host with no seated player (an observer) cannot start', () => {
    const h = createHarness()
    joinPlayers(h, 5) // uid-5 is an observer
    for (const n of [1, 2, 3, 4]) h.room.leave(`uid-${n}`)
    expect(h.room.viewFor('uid-5')?.you).toMatchObject({ role: 'observer', isHost: true })
    h.room.start('uid-5')
    expect(h.errorsTo('uid-5')).toEqual(['INVALID_STATE'])
  })

  it('FR-011 AC: start sets the room to running, lists it as running and tells everyone', () => {
    const h = createHarness()
    joinPlayers(h, 3)
    h.room.start('uid-1')
    expect(h.room.running).toBe(true)
    expect(h.published.at(-1)).toMatchObject({ status: 'running', players: 3 })
    for (const n of [1, 2, 3]) expect(h.ofType(`uid-${n}`, 'room.state').at(-1)?.view.status).toBe('running')
  })

  it('FR-011 AC: everyone gets the same price stream, speed prices per tick, each with its own `you`', () => {
    const h = running(3)
    joinPlayers(h, 1, 4) // a fourth player seat
    h.room.join('uid-9', 'Eve') // 5th member: observer
    h.tick(20)
    h.room.order('uid-2', 'BUY', 50)
    h.tick(5)
    const stream = (uid: string) => h.ofType(uid, 'room.tick').flatMap((t) => t.prices)
    expect(stream('uid-1')).toHaveLength(8 * 25)
    expect(stream('uid-2')).toEqual(stream('uid-1'))
    expect(stream('uid-9')).toEqual(stream('uid-1'))
    expect(lastTick(h, 'uid-1')?.you).toMatchObject({ role: 'player', units: 0 })
    expect(lastTick(h, 'uid-2')?.you).toMatchObject({ role: 'player', units: 50 })
    expect(lastTick(h, 'uid-9')?.you).toMatchObject({ role: 'observer', units: 0 })
  })

  it('FR-011: the tick carries the ranking of all seats and the wall-clock time left', () => {
    const h = running(2, { durationMin: 3 })
    h.tick(10)
    const tick = lastTick(h, 'uid-1')
    expect(tick?.ranking.map((row) => row.nick).sort()).toEqual(['Nick1', 'Nick2'])
    expect(tick?.endsInMs).toBe(3 * 60_000 - 10 * TICK_MS)
  })

  it('BR-014: starting hides the last round result', () => {
    const h = running(1, { durationMin: 3 })
    h.runToEnd(2_300)
    expect(h.room.viewFor('uid-1')?.lastRound).not.toBeNull()
    h.room.start('uid-1')
    expect(h.room.viewFor('uid-1')?.lastRound).toBeNull()
  })

  it('ARCH Privacy: no round message carries a uid', () => {
    const h = running(2)
    h.room.order('uid-1', 'BUY', 50)
    h.tick(10)
    h.room.onSocketClosed('uid-2')
    expect(JSON.stringify(h.log.map((entry) => entry.msg))).not.toContain('uid-')
  })
})

describe('RoomLogic orders (FR-012, BR-007, BR-018)', () => {
  it('FR-012: BUY fills at the price of the latest tick plus half the spread, confirmed in the same call', () => {
    const h = running(2)
    h.tick(3)
    const before = h.inbox('uid-1').length
    h.room.order('uid-1', 'BUY', 50)
    const fill = latestPrice(h) + SPREAD / 2
    const sent = h.inbox('uid-1').slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'order.ok', fill, you: { units: 50 } })
    expect(h.ofType('uid-1', 'order.ok').at(-1)?.you.avg).toBeCloseTo(fill, 9)
  })

  it('FR-012: SELL fills below the price, CLOSE at the opposite side of the spread', () => {
    const h = running(2)
    h.tick(3)
    h.room.order('uid-1', 'BUY', 10)
    h.tick(2)
    h.room.close('uid-1')
    const price = latestPrice(h)
    expect(h.ofType('uid-1', 'order.ok').at(-1)).toMatchObject({ fill: price - SPREAD / 2, you: { units: 0, closedTrades: 1 } })
    h.room.order('uid-1', 'SELL', 10)
    expect(h.ofType('uid-1', 'order.ok').at(-1)).toMatchObject({ fill: price - SPREAD / 2, you: { units: -10 } })
  })

  it('FR-003 / FR-012: CLOSE with no position answers a null fill and changes nothing', () => {
    const h = running(2)
    h.tick(2)
    h.room.close('uid-1')
    expect(h.ofType('uid-1', 'order.ok').at(-1)).toMatchObject({
      fill: null,
      you: { units: 0, realized: 0, closedTrades: 0, equity: 10_000 },
    })
  })

  it('race: an order between two ticks fills at the price of the tick before it', () => {
    const h = running(2)
    h.tick(4)
    const price = latestPrice(h)
    h.room.order('uid-1', 'BUY', 10)
    h.tick(1)
    expect(h.ofType('uid-1', 'order.ok').at(-1)?.fill).toBe(price + SPREAD / 2)
    expect(latestPrice(h)).not.toBe(price)
  })

  it('FR-012 AC, BR-018: the 11th order within 1 s gets RATE_LIMITED and the connection stays open', () => {
    const h = running(2)
    h.tick(2)
    for (let i = 0; i < 10; i++) h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual([])
    h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual(['RATE_LIMITED'])
    expect(h.closed).toEqual([])
    expect(h.ofType('uid-1', 'order.ok')).toHaveLength(10)
    expect(h.ofType('uid-1', 'order.ok').at(-1)?.you.units).toBe(100) // the refused one changed nothing
  })

  it('BR-018: the limit is per player and recovers after the window', () => {
    const h = running(2)
    for (let i = 0; i < 11; i++) h.room.order('uid-1', 'BUY', 10)
    h.room.order('uid-2', 'BUY', 10)
    expect(h.errorsTo('uid-2')).toEqual([])
    h.tick(13) // 1 040 ms later the window has slid past the old attempts
    h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual(['RATE_LIMITED'])
  })

  it('BR-018: a close counts toward the limit, and rejected orders count too', () => {
    const h = running(2)
    for (let i = 0; i < 5; i++) h.room.order('uid-1', 'BUY', 10)
    for (let i = 0; i < 5; i++) h.room.close('uid-1')
    h.room.close('uid-1')
    expect(h.errorsTo('uid-1')).toEqual(['RATE_LIMITED'])
    h.tick(6) // 480 ms: still inside the window, and the refused attempt counts
    h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual(['RATE_LIMITED', 'RATE_LIMITED'])
  })

  it('FR-012 edge case: an observer gets FORBIDDEN, a stranger as well', () => {
    const h = createHarness()
    joinPlayers(h, 5)
    h.room.start('uid-1')
    h.room.order('uid-5', 'BUY', 10)
    h.room.close('uid-5')
    h.room.order('uid-stranger', 'BUY', 10)
    expect(h.errorsTo('uid-5')).toEqual(['FORBIDDEN', 'FORBIDDEN'])
    expect(h.errorsTo('uid-stranger')).toEqual(['FORBIDDEN'])
  })

  it('FR-012: an order in the lobby gives INVALID_STATE', () => {
    const h = createHarness()
    joinPlayers(h, 2)
    h.room.order('uid-1', 'BUY', 10)
    h.room.close('uid-1')
    expect(h.errorsTo('uid-1')).toEqual(['INVALID_STATE', 'INVALID_STATE'])
  })

  it('FR-005 AC, BR-015: orders and close during a trading halt get HALTED; trading resumes after 5 s wall time', () => {
    const h = running(2)
    let guard = 0
    while (lastTick(h, 'uid-1')?.halt == null && guard++ < 200) h.tick()
    expect(lastTick(h, 'uid-1')?.halt).not.toBeNull()
    h.room.order('uid-1', 'BUY', 10)
    h.room.close('uid-1')
    expect(h.errorsTo('uid-1')).toEqual(['HALTED', 'HALTED'])

    let haltTicks = 0
    while (lastTick(h, 'uid-1')?.halt != null) {
      h.tick()
      haltTicks++
    }
    // 5 000 ms in 80 ms ticks, at speed 8: wall time, not game ticks (decision 39).
    expect(haltTicks).toBeGreaterThanOrEqual(HALT_MS / TICK_MS - 1)
    expect(haltTicks).toBeLessThanOrEqual(HALT_MS / TICK_MS + 1)
    h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual(['HALTED', 'HALTED'])
  })

  it('BR-015: during a halt the displayed price is frozen while the price stream keeps moving', () => {
    const h = running(2)
    let guard = 0
    while (lastTick(h, 'uid-1')?.halt == null && guard++ < 200) h.tick()
    const first = lastTick(h, 'uid-1')
    h.tick(10)
    const later = lastTick(h, 'uid-1')
    expect(later?.price).toBe(first?.price)
    expect(later?.prices.at(-1)).not.toBe(first?.prices.at(-1))
    expect(later?.halt?.msLeft).toBeLessThan(first?.halt?.msLeft ?? 0)
  })

  it('BR-015: every recipient gets the same news on the interval it is drawn', () => {
    const h = running(3)
    let guard = 0
    while (lastTick(h, 'uid-1')?.news == null && guard++ < 200) h.tick()
    const news = lastTick(h, 'uid-1')?.news
    expect(news).not.toBeNull()
    for (const uid of ['uid-2', 'uid-3']) expect(lastTick(h, uid)?.news).toEqual(news)
    h.tick()
    expect(lastTick(h, 'uid-1')?.news).toBeNull() // reported once
  })
})

describe('RoomLogic disconnect and return (BR-019, FR-015)', () => {
  it('FR-015 AC: after 10 s away the same UID returns to its seat, position and equity as they were', () => {
    const h = running(3)
    h.tick(3)
    h.room.order('uid-2', 'BUY', 50)
    const held = h.ofType('uid-2', 'order.ok').at(-1)?.you
    h.room.onSocketClosed('uid-2')
    expect(h.room.viewFor('uid-1')?.players.map((p) => p.status)).toEqual(['active', 'disconnected', 'active'])
    h.tick(125) // 10 s
    expect(h.room.summary().players).toBe(3)

    h.room.join('uid-2', 'Nick2')
    const view = h.ofType('uid-2', 'room.state').at(-1)?.view
    expect(view).toMatchObject({ status: 'running', you: { role: 'player', nick: 'Nick2' } })
    expect(view?.players.map((p) => p.status)).toEqual(['active', 'active', 'active'])
    h.tick(1)
    expect(lastTick(h, 'uid-2')?.you).toMatchObject({ status: 'active', units: 50, avg: held?.avg, realized: 0 })
  })

  it('FR-015 AC: the returning player gets the whole price history', () => {
    const h = running(2)
    h.tick(30)
    h.room.onSocketClosed('uid-2')
    h.tick(10)
    h.room.join('uid-2', 'Nick2')
    const history = h.ofType('uid-2', 'room.history').at(-1)?.prices
    expect(history).toHaveLength(1 + 8 * 40)
    expect(history?.at(-1)).toBe(latestPrice(h))
  })

  it('BR-019: a disconnected player keeps its position and its equity keeps moving', () => {
    const h = running(2)
    h.tick(2)
    h.room.order('uid-2', 'BUY', 250)
    h.room.onSocketClosed('uid-2')
    h.tick(40)
    const row = lastTick(h, 'uid-1')?.ranking.find((r) => r.nick === 'Nick2')
    expect(row?.status).toBe('disconnected')
    expect(row?.equity).not.toBe(10_000)
    const price = latestPrice(h)
    const avg = h.ofType('uid-2', 'order.ok').at(-1)?.you.avg ?? 0
    expect(row?.equity).toBeCloseTo(10_000 + (price - avg) * 250, 6)
  })

  it('FR-015 AC, BR-019: 31 s away eliminates the player; returning, they are seated but watch-only', () => {
    const h = running(2)
    h.tick(2)
    h.room.order('uid-2', 'BUY', 50)
    h.room.onSocketClosed('uid-2')
    h.tick(DISCONNECT_GRACE_MS / TICK_MS + 6) // 31 s
    const row = lastTick(h, 'uid-1')?.ranking.find((r) => r.nick === 'Nick2')
    expect(row).toMatchObject({ status: 'eliminated', equity: 0 })

    h.room.join('uid-2', 'Nick2')
    expect(h.ofType('uid-2', 'room.state').at(-1)?.view.players.map((p) => p.status)).toEqual(['active', 'eliminated'])
    h.room.order('uid-2', 'BUY', 10)
    expect(h.errorsTo('uid-2')).toEqual(['ELIMINATED'])
    h.tick(1)
    expect(lastTick(h, 'uid-2')?.you).toMatchObject({ status: 'eliminated', units: 0, equity: 0 })
  })

  it('BR-019: the position is closed at market incl. spread when the grace runs out', () => {
    const h = running(2)
    h.tick(2)
    h.room.order('uid-2', 'BUY', 50)
    h.room.onSocketClosed('uid-2')
    h.tick(DISCONNECT_GRACE_MS / TICK_MS + 1)
    h.room.join('uid-2', 'Nick2')
    h.tick(1)
    expect(lastTick(h, 'uid-2')?.you).toMatchObject({ units: 0, avg: 0, closedTrades: 1 })
  })

  it('race: returning just before the 30 s are up cancels the elimination', () => {
    const h = running(2)
    h.room.onSocketClosed('uid-2')
    h.tick(DISCONNECT_GRACE_MS / TICK_MS - 2)
    h.room.join('uid-2', 'Nick2')
    h.tick(20)
    expect(lastTick(h, 'uid-1')?.ranking.find((r) => r.nick === 'Nick2')?.status).toBe('active')
  })

  it('decision 41: an explicit room.leave in a round is a disconnect with the 30 s grace', () => {
    const h = running(2)
    h.room.leave('uid-2')
    expect(h.room.summary().players).toBe(2)
    expect(h.room.viewFor('uid-1')?.players[1]).toEqual({ nick: 'Nick2', status: 'disconnected' })
    h.tick(DISCONNECT_GRACE_MS / TICK_MS + 1)
    expect(h.room.viewFor('uid-1')?.players[1]).toEqual({ nick: 'Nick2', status: 'eliminated' })
  })

  it('BR-013: a host who drops mid-round hands the role to the next connected player; the round continues', () => {
    const h = running(3)
    h.room.onSocketClosed('uid-1')
    expect(h.room.viewFor('uid-2')?.you.isHost).toBe(true)
    expect(h.room.running).toBe(true)
    h.room.join('uid-1', 'Nick1')
    expect(h.room.viewFor('uid-1')?.you.isHost).toBe(false)
  })

  it('BR-012: an observer who leaves mid-round is removed at once, no grace', () => {
    const h = createHarness()
    joinPlayers(h, 5)
    h.room.start('uid-1')
    h.room.onSocketClosed('uid-5')
    expect(h.room.summary()).toMatchObject({ players: 4, observers: 0 })
  })

  it('BR-014: when everyone is gone the grace runs out, the round ends, and the empty room is deleted after 5 min', () => {
    const h = running(2)
    h.room.onSocketClosed('uid-1')
    h.room.onSocketClosed('uid-2')
    h.tick(DISCONNECT_GRACE_MS / TICK_MS + 1)
    expect(h.room.running).toBe(false)
    expect(h.room.summary()).toMatchObject({ players: 0, status: 'lobby' })
    h.clock.advance(EMPTY_ROOM_TTL_MS)
    expect(h.published.at(-1)).toBeNull()
  })
})

describe('RoomLogic in a running round (BR-012, BR-017)', () => {
  it('BR-012: a joiner during a round is an observer and receives the history', () => {
    const h = running(2)
    h.tick(5)
    h.room.join('uid-9', 'Eve')
    expect(h.ofType('uid-9', 'room.state').at(-1)?.view.you.role).toBe('observer')
    expect(h.ofType('uid-9', 'room.history').at(-1)?.prices).toHaveLength(1 + 8 * 5)
    h.tick(1)
    expect(lastTick(h, 'uid-9')?.you.role).toBe('observer')
  })

  it('BR-011: observer slots still cap a running room', () => {
    const h = createHarness()
    joinPlayers(h, 8)
    h.room.start('uid-1')
    h.room.join('uid-9', 'Late')
    expect(h.errorsTo('uid-9')).toEqual(['ROOM_FULL'])
  })

  it('BR-017: a kicked player is gone from the seats and the ranking, gets `kicked` and close 4403', () => {
    const h = running(3)
    h.tick(3)
    h.room.kick(ADMIN, 'Nick2')
    expect(h.inbox('uid-2').some((m) => m.type === 'kicked')).toBe(true)
    expect(h.closed).toEqual([{ uid: 'uid-2', code: CLOSE_CODES.KICKED }])
    expect(h.room.summary().players).toBe(2)
    h.tick(1)
    expect(lastTick(h, 'uid-1')?.ranking.map((r) => r.nick).sort()).toEqual(['Nick1', 'Nick3'])
    expect(h.room.running).toBe(true)
  })

  it('FR-017 AC: a kicked player may rejoin; during a round they come back as an observer', () => {
    const h = running(3)
    h.room.kick(ADMIN, 'Nick2')
    h.room.onSocketClosed('uid-2') // already removed: a no-op
    h.room.join('uid-2', 'Nick2')
    expect(h.ofType('uid-2', 'room.state').at(-1)?.view.you.role).toBe('observer')
  })

  it('BR-009: kicking the last player of a round ends it (nobody left to play)', () => {
    const h = running(1)
    h.room.kick(ADMIN, 'Nick1')
    expect(h.room.running).toBe(false)
    expect(h.room.viewFor('uid-1')).toBeNull()
  })

  it('closeRoom during a round clears every timer', () => {
    const h = running(2)
    h.room.onSocketClosed('uid-2')
    h.room.closeRoom(ADMIN)
    expect(h.clock.pendingCount).toBe(0)
    h.tick(1)
    expect(h.published.at(-1)).toBeNull()
  })
})
