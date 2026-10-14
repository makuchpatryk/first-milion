import { z } from 'zod'
import {
  NICK_PATTERN,
  ROOM_NAME_MAX,
  ROOM_NAME_MIN,
  ROUND_DURATIONS_MIN,
  SPEEDS,
  START_CASH_MAX,
  START_CASH_MIN,
  START_CASH_STEP,
} from './rules'
import type { Rng } from './rng'

/** Nickname rules (BR-016, FR-002); the protocol and the web form share this. */
export const nickSchema = z.string().regex(NICK_PATTERN)

/** Starting capital (BR-003): a whole multiple of the step within the range. */
export const startCashSchema = z
  .number()
  .int()
  .min(START_CASH_MIN)
  .max(START_CASH_MAX)
  .multipleOf(START_CASH_STEP)

/** The goal (BR-009): a target equity, a whole number of dollars with no upper limit (safe integers only). */
export const goalSchema = z.number().int().positive()

/** The goal must lie above the starting capital (BR-009). */
export const goalAboveStart = (s: { startCash: number; goal: number }): boolean =>
  s.goal > s.startCash

// One shape for single play and rooms; zod 4 cannot `.extend` a refined object.
const stakesShape = { startCash: startCashSchema, goal: goalSchema }

/** Starting capital and goal of a round; single play validates it with this (FR-003, FR-004). */
export const stakesSchema = z
  .object(stakesShape)
  .strict()
  .refine(goalAboveStart, { path: ['goal'] })
export type Stakes = z.infer<typeof stakesSchema>

/** Room creation form (FR-009). */
export const roomFormSchema = z
  .object({
    name: z.string().trim().min(ROOM_NAME_MIN).max(ROOM_NAME_MAX),
    durationMin: z.literal(ROUND_DURATIONS_MIN),
    speed: z.literal(SPEEDS),
    ...stakesShape,
  })
  .strict()
  .refine(goalAboveStart, { path: ['goal'] })
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
