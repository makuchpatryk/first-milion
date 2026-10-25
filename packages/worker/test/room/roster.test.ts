import { MAX_OBSERVERS, MAX_PLAYERS, NICK_MAX } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import { assignRole, nextHost, uniqueNick, type Member } from '../../src/room/roster'

const members = (count: number, prefix = 'p'): Member[] =>
  Array.from({ length: count }, (_, i) => ({ uid: `${prefix}${i + 1}`, nick: `${prefix}Nick${i + 1}` }))

const role = (players: number, observers: number, status: 'lobby' | 'running' = 'lobby') =>
  assignRole(members(players), members(observers, 'o'), status, MAX_PLAYERS, MAX_OBSERVERS)

describe('assignRole', () => {
  it('FR-010 AC: a lobby with 3 players seats the joiner as a player', () => {
    expect(role(3, 0)).toBe('player')
  })

  it('FR-010 AC: a lobby with 4 players seats the joiner as an observer', () => {
    expect(role(4, 0)).toBe('observer')
    expect(role(4, 3)).toBe('observer')
  })

  it('FR-010 AC: 4 players and 4 observers is full', () => {
    expect(role(4, 4)).toBe('full')
  })

  it('BR-012: a running room never seats a player, even with free player slots', () => {
    expect(role(1, 0, 'running')).toBe('observer')
    expect(role(1, 4, 'running')).toBe('full')
  })

  it('an empty room seats the first joiner as a player', () => {
    expect(role(0, 0)).toBe('player')
  })
})

describe('uniqueNick', () => {
  it('a free nick is kept as it is', () => {
    expect(uniqueNick(['Anna'], 'Jan')).toBe('Jan')
  })

  it('FR-002 AC: a second "Jan" becomes "Jan#2", a third "Jan#3"', () => {
    expect(uniqueNick(['Jan'], 'Jan')).toBe('Jan#2')
    expect(uniqueNick(['Jan', 'Jan#2'], 'Jan')).toBe('Jan#3')
  })

  it('skips a suffix that is already taken', () => {
    expect(uniqueNick(['Jan', 'Jan#3'], 'Jan')).toBe('Jan#2')
  })

  it('spec Risks: the base is cut so a suffixed nick fits 16 characters', () => {
    const base = 'Trader-123456789'
    expect(base).toHaveLength(NICK_MAX)
    const nick = uniqueNick([base], base)
    expect(nick).toBe('Trader-1234567#2')
    expect(nick).toHaveLength(NICK_MAX)
  })

  it('a longer suffix (#10) cuts one more character', () => {
    const base = 'a'.repeat(NICK_MAX)
    const taken = [base, ...Array.from({ length: 8 }, (_, i) => `${'a'.repeat(14)}#${i + 2}`)]
    const nick = uniqueNick(taken, base)
    expect(nick).toBe(`${'a'.repeat(13)}#10`)
    expect(nick).toHaveLength(NICK_MAX)
  })
})

describe('nextHost', () => {
  it('BR-013: the next player by join order takes over', () => {
    expect(nextHost(members(3), members(2, 'o'), 'p1')).toBe('p2')
  })

  it('BR-013: a leaving non-first host still hands over to the first other player', () => {
    expect(nextHost(members(3), [], 'p2')).toBe('p1')
  })

  it('BR-013: with no other player the earliest observer takes over', () => {
    expect(nextHost(members(1), members(2, 'o'), 'p1')).toBe('o1')
  })

  it('BR-013: an empty room has no host', () => {
    expect(nextHost(members(1), [], 'p1')).toBeNull()
    expect(nextHost([], [], 'p1')).toBeNull()
  })

  it('decision 46: given connected members only, the first connected player, else the first connected observer, else null', () => {
    const connectedPlayers = members(3).filter((member) => member.uid !== 'p2')
    expect(nextHost(connectedPlayers, members(2, 'o'), 'p1')).toBe('p3')
    expect(nextHost([], members(2, 'o'), 'p1')).toBe('o1')
    expect(nextHost([], [], 'p1')).toBeNull()
  })
})
