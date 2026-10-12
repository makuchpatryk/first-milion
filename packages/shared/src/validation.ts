import { z } from 'zod'
import {
  NICK_PATTERN,
  PROFIT_TARGET_MIN,
  ROOM_NAME_MAX,
  ROOM_NAME_MIN,
  ROUND_DURATIONS_MIN,
  SPEEDS,
} from './rules'
import type { Rng } from './rng'

/** Nickname rules (BR-016, FR-002); the protocol and the web form share this. */
export const nickSchema = z.string().regex(NICK_PATTERN)

/** The goal (BR-009): required, a whole number of dollars from 20,000. Rooms and single play share it. */
export const goalSchema = z.number().int().min(PROFIT_TARGET_MIN)

/** Room creation form (FR-009). `profitTarget` is the goal. */
export const roomFormSchema = z
  .object({
    name: z.string().trim().min(ROOM_NAME_MIN).max(ROOM_NAME_MAX),
    durationMin: z.literal(ROUND_DURATIONS_MIN),
    speed: z.literal(SPEEDS),
    profitTarget: goalSchema,
  })
  .strict()
export type RoomForm = z.infer<typeof roomFormSchema>

export function isValidNick(s: string): boolean {
  return NICK_PATTERN.test(s)
}

/** Default nickname `Trader-NNNN` (BR-016). */
export function randomNick(rng: Rng): string {
  return `Trader-${String(Math.floor(rng() * 10_000)).padStart(4, '0')}`
}

/**
 * Collision suffix `#n` (FR-002). The result can exceed 16 characters; `uniqueNick` in
 * `worker/room/roster.ts` cuts the base first, so call that rather than this.
 */
export function suffixNick(nick: string, n: number): string {
  return `${nick}#${n}`
}
