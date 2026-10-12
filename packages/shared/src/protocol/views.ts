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
    profitTarget: z.number().int().nullable(),
    speed: speedSchema,
    status: statusSchema,
  })
  .strict()
export type RoomSummary = z.infer<typeof roomSummarySchema>

export const memberViewSchema = z
  .object({ nick: z.string(), status: z.enum(['active', 'disconnected', 'eliminated']) })
  .strict()
export type MemberView = z.infer<typeof memberViewSchema>

/** Sent to one socket; `you` differs per socket. M4 adds the round fields. */
export const roomViewSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    hostNick: z.string().nullable(),
    durationMin: durationSchema,
    profitTarget: z.number().int().nullable(),
    speed: speedSchema,
    status: statusSchema,
    /** Join order (FR-010, BR-013). */
    players: z.array(memberViewSchema),
    /** Join order. */
    observers: z.array(z.object({ nick: z.string() }).strict()),
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
