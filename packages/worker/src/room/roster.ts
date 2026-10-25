import type { RoomView } from '@fm/shared/protocol'
import { NICK_MAX } from '@fm/shared/rules'
import { suffixNick } from '@fm/shared/validation'

export interface Member {
  uid: string
  nick: string
}

/**
 * Seat for a joiner (FR-010, BR-011, BR-012, BP-003): a free player slot in a lobby-state room
 * makes a player; a running room or full player slots make an observer; `full` when the
 * observer slots are also taken.
 */
export function assignRole(
  players: readonly Member[],
  observers: readonly Member[],
  roomStatus: RoomView['status'],
  maxPlayers: number,
  maxObservers: number,
): 'player' | 'observer' | 'full' {
  if (roomStatus === 'lobby' && players.length < maxPlayers) return 'player'
  return observers.length < maxObservers ? 'observer' : 'full'
}

/**
 * Collision suffix `#2`, `#3`, ... (FR-002). The base is cut so the result still fits
 * `NICK_MAX` characters.
 */
export function uniqueNick(taken: readonly string[], base: string): string {
  if (!taken.includes(base)) return base
  for (let n = 2; ; n++) {
    const room = NICK_MAX - `#${n}`.length
    const candidate = suffixNick(base.slice(0, room), n)
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * Host handover when `leavingUid` goes (BR-013): next player by join order, else the earliest
 * observer, else `null`. Callers pass connected members only, so the role never lands on someone
 * whose socket is away (decision 46).
 */
export function nextHost(
  players: readonly Member[],
  observers: readonly Member[],
  leavingUid: string,
): string | null {
  const successor =
    players.find((member) => member.uid !== leavingUid) ??
    observers.find((member) => member.uid !== leavingUid)
  return successor?.uid ?? null
}
