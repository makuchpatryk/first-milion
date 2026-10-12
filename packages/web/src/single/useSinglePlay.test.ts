import { TICK_MS } from '@fm/shared/config'
import { emptyPortfolio } from '@fm/shared/engine/portfolio'
import { createRng } from '@fm/shared/rng'
import { START_CASH, START_PRICE } from '@fm/shared/rules'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SINGLE_ROUND } from './loop'
import { useSinglePlay } from './useSinglePlay'

const SEED = 42

let clock = 0

/** Fresh composable on a fake clock and a seeded RNG, game started; `run(n)` plays n 80 ms intervals. */
function start(seed = SEED) {
  clock = 0
  const game = useSinglePlay({ now: () => clock, rng: createRng(seed) })
  game.start(DEFAULT_SINGLE_ROUND)
  const run = (intervals: number) => {
    for (let i = 0; i < intervals; i++) {
      clock += TICK_MS
      vi.advanceTimersByTime(TICK_MS)
    }
  }
  return { game, run }
}

/** Plays until a trading halt is running; the seed search keeps the test deterministic. */
function startHalted() {
  for (let seed = 1; seed <= 300; seed++) {
    const { game, run } = start(seed)
    for (let i = 0; i < 900 && !game.halted.value; i++) run(1)
    if (game.halted.value) return { game, run }
    game.dispose()
  }
  throw new Error('no seed produced a trading halt')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSinglePlay timing (FR-004)', () => {
  it('FR-004: the default speed is 3x and one interval appends 3 price steps', () => {
    const { game, run } = start()
    run(1)
    expect(game.speed.value).toBe(3)
    expect(game.sim.value.prices).toHaveLength(1 + 3)
    game.dispose()
  })

  it('FR-004 AC: at 8x one 80 ms interval appends exactly 8 price steps', () => {
    const { game, run } = start()
    game.speed.value = 8
    run(1)
    expect(game.sim.value.prices).toHaveLength(1 + 8)
    game.dispose()
  })

  it('FR-004: pausing appends no steps and resuming continues', () => {
    const { game, run } = start()
    run(2)
    const before = game.sim.value.prices.length

    game.togglePause()
    run(5)
    expect(game.sim.value.prices).toHaveLength(before)

    game.togglePause()
    run(1)
    expect(game.sim.value.prices.length).toBeGreaterThan(before)
    game.dispose()
  })

  it('FR-004 edge: pausing during a trading halt freezes the countdown', () => {
    const { game, run } = startHalted()
    const left = game.sim.value.market.haltMsLeft

    game.togglePause()
    run(10)
    expect(game.sim.value.market.haltMsLeft).toBe(left)

    game.togglePause()
    run(1)
    expect(game.sim.value.market.haltMsLeft).toBeLessThan(left)
    game.dispose()
  })

  it('BR-015: a stalled tab never advances the halt by more than 250 ms per interval', () => {
    const { game } = startHalted()
    const left = game.sim.value.market.haltMsLeft

    clock += 10_000
    vi.advanceTimersByTime(TICK_MS)
    expect(left - game.sim.value.market.haltMsLeft).toBe(250)
    game.dispose()
  })

  it('FR-004: dispose stops the timer', () => {
    const { game, run } = start()
    run(1)
    game.dispose()
    const length = game.sim.value.prices.length
    run(5)
    expect(game.sim.value.prices).toHaveLength(length)
  })
})

describe('useSinglePlay actions', () => {
  it('FR-004 AC: restart returns the initial state', () => {
    const { game, run } = start()
    game.buy()
    run(10)
    game.sell()
    game.close()
    game.restart()

    const sim = game.sim.value
    expect(sim.prices).toEqual([START_PRICE])
    expect(sim.portfolio).toEqual(emptyPortfolio)
    expect(sim.history).toEqual([])
    expect(sim.peak).toBe(START_CASH)
    expect(sim.end).toBeNull()
    expect(sim.timeLeftMs).toBe(DEFAULT_SINGLE_ROUND.durationMs)
    expect(game.equity.value).toBe(START_CASH)
    game.dispose()
  })

  it('FR-004: buy and sell use the chosen size; close flattens', () => {
    const { game } = start()
    game.qty.value = 100
    game.buy()
    expect(game.sim.value.portfolio.units).toBe(100)
    game.qty.value = 10
    game.sell()
    expect(game.sim.value.portfolio.units).toBe(90)
    game.close()
    expect(game.sim.value.portfolio.units).toBe(0)
    game.dispose()
  })

  it('FR-005 AC: buy, sell and close are no-ops during a trading halt', () => {
    const { game } = startHalted()
    const before = game.sim.value.portfolio

    game.buy()
    game.sell()
    game.close()
    expect(game.sim.value.portfolio).toBe(before)
    game.dispose()
  })

  it('FR-005: the headline price stays at the frozen price during a halt', () => {
    const { game, run } = startHalted()
    const frozen = game.price.value
    const length = game.sim.value.prices.length
    run(5) // 400 ms of a 5 s halt: still halted, the true price keeps moving
    expect(game.halted.value).toBe(true)
    expect(game.sim.value.prices.length).toBeGreaterThan(length)
    expect(game.price.value).toBe(frozen)
    game.dispose()
  })

  it('UF-002: the win rate is empty until a trade is closed', () => {
    const { game } = start()
    expect(game.winRate.value).toBeNull()
    game.buy()
    game.close()
    expect(game.winRate.value).toBe(game.sim.value.portfolio.wins === 1 ? 100 : 0)
    game.dispose()
  })
})

