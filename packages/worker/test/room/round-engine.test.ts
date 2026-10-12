import { TICK_MS } from '@fm/shared/config'
import type { RankRow } from '@fm/shared/protocol'
import { START_CASH } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import {
  ADMIN,
  createHarness,
  joinPlayers,
  leverage,
  scriptedPlayers,
  type Harness,
  type HarnessOptions,
} from '../support/test-client'

// Rounds played through `RoomLogic` with a fake clock, no sleeps (CODE_QUALITY: tests). Seeds are
// fixed: the engine is a pure function of the seed, so each scenario replays exactly.

const ROUND_TICKS = (3 * 60_000) / TICK_MS // a 3 minute round in 80 ms ticks

function started(players: number, options: HarnessOptions = {}): Harness {
  const h = createHarness(options)
  joinPlayers(h, players)
  h.room.start('uid-1')
  return h
}

const roundEnd = (h: Harness, uid = 'uid-1') => h.ofType(uid, 'round.end').at(-1)

/** Equity is non-increasing down the ranking and places are competition ranks (BR-009, BR-010). */
function expectConsistentRanking(ranking: readonly RankRow[]): void {
  for (const [index, row] of ranking.entries()) {
    const ahead = ranking.filter((other) => rank(other) < rank(row)).length
    expect(row.place).toBe(1 + ahead)
    if (row.status === 'eliminated') expect(row.equity).toBe(0)
    const next = ranking[index + 1]
    if (next !== undefined) expect(next.place).toBeGreaterThanOrEqual(row.place)
  }
  const equities = ranking.filter((row) => row.status !== 'eliminated').map((row) => row.equity)
  expect(equities).toEqual([...equities].sort((a, b) => b - a))
  const firstEliminated = ranking.findIndex((row) => row.status === 'eliminated')
  if (firstEliminated !== -1) {
    expect(ranking.slice(firstEliminated).every((row) => row.status === 'eliminated')).toBe(true)
  }
}
/** Sort key: eliminated behind everyone, then by equity; ties are the tie-break's job. */
const rank = (row: RankRow): number => (row.status === 'eliminated' ? Infinity : -row.equity)

describe('profit target (FR-013 AC, BR-009)', () => {
  it('FR-013 AC: a player at the target ends the round and wins', () => {
    const h = started(3, { profitTarget: 100, seed: 1 })
    h.tick(2)
    h.room.order('uid-1', 'BUY', 250)
    const used = h.runToEnd(ROUND_TICKS)
    expect(used).toBeLessThan(ROUND_TICKS) // well before the time is up
    expect(roundEnd(h)).toMatchObject({ reason: 'TARGET', winners: ['Nick1'] })
    const winnerRow = roundEnd(h)?.ranking.find((row) => row.nick === 'Nick1')
    expect(winnerRow?.equity).toBeGreaterThanOrEqual(START_CASH + 100)
    expect(winnerRow?.place).toBe(1)
  })

  it('BR-009: every member, observers too, gets the same round.end', () => {
    const h = createHarness({ profitTarget: 100, seed: 1 })
    joinPlayers(h, 5) // uid-5 observes
    h.room.start('uid-1')
    h.tick(2)
    h.room.order('uid-1', 'BUY', 250)
    h.runToEnd(ROUND_TICKS)
    const ends = [1, 2, 3, 4, 5].map((n) => roundEnd(h, `uid-${n}`))
    expect(ends.every((end) => end !== undefined)).toBe(true)
    for (const end of ends) expect(end).toEqual(ends[0])
  })

  it('BR-009: two players reaching the target on the same tick with equal equity share the first place', () => {
    const h = started(3, { profitTarget: 100, seed: 1 })
    h.tick(2)
    h.room.order('uid-1', 'BUY', 250)
    h.room.order('uid-2', 'BUY', 250)
    h.runToEnd(ROUND_TICKS)
    expect(roundEnd(h)).toMatchObject({ reason: 'TARGET', winners: ['Nick1', 'Nick2'] })
    expect(roundEnd(h)?.ranking.map((row) => row.place)).toEqual([1, 1, 3])
  })

  it('BR-009: no target in the room, no TARGET end however far ahead a player is', () => {
    const h = started(2, { profitTarget: null, seed: 1 })
    h.tick(2)
    h.room.order('uid-1', 'BUY', 250)
    h.runToEnd(ROUND_TICKS)
    expect(roundEnd(h)?.reason).toBe('TIME')
  })

  it('BR-009: the end checks also run after an order (the time ran out between two ticks)', () => {
    const h = started(2, { seed: 1 })
    h.tick(5)
    h.clock.advance(3 * 60_000) // past the end, the next tick has not run yet
    expect(h.room.running).toBe(true)
    h.room.order('uid-1', 'BUY', 10)
    expect(h.ofType('uid-1', 'order.ok')).toHaveLength(1)
    expect(roundEnd(h)?.reason).toBe('TIME')
    expect(h.room.running).toBe(false)
  })
})

