import { LOBBY_SWEEP_MS, MAX_ROOMS, MAX_ROOMS_PER_HOST, STALE_AFTER_MS } from '@fm/shared/config'
import type { RoomSummary } from '@fm/shared/protocol'
import type { Handle, Timers } from '../timers'

export interface LobbyDeps extends Timers {
  now(): number
  broadcast(rooms: RoomSummary[]): void
}

interface Entry {
  summary: RoomSummary
  lastSeen: number
}

/** Who created a room. Kept here only: the UID never goes into a summary (ARCHITECTURE Privacy). */
interface Owner {
  uid: string
  reservedAt: number
}

/**
 * Registry behind the lobby list (FR-008). Rooms register on change and on every heartbeat;
 * a room silent for `STALE_AFTER_MS` (3 heartbeats) disappears. The sweep timer runs only while
 * a room or a reservation exists, so an idle Lobby arms nothing (ARCHITECTURE: no idle timers).
 *
 * It also caps the rooms (PRD §20 #49): a room is reserved for its creator before the Room is
 * initialised, so rooms still being created count too.
 */
export class LobbyLogic {
  // Map insertion order = creation order; re-registering a room keeps its place.
  private readonly rooms = new Map<string, Entry>()
  private readonly owners = new Map<string, Owner>()
  private sweepTimer: Handle | null = null
  private lastBroadcast = '[]'

  constructor(private readonly deps: LobbyDeps) {}

  /**
   * Takes a room slot for `uid`; false at `MAX_ROOMS_PER_HOST` for that host or `MAX_ROOMS` in
   * total. Synchronous on purpose: the caller reserves before its first `await`, so concurrent
   * creates cannot both pass the check.
   */
  reserve(roomId: string, uid: string): boolean {
    // Rooms listed without an owner (the Lobby restarted, the Room re-registered) count too.
    const unowned = [...this.rooms.keys()].filter((id) => !this.owners.has(id)).length
    if (this.owners.size + unowned >= MAX_ROOMS) return false
    const owned = [...this.owners.values()].filter((owner) => owner.uid === uid).length
    if (owned >= MAX_ROOMS_PER_HOST) return false
    this.owners.set(roomId, { uid, reservedAt: this.deps.now() })
    this.armSweep()
    return true
  }

  /** Gives the slot back when the Room could not be initialised. */
  release(roomId: string): void {
    this.owners.delete(roomId)
    this.disarmSweepIfIdle()
  }

  register(summary: RoomSummary): void {
    this.rooms.set(summary.id, { summary, lastSeen: this.deps.now() })
    this.armSweep()
    this.publishIfChanged()
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId)
    this.owners.delete(roomId)
    this.disarmSweepIfIdle()
    this.publishIfChanged()
  }

  has(roomId: string): boolean {
    const entry = this.rooms.get(roomId)
    return entry !== undefined && !this.isStale(entry)
  }

  list(): RoomSummary[] {
    return [...this.rooms.values()].filter((entry) => !this.isStale(entry)).map((entry) => entry.summary)
  }

  sweep(): void {
    for (const [id, entry] of this.rooms) {
      if (this.isStale(entry)) {
        this.rooms.delete(id)
        this.owners.delete(id)
      }
    }
    // A reservation whose Room never registered (init failed half way, a register was lost) would
    // hold its slot for ever.
    for (const [id, owner] of this.owners) {
      if (!this.rooms.has(id) && this.deps.now() - owner.reservedAt > STALE_AFTER_MS) {
        this.owners.delete(id)
      }
    }
    this.disarmSweep()
    this.armSweep()
    this.publishIfChanged()
  }

  private isStale(entry: Entry): boolean {
    return this.deps.now() - entry.lastSeen > STALE_AFTER_MS
  }

  private armSweep(): void {
    if (this.sweepTimer !== null || (this.rooms.size === 0 && this.owners.size === 0)) return
    this.sweepTimer = this.deps.schedule(() => {
      this.sweepTimer = null
      this.sweep()
    }, LOBBY_SWEEP_MS)
  }

  private disarmSweepIfIdle(): void {
    if (this.rooms.size === 0 && this.owners.size === 0) this.disarmSweep()
  }

  private disarmSweep(): void {
    if (this.sweepTimer === null) return
    this.deps.cancel(this.sweepTimer)
    this.sweepTimer = null
  }

  // Compared with the last broadcast, not the previous list: stale rooms already drop out of
  // `list()` between sweeps, and the subscribers still need to hear about it.
  private publishIfChanged(): void {
    const rooms = this.list()
    const json = JSON.stringify(rooms)
    if (json === this.lastBroadcast) return
    this.lastBroadcast = json
    this.deps.broadcast(rooms)
  }
}