describe('useSinglePlay setup and round (FR-004, BR-009)', () => {
  const ROUND = { durationMs: 3 * 60_000, goal: 20_000 }

  it('nothing runs and no trade is booked before the game starts', () => {
    clock = 0
    const game = useSinglePlay({ now: () => clock, rng: createRng(SEED) })
    clock += TICK_MS
    vi.advanceTimersByTime(TICK_MS * 10)
    game.buy()
    expect(game.sim.value.prices).toHaveLength(1)
    expect(game.sim.value.portfolio.units).toBe(0)
    game.dispose()
  })

  it('start takes the chosen time and goal', () => {
    clock = 0
    const game = useSinglePlay({ now: () => clock, rng: createRng(SEED) })
    game.start(ROUND)
    expect(game.started.value).toBe(true)
    expect(game.sim.value.round).toEqual(ROUND)
    expect(game.sim.value.timeLeftMs).toBe(ROUND.durationMs)
    game.dispose()
  })

  it('the round time counts down while running and stops while paused', () => {
    const { game, run } = start()
    game.changeSettings()
    game.start(ROUND)
    run(10)
    const left = game.sim.value.timeLeftMs
    expect(left).toBeLessThan(ROUND.durationMs)

    game.togglePause()
    run(20)
    expect(game.sim.value.timeLeftMs).toBe(left)
    game.dispose()
  })

  it('BR-009: the round ends as TIME when the time runs out', () => {
    clock = 0
    const game = useSinglePlay({ now: () => clock, rng: createRng(SEED) })
    game.start({ durationMs: 800, goal: 20_000 })
    for (let i = 0; i < 20 && game.sim.value.end === null; i++) {
      clock += TICK_MS
      vi.advanceTimersByTime(TICK_MS)
    }
    expect(game.sim.value.end).toBe('TIME')
    expect(game.sim.value.timeLeftMs).toBe(0)
    game.dispose()
  })

  it('an ended round takes no more trades', () => {
    clock = 0
    const game = useSinglePlay({ now: () => clock, rng: createRng(SEED) })
    game.start({ durationMs: 800, goal: 20_000 })
    for (let i = 0; i < 20 && game.sim.value.end === null; i++) {
      clock += TICK_MS
      vi.advanceTimersByTime(TICK_MS)
    }
    const before = game.sim.value
    game.buy()
    game.close()
    expect(game.sim.value).toBe(before)
    game.dispose()
  })

  it('restart plays again with the same time and goal', () => {
    const { game, run } = start()
    game.start(ROUND)
    run(5)
    game.restart()
    expect(game.sim.value.round).toEqual(ROUND)
    expect(game.sim.value.timeLeftMs).toBe(ROUND.durationMs)
    expect(game.started.value).toBe(true)
    game.dispose()
  })

  it('changeSettings goes back to the setup screen', () => {
    const { game } = start()
    game.changeSettings()
    expect(game.started.value).toBe(false)
    game.dispose()
  })
})

describe('useSinglePlay storage (BR-006, BR-020)', () => {
  it('BR-006: playing, trading and restarting writes nothing to localStorage or sessionStorage', () => {
    const local = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() }
    const session = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', session)

    const { game, run } = start()
    game.speed.value = 8
    game.buy()
    run(50)
    game.close()
    game.restart()
    game.dispose()

    expect(local.setItem).not.toHaveBeenCalled()
    expect(session.setItem).not.toHaveBeenCalled()
  })
})
