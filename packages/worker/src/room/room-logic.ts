import {
  closePosition,
  closedTradeOf,
  executeOrder,
  fillPrice,
  newPortfolio,
  type TradeSide,
} from '@fm/shared/engine/portfolio'
import {
  CLOSE_CODES,
  type ErrorCode,
  type LastRound,
  type MeRound,
  type RoomSummary,
  type RoomView,
  type RoundEndReason,
  type ServerMessage,
} from '@fm/shared/protocol'
import {
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_TTL_MS,
  MAX_OBSERVERS,
  MAX_PLAYERS,
  ORDER_RATE_PER_SEC,
  ORDER_RATE_WINDOW_MS,
  type OrderQty,
  type RoundDuration,
  type Speed,
} from '@fm/shared/rules'
import type { Handle, Timers } from '../timers'
import { OrderRateLimit } from './rate-limit'
import { rankSeats, reachedGoal, shownEquity, winnersAtTarget, winnersAtTime } from './ranking'
import { assignRole, nextHost, uniqueNick, type Member } from './roster'
import { eliminateSeat, settleSeat, startRound, stepRound, type Round, type Seat } from './round'

export interface RoomInit {
  id: string
  name: string
  durationMin: RoundDuration
  speed: Speed
  /** Capital every player starts with (BR-003). */
  startCash: number
  /** Target equity that wins the round (BR-009). */
  goal: number
  /** The creator (BR-013). */
  hostUid: string
}

export interface RoomDeps extends Timers {
  send(uid: string, msg: ServerMessage): void
  close(uid: string, code: number): void
  /** A summary on every change; `null` once the room is deleted. */
  publish(summary: RoomSummary | null): void
  isAdmin(uid: string): boolean
  /** Server clock in ms; the only time source (BR-008, BR-010). */
  now(): number
  /** A fresh seed for each round's engine. */
  seed(): number
}

const OBSERVER_ME: MeRound = {
  role: 'observer',
  status: 'active',
  units: 0,
  avg: 0,
  realized: 0,
  equity: 0,
  closedTrades: 0,
  wins: 0,
}

/**
 * Room membership, lifecycle and the round (M3, M4). Plain TypeScript: clock, seed, timers and
 * sockets are injected (ARCHITECTURE A1). The Durable Object shell owns the 80 ms interval and
 * calls `tick()`; everything else, rules included, happens here. One call runs to completion, so
 * ticks and orders never interleave (ARCHITECTURE Serialized).
 */
export class RoomLogic {
  /** Players in join order, whatever their status: eliminated players keep their seat (decision 38). */
  private seats: Seat[] = []
  private readonly observers: Member[] = []
  private round: Round | null = null
  private lastRound: LastRound | null = null
  private hostUid: string | null
  private emptyTimer: Handle | null = null
  private readonly disconnectTimers = new Map<string, Handle>()
  private readonly rateLimits = new Map<string, OrderRateLimit>()
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

  /** True while a round runs; the shell ticks only then. */
  get running(): boolean {
    return this.round !== null
  }

  summary(): RoomSummary {
    return {
      id: this.init.id,
      name: this.init.name,
      hostNick: this.hostMember()?.nick ?? null,
      players: this.seats.length,
      observers: this.observers.length,
      maxPlayers: MAX_PLAYERS,
      durationMin: this.init.durationMin,
      startCash: this.init.startCash,
      goal: this.init.goal,
      speed: this.init.speed,
      status: this.round === null ? 'lobby' : 'running',
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
      startCash: this.init.startCash,
      goal: this.init.goal,
      speed: this.init.speed,
      status: this.round === null ? 'lobby' : 'running',
      players: this.seats.map((seat) => ({ nick: seat.nick, status: seat.status })),
      observers: this.observers.map((member) => ({ nick: member.nick })),
      lastRound: this.lastRound,
      you: {
        role: this.seat(uid) === null ? 'observer' : 'player',
        nick: you.nick,
        isHost: uid === this.hostUid,
      },
    }
  }

