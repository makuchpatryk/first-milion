import { equity, totalResult, type Portfolio } from '@fm/shared/engine/portfolio'
import type { MemberStatus, RankRow } from '@fm/shared/protocol'

/** What ranking reads of a seat; `Seat` (round.ts) satisfies it. */
export interface RankableSeat {
  nick: string
  status: MemberStatus
  portfolio: Portfolio
  /** Server time the equity last changed value (BR-010). */
  reachedEquityAt: number
}

/** An eliminated player shows equity 0 (BR-005, BR-010, FR-014). */
export function shownEquity(seat: RankableSeat, price: number): number {
  return seat.status === 'eliminated' ? 0 : equity(seat.portfolio, price)
}

/** Negative when `a` ranks ahead of `b`, 0 when they share a place. */
function compare(a: RankableSeat, b: RankableSeat, price: number): number {
  const aOut = a.status === 'eliminated'
  const bOut = b.status === 'eliminated'
  // Eliminated players share the last places; the tie-break does not apply to them (BR-010).
  if (aOut || bOut) return Number(aOut) - Number(bOut)
  const byEquity = equity(b.portfolio, price) - equity(a.portfolio, price)
  if (byEquity !== 0) return byEquity
  // Equal equity: who reached that value earlier wins (BR-010).
  return a.reachedEquityAt - b.reachedEquityAt
}

/**
 * The ranking, best first (BR-009, BR-010). `place` is a competition rank: one plus the rows
 * strictly ahead, so equal rows share it. Disconnected players still rank with the active ones
 * until their grace ends (BR-019).
 */
export function rankSeats(seats: readonly RankableSeat[], price: number): RankRow[] {
  return seats
    .map((seat) => ({
      seat,
      place: 1 + seats.filter((other) => compare(other, seat, price) < 0).length,
    }))
    .sort((a, b) => a.place - b.place)
    .map(({ seat, place }) => ({
      nick: seat.nick,
      equity: shownEquity(seat, price),
      status: seat.status,
      place,
    }))
}

/** Has the seat's total result reached the profit target (BR-009)? Eliminated seats cannot. */
export function reachedTarget(seat: RankableSeat, price: number, target: number): boolean {
  return seat.status !== 'eliminated' && totalResult(seat.portfolio, price) >= target
}

/** Winners at round time: everyone sharing the first place among the not eliminated (BR-009). */
export function winnersAtTime(ranking: readonly RankRow[]): string[] {
  return ranking.filter((row) => row.place === 1 && row.status !== 'eliminated').map((row) => row.nick)
}

/**
 * Winners when `reachers` all reached the target on the same tick: the highest equity; equal
 * equity shares the first place (BR-009). The BR-010 time tie-break is not used here.
 */
export function winnersAtTarget(reachers: readonly RankableSeat[], price: number): string[] {
  const best = Math.max(...reachers.map((seat) => equity(seat.portfolio, price)))
  return reachers.filter((seat) => equity(seat.portfolio, price) === best).map((seat) => seat.nick)
}
