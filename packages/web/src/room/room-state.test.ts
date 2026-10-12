import { HISTORY_MAX, NEWS_FADE_TICKS } from '@fm/shared/config'
import type { MeRound, RoomView, ServerMessage } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { newsTone } from '../components/newsTone'
import { canTrade, initialRoomState, reduceRoom, shownHistory, type RoomState } from './room-state'

const view = (over: Partial<RoomView> = {}): RoomView => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  durationMin: 5,
  profitTarget: null,
  speed: 3,
  status: 'lobby',
  players: [{ nick: 'Ann', status: 'active' }],
  observers: [],
  lastRound: null,
  you: { role: 'player', nick: 'Ann', isHost: true },
  ...over,
})

const me = (over: Partial<MeRound> = {}): MeRound => ({
  role: 'player',
  status: 'active',
  units: 0,
  avg: 0,
  realized: 0,
  equity: 10_000,
  closedTrades: 0,
  wins: 0,
  ...over,
})

type Tick = Extract<ServerMessage, { type: 'room.tick' }>

const tick = (over: Partial<Tick> = {}): ServerMessage => ({
  type: 'room.tick',
  prices: [100, 101, 102],
  price: 102,
  halt: null,
  news: null,
  endsInMs: 60_000,
  ranking: [{ nick: 'Ann', equity: 10_000, status: 'active', place: 1 }],
  you: me(),
  ...over,
})

const run = (msgs: ServerMessage[], from: RoomState = initialRoomState): RoomState =>
  msgs.reduce(reduceRoom, from)