describe('round time (FR-013 AC, BR-008, BR-009, BR-010)', () => {
  it('BR-008: a 3 minute round lasts 3 minutes of wall clock at speed 8, to the tick', () => {
    const h = started(2, { seed: 1, speed: 8 })
    h.tick(ROUND_TICKS - 1)
    expect(h.room.running).toBe(true)
    h.tick(1)
    expect(h.room.running).toBe(false)
    expect(roundEnd(h)?.reason).toBe('TIME')
  })

  it('FR-013 AC: at the end the highest equity wins and the ranking is consistent', () => {
    const h = started(3, { seed: 1 })
    h.tick(2)
    h.room.order('uid-1', 'BUY', 250)
    h.room.order('uid-2', 'SELL', 250)
    h.runToEnd(ROUND_TICKS)
    const end = roundEnd(h)
    expect(end?.reason).toBe('TIME')
    const ranking = end?.ranking ?? []
    expect(ranking).toHaveLength(3)
    expectConsistentRanking(ranking)
    // Long and short on one price: one gained, one lost; the flat player sits between them.
    expect(ranking.map((row) => row.nick)[1]).toBe('Nick3')
    expect(end?.winners).toEqual([ranking[0]?.nick])
  })

  it('BR-010: equal equity and equal time share the first place', () => {
    const h = started(2, { seed: 1 })
    h.runToEnd(ROUND_TICKS) // both flat the whole round
    expect(roundEnd(h)).toMatchObject({ reason: 'TIME', winners: ['Nick1', 'Nick2'] })
    expect(roundEnd(h)?.ranking.map((row) => row.place)).toEqual([1, 1])
  })

  it('BR-010: flat players keep the start timestamp, so they stay level on equity and on time', () => {
    // A player who traded and came back to the exact same equity is not reachable (the spread
    // always costs), so "earlier wins" is tested on seats in ranking.test.ts and round.test.ts.
    const h = started(2, { seed: 1 })
    h.tick(10)
    expect(h.latestTick('uid-1')?.ranking.map((row) => row.place)).toEqual([1, 1])
  })

  it('the tick counts the time left down in wall-clock ms', () => {
    const h = started(2, { seed: 1, durationMin: 3 })
    h.tick(100)
    expect(h.latestTick('uid-1')?.endsInMs).toBe(3 * 60_000 - 100 * TICK_MS)
  })
})

