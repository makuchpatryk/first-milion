import { HEARTBEAT_MS, LOBBY_SWEEP_MS, STALE_AFTER_MS } from '@fm/shared/config'
import type { RoomSummary } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { LobbyLogic } from '../../src/lobby/lobby-logic'
import { FakeClock } from '../fake-clock'

const summary = (id: string, patch: Partial<RoomSummary> = {}): RoomSummary => ({
  id,
  name: `Room ${id}`,
  hostNick: 'Jan',
  players: 1,
  observers: 0,
  maxPlayers: 4,
  durationMin: 5,
  profitTarget: 20_000,
  speed: 1,
  status: 'lobby',
  ...patch,
})

function setup() {
  const clock = new FakeClock()
  const broadcasts: RoomSummary[][] = []
  const lobby = new LobbyLogic({
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    broadcast: (rooms) => broadcasts.push(rooms),
  })
  return { clock, lobby, broadcasts }
}

describe('LobbyLogic', () => {
  it('FR-008: a registered room is listed and broadcast', () => {
    const { lobby, broadcasts } = setup()
    lobby.register(summary('a'))
    expect(lobby.list()).toEqual([summary('a')])
    expect(lobby.has('a')).toBe(true)
    expect(broadcasts).toEqual([[summary('a')]])
  })

  it('FR-008: list order is registration order, and updating a room keeps its place', () => {
    const { lobby } = setup()
    lobby.register(summary('a'))
    lobby.register(summary('b'))
    lobby.register(summary('a', { players: 3 }))
    expect(lobby.list().map((room) => room.id)).toEqual(['a', 'b'])
    expect(lobby.list()[0]?.players).toBe(3)
  })

  it('FR-008: a heartbeat with an unchanged summary does not broadcast', () => {
    const { clock, lobby, broadcasts } = setup()
    lobby.register(summary('a'))
    clock.advance(HEARTBEAT_MS)
    lobby.register(summary('a'))
    expect(broadcasts).toHaveLength(1)
  })

  it('FR-008: a changed summary broadcasts again', () => {
    const { lobby, broadcasts } = setup()
    lobby.register(summary('a'))
    lobby.register(summary('a', { players: 2 }))
    expect(broadcasts).toHaveLength(2)
    expect(broadcasts[1]?.[0]?.players).toBe(2)
  })

  it('FR-008 AC: a room with no heartbeat for 3x the interval (90 s) is removed and broadcast', () => {
    const { clock, lobby, broadcasts } = setup()
    lobby.register(summary('a'))
    clock.advance(STALE_AFTER_MS)
    expect(lobby.list()).toHaveLength(1) // exactly 90 s is not yet over the limit
    clock.advance(LOBBY_SWEEP_MS)
    expect(lobby.list()).toEqual([])
    expect(lobby.has('a')).toBe(false)
    expect(broadcasts.at(-1)).toEqual([])
  })

  it('FR-008 AC: a room heartbeating every 30 s stays listed', () => {
    const { clock, lobby } = setup()
    lobby.register(summary('a'))
    for (let i = 0; i < 10; i++) {
      clock.advance(HEARTBEAT_MS)
      lobby.register(summary('a'))
    }
    expect(lobby.has('a')).toBe(true)
  })

  it('FR-008: only the silent room is dropped', () => {
    const { clock, lobby } = setup()
    lobby.register(summary('quiet'))
    lobby.register(summary('alive'))
    for (let i = 0; i < 5; i++) {
      clock.advance(HEARTBEAT_MS)
      lobby.register(summary('alive'))
    }
    expect(lobby.list().map((room) => room.id)).toEqual(['alive'])
  })

  it('FR-016: remove drops the room and broadcasts', () => {
    const { lobby, broadcasts } = setup()
    lobby.register(summary('a'))
    lobby.remove('a')
    expect(lobby.list()).toEqual([])
    expect(broadcasts.at(-1)).toEqual([])
  })

  it('removing an unknown room changes nothing and does not broadcast', () => {
    const { lobby, broadcasts } = setup()
    lobby.remove('ghost')
    expect(broadcasts).toEqual([])
  })

  it('ARCH: the sweep timer is not armed while the registry is empty', () => {
    const { clock, lobby } = setup()
    expect(clock.pendingCount).toBe(0)
    lobby.register(summary('a'))
    expect(clock.pendingCount).toBe(1)
    lobby.register(summary('b'))
    expect(clock.pendingCount).toBe(1)
    lobby.remove('a')
    expect(clock.pendingCount).toBe(1)
    lobby.remove('b')
    expect(clock.pendingCount).toBe(0)
  })

  it('ARCH: after the last stale room is swept the timer stops', () => {
    const { clock, lobby } = setup()
    lobby.register(summary('a'))
    clock.advance(STALE_AFTER_MS + LOBBY_SWEEP_MS)
    expect(lobby.list()).toEqual([])
    expect(clock.pendingCount).toBe(0)
  })

  it('a room registering again after being swept appears as new', () => {
    const { clock, lobby } = setup()
    lobby.register(summary('a'))
    clock.advance(STALE_AFTER_MS + LOBBY_SWEEP_MS)
    lobby.register(summary('a'))
    expect(lobby.has('a')).toBe(true)
    expect(clock.pendingCount).toBe(1)
  })
})