describe('reduceRoom', () => {
  it('FR-017: auth.ok sets isAdmin, and it survives the start of a round', () => {
    const state = run([
      { type: 'auth.ok', admin: true },
      { type: 'room.state', view: view() },
      { type: 'room.state', view: view({ status: 'running' }) },
    ])
    expect(state.isAdmin).toBe(true)
  })

  it('room.state sets the view', () => {
    const state = run([{ type: 'room.state', view: view() }])
    expect(state.view?.name).toBe('Alpha')
  })

  it('FR-015: room.history replaces the history, then ticks append', () => {
    const state = run([
      { type: 'room.state', view: view({ status: 'running' }) },
      { type: 'room.history', prices: [100, 101] },
      tick({ prices: [102, 103], price: 103 }),
    ])
    expect(state.history).toEqual([100, 101, 102, 103])
    expect(state.price).toBe(103)
  })

  it('FR-005: history is capped at HISTORY_MAX, newest kept', () => {
    const full = Array.from({ length: HISTORY_MAX }, (_, i) => i)
    const state = run([{ type: 'room.history', prices: full }, tick({ prices: [-1, -2, -3] })])
    expect(state.history).toHaveLength(HISTORY_MAX)
    expect(state.history.slice(-3)).toEqual([-1, -2, -3])
    expect(state.history[0]).toBe(3)
  })

  it('FR-013: a tick sets endsInMs, ranking and own numbers', () => {
    const state = run([tick({ endsInMs: 5_000, you: me({ equity: 9_000 }) })])
    expect(state.endsInMs).toBe(5_000)
    expect(state.ranking).toHaveLength(1)
    expect(state.you?.equity).toBe(9_000)
  })

  it('FR-005: news stays hot for 90 steps and counts steps, not messages', () => {
    const news = { type: 'VOL_SPIKE' } as const
    let state = run([tick({ news })])
    expect(state.news).toEqual(news)
    expect(state.newsAgeTicks).toBe(0)

    // 3 steps per tick: 30 ticks reach exactly NEWS_FADE_TICKS
    for (let i = 0; i < 30; i++) state = reduceRoom(state, tick())
    expect(state.newsAgeTicks).toBe(NEWS_FADE_TICKS)
    expect(newsTone(state.news, state.newsAgeTicks)).toBe('warn')

    state = reduceRoom(state, tick())
    expect(newsTone(state.news, state.newsAgeTicks)).toBe('none')
  })

  it('FR-005: a new news event resets the age and replaces the old one', () => {
    let state = run([tick({ news: { type: 'VOL_SPIKE' } }), tick(), tick()])
    state = reduceRoom(state, tick({ news: { type: 'TREND', dir: 1 } }))
    expect(state.news).toEqual({ type: 'TREND', dir: 1 })
    expect(state.newsAgeTicks).toBe(0)
  })

  it('BR-015: the chart stops at the halt start and resumes with the full history after it', () => {
    let state = run([tick({ prices: [100, 101, 102] })])
    state = reduceRoom(state, tick({ prices: [103, 104, 105], price: 102, halt: { msLeft: 5_000 } }))
    expect(state.price).toBe(102)
    expect(shownHistory(state)).toEqual([100, 101, 102])

    state = reduceRoom(state, tick({ prices: [106, 107, 108], price: 102, halt: { msLeft: 4_000 } }))
    expect(shownHistory(state)).toEqual([100, 101, 102])

    state = reduceRoom(state, tick({ prices: [109, 110, 111], price: 111, halt: null }))
    expect(shownHistory(state)).toHaveLength(12)
  })

  it('order.ok updates the own numbers at once and clears an old error', () => {
    const failed = run([{ type: 'error', code: 'RATE_LIMITED' }])
    const state = reduceRoom(failed, { type: 'order.ok', fill: 100.03, you: me({ units: 50 }) })
    expect(state.you?.units).toBe(50)
    expect(state.error).toBeNull()
  })

  it('BR-014: round.end keeps the result and stops the countdown', () => {
    const end: ServerMessage = {
      type: 'round.end',
      reason: 'TIME',
      winners: ['Ann'],
      ranking: [{ nick: 'Ann', equity: 10_500, status: 'active', place: 1 }],
    }
    const state = run([tick({ halt: { msLeft: 1_000 } }), end])
    expect(state.lastResult).toEqual({ reason: 'TIME', winners: ['Ann'], ranking: end.ranking })
    expect(state.endsInMs).toBeNull()
    expect(state.halt).toBeNull()
  })

  it('BP-002: the next round starts clean but keeps the socket-level flags', () => {
    const ended = run([
      { type: 'room.state', view: view({ status: 'running' }) },
      tick(),
      { type: 'round.end', reason: 'TIME', winners: [], ranking: [] },
      { type: 'room.state', view: view() },
    ])
    expect(ended.lastResult).not.toBeNull()

    const next = reduceRoom(ended, { type: 'room.state', view: view({ status: 'running' }) })
    expect(next.lastResult).toBeNull()
    expect(next.history).toEqual([])
    expect(next.you).toBeNull()
    expect(next.view?.status).toBe('running')
  })

  it('FR-015: joining a running room mid-round keeps the history that follows room.state', () => {
    const state = run([
      { type: 'room.state', view: view({ status: 'running' }) },
      { type: 'room.history', prices: [100, 99] },
    ])
    expect(state.history).toEqual([100, 99])
  })

  it('BR-017: kicked sets 4403; ROOM_CLOSED sets 4410; other errors set only the code', () => {
    expect(run([{ type: 'kicked' }]).closeCode).toBe(4403)
    const closed = run([{ type: 'error', code: 'ROOM_CLOSED' }])
    expect(closed.closeCode).toBe(4410)
    expect(closed.error).toBe('ROOM_CLOSED')
    const other = run([{ type: 'error', code: 'HALTED' }])
    expect(other.closeCode).toBeNull()
    expect(other.error).toBe('HALTED')
  })
})

describe('canTrade (UF-004, UF-005, FR-014, FR-005)', () => {
  it('an active player outside a halt can trade', () => {
    expect(canTrade(me(), false)).toBe(true)
  })

  it('an observer cannot', () => {
    expect(canTrade(me({ role: 'observer' }), false)).toBe(false)
  })

  it('an eliminated player cannot', () => {
    expect(canTrade(me({ status: 'eliminated' }), false)).toBe(false)
  })

  it('nobody can during a halt, or before the first tick', () => {
    expect(canTrade(me(), true)).toBe(false)
    expect(canTrade(null, false)).toBe(false)
  })
})
