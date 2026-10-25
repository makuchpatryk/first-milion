import { HISTORY_MAX, TICK_MS } from '@fm/shared/config'
import { newPortfolio } from '@fm/shared/engine/portfolio'
import { START_PRICE } from '@fm/shared/rules'
import { describe, expect, it } from 'vitest'
import {
  eliminateSeat,
  settleSeat,
  startRound,
  stepRound,
  type Round,
  type Seat,
} from '../../src/room/round'

const SEED = 20_261_012
/** A non-default capital, so a site that still assumes $10,000 fails (BR-003). */
const START = 5_000
const emptyPortfolio = newPortfolio(START)

function seat(uid: string, over: Partial<Seat> = {}): Seat {
  return {
    uid,
    nick: uid,
    status: 'active',
    portfolio: emptyPortfolio,
    reachedEquityAt: 0,
    lastEquity: null,
    disconnectedAt: null,
    ...over,
  }
}

/** The round with a market that has no randomness left: flat, no regime change, no news. */
function quiet(round: Round): Round {
  return { ...round, market: { ...round.market, drift: 0, vol: 0, regimeLeft: 1e9, newsLeft: 1e9 } }
}

describe('startRound', () => {
  it('FR-011, BR-003: seats start active with an empty portfolio of the room capital, the price is $100, the BR-010 clock starts now', () => {
    const old = seat('a', {
      status: 'eliminated',
      portfolio: { ...emptyPortfolio, startCash: 10_000, realized: -10_000, closedTrades: 3 },
      reachedEquityAt: 5,
    })
    const { round, seats } = startRound([old, seat('b')], 1_000, 5, SEED, START)
    expect(seats).toHaveLength(2)
    for (const s of seats) {
      expect(s).toMatchObject({
        status: 'active',
        portfolio: emptyPortfolio,
        reachedEquityAt: 1_000,
        lastEquity: START,
        disconnectedAt: null,
      })
    }
    expect(round.market.price).toBe(START_PRICE)
    expect(round.history).toEqual([START_PRICE])
  })

  it('decision 46: an absent seat is carried into the round as disconnected, with its disconnectedAt', () => {
    const away = seat('a', { status: 'eliminated', disconnectedAt: 77 })
    const { seats } = startRound([away, seat('b')], 1_000, 5, SEED, START)
    expect(seats[0]).toMatchObject({
      status: 'disconnected',
      disconnectedAt: 77,
      portfolio: emptyPortfolio,
      lastEquity: START,
    })
    expect(seats[1]).toMatchObject({ status: 'active', disconnectedAt: null })
  })

  it('BR-008: the round ends after its duration in wall-clock time, whatever the speed', () => {
    expect(startRound([], 1_000, 3, SEED, START).round.endsAt).toBe(1_000 + 3 * 60_000)
    expect(startRound([], 0, 10, SEED, START).round.endsAt).toBe(600_000)
  })
})

