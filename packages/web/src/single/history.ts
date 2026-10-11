import type { BookedTrade } from '@fm/shared/engine/portfolio'

/** UF-002: the screen lists the last 8 closed trades. */
export const HISTORY_SIZE = 8

/** Newest first; the oldest entry drops out beyond `max`. */
export function pushTrade(
  history: readonly BookedTrade[],
  trade: BookedTrade,
  max: number = HISTORY_SIZE,
): readonly BookedTrade[] {
  return [trade, ...history].slice(0, max)
}