describe('elimination (BR-005, FR-014)', () => {
  it('FR-003 AC, FR-014 AC: equity <= 0 liquidates the position; the player is last with equity 0 and stays seated', () => {
    const h = started(2, { seed: 2 }) // seed 2: the long side is wiped out first
    h.tick(2)
    leverage(h, 'uid-1', 'BUY', 100)
    leverage(h, 'uid-2', 'SELL', 100)
    expect(h.room.running).toBe(true)

    const tick = h.latestTick('uid-2')
    expect(tick?.ranking).toEqual([
      expect.objectContaining({ nick: 'Nick2', status: 'active', place: 1 }),
      { nick: 'Nick1', equity: 0, status: 'eliminated', place: 2 },
    ])
    expect(h.latestTick('uid-1')?.you).toMatchObject({ status: 'eliminated', units: 0, avg: 0, equity: 0 })
    expect(h.room.viewFor('uid-2')?.players.map((p) => p.status)).toEqual(['eliminated', 'active'])
    expect(h.room.summary().players).toBe(2)
  })

  it('FR-012: an eliminated player is refused with ELIMINATED, the round goes on for the others', () => {
    const h = started(2, { seed: 2 }) // uid-2 stays flat
    h.tick(2)
    leverage(h, 'uid-1', 'BUY', 100)
    expect(h.latestTick('uid-1')?.you.status).toBe('eliminated')
    const errors = h.errorsTo('uid-1').length
    h.room.order('uid-1', 'SELL', 10)
    h.room.close('uid-1')
    expect(h.errorsTo('uid-1').slice(errors)).toEqual(['ELIMINATED', 'ELIMINATED'])
    h.tick(20)
    expect(h.room.running).toBe(true)
    expect(h.latestTick('uid-1')?.you.status).toBe('eliminated') // still receives the stream, watch-only
  })

  it('BR-009 exception, FR-014: when every player is eliminated the round ends at once', () => {
    const h = started(1, { seed: 1 })
    h.tick(2)
    leverage(h, 'uid-1', 'BUY', 100)
    h.runToEnd(ROUND_TICKS)
    expect(roundEnd(h)).toMatchObject({
      reason: 'ALL_ELIMINATED',
      winners: [],
      ranking: [{ nick: 'Nick1', equity: 0, status: 'eliminated', place: 1 }],
    })
    expect(h.room.running).toBe(false)
  })

  it('BR-005: a player wiped out while piling up a position ends with equity 0, never below', () => {
    const h = started(1, { seed: 1 })
    h.tick(2)
    leverage(h, 'uid-1', 'BUY', 200)
    h.runToEnd(ROUND_TICKS)
    expect(roundEnd(h)?.reason).toBe('ALL_ELIMINATED')
    for (const ok of h.ofType('uid-1', 'order.ok')) expect(ok.you.equity).toBeGreaterThanOrEqual(0)
  })
})

describe('round end and the next round (BR-014, decision 38)', () => {
  it('BR-014: the room goes back to the lobby with the result shown until the next start', () => {
    const h = started(2, { seed: 1 })
    h.runToEnd(ROUND_TICKS)
    expect(h.room.running).toBe(false)
    expect(h.published.at(-1)).toMatchObject({ status: 'lobby' })
    const view = h.room.viewFor('uid-1')
    expect(view).toMatchObject({ status: 'lobby', lastRound: { reason: 'TIME', winners: ['Nick1', 'Nick2'] } })
    expect(view?.lastRound?.ranking).toEqual(roundEnd(h)?.ranking)
    expect(h.ofType('uid-1', 'room.state').at(-1)?.view.status).toBe('lobby')
  })

  it('after the end the room no longer ticks, orders get INVALID_STATE', () => {
    const h = started(2, { seed: 1 })
    h.runToEnd(ROUND_TICKS)
    const sent = h.log.length
    h.tick(5)
    expect(h.log).toHaveLength(sent)
    h.room.order('uid-1', 'BUY', 10)
    expect(h.errorsTo('uid-1')).toEqual(['INVALID_STATE'])
  })

  it('decision 38: the next start resets every seat to active with an empty portfolio', () => {
    const h = started(2, { seed: 2 }) // uid-1 is wiped out, uid-2 stays flat
    h.tick(2)
    leverage(h, 'uid-1', 'BUY', 100)
    h.runToEnd(ROUND_TICKS)
    expect(roundEnd(h)?.reason).toBe('TIME')
    expect(h.room.viewFor('uid-1')?.players.map((p) => p.status)).toEqual(['eliminated', 'active'])

    h.room.start('uid-1')
    expect(h.room.viewFor('uid-1')?.players.map((p) => p.status)).toEqual(['active', 'active'])
    h.tick(1)
    for (const uid of ['uid-1', 'uid-2']) {
      expect(h.latestTick(uid)?.you).toMatchObject({
        status: 'active',
        units: 0,
        realized: 0,
        closedTrades: 0,
        equity: START_CASH,
      })
    }
    expect(h.latestTick('uid-1')?.endsInMs).toBe(3 * 60_000 - TICK_MS)
  })

  it('BR-012: observers are untouched by a start', () => {
    const h = createHarness({ seed: 1 })
    joinPlayers(h, 5)
    h.room.start('uid-1')
    h.runToEnd(ROUND_TICKS)
    h.room.start('uid-1')
    expect(h.room.summary()).toMatchObject({ players: 4, observers: 1, status: 'running' })
  })

  it('BR-017: a kick between rounds removes the seat; the next round runs without it', () => {
    const h = started(3, { seed: 1 })
    h.runToEnd(ROUND_TICKS)
    h.room.kick(ADMIN, 'Nick3')
    h.room.start('uid-1')
    h.tick(1)
    expect(h.latestTick('uid-1')?.ranking.map((row) => row.nick)).toEqual(['Nick1', 'Nick2'])
  })
})

