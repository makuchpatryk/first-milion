import { emptyPortfolio, type Portfolio } from '@fm/shared/engine/portfolio'
import { describe, expect, it } from 'vitest'
import {
  rankSeats,
  reachedTarget,
  winnersAtTarget,
  winnersAtTime,
  type RankableSeat,
} from '../../src/room/ranking'

const PRICE = 100

/** A seat whose equity at PRICE is 10 000 + `result` (realized P&L, flat). */
function seat(nick: string, result: number, over: Partial<RankableSeat> = {}): RankableSeat {
  const portfolio: Portfolio = { ...emptyPortfolio, realized: result }
  return { nick, status: 'active', portfolio, reachedEquityAt: 0, ...over }
}

describe('rankSeats (BR-009, BR-010)', () => {
  it('FR-013: higher equity ranks first', () => {
    const rows = rankSeats([seat('Low', -100), seat('High', 300), seat('Mid', 50)], PRICE)
    expect(rows.map((r) => [r.nick, r.place])).toEqual([
      ['High', 1],
      ['Mid', 2],
      ['Low', 3],
    ])
    expect(rows[0]?.equity).toBe(10_300)
  })

  it('BR-010 / FR-013 AC: equal equity, the one who reached it earlier ranks first', () => {
    const rows = rankSeats(
      [seat('Late', 100, { reachedEquityAt: 9_000 }), seat('Early', 100, { reachedEquityAt: 2_000 })],
      PRICE,
    )
    expect(rows.map((r) => [r.nick, r.place])).toEqual([
      ['Early', 1],
      ['Late', 2],
    ])
  })

  it('BR-009: equal equity and equal time share the place, the next place is skipped', () => {
    const rows = rankSeats([seat('A', 100), seat('B', 100), seat('C', 0)], PRICE)
    expect(rows.map((r) => r.place)).toEqual([1, 1, 3])
  })

  it('BR-010, FR-014 AC: eliminated rank last with equity 0 and share the last place, whatever their time', () => {
    const rows = rankSeats(
      [
        seat('Out1', -10_000, { status: 'eliminated', reachedEquityAt: 100 }),
        seat('Active', -9_000),
        seat('Out2', -12_000, { status: 'eliminated', reachedEquityAt: 5_000 }),
      ],
      PRICE,
    )
    expect(rows.map((r) => [r.nick, r.equity, r.place])).toEqual([
      ['Active', 1_000, 1],
      ['Out1', 0, 2],
      ['Out2', 0, 2],
    ])
  })

  it('BR-019: a disconnected player ranks with the active ones by equity', () => {
    const rows = rankSeats([seat('Away', 500, { status: 'disconnected' }), seat('Here', 100)], PRICE)
    expect(rows.map((r) => [r.nick, r.status, r.place])).toEqual([
      ['Away', 'disconnected', 1],
      ['Here', 'active', 2],
    ])
  })

  it('equity follows the price for an open position', () => {
    const long: RankableSeat = {
      ...seat('Long', 0),
      portfolio: { ...emptyPortfolio, units: 100, avg: 100 },
    }
    const rows = rankSeats([long, seat('Flat', 0)], 105)
    expect(rows.map((r) => [r.nick, r.equity])).toEqual([
      ['Long', 10_500],
      ['Flat', 10_000],
    ])
  })

  it('an empty room ranks nobody', () => {
    expect(rankSeats([], PRICE)).toEqual([])
  })
})

describe('reachedTarget (BR-009)', () => {
  it('FR-013 AC: a total result of exactly the target counts, one cent below does not', () => {
    expect(reachedTarget(seat('A', 500), PRICE, 500)).toBe(true)
    expect(reachedTarget(seat('A', 499.99), PRICE, 500)).toBe(false)
  })

  it('BR-009: a goal is reached at exactly the goal', () => {
    expect(reachedTarget(seat('A', 20_000), PRICE, 20_000)).toBe(true)
  })

  it('an eliminated player cannot reach the target', () => {
    expect(reachedTarget(seat('A', 900, { status: 'eliminated' }), PRICE, 500)).toBe(false)
  })

  it('a disconnected player still can (BR-019: equity keeps moving)', () => {
    expect(reachedTarget(seat('A', 900, { status: 'disconnected' }), PRICE, 500)).toBe(true)
  })

  it('the open profit counts, not only the realized one', () => {
    const long: RankableSeat = { ...seat('A', 0), portfolio: { ...emptyPortfolio, units: 100, avg: 100 } }
    expect(reachedTarget(long, 105, 500)).toBe(true)
    expect(reachedTarget(long, 104.99, 500)).toBe(false)
  })
})

describe('winnersAtTime (BR-009)', () => {
  it('FR-013 AC: the highest equity wins', () => {
    const rows = rankSeats([seat('A', 10), seat('B', 90)], PRICE)
    expect(winnersAtTime(rows)).toEqual(['B'])
  })

  it('equal equity and equal time share the first place', () => {
    const rows = rankSeats([seat('A', 50), seat('B', 50), seat('C', 0)], PRICE)
    expect(winnersAtTime(rows)).toEqual(['A', 'B'])
  })

  it('equal equity: the earlier one wins alone (BR-010)', () => {
    const rows = rankSeats(
      [seat('A', 50, { reachedEquityAt: 10 }), seat('B', 50, { reachedEquityAt: 5 })],
      PRICE,
    )
    expect(winnersAtTime(rows)).toEqual(['B'])
  })

  it('nobody wins when everybody is eliminated', () => {
    const rows = rankSeats([seat('A', 0, { status: 'eliminated' }), seat('B', 0, { status: 'eliminated' })], PRICE)
    expect(winnersAtTime(rows)).toEqual([])
  })
})

describe('winnersAtTarget (BR-009)', () => {
  it('two players reach the target on the same tick: the higher equity wins', () => {
    expect(winnersAtTarget([seat('A', 520), seat('B', 610)], PRICE)).toEqual(['B'])
  })

  it('equal equity on the same tick shares the first place, the BR-010 time does not apply', () => {
    const reachers = [seat('A', 600, { reachedEquityAt: 1 }), seat('B', 600, { reachedEquityAt: 9 })]
    expect(winnersAtTarget(reachers, PRICE)).toEqual(['A', 'B'])
  })

  it('a single player reaching the target wins', () => {
    expect(winnersAtTarget([seat('A', 500)], PRICE)).toEqual(['A'])
  })
})
