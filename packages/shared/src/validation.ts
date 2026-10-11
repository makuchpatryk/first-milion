import { NICK_PATTERN } from './rules'
import type { Rng } from './rng'

export function isValidNick(s: string): boolean {
  return NICK_PATTERN.test(s)
}

/** Default nickname `Trader-NNNN` (BR-016). */
export function randomNick(rng: Rng): string {
  return `Trader-${String(Math.floor(rng() * 10_000)).padStart(4, '0')}`
}

/**
 * Collision suffix `#n` (FR-002). The result can exceed 16 characters; room join (M3) must
 * handle that, see spec Risks.
 */
export function suffixNick(nick: string, n: number): string {
  return `${nick}#${n}`
}
