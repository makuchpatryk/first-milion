import { z } from 'zod'
import { MAX_FRAME_CHARS } from '../config'
import { ORDER_QTYS } from '../rules'
import { nickSchema, roomFormSchema } from '../validation'

// Every schema is strict: unknown fields (e.g. `price` on `order`) are rejected (NFR-004, FR-012).
// The client sends intent only; the server decides price and result (BR-007).

/** Firebase ID tokens are ~1 KB; the cap bounds what the Worker will parse. */
const TOKEN_MAX = 4_096
/** A Durable Object id is 64 hex characters. */
const ROOM_ID_MAX = 64

const roomIdSchema = z.string().min(1).max(ROOM_ID_MAX)

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1).max(TOKEN_MAX) }).strict(),
  z.object({ type: z.literal('room.create'), form: roomFormSchema }).strict(),
  z.object({ type: z.literal('room.join'), roomId: roomIdSchema, nick: nickSchema }).strict(),
  z.object({ type: z.literal('room.leave') }).strict(),
  z.object({ type: z.literal('room.start') }).strict(),
  z
    .object({
      type: z.literal('order'),
      side: z.enum(['BUY', 'SELL']),
      qty: z.literal(ORDER_QTYS),
    })
    .strict(),
  z.object({ type: z.literal('close') }).strict(),
  z.object({ type: z.literal('admin.kick'), nick: nickSchema }).strict(),
  z.object({ type: z.literal('admin.closeRoom'), roomId: roomIdSchema }).strict(),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export type ParsedClientMessage = { ok: true; msg: ClientMessage } | { ok: false }

/**
 * Parses one inbound frame. Text frames are JSON-decoded here; an already decoded value is
 * validated as is. A text frame over `MAX_FRAME_CHARS` is refused before it is parsed. Anything
 * invalid maps to `INVALID_PAYLOAD` at the caller, without closing.
 */
export function parseClientMessage(raw: unknown): ParsedClientMessage {
  let value = raw
  if (typeof raw === 'string') {
    if (raw.length > MAX_FRAME_CHARS) return { ok: false }
    try {
      value = JSON.parse(raw)
    } catch {
      return { ok: false }
    }
  }
  const parsed = clientMessageSchema.safeParse(value)
  return parsed.success ? { ok: true, msg: parsed.data } : { ok: false }
}
