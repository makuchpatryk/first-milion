import { roomSummarySchema } from '@fm/shared/protocol'
import type { RoomForm } from '@fm/shared/validation'
import type { Env } from '../env'
import { INTERNAL_PATHS, WS_PATH, deregisterBodySchema, postJson } from '../internal'
import { assertNever, createSocketAcceptor, type Connection, type SocketAcceptor } from '../socket'
import { runtimeTimers } from '../timers'
import { LobbyLogic } from './lobby-logic'

/**
 * The single registry Durable Object (ARCHITECTURE A3). Holds the room list in memory only,
 * serves it to subscribed sockets, and creates and closes rooms on request. All list rules live
 * in `LobbyLogic`.
 */
export class Lobby implements DurableObject {
  private readonly logic: LobbyLogic
  private readonly subscribers = new Set<Connection>()
  private readonly acceptor: SocketAcceptor

  constructor(
    _ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.acceptor = createSocketAcceptor(env)
    this.logic = new LobbyLogic({
      ...runtimeTimers,
      now: () => Date.now(),
      broadcast: (rooms) => {
        for (const conn of this.subscribers) conn.send({ type: 'lobby.rooms', rooms })
      },
    })
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === INTERNAL_PATHS.register) {
      return this.handleRegister(request)
    }
    if (request.method === 'POST' && pathname === INTERNAL_PATHS.deregister) {
      return this.handleDeregister(request)
    }
    if (pathname === WS_PATH) return this.handleSocket()
    return new Response(null, { status: 404 })
  }

  /** Room → Lobby: on every change and every heartbeat (FR-008). */
  private async handleRegister(request: Request): Promise<Response> {
    const body = roomSummarySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return new Response(null, { status: 400 })
    this.logic.register(body.data)
    return new Response(null, { status: 200 })
  }

  private async handleDeregister(request: Request): Promise<Response> {
    const body = deregisterBodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return new Response(null, { status: 400 })
    this.logic.remove(body.data.roomId)
    return new Response(null, { status: 200 })
  }

  private handleSocket(): Response {
    return this.acceptor.accept({
      onAuthed: (_session, conn) => {
        this.subscribers.add(conn)
        conn.send({ type: 'lobby.rooms', rooms: this.logic.list() })
      },
      onMessage: (session, conn, msg) => {
        switch (msg.type) {
          case 'room.create':
            void this.createRoom(session.uid, msg.form, conn)
            return
          case 'admin.closeRoom':
            void this.closeRoom(session.uid, msg.roomId, conn)
            return
          case 'room.join':
          case 'room.leave':
          case 'room.start':
          case 'order':
          case 'close':
          case 'admin.kick':
            // Room messages belong on a room socket.
            conn.send({ type: 'error', code: 'INVALID_STATE' })
            return
          default:
            assertNever(msg)
        }
      },
      onClose: (_session, conn) => {
        this.subscribers.delete(conn)
      },
    })
  }

  /** FR-009: the Lobby mints the id and initialises the Room before answering. */
  private async createRoom(hostUid: string, form: RoomForm, conn: Connection): Promise<void> {
    try {
      const id = this.env.ROOM.newUniqueId()
      const roomId = id.toString()
      const response = await this.env.ROOM.get(id).fetch(
        postJson(INTERNAL_PATHS.init, { id: roomId, form, hostUid }),
      )
      conn.send(response.ok ? { type: 'room.created', roomId } : { type: 'error', code: 'INVALID_STATE' })
    } catch {
      conn.send({ type: 'error', code: 'INVALID_STATE' })
    }
  }

  /** FR-017: admin only; the Room checks the UID again and deregisters itself. */
  private async closeRoom(actorUid: string, roomId: string, conn: Connection): Promise<void> {
    if (!this.acceptor.isAdmin(actorUid)) {
      conn.send({ type: 'error', code: 'FORBIDDEN' })
      return
    }
    if (!this.logic.has(roomId)) {
      conn.send({ type: 'error', code: 'ROOM_NOT_FOUND' })
      return
    }
    try {
      const response = await this.env.ROOM.get(this.env.ROOM.idFromString(roomId)).fetch(
        postJson(INTERNAL_PATHS.close, { actorUid }),
      )
      if (response.status === 404) {
        // The Room is gone but still listed: drop the stale entry.
        this.logic.remove(roomId)
        conn.send({ type: 'error', code: 'ROOM_NOT_FOUND' })
      } else if (!response.ok) {
        conn.send({ type: 'error', code: 'INVALID_STATE' })
      }
    } catch {
      conn.send({ type: 'error', code: 'INVALID_STATE' })
    }
  }
}