describe('four-player round (M4 DoD, FR-011..FR-015)', () => {
  function playRound(seed: number, botSeed: number) {
    const h = createHarness({ seed, durationMin: 3, speed: 8 })
    joinPlayers(h, 4)
    h.room.start('uid-1')
    const act = scriptedPlayers(h, ['uid-1', 'uid-2', 'uid-3', 'uid-4'], botSeed)
    let ticks = 0
    while (h.room.running && ticks < ROUND_TICKS + 5) {
      h.tick()
      if (h.room.running) act()
      ticks++
    }
    return { h, ticks }
  }

  it('plays to the end with no errors, one price stream for all and a consistent result', () => {
    const { h, ticks } = playRound(42, 7)
    expect(h.room.running).toBe(false)
    expect(ticks).toBeLessThanOrEqual(ROUND_TICKS)

    const errors = h.log.filter((entry) => entry.msg.type === 'error')
    expect(errors).toEqual([])

    const uids = ['uid-1', 'uid-2', 'uid-3', 'uid-4']
    const stream = (uid: string) => h.ofType(uid, 'room.tick').flatMap((tick) => tick.prices)
    // The interval that ends the round sends round.end instead of a tick.
    expect(stream('uid-1').length).toBe(8 * (ticks - 1))
    for (const uid of uids) expect(stream(uid)).toEqual(stream('uid-1'))

    const ends = uids.map((uid) => roundEnd(h, uid))
    for (const end of ends) expect(end).toEqual(ends[0])
    const end = ends[0]
    expect(['TARGET', 'TIME', 'ALL_ELIMINATED']).toContain(end?.reason)
    expect(end?.ranking).toHaveLength(4)
    expectConsistentRanking(end?.ranking ?? [])
    const first = end?.ranking.filter((row) => row.place === 1 && row.status !== 'eliminated') ?? []
    expect(end?.winners).toEqual(first.map((row) => row.nick))

    // Orders were confirmed in the same call and the bots really traded.
    expect(uids.reduce((sum, uid) => sum + h.ofType(uid, 'order.ok').length, 0)).toBeGreaterThan(20)
  })

  it('FR-013: every member ends the round with round.end, then the lobby state', () => {
    const { h } = playRound(42, 7)
    for (const uid of ['uid-1', 'uid-2', 'uid-3', 'uid-4']) {
      const types = h.inbox(uid).map((msg) => msg.type)
      expect(types.at(-1)).toBe('room.state') // round.end, then the lobby state
      expect(types.at(-2)).toBe('round.end')
    }
  })

  it('ARCH invariant: the same seeds replay the identical message log; another seed does not', () => {
    const first = playRound(42, 7).h.log
    const again = playRound(42, 7).h.log
    expect(again).toEqual(first)
    expect(playRound(43, 7).h.log).not.toEqual(first)
  })
})

describe('timers and cleanup (CODE_QUALITY: cleanup)', () => {
  it('no timer is left after the round ends, a pending disconnect timer included', () => {
    const h = started(3, { seed: 1 })
    h.tick(ROUND_TICKS - 100) // 8 s before the end
    h.room.onSocketClosed('uid-3') // its 30 s timer would fire after the round
    expect(h.clock.pendingCount).toBe(1)
    h.runToEnd(200)
    expect(h.room.running).toBe(false)
    expect(h.clock.pendingCount).toBe(0)
    // The player who dropped is not in the lobby; their place stays in the result.
    expect(h.room.summary().players).toBe(2)
    expect(roundEnd(h)?.ranking.map((row) => row.nick)).toContain('Nick3')
  })

  it('no timer is left after dispose', () => {
    const h = started(3, { seed: 1 })
    h.room.onSocketClosed('uid-2')
    h.tick(10)
    expect(h.clock.pendingCount).toBe(1)
    h.room.dispose()
    expect(h.clock.pendingCount).toBe(0)
    h.tick(5) // a disposed room does not tick
    expect(h.room.running).toBe(false)
  })

  it('a room with the round still running is not "empty": the 5 min timer is not armed', () => {
    const h = started(2, { seed: 1 })
    h.tick(5)
    expect(h.clock.pendingCount).toBe(0)
  })
})
