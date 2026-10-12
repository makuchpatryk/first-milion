import { TICK_MS } from '@fm/shared/config'
import type { ErrorCode, RoomSummary, ServerMessage } from '@fm/shared/protocol'
import { createRng, pick, type Rng } from '@fm/shared/rng'
import { ORDER_QTYS } from '@fm/shared/rules'
import { RoomLogic, type RoomInit } from '../../src/room/room-logic'
import { FakeClock } from '../fake-clock'

export const ADMIN = 'uid-admin'

export interface HarnessOptions extends Partial<Omit<RoomInit, 'id'>> {
  /** Seed of the round's engine (`RoomDeps.seed`). */
  seed?: number
}

/** A `RoomLogic` wired to a fake clock, with everything it sends recorded in order. */
export interface Harness {
  clock: FakeClock
  room: RoomLogic
  /** Every message the room sent, with its recipient. */
  log: { uid: string; msg: ServerMessage }[]
  closed: { uid: string; code: number }[]
  published: (RoomSummary | null)[]
  /** Messages sent to one user. */
  inbox(uid: string): ServerMessage[]
  /** Messages of one type sent to one user. */
  ofType<T extends ServerMessage['type']>(uid: string, type: T): Extract<ServerMessage, { type: T }>[]
  errorsTo(uid: string): ErrorCode[]
  /** The newest `room.tick` a user has received. */
  latestTick(uid: string): Extract<ServerMessage, { type: 'room.tick' }> | undefined
  /** Advances the fake clock by one tick length and runs one tick, `count` times. */
  tick(count?: number): void
  /** Ticks until the round is over or `maxTicks` is reached; returns the ticks used. */
  runToEnd(maxTicks: number): number
}

/** `uid-1`..`uid-n` join as `Nick1`..`Nick<n>`; the creator is `uid-1`. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const { seed = 1, ...init } = options
  const clock = new FakeClock()
  const log: Harness['log'] = []
  const closed: Harness['closed'] = []
  const published: Harness['published'] = []
  const latest = new Map<string, Extract<ServerMessage, { type: 'room.tick' }>>()
  const room = new RoomLogic(
    {
      id: 'room-1',
      name: 'Friday round',
      durationMin: 3,
      speed: 8,
      profitTarget: null,
      hostUid: 'uid-1',
      ...init,
    },
    {
      schedule: clock.schedule,
      cancel: clock.cancel,
      now: clock.now,
      seed: () => seed,
      send: (uid, msg) => {
        log.push({ uid, msg })
        if (msg.type === 'room.tick') latest.set(uid, msg)
      },
      close: (uid, code) => closed.push({ uid, code }),
      publish: (summary) => published.push(summary),
      isAdmin: (uid) => uid === ADMIN,
    },
  )
  const inbox = (uid: string) => log.filter((entry) => entry.uid === uid).map((entry) => entry.msg)
  return {
    clock,
    room,
    log,
    closed,
    published,
    inbox,
    ofType: (uid, type) =>
      inbox(uid).filter((msg): msg is Extract<ServerMessage, { type: typeof type }> => msg.type === type),
    errorsTo: (uid) => inbox(uid).flatMap((msg) => (msg.type === 'error' ? [msg.code] : [])),
    latestTick: (uid) => latest.get(uid),
    tick(count = 1) {
      for (let i = 0; i < count; i++) {
        clock.advance(TICK_MS)
        room.tick()
      }
    },
    runToEnd(maxTicks) {
      let used = 0
      while (room.running && used < maxTicks) {
        clock.advance(TICK_MS)
        room.tick()
        used++
      }
      return used
    },
  }
}

/** Joins `uid-<from>`..`uid-<from+count-1>` as `Nick<n>`. */
export function joinPlayers(harness: Harness, count: number, from = 1): void {
  for (let n = from; n < from + count; n++) harness.room.join(`uid-${n}`, `Nick${n}`)
}

/**
 * Builds a big position with repeated max-size orders, 10 per second (BR-018), ticking in between.
 * Stops when the round is over. The position size is not limited in the rules, so this is how a
 * test makes a player go bankrupt on a small price move.
 */
export function leverage(harness: Harness, uid: string, side: 'BUY' | 'SELL', orders: number): void {
  for (let i = 0; i < orders && harness.room.running; i++) {
    if (i > 0 && i % 10 === 0) harness.tick(13)
    harness.room.order(uid, side, 250)
  }
  harness.tick(13)
}

/**
 * Scripted players: every call may place one random order or close for each given user, from a
 * seeded generator, so a whole round replays exactly (M4 DoD, determinism). Like a client with
 * its buttons disabled, they do not trade during a halt or once eliminated.
 */
export function scriptedPlayers(harness: Harness, uids: readonly string[], seed: number): () => void {
  const rng: Rng = createRng(seed)
  return () => {
    for (const uid of uids) {
      const roll = rng()
      const tick = harness.latestTick(uid)
      if (tick === undefined || tick.halt !== null || tick.you.status === 'eliminated') continue
      if (roll < 0.04) harness.room.order(uid, 'BUY', pick(rng, ORDER_QTYS))
      else if (roll < 0.08) harness.room.order(uid, 'SELL', pick(rng, ORDER_QTYS))
      else if (roll < 0.1) harness.room.close(uid)
    }
  }
}
