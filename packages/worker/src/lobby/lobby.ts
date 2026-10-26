import { CLOSE_CODES, roomSummarySchema } from '@fm/shared/protocol'
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
  /** The one socket that listens for a user: the newest one (decision 47, PRD §20 #49). */
  private readonly subscribers = new Map<string, Connection>()
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
        for (const conn of this.subscribers.values()) conn.send({ type: 'lobby.rooms', rooms })
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
      onAuthed: (session, conn) => {
        const previous = this.subscribers.get(session.uid)
        this.subscribers.set(session.uid, conn)
        // Newest wins, as in a Room: one user cannot hold many lobby sockets. `onClose` ignores
        // the replaced socket.
        if (previous !== undefined && previous !== conn) previous.close(CLOSE_CODES.REPLACED)
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
      onClose: (session, conn) => {
        if (session !== null && this.subscribers.get(session.uid) === conn) {
          this.subscribers.delete(session.uid)
        }
      },
    })
  }

  /** FR-009: the Lobby mints the id and initialises the Room before answering. */
  private async createRoom(hostUid: string, form: RoomForm, conn: Connection): Promise<void> {
    const id = this.env.ROOM.newUniqueId()
    const roomId = id.toString()
    // PRD §20 #49: the slot is taken before the first `await`, so two creates sent together cannot
    // both pass the cap. A refusal does not close the socket (decision 41).
    if (!this.logic.reserve(roomId, hostUid)) {
      conn.send({ type: 'error', code: 'RATE_LIMITED' })
      return
    }
    try {
      const response = await this.env.ROOM.get(id).fetch(
        postJson(INTERNAL_PATHS.init, { id: roomId, form, hostUid }),
      )
      if (response.ok) {
        conn.send({ type: 'room.created', roomId })
        return
      }
    } catch {
      // Handled below, like a refused init.
    }
    this.logic.release(roomId)
    conn.send({ type: 'error', code: 'INVALID_STATE' })
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
