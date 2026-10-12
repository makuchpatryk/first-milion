import { LOBBY_SWEEP_MS, STALE_AFTER_MS } from '@fm/shared/config'
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

/**
 * Registry behind the lobby list (FR-008). Rooms register on change and on every heartbeat;
 * a room silent for `STALE_AFTER_MS` (3 heartbeats) disappears. The sweep timer runs only while
 * a room exists, so an idle Lobby arms nothing (ARCHITECTURE: no idle timers).
 */
export class LobbyLogic {
  // Map insertion order = creation order; re-registering a room keeps its place.
  private readonly rooms = new Map<string, Entry>()
  private sweepTimer: Handle | null = null
  private lastBroadcast = '[]'

  constructor(private readonly deps: LobbyDeps) {}

  register(summary: RoomSummary): void {
    this.rooms.set(summary.id, { summary, lastSeen: this.deps.now() })
    this.armSweep()
    this.publishIfChanged()
  }

  remove(roomId: string): void {
    this.rooms.delete(roomId)
    if (this.rooms.size === 0) this.disarmSweep()
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
      if (this.isStale(entry)) this.rooms.delete(id)
    }
    this.disarmSweep()
    this.armSweep()
    this.publishIfChanged()
  }

  private isStale(entry: Entry): boolean {
    return this.deps.now() - entry.lastSeen > STALE_AFTER_MS
  }

  private armSweep(): void {
    if (this.sweepTimer !== null || this.rooms.size === 0) return
    this.sweepTimer = this.deps.schedule(() => {
      this.sweepTimer = null
      this.sweep()
    }, LOBBY_SWEEP_MS)
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