  join(uid: string, nick: string): void {
    if (this.disposed) return this.fail(uid, 'ROOM_CLOSED')
    const seat = this.seat(uid)
    // A player whose socket dropped comes back to their seat, in the grace or after it (FR-015).
    if (seat !== null && seat.disconnectedAt !== null) return this.restore(seat)
    if (this.find(uid) !== null) return this.fail(uid, 'INVALID_STATE')
    // The room is listed before its creator has connected; until they join, nobody else may
    // take the seat or the host role (BR-013, FR-009). A creator who never comes leaves the room
    // empty, and the empty-room timer deletes it (BR-014).
    if (!this.creatorJoined && uid !== this.init.hostUid) return this.fail(uid, 'INVALID_STATE')
    const role = assignRole(
      this.seats,
      this.observers,
      this.round === null ? 'lobby' : 'running',
      MAX_PLAYERS,
      MAX_OBSERVERS,
    )
    if (role === 'full') return this.fail(uid, 'ROOM_FULL')

    const taken = [...this.seats, ...this.observers].map((member) => member.nick)
    const member = { uid, nick: uniqueNick(taken, nick) }
    if (role === 'player') this.seats.push(newSeat(member, this.init.startCash))
    else this.observers.push(member)
    if (uid === this.init.hostUid) this.creatorJoined = true
    // The creator is host (BR-013). Once they have gone and the room is empty, the next joiner
    // takes the role, so a room never sits without a host.
    if (this.hostMember() === null) this.hostUid = uid
    this.cancelEmptyTimer()
    this.changed()
    this.sendHistory(uid)
  }

  /**
   * A player leaving a running round is a dropped socket: the 30 s grace applies, so leaving
   * cannot be used to escape a loss (decision 41). Anywhere else the member is removed.
   */
  leave(uid: string): void {
    const seat = this.seat(uid)
    if (this.round !== null && seat !== null) return this.disconnect(seat)
    if (this.remove(uid) !== null) this.changed()
  }

  onSocketClosed(uid: string): void {
    this.leave(uid)
  }

  /** The host starts a round from the lobby (FR-011, BR-013). */
  start(uid: string): void {
    if (uid !== this.hostUid) return this.fail(uid, 'FORBIDDEN')
    if (this.round !== null || this.seats.length === 0) return this.fail(uid, 'INVALID_STATE')
    const now = this.deps.now()
    const { durationMin, startCash } = this.init
    const started = startRound(this.seats, now, durationMin, this.deps.seed(), startCash)
    this.round = started.round
    this.seats = started.seats
    this.lastRound = null
    this.rateLimits.clear()
    this.changed()
  }

  /** One tick interval (80 ms, `speed` price steps). Called by the shell's interval. */
  tick(): void {
    if (this.round === null) return
    const now = this.deps.now()
    const step = stepRound(this.round, this.seats, now, this.init.speed)
    this.round = step.round
    this.seats = step.seats
    if (this.checkEnd(now)) return
    this.broadcastTick(step.round, step.newPrices, now)
  }

  /** Executes at the server price of the latest tick, never a client price (BR-007, FR-012). */
  order(uid: string, side: TradeSide, qty: OrderQty): void {
    const trade = this.admitTrade(uid)
    if (trade === null) return
    const price = trade.round.market.price
    this.book(trade, executeOrder(trade.seat.portfolio, side, qty, price), fillPrice(price, side))
  }

  /** Closes the whole position; flat is a no-op answered with a null fill (FR-003 edge case). */
  close(uid: string): void {
    const trade = this.admitTrade(uid)
    if (trade === null) return
    const { seat, round } = trade
    const price = round.market.price
    const fill = closedTradeOf(seat.portfolio, price)?.exit ?? null
    if (fill === null) {
      this.deps.send(uid, { type: 'order.ok', fill, you: this.meRound(uid, price) })
      return
    }
    this.book(trade, closePosition(seat.portfolio, price), fill)
  }

  /** Admin removes a member by nickname; they may rejoin (BR-017, FR-017). */
  kick(actorUid: string, nick: string): void {
    if (!this.deps.isAdmin(actorUid)) return this.fail(actorUid, 'FORBIDDEN')
    const target = [...this.seats, ...this.observers].find((member) => member.nick === nick)
    if (target === undefined) return this.fail(actorUid, 'INVALID_STATE')

    this.deps.send(target.uid, { type: 'kicked' })
    this.remove(target.uid)
    this.deps.close(target.uid, CLOSE_CODES.KICKED)
    this.changed()
    // A seat taken out of a round can leave nobody to play (BR-009).
    this.checkEnd(this.deps.now())
  }

  /** Admin closes the room: everyone is told, their sockets close, the room leaves the list. */
  closeRoom(actorUid: string): void {
    if (!this.deps.isAdmin(actorUid)) return this.fail(actorUid, 'FORBIDDEN')
    if (this.disposed) return
    const everyone = [...this.seats, ...this.observers]
    this.seats = []
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
    this.round = null
    this.cancelEmptyTimer()
    for (const handle of this.disconnectTimers.values()) this.deps.cancel(handle)
    this.disconnectTimers.clear()
    this.rateLimits.clear()
  }

