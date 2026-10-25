import { z } from 'zod'
import { ERROR_CODES } from './errors'
import {
  meRoundSchema,
  newsViewSchema,
  rankRowSchema,
  roomSummarySchema,
  roomViewSchema,
  roundEndReasonSchema,
} from './views'

// The error union is closed: no free text (ARCHITECTURE Errors). Server messages are parsed by
// the client (M5) and validated in tests; the server never parses its own output.
export const serverMessageSchema = z.discriminatedUnion('type', [
  /** `admin` is a flag only, never the UID (ARCHITECTURE Privacy). */
  z.object({ type: z.literal('auth.ok'), admin: z.boolean() }).strict(),
  z.object({ type: z.literal('lobby.rooms'), rooms: z.array(roomSummarySchema) }).strict(),
  z.object({ type: z.literal('room.created'), roomId: z.string().min(1) }).strict(),
  /** Sent on every membership or status change. */
  z.object({ type: z.literal('room.state'), view: roomViewSchema }).strict(),
  /** On join or return while a round runs: every price so far, at most `HISTORY_MAX` (FR-015). */
  z.object({ type: z.literal('room.history'), prices: z.array(z.number()) }).strict(),
  /** One per recipient every tick interval; prices, news and ranking are the same for all. */
  z
    .object({
      type: z.literal('room.tick'),
      /** Prices of this interval, one per simulation step (length = speed). */
      prices: z.array(z.number()),
      price: z.number(),
      /** Set only on the interval the event was drawn. */
      news: newsViewSchema.nullable(),
      endsInMs: z.number(),
      ranking: z.array(rankRowSchema),
      you: meRoundSchema,
    })
    .strict(),
  /** Answer to an accepted order; `fill` is the price incl. spread, `null` for a no-op close. */
  z
    .object({ type: z.literal('order.ok'), fill: z.number().nullable(), you: meRoundSchema })
    .strict(),
  z
    .object({
      type: z.literal('round.end'),
      reason: roundEndReasonSchema,
      /** Nicknames; several means a shared first place. */
      winners: z.array(z.string()),
      ranking: z.array(rankRowSchema),
    })
    .strict(),
  /** Followed by a close with `CLOSE_CODES.KICKED`. */
  z.object({ type: z.literal('kicked') }).strict(),
  z.object({ type: z.literal('error'), code: z.enum(ERROR_CODES) }).strict(),
  /** Answer to `ping` (decision 48). */
  z.object({ type: z.literal('pong') }).strict(),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>
