import type { BookedTrade } from '@fm/shared/engine/portfolio'
import { describe, expect, it } from 'vitest'
import { HISTORY_SIZE, pushTrade } from './history'

const trade = (units: number): BookedTrade => ({ dir: 1, units, entry: 100, exit: 101, pnl: units })

describe('pushTrade', () => {
  it('UF-002: the newest trade comes first', () => {
    const history = pushTrade(pushTrade([], trade(1)), trade(2))
    expect(history.map((t) => t.units)).toEqual([2, 1])
  })

  it('UF-002: the 9th trade drops the oldest, keeping the last 8', () => {
    let history: readonly BookedTrade[] = []
    for (let i = 1; i <= HISTORY_SIZE + 1; i++) history = pushTrade(history, trade(i))

    expect(history).toHaveLength(8)
    expect(history[0]?.units).toBe(9)
    expect(history.at(-1)?.units).toBe(2)
  })

  it('UF-002: does not mutate the previous history', () => {
    const before: readonly BookedTrade[] = [trade(1)]
    pushTrade(before, trade(2))
    expect(before).toHaveLength(1)
  })
})
