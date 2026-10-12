import { CLOSE_CODES, type RoomSummary, type ServerMessage } from '@fm/shared/protocol'
import { EMPTY_ROOM_TTL_MS } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import { RoomLogic } from '../../src/room/room-logic'
import { FakeClock } from '../fake-clock'

const ADMIN = 'uid-admin'

function setup(hostUid = 'uid-1') {
  const clock = new FakeClock()
  const sent: { uid: string; msg: ServerMessage }[] = []
  const closed: { uid: string; code: number }[] = []
  const published: (RoomSummary | null)[] = []
  const room = new RoomLogic(
    { id: 'room-1', name: 'Friday round', durationMin: 5, speed: 3, profitTarget: 500, hostUid },
    {
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
      seed: () => 1,
      send: (uid, msg) => sent.push({ uid, msg }),
      close: (uid, code) => closed.push({ uid, code }),
      publish: (summary) => published.push(summary),
      isAdmin: (uid) => uid === ADMIN,
    },
  )
  const errorsTo = (uid: string) =>
    sent.flatMap((s) => (s.uid === uid && s.msg.type === 'error' ? [s.msg.code] : []))
  const lastView = (uid: string) => {
    const states = sent.flatMap((s) => (s.uid === uid && s.msg.type === 'room.state' ? [s.msg.view] : []))
    return states.at(-1)
  }
  return { clock, room, sent, closed, published, errorsTo, lastView }
}

/** Joins uid-1..uid-n as Nick1..Nick n. */
function fill(room: RoomLogic, count: number, from = 1) {
  for (let i = from; i < from + count; i++) room.join(`uid-${i}`, `Nick${i}`)
}

describe('RoomLogic join', () => {
  it('FR-009 AC: the creator joins as a player and host', () => {
    const { room, lastView } = setup()
    room.join('uid-1', 'Jan')
    expect(lastView('uid-1')).toMatchObject({
      you: { role: 'player', nick: 'Jan', isHost: true },
      hostNick: 'Jan',
      status: 'lobby',
      players: [{ nick: 'Jan', status: 'active' }],
      observers: [],
    })
  })

  it('FR-008: the summary carries the entry fields and counts', () => {
    const { room } = setup()
    fill(room, 2)
    room.join('uid-9', 'Eve') // third player
    expect(room.summary()).toEqual({
      id: 'room-1',
      name: 'Friday round',
      hostNick: 'Nick1',
      players: 3,
      observers: 0,
      maxPlayers: 4,
      durationMin: 5,
      profitTarget: 500,
      speed: 3,
      status: 'lobby',
    })
  })

  it('FR-010 AC: 4 players fit, the 5th joiner becomes an observer', () => {
    const { room, lastView } = setup()
    fill(room, 5)
    expect(room.summary()).toMatchObject({ players: 4, observers: 1 })
    expect(lastView('uid-5')?.you.role).toBe('observer')
  })

  it('FR-010 AC: with 4 players and 4 observers the next joiner gets ROOM_FULL', () => {
    const { room, errorsTo } = setup()
    fill(room, 8)
    room.join('uid-9', 'Late')
    expect(errorsTo('uid-9')).toEqual(['ROOM_FULL'])
    expect(room.summary()).toMatchObject({ players: 4, observers: 4 })
  })

  it('BR-013: players and observers are listed in join order', () => {
    const { room, lastView } = setup()
    fill(room, 6)
    expect(lastView('uid-1')?.players.map((p) => p.nick)).toEqual(['Nick1', 'Nick2', 'Nick3', 'Nick4'])
    expect(lastView('uid-1')?.observers).toEqual([{ nick: 'Nick5' }, { nick: 'Nick6' }])
  })

  it('FR-002 AC: a taken nickname gets #2, then #3', () => {
    const { room, lastView } = setup()
    room.join('uid-1', 'Jan')
    room.join('uid-2', 'Jan')
    room.join('uid-3', 'Jan')
    expect(lastView('uid-2')?.you.nick).toBe('Jan#2')
    expect(lastView('uid-3')?.you.nick).toBe('Jan#3')
  })

  it('FR-002 / spec Risks: a suffixed nickname never exceeds 16 characters', () => {
    const { room, lastView } = setup()
    room.join('uid-1', 'Trader-123456789')
    room.join('uid-2', 'Trader-123456789')
    expect(lastView('uid-2')?.you.nick).toBe('Trader-1234567#2')
  })

  it('a uid already in the room is refused with INVALID_STATE', () => {
    const { room, errorsTo } = setup()
    room.join('uid-1', 'Jan')
    room.join('uid-1', 'Other')
    expect(errorsTo('uid-1')).toEqual(['INVALID_STATE'])
    expect(room.summary().players).toBe(1)
  })

  it('every join broadcasts room.state to all members and publishes a summary', () => {
    const { room, sent, published, lastView } = setup()
    room.join('uid-1', 'Jan')
    room.join('uid-2', 'Ola')
    expect(lastView('uid-1')?.players).toHaveLength(2)
    expect(lastView('uid-2')?.players).toHaveLength(2)
    expect(sent.filter((s) => s.msg.type === 'room.state')).toHaveLength(3)
    expect(published.at(-1)).toMatchObject({ players: 2 })
  })

  it('ARCH Privacy: no view carries a uid', () => {
    const { room, sent } = setup('uid-secret-1')
    room.join('uid-secret-1', 'Jan')
    room.join('uid-secret-2', 'Ola')
    expect(JSON.stringify(sent.map((s) => s.msg))).not.toContain('uid-secret')
    expect(JSON.stringify(room.summary())).not.toContain('uid-secret')
  })
})

