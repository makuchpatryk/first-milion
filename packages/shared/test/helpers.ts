import type { Market } from '../src/engine/market'
import type { Rng } from '../src/rng'

/** Rng that plays `values` in order and then repeats the last one. */
export function sequence(values: readonly number[]): Rng {
  let i = 0
  return () => {
    const v = values[Math.min(i, values.length - 1)]
    i++
    if (v === undefined) throw new Error('sequence: empty values')
    return v
  }
}

/** Market with no randomness left in it: flat regime, no scheduled news or regime change. */
export function quietMarket(m: Market): Market {
  return { ...m, drift: 0, vol: 0, regimeLeft: 1e9, newsLeft: 1e9 }
}
