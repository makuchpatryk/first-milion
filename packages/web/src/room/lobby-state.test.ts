import type { RoomSummary } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { initialLobbyState, joinPolicy, reduceLobby } from './lobby-state'

const room = (over: Partial<RoomSummary> = {}): RoomSummary => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  players: 1,
  observers: 0,
  maxPlayers: 4,
  durationMin: 5,
  profitTarget: null,
  speed: 3,
  status: 'lobby',
  ...over,
})

describe('joinPolicy (BP-003, FR-010)', () => {
  it('a lobby room with 3 players seats a player', () => {
    expect(joinPolicy(room({ players: 3 }))).toBe('player')
  })

  it('a lobby room with 4 players and 3 observers seats an observer', () => {
    expect(joinPolicy(room({ players: 4, observers: 3 }))).toBe('observer')
  })

  it('4 observers close the room to newcomers', () => {
    expect(joinPolicy(room({ players: 4, observers: 4 }))).toBe('closed')
  })

  it('a running room seats an observer, or nobody once 4 watch', () => {
    expect(joinPolicy(room({ status: 'running', players: 2, observers: 3 }))).toBe('observer')
    expect(joinPolicy(room({ status: 'running', players: 2, observers: 4 }))).toBe('closed')
  })

  it('a lobby room with free player slots stays joinable even with full observers', () => {
    expect(joinPolicy(room({ players: 2, observers: 4 }))).toBe('player')
  })
})

describe('reduceLobby', () => {
  it('FR-008: lobby.rooms replaces the list', () => {
    const first = reduceLobby(initialLobbyState, { type: 'lobby.rooms', rooms: [room()] })
    const second = reduceLobby(first, { type: 'lobby.rooms', rooms: [room({ id: 'r2' })] })
    expect(second.rooms.map((r) => r.id)).toEqual(['r2'])
  })

  it('FR-017: auth.ok sets isAdmin from the server flag', () => {
    expect(reduceLobby(initialLobbyState, { type: 'auth.ok', admin: true }).isAdmin).toBe(true)
    const off = reduceLobby({ ...initialLobbyState, isAdmin: true }, { type: 'auth.ok', admin: false })
    expect(off.isAdmin).toBe(false)
  })

  it('UF-003: room.created records the new room id and clears an old error', () => {
    const failed = reduceLobby(initialLobbyState, { type: 'error', code: 'INVALID_PAYLOAD' })
    const created = reduceLobby(failed, { type: 'room.created', roomId: 'abc' })
    expect(created.createdRoomId).toBe('abc')
    expect(created.error).toBeNull()
  })

  it('UF-003: a server error is kept for the screen', () => {
    expect(reduceLobby(initialLobbyState, { type: 'error', code: 'FORBIDDEN' }).error).toBe('FORBIDDEN')
  })

  it('ignores messages that belong to a room socket', () => {
    expect(reduceLobby(initialLobbyState, { type: 'kicked' })).toBe(initialLobbyState)
  })
})