  private seat(uid: string): Seat | null {
    return this.seats.find((seat) => seat.uid === uid) ?? null
  }

  private find(uid: string): Member | null {
    return [...this.seats, ...this.observers].find((member) => member.uid === uid) ?? null
  }

  private hostMember(): Member | null {
    return this.hostUid === null ? null : this.find(this.hostUid)
  }

  /** Everyone with a socket: they get the broadcasts. */
  private connected(): Member[] {
    return [...this.seats.filter((seat) => seat.disconnectedAt === null), ...this.observers]
  }

  private replaceSeat(next: Seat): void {
    this.seats = this.seats.map((seat) => (seat.uid === next.uid ? next : seat))
  }

  /** Hands the host role to the next connected member when the host goes (BR-013). */
  private handOverHost(leavingUid: string): void {
    if (leavingUid !== this.hostUid) return
    const online = this.seats.filter((seat) => seat.disconnectedAt === null)
    this.hostUid = nextHost(online, this.observers, leavingUid)
  }

  /** Removes a member, hands the host role over (BR-013) and arms the empty-room timer (BR-014). */
  private remove(uid: string): Member | null {
    const member = this.find(uid)
    if (member === null) return null
    this.handOverHost(uid)
    this.seats = this.seats.filter((seat) => seat.uid !== uid)
    const index = this.observers.indexOf(member)
    if (index !== -1) this.observers.splice(index, 1)
    this.clearDisconnectTimer(uid)
    this.rateLimits.delete(uid)
    if (this.seats.length + this.observers.length === 0) this.armEmptyTimer()
    return member
  }

  /** The socket of a player in a running round is gone: keep the seat for the grace (BR-019). */
  private disconnect(seat: Seat): void {
    if (seat.disconnectedAt !== null) return
    this.handOverHost(seat.uid)
    const active = seat.status === 'active'
    this.replaceSeat({
      ...seat,
      status: active ? 'disconnected' : seat.status,
      disconnectedAt: this.deps.now(),
    })
    // An eliminated player has nothing left to lose; only the seat marker is kept.
    if (active) this.armDisconnectTimer(seat.uid)
    this.changed()
  }

  /** FR-015 AC: the same UID returns with position and equity as they were. */
  private restore(seat: Seat): void {
    this.clearDisconnectTimer(seat.uid)
    this.replaceSeat({
      ...seat,
      status: seat.status === 'disconnected' ? 'active' : seat.status,
      disconnectedAt: null,
    })
    if (this.hostMember() === null) this.hostUid = seat.uid
    this.changed()
    this.sendHistory(seat.uid)
  }

  private armDisconnectTimer(uid: string): void {
    const handle = this.deps.schedule(() => {
      // A restore cancels the timer; the handle check guards a timer that already fired.
      if (this.disconnectTimers.get(uid) !== handle) return
      this.disconnectTimers.delete(uid)
      this.eliminateDisconnected(uid)
    }, DISCONNECT_GRACE_MS)
    this.disconnectTimers.set(uid, handle)
  }

  private clearDisconnectTimer(uid: string): void {
    const handle = this.disconnectTimers.get(uid)
    if (handle === undefined) return
    this.deps.cancel(handle)
    this.disconnectTimers.delete(uid)
  }

  /** The 30 s are up: close the position at market, rank like a bankrupt player (BR-019). */
  private eliminateDisconnected(uid: string): void {
    const seat = this.seat(uid)
    if (this.round === null || seat === null || seat.status !== 'disconnected') return
    this.replaceSeat(eliminateSeat(seat, this.round.market.price))
    this.changed()
    this.checkEnd(this.deps.now())
  }

  /** Gate shared by `order` and `close`: membership, rate limit, role, state (FR-012). */
  private admitTrade(uid: string): { seat: Seat; round: Round } | null {
    const member = this.find(uid)
    if (member === null) return this.deny(uid, 'FORBIDDEN')
    // Every valid attempt counts, accepted or not, before any other check (BR-018).
    if (!this.rateLimitFor(uid).attempt(this.deps.now())) return this.deny(uid, 'RATE_LIMITED')
    const seat = this.seat(uid)
    if (seat === null) return this.deny(uid, 'FORBIDDEN')
    const round = this.round
    if (round === null) return this.deny(uid, 'INVALID_STATE')
    if (seat.status === 'eliminated') return this.deny(uid, 'ELIMINATED')
    return { seat, round }
  }

