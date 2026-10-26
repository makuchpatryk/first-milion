import type { Env } from './env'
import { WS_PATH, lobbyStub } from './internal'
import { ME_PATH, handleMe } from './me'
import { isAllowedOrigin } from './origin'

export { Lobby } from './lobby/lobby'
export { Room } from './room/room'

const ROOM_ROUTE = /^\/ws\/room\/([^/]+)$/

function notFound(): Response {
  return new Response(null, { status: 404 })
}

/** Where a public WebSocket route leads, or null for an unknown route or an invalid room id. */
function resolveStub(pathname: string, env: Env): DurableObjectStub | null {
  if (pathname === '/ws/lobby') return lobbyStub(env)
  const roomId = ROOM_ROUTE.exec(pathname)?.[1]
  if (roomId === undefined) return null
  try {
    return env.ROOM.get(env.ROOM.idFromString(roomId))
  } catch {
    return null // not a Durable Object id
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === ME_PATH) return handleMe(request, env)
    const stub = request.method === 'GET' ? resolveStub(url.pathname, env) : null
    if (stub === null) return notFound()
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(null, { status: 426 })
    }
    // FR-007, NFR-004: before anything reaches a Durable Object. The token is not read from
    // the URL: it arrives in the first `auth` message.
    if (!isAllowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response(null, { status: 403 })
    }
    // Only the socket path is forwarded: the internal /init, /close, /register and /deregister
    // paths are unreachable from outside.
    return stub.fetch(new Request(new URL(WS_PATH, request.url), request))
  },
} satisfies ExportedHandler<Env>