describe('stepRound', () => {
  it('FR-011 AC: one seed gives one price stream; the same seed replays it exactly', () => {
    const run = () => {
      let { round, seats } = startRound([seat('a'), seat('b')], 0, 5, SEED, START)
      const stream: number[] = []
      for (let i = 1; i <= 200; i++) {
        const step = stepRound(round, seats, i * TICK_MS, 3)
        ;({ round, seats } = step)
        stream.push(...step.newPrices)
      }
      return { stream, history: round.history }
    }
    const first = run()
    expect(first.stream).toHaveLength(600)
    expect(run().stream).toEqual(first.stream)
    expect(first.history).toEqual([START_PRICE, ...first.stream])
  })

  it('PRD §20 #33: every interval runs exactly `speed` steps', () => {
    const { round, seats } = startRound([seat('a')], 0, 3, SEED, START)
    for (const speed of [1, 3, 8]) {
      expect(stepRound(round, seats, TICK_MS, speed).newPrices).toHaveLength(speed)
    }
  })

  it('PRD §13: the history is capped at 2 400 points, newest kept', () => {
    let { round, seats } = startRound([seat('a')], 0, 10, SEED, START)
    for (let i = 1; i <= 400; i++) ({ round, seats } = stepRound(round, seats, i * TICK_MS, 8))
    expect(round.history).toHaveLength(HISTORY_MAX)
    expect(round.history.at(-1)).toBe(round.market.price)
  })

  it('BR-015: news is reported once, on the interval it was drawn', () => {
    let { round, seats } = startRound([seat('a')], 0, 10, SEED, START)
    let drawn = 0
    let previous: Round['lastNews'] = null
    for (let i = 1; i <= 2_000 && drawn < 2; i++) {
      ;({ round, seats } = stepRound(round, seats, i * TICK_MS, 8))
      if (round.lastNews !== null) {
        drawn++
        expect(previous).toBeNull() // the interval before carried no news
        expect(round.lastNews).toBe(round.market.news)
      }
      previous = round.lastNews
    }
    expect(drawn).toBe(2)
  })

  it('FR-003 AC, BR-005, FR-014: equity <= 0 liquidates the position and eliminates the seat', () => {
    const { round } = startRound([], 0, 3, SEED, START)
    const broke = seat('broke', {
      portfolio: { ...emptyPortfolio, units: 250, avg: 500 },
      lastEquity: 1,
    })
    const fine = seat('fine', { lastEquity: START })
    const step = stepRound(quiet(round), [broke, fine], TICK_MS, 1)
    const [outBroke, outFine] = step.seats
    expect(outBroke).toMatchObject({
      status: 'eliminated',
      portfolio: { units: 0, avg: 0, closedTrades: 1 },
    })
    // The loss was booked: realized P&L alone is below the starting cash.
    expect(START + (outBroke?.portfolio.realized ?? 0)).toBeLessThanOrEqual(0)
    expect(outFine?.status).toBe('active')
  })

  it('BR-019: a disconnected seat keeps moving with the price', () => {
    const { round } = startRound([], 0, 3, SEED, START)
    const away = seat('away', {
      status: 'disconnected',
      portfolio: { ...emptyPortfolio, units: 10, avg: START_PRICE },
      lastEquity: START,
      disconnectedAt: 0,
    })
    const live = quiet(round)
    const moved = { ...live, market: { ...live.market, price: 110 } }
    const [after] = stepRound(moved, [away], TICK_MS, 1).seats
    expect(after).toMatchObject({ status: 'disconnected', reachedEquityAt: TICK_MS })
    expect(after?.lastEquity).toBeCloseTo(START + 10 * 10, 6)
  })
})

describe('settleSeat (BR-010)', () => {
  it('reachedEquityAt changes only when the equity value changes', () => {
    const flat = seat('a', { lastEquity: START, reachedEquityAt: 100 })
    expect(settleSeat(flat, 105, 900)).toBe(flat) // flat: price does not matter

    const long = seat('b', {
      portfolio: { ...emptyPortfolio, units: 10, avg: 100 },
      lastEquity: START,
      reachedEquityAt: 100,
    })
    expect(settleSeat(long, 100, 500).reachedEquityAt).toBe(100) // same value, same timestamp
    expect(settleSeat(long, 101, 500)).toMatchObject({
      reachedEquityAt: 500,
      lastEquity: START + 10,
    })
  })

  it('an eliminated seat is left alone', () => {
    const out = seat('a', { status: 'eliminated', lastEquity: 0 })
    expect(settleSeat(out, 50, 10)).toBe(out)
  })
})

describe('eliminateSeat (BR-019)', () => {
  it('closes the position at market incl. spread and marks the seat eliminated, still offline', () => {
    const away = seat('a', {
      status: 'disconnected',
      portfolio: { ...emptyPortfolio, units: 10, avg: 100 },
      disconnectedAt: 5,
    })
    const out = eliminateSeat(away, 110)
    expect(out).toMatchObject({
      status: 'eliminated',
      disconnectedAt: 5,
      portfolio: { units: 0, closedTrades: 1, wins: 1 },
    })
    // Sold at 110 - 0.03.
    expect(out.portfolio.realized).toBeCloseTo((110 - 0.03 - 100) * 10, 9)
  })
})
