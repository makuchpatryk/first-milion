import { z } from 'zod'
import { ROUND_DURATIONS_MIN, SPEEDS } from '../rules'

// Views carry nicknames and numbers only: no email, UID or token (ARCHITECTURE Privacy).
// Schemas so the client can parse what it receives (boundaries are `unknown`) and the
// Lobby can parse what Rooms register.

const durationSchema = z.literal(ROUND_DURATIONS_MIN)
const speedSchema = z.literal(SPEEDS)
const statusSchema = z.enum(['lobby', 'running'])

/** One lobby list entry (FR-008). */
export const roomSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    hostNick: z.string().nullable(),
    players: z.number().int().min(0),
    observers: z.number().int().min(0),
    maxPlayers: z.literal(4),
    durationMin: durationSchema,
    startCash: z.number().int(),
    goal: z.number().int(),
    speed: speedSchema,
    status: statusSchema,
  })
  .strict()
export type RoomSummary = z.infer<typeof roomSummarySchema>

/** An eliminated player stays seated and watches (decision 38). */
export const memberStatusSchema = z.enum(['active', 'disconnected', 'eliminated'])
export type MemberStatus = z.infer<typeof memberStatusSchema>

export const memberViewSchema = z
  .object({ nick: z.string(), status: memberStatusSchema })
  .strict()
export type MemberView = z.infer<typeof memberViewSchema>

export const roundEndReasonSchema = z.enum(['TARGET', 'TIME', 'ALL_ELIMINATED'])
export type RoundEndReason = z.infer<typeof roundEndReasonSchema>

/** One ranking line; `place` is a competition rank, equal rows share it (BR-009, BR-010). */
export const rankRowSchema = z
  .object({
    nick: z.string(),
    equity: z.number(),
    status: memberStatusSchema,
    place: z.number().int().min(1),
  })
  .strict()
export type RankRow = z.infer<typeof rankRowSchema>

/** A member's own round numbers; sent per recipient (FR-011). */
export const meRoundSchema = z
  .object({
    role: z.enum(['player', 'observer']),
    status: memberStatusSchema,
    units: z.number(),
    avg: z.number(),
    realized: z.number(),
    equity: z.number(),
    closedTrades: z.number().int().min(0),
    wins: z.number().int().min(0),
  })
  .strict()
export type MeRound = z.infer<typeof meRoundSchema>

/**
 * The news of one tick interval. Parameters only: the texts are i18n keys on the client
 * (FR-005). Same shape as the engine's `NewsEvent`.
 */
export const newsViewSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('SHOCK'),
      dir: z.union([z.literal(1), z.literal(-1)]),
      mag: z.number(),
      idx: z.number().int().min(0),
    })
    .strict(),
  z.object({ type: z.literal('FLASH_CRASH'), drop: z.number() }).strict(),
  z.object({ type: z.literal('VOL_SPIKE') }).strict(),
  z.object({ type: z.literal('TREND'), dir: z.union([z.literal(1), z.literal(-1)]) }).strict(),
])
export type NewsView = z.infer<typeof newsViewSchema>

/** The result of the last round, shown in the lobby until the next start (BR-014). */
export const lastRoundSchema = z
  .object({
    reason: roundEndReasonSchema,
    /** Nicknames; several means a shared first place. */
    winners: z.array(z.string()),
    ranking: z.array(rankRowSchema),
  })
  .strict()
export type LastRound = z.infer<typeof lastRoundSchema>

/** Sent to one socket; `you` differs per socket. */
export const roomViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    hostNick: z.string().nullable(),
    durationMin: durationSchema,
    startCash: z.number().int(),
    goal: z.number().int(),
    speed: speedSchema,
    status: statusSchema,
    /** Join order (FR-010, BR-013). */
    players: z.array(memberViewSchema),
    /** Join order. */
    observers: z.array(z.object({ nick: z.string() }).strict()),
    lastRound: lastRoundSchema.nullable(),
    you: z
      .object({
        role: z.enum(['player', 'observer']),
        nick: z.string(),
        isHost: z.boolean(),
      })
      .strict(),
  })
  .strict()
export type RoomView = z.infer<typeof roomViewSchema>