describe('RoomLogic host', () => {
  it('BR-013, FR-009: until the creator has joined, nobody else can join or take the host role', () => {
    const { room, errorsTo, published } = setup('uid-creator')
    room.join('uid-2', 'Ola')
    expect(errorsTo('uid-2')).toEqual(['INVALID_STATE'])
    expect(room.summary()).toMatchObject({ players: 0, observers: 0, hostNick: null })
    expect(published).toHaveLength(0)
  })

  it('BR-013, FR-009: the creator who joins after a rejected stranger is the host, then others can join', () => {
    const { room, lastView } = setup('uid-creator')
    room.join('uid-2', 'Ola')
    room.join('uid-creator', 'Jan')
    room.join('uid-2', 'Ola')
    expect(lastView('uid-creator')?.you.isHost).toBe(true)
    expect(lastView('uid-2')?.you.isHost).toBe(false)
    expect(lastView('uid-2')?.hostNick).toBe('Jan')
  })

  it('BR-014: a room whose creator never joins is deleted after the empty-room TTL', () => {
    const { clock, room, published } = setup('uid-creator')
    room.join('uid-2', 'Ola')
    clock.advance(EMPTY_ROOM_TTL_MS)
    expect(published.at(-1)).toBeNull()
  })

  it('BR-013 AC: when the host leaves, the next player by join order becomes host', () => {
    const { room, lastView } = setup()
    fill(room, 3)
    room.leave('uid-1')
    expect(lastView('uid-2')?.you.isHost).toBe(true)
    expect(lastView('uid-2')?.hostNick).toBe('Nick2')
    expect(lastView('uid-3')?.you.isHost).toBe(false)
  })

  it('BR-013: with no other player the earliest observer becomes host', () => {
    const { room, lastView } = setup()
    fill(room, 6)
    for (const n of [2, 3, 4]) room.leave(`uid-${n}`)
    room.leave('uid-1')
    expect(lastView('uid-5')?.you.isHost).toBe(true)
    expect(lastView('uid-6')?.you.isHost).toBe(false)
  })

  it('a non-host leaving keeps the host and updates everyone', () => {
    const { room, lastView, published } = setup()
    fill(room, 3)
    room.leave('uid-2')
    expect(lastView('uid-1')?.you.isHost).toBe(true)
    expect(lastView('uid-1')?.players.map((p) => p.nick)).toEqual(['Nick1', 'Nick3'])
    expect(published.at(-1)).toMatchObject({ players: 2 })
  })

  it('an unknown uid leaving changes nothing', () => {
    const { room, published } = setup()
    room.join('uid-1', 'Jan')
    const before = published.length
    room.leave('ghost')
    expect(published).toHaveLength(before)
  })

  it('the room is without host after the last member leaves, and the next joiner takes it', () => {
    const { room, lastView } = setup()
    room.join('uid-1', 'Jan')
    room.leave('uid-1')
    expect(room.summary().hostNick).toBeNull()
    room.join('uid-7', 'Ola')
    expect(lastView('uid-7')?.you.isHost).toBe(true)
  })

  it('M3: a closed socket counts as a leave', () => {
    const { room } = setup()
    fill(room, 2)
    room.onSocketClosed('uid-2')
    expect(room.summary().players).toBe(1)
  })
})

describe('RoomLogic empty room', () => {
  it('BR-014, FR-016 AC: a room empty for 5 min is deleted and leaves the list', () => {
    const { clock, room, published } = setup()
    room.join('uid-1', 'Jan')
    room.leave('uid-1')
    clock.advance(EMPTY_ROOM_TTL_MS - 1)
    expect(published.at(-1)).not.toBeNull()
    clock.advance(1)
    expect(published.at(-1)).toBeNull()
  })

  it('BR-014: a join before the 5 min are up cancels the deletion', () => {
    const { clock, room, published } = setup()
    room.join('uid-1', 'Jan')
    room.leave('uid-1')
    clock.advance(EMPTY_ROOM_TTL_MS - 1_000)
    room.join('uid-2', 'Ola')
    clock.advance(EMPTY_ROOM_TTL_MS * 2)
    expect(published.at(-1)).not.toBeNull()
    expect(clock.pendingCount).toBe(0)
  })

  it('BR-014: the 5 min restart each time the room empties', () => {
    const { clock, room, published } = setup()
    room.join('uid-1', 'Jan')
    room.leave('uid-1')
    clock.advance(EMPTY_ROOM_TTL_MS - 1_000)
    room.join('uid-2', 'Ola')
    room.leave('uid-2')
    clock.advance(EMPTY_ROOM_TTL_MS - 1_000)
    expect(published.at(-1)).not.toBeNull()
    clock.advance(1_000)
    expect(published.at(-1)).toBeNull()
  })

  it('BR-014: a room nobody ever joined is deleted after 5 min as well', () => {
    const { clock, published } = setup()
    clock.advance(EMPTY_ROOM_TTL_MS)
    expect(published).toEqual([null])
  })

  it('a deleted room refuses joins with ROOM_CLOSED', () => {
    const { clock, room, errorsTo } = setup()
    clock.advance(EMPTY_ROOM_TTL_MS)
    room.join('uid-1', 'Jan')
    expect(errorsTo('uid-1')).toEqual(['ROOM_CLOSED'])
    expect(room.summary().players).toBe(0)
  })

  it('dispose cancels the timers', () => {
    const { clock, room, published } = setup()
    room.dispose()
    expect(clock.pendingCount).toBe(0)
    clock.advance(EMPTY_ROOM_TTL_MS * 2)
    expect(published).toEqual([])
  })
})

