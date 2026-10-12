import { z } from 'zod'
import { ERROR_CODES } from './errors'
import { roomSummarySchema, roomViewSchema } from './views'

// The error union is closed: no free text (ARCHITECTURE Errors). M4 adds `room.tick`,
// `order.ok` and `round.end`.
export const serverMessageSchema = z.discriminatedUnion('type', [
  /** `admin` is a flag only, never the UID (ARCHITECTURE Privacy). */
  z.object({ type: z.literal('auth.ok'), admin: z.boolean() }).strict(),
  z.object({ type: z.literal('lobby.rooms'), rooms: z.array(roomSummarySchema) }).strict(),
  z.object({ type: z.literal('room.created'), roomId: z.string().min(1) }).strict(),
  /** Sent on every membership or status change. */
  z.object({ type: z.literal('room.state'), view: roomViewSchema }).strict(),
  /** Followed by a close with `CLOSE_CODES.KICKED`. */
  z.object({ type: z.literal('kicked') }).strict(),
  z.object({ type: z.literal('error'), code: z.enum(ERROR_CODES) }).strict(),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>