  private rateLimitFor(uid: string): OrderRateLimit {
    let limit = this.rateLimits.get(uid)
    if (limit === undefined) {
      limit = new OrderRateLimit(ORDER_RATE_PER_SEC, ORDER_RATE_WINDOW_MS)
      this.rateLimits.set(uid, limit)
    }
    return limit
  }

  /** Applies a trade, confirms it in the same call, then checks the end (BR-009: after every order). */
  private book(
    trade: { seat: Seat; round: Round },
    portfolio: Seat['portfolio'],
    fill: number,
  ): void {
    const now = this.deps.now()
    const price = trade.round.market.price
    this.replaceSeat(settleSeat({ ...trade.seat, portfolio }, price, now))
    this.deps.send(trade.seat.uid, {
      type: 'order.ok',
      fill,
      you: this.meRound(trade.seat.uid, price),
    })
    this.checkEnd(now)
  }

  /**
   * End conditions, in the order of BR-009: everybody eliminated, a player at the goal equity,
   * then the round time. True when the round ended.
   */
  private checkEnd(now: number): boolean {
    const round = this.round
    if (round === null) return false
    const price = round.market.price
    if (this.seats.every((seat) => seat.status === 'eliminated')) {
      this.endRound('ALL_ELIMINATED', [])
      return true
    }
    const reachers = this.seats.filter((seat) => reachedGoal(seat, price, this.init.goal))
    if (reachers.length > 0) {
      this.endRound('TARGET', winnersAtTarget(reachers, price))
      return true
    }
    if (now >= round.endsAt) {
      this.endRound('TIME', winnersAtTime(rankSeats(this.seats, price)))
      return true
    }
    return false
  }

  /** The room goes back to the lobby with the result kept until the next start (BR-014). */
  private endRound(reason: RoundEndReason, winners: string[]): void {
    const round = this.round
    if (round === null) return
    const ranking = rankSeats(this.seats, round.market.price)
    this.lastRound = { reason, winners, ranking }
    this.round = null
    for (const handle of this.disconnectTimers.values()) this.deps.cancel(handle)
    this.disconnectTimers.clear()
    this.rateLimits.clear()
    for (const member of this.connected()) {
      this.deps.send(member.uid, { type: 'round.end', reason, winners, ranking })
    }
    // Players whose socket is gone have no lobby to return to; the ranking above still lists them.
    this.seats = this.seats.filter((seat) => seat.disconnectedAt === null)
    if (this.seats.length + this.observers.length === 0) this.armEmptyTimer()
    this.changed()
  }

  private broadcastTick(round: Round, newPrices: number[], now: number): void {
    const { market } = round
    const ranking = rankSeats(this.seats, market.price)
    for (const member of this.connected()) {
      this.deps.send(member.uid, {
        type: 'room.tick',
        prices: newPrices,
        price: market.price,
        news: round.lastNews,
        endsInMs: Math.max(0, round.endsAt - now),
        ranking,
        you: this.meRound(member.uid, market.price),
      })
    }
  }

  /** A member's own round numbers; observers have none. */
  private meRound(uid: string, price: number): MeRound {
    const seat = this.seat(uid)
    if (seat === null) return OBSERVER_ME
    const { portfolio } = seat
    return {
      role: 'player',
      status: seat.status,
      units: portfolio.units,
      avg: portfolio.avg,
      realized: portfolio.realized,
      equity: shownEquity(seat, price),
      closedTrades: portfolio.closedTrades,
      wins: portfolio.wins,
    }
  }

  /** Every price so far, for someone who joins or returns mid-round (FR-015). */
  private sendHistory(uid: string): void {
    if (this.round === null) return
    this.deps.send(uid, { type: 'room.history', prices: [...this.round.history] })
  }

  private changed(): void {
    if (this.disposed) return
    this.deps.publish(this.summary())
    for (const member of this.connected()) {
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

  /** Sends the error and returns null, so a gate can `return this.deny(...)`. */
  private deny(uid: string, code: ErrorCode): null {
    this.fail(uid, code)
    return null
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

function newSeat(member: Member, startCash: number): Seat {
  return {
    ...member,
    status: 'active',
    portfolio: newPortfolio(startCash),
    reachedEquityAt: 0,
    lastEquity: null,
    disconnectedAt: null,
  }
}
