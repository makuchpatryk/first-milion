import {
  CLOSE_CODES,
  type ErrorCode,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
} from '@fm/shared/protocol'
import {
  EMPTY_ROOM_TTL_MS,
  MAX_OBSERVERS,
  MAX_PLAYERS,
  type RoundDuration,
  type Speed,
} from '@fm/shared/rules'
import type { Handle, Timers } from '../timers'
import { assignRole, nextHost, uniqueNick, type Member } from './roster'

export interface RoomInit {
  id: string
  name: string
  durationMin: RoundDuration
  speed: Speed
  profitTarget: number | null
  /** The creator (BR-013). */
  hostUid: string
}

export interface RoomDeps extends Timers {
  send(uid: string, msg: ServerMessage): void
  close(uid: string, code: number): void
  /** A summary on every change; `null` once the room is deleted. */
  publish(summary: RoomSummary | null): void
  isAdmin(uid: string): boolean
}

/**
 * Room membership and lifecycle in lobby state (M3). Plain TypeScript: clock, timers and
 * sockets are injected (ARCHITECTURE A1). The round engine arrives with M4.
 */
export class RoomLogic {
  private readonly players: Member[] = []
  private readonly observers: Member[] = []
  private hostUid: string | null
  private emptyTimer: Handle | null = null
  private disposed = false
  private creatorJoined = false

  constructor(
    private readonly init: RoomInit,
    private readonly deps: RoomDeps,
  ) {
    this.hostUid = init.hostUid
    // A room nobody ever joins is deleted too (BR-014).
    this.armEmptyTimer()
  }

  summary(): RoomSummary {
    return {
      id: this.init.id,
      name: this.init.name,
      hostNick: this.hostMember()?.nick ?? null,
      players: this.players.length,
      observers: this.observers.length,
      maxPlayers: MAX_PLAYERS,
      durationMin: this.init.durationMin,
      profitTarget: this.init.profitTarget,
      speed: this.init.speed,
      status: 'lobby',
    }
  }

  /** The view for one member; carries nicknames only, never UIDs (ARCHITECTURE Privacy). */
  viewFor(uid: string): RoomView | null {
    const you = this.find(uid)
    if (you === null) return null
    return {
      id: this.init.id,
      name: this.init.name,
      hostNick: this.hostMember()?.nick ?? null,
      durationMin: this.init.durationMin,
      profitTarget: this.init.profitTarget,
      speed: this.init.speed,
      status: 'lobby',
      players: this.players.map((member) => ({ nick: member.nick, status: 'active' })),
      observers: this.observers.map((member) => ({ nick: member.nick })),
      you: {
        role: this.players.includes(you) ? 'player' : 'observer',
        nick: you.nick,
        isHost: uid === this.hostUid,
      },
    }
  }

  join(uid: string, nick: string): void {
    if (this.disposed) return this.fail(uid, 'ROOM_CLOSED')
    // One socket per user per room; reconnecting is M4.
    if (this.find(uid) !== null) return this.fail(uid, 'INVALID_STATE')
    // The room is listed before its creator has connected; until they join, nobody else may
    // take the seat or the host role (BR-013, FR-009). A creator who never comes leaves the room
    // empty, and the empty-room timer deletes it (BR-014).
    if (!this.creatorJoined && uid !== this.init.hostUid) return this.fail(uid, 'INVALID_STATE')
    const role = assignRole(this.players, this.observers, 'lobby', MAX_PLAYERS, MAX_OBSERVERS)
    if (role === 'full') return this.fail(uid, 'ROOM_FULL')

    const taken = [...this.players, ...this.observers].map((member) => member.nick)
    const member = { uid, nick: uniqueNick(taken, nick) }
    const seats = role === 'player' ? this.players : this.observers
    seats.push(member)
    if (uid === this.init.hostUid) this.creatorJoined = true
    // The creator is host (BR-013). Once they have gone and the room is empty, the next joiner
    // takes the role, so a room never sits without a host.
    if (this.hostMember() === null) this.hostUid = uid
    this.cancelEmptyTimer()
    this.changed()
  }

  leave(uid: string): void {
    if (this.remove(uid) !== null) this.changed()
  }

  /** M3: a closed socket is a leave. M4 adds the disconnect grace (BR-019). */
  onSocketClosed(uid: string): void {
    this.leave(uid)
  }

  /** Admin removes a member by nickname; they may rejoin (BR-017, FR-017). */
  kick(actorUid: string, nick: string): void {
    if (!this.deps.isAdmin(actorUid)) return this.fail(actorUid, 'FORBIDDEN')
    const target = [...this.players, ...this.observers].find((member) => member.nick === nick)
    if (target === undefined) return this.fail(actorUid, 'INVALID_STATE')

    this.deps.send(target.uid, { type: 'kicked' })
    this.remove(target.uid)
    this.deps.close(target.uid, CLOSE_CODES.KICKED)
    this.changed()
  }

  /** Admin closes the room: everyone is told, their sockets close, the room leaves the list. */
  closeRoom(actorUid: string): void {
    if (!this.deps.isAdmin(actorUid)) return this.fail(actorUid, 'FORBIDDEN')
    if (this.disposed) return
    const everyone = [...this.players, ...this.observers]
    this.players.length = 0
    this.observers.length = 0
    this.hostUid = null
    for (const member of everyone) {
      this.fail(member.uid, 'ROOM_CLOSED')
      this.deps.close(member.uid, CLOSE_CODES.ROOM_CLOSED)
    }
    this.delete()
  }

  dispose(): void {
    this.disposed = true
    this.cancelEmptyTimer()
  }

  private find(uid: string): Member | null {
    return [...this.players, ...this.observers].find((member) => member.uid === uid) ?? null
  }

  private hostMember(): Member | null {
    return this.hostUid === null ? null : this.find(this.hostUid)
  }

  /** Removes a member, hands the host role over (BR-013) and arms the empty-room timer (BR-014). */
  private remove(uid: string): Member | null {
    const member = this.find(uid)
    if (member === null) return null
    if (uid === this.hostUid) this.hostUid = nextHost(this.players, this.observers, uid)
    for (const list of [this.players, this.observers]) {
      const index = list.indexOf(member)
      if (index !== -1) list.splice(index, 1)
    }
    if (this.players.length + this.observers.length === 0) this.armEmptyTimer()
    return member
  }

  private changed(): void {
    if (this.disposed) return
    this.deps.publish(this.summary())
    for (const member of [...this.players, ...this.observers]) {
      const view = this.viewFor(member.uid)
      if (view !== null) this.deps.send(member.uid, { type: 'room.state', view })
    }
  }

  private delete(): void {
    this.dispose()
    this.deps.publish(null)
  }

  private fail(uid: string, code: ErrorCode): void {
    this.deps.send(uid, { type: 'error', code })
  }

  private armEmptyTimer(): void {
    if (this.emptyTimer !== null) return
    this.emptyTimer = this.deps.schedule(() => {
      this.emptyTimer = null
      this.delete()
    }, EMPTY_ROOM_TTL_MS)
  }

  private cancelEmptyTimer(): void {
    if (this.emptyTimer === null) return
    this.deps.cancel(this.emptyTimer)
    this.emptyTimer = null
  }
}