describe('RoomLogic kick (BR-017)', () => {
  it('FR-017 AC: a non-admin is refused with FORBIDDEN and nothing changes', () => {
    const { room, errorsTo, closed } = setup()
    fill(room, 2)
    room.kick('uid-1', 'Nick2')
    expect(errorsTo('uid-1')).toEqual(['FORBIDDEN'])
    expect(closed).toEqual([])
    expect(room.summary().players).toBe(2)
  })

  it('an unknown nickname gives INVALID_STATE', () => {
    const { room, errorsTo } = setup()
    fill(room, 2)
    room.kick(ADMIN, 'Nobody')
    expect(errorsTo(ADMIN)).toEqual(['INVALID_STATE'])
  })

  it('FR-017 AC: the admin kicks a player: kicked message, close 4403, removed, others updated', () => {
    const { room, sent, closed, lastView } = setup()
    fill(room, 3)
    room.kick(ADMIN, 'Nick2')
    expect(sent.filter((s) => s.uid === 'uid-2').at(-1)?.msg).toEqual({ type: 'kicked' })
    expect(closed).toEqual([{ uid: 'uid-2', code: CLOSE_CODES.KICKED }])
    expect(lastView('uid-1')?.players.map((p) => p.nick)).toEqual(['Nick1', 'Nick3'])
    expect(room.summary().players).toBe(2)
  })

  it('the admin can kick an observer', () => {
    const { room } = setup()
    fill(room, 5)
    room.kick(ADMIN, 'Nick5')
    expect(room.summary()).toMatchObject({ players: 4, observers: 0 })
  })

  it('kicking the host hands the host role over', () => {
    const { room, lastView } = setup()
    fill(room, 2)
    room.kick(ADMIN, 'Nick1')
    expect(lastView('uid-2')?.you.isHost).toBe(true)
  })

  it('FR-017 AC: a kicked player can rejoin', () => {
    const { room, lastView } = setup()
    fill(room, 2)
    room.kick(ADMIN, 'Nick2')
    room.onSocketClosed('uid-2') // the closing socket reports in; already removed, a no-op
    room.join('uid-2', 'Nick2')
    expect(lastView('uid-2')?.you.role).toBe('player')
    expect(room.summary().players).toBe(2)
  })
})

describe('RoomLogic closeRoom (BR-017)', () => {
  it('FR-017 AC: a non-admin is refused with FORBIDDEN and the room stays', () => {
    const { room, errorsTo, published } = setup()
    fill(room, 2)
    room.closeRoom('uid-1')
    expect(errorsTo('uid-1')).toEqual(['FORBIDDEN'])
    expect(published.at(-1)).not.toBeNull()
    expect(room.summary().players).toBe(2)
  })

  it('FR-017 AC: the admin closes: ROOM_CLOSED to all, sockets closed with 4410, room deregistered', () => {
    const { room, errorsTo, closed, published, clock } = setup()
    fill(room, 5)
    room.closeRoom(ADMIN)
    for (let n = 1; n <= 5; n++) expect(errorsTo(`uid-${n}`)).toEqual(['ROOM_CLOSED'])
    expect(closed.map((c) => c.code)).toEqual(Array(5).fill(CLOSE_CODES.ROOM_CLOSED))
    expect(published.at(-1)).toBeNull()
    expect(clock.pendingCount).toBe(0)
  })

  it('closing twice deregisters once', () => {
    const { room, published } = setup()
    fill(room, 1)
    room.closeRoom(ADMIN)
    room.closeRoom(ADMIN)
    expect(published.filter((s) => s === null)).toHaveLength(1)
  })

  it('a closed room refuses joins with ROOM_CLOSED', () => {
    const { room, errorsTo } = setup()
    fill(room, 1)
    room.closeRoom(ADMIN)
    room.join('uid-9', 'Late')
    expect(errorsTo('uid-9')).toEqual(['ROOM_CLOSED'])
  })
})
