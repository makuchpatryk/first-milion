import { roomFormSchema } from '@fm/shared/validation'
import { z } from 'zod'
import type { Env } from './env'

// Bodies of the requests the Lobby and Rooms send each other over the DO bindings. They are not
// reachable from the public routes (`index.ts` never forwards these paths), but they are still
// parsed: a DO boundary is `unknown` too.

/** Lobby → Room `POST /init`. `id` is the Room's own DO id (`ctx.id.toString()`). */
export const roomInitBodySchema = z
  .object({ id: z.string().min(1), form: roomFormSchema, hostUid: z.string().min(1) })
  .strict()
export type RoomInitBody = z.infer<typeof roomInitBodySchema>

/** Lobby → Room `POST /close`; the Room checks the admin UID again. */
export const roomCloseBodySchema = z.object({ actorUid: z.string().min(1) }).strict()

/** Room → Lobby `POST /deregister`. (`/register` carries a `RoomSummary`.) */
export const deregisterBodySchema = z.object({ roomId: z.string().min(1) }).strict()

export const INTERNAL_PATHS = {
  init: '/init',
  close: '/close',
  register: '/register',
  deregister: '/deregister',
} as const

/** Stub requests need an absolute URL; the host is never resolved. */
export const INTERNAL_ORIGIN = 'https://internal'

/** The one `Lobby` instance (ARCHITECTURE A3). */
export function lobbyStub(env: Env): DurableObjectStub {
  return env.LOBBY.get(env.LOBBY.idFromName('lobby'))
}

/** Path the Worker hands to a DO for a WebSocket upgrade; the public route is rewritten to it. */
export const WS_PATH = '/ws'

export function postJson(path: string, body: unknown): Request {
  return new Request(`${INTERNAL_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
