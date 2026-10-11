/** Uniform generator returning values in [0, 1). Injected everywhere; never Math.random (ARCHITECTURE A4). */
export type Rng = () => number

/** mulberry32: 32-bit state, small and good enough for a game. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Standard normal via Box–Muller. Uses one draw pair per call and discards the second value,
 * so the sequence stays a pure function of the seed (no hidden cache).
 */
export function randn(rng: Rng): number {
  const u = 1 - rng() // (0, 1] keeps log finite
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export function between(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo)
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)]
  if (item === undefined) throw new Error('pick: empty items')
  return item
}
