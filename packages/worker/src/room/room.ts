import { HEARTBEAT_MS } from '@fm/shared/config'
import { CLOSE_CODES, type RoomSummary } from '@fm/shared/protocol'
import type { Env } from '../env'
import {
  INTERNAL_PATHS,
  WS_PATH,
  lobbyStub,
  postJson,
  roomCloseBodySchema,
  roomInitBodySchema,
} from '../internal'
import {
  NORMAL_CLOSURE,
  assertNever,
  createSocketAcceptor,
  type Connection,
  type SocketAcceptor,
} from '../socket'
import { runtimeTimers } from '../timers'
import { RoomLogic } from './room-logic'

/**
 * One Durable Object per room. Owns the sockets and the heartbeat timer; every rule lives in
 * `RoomLogic` (ARCHITECTURE A1). Memory only, no hibernation, no storage (BR-020, decision 37).
 */
export class Room implements DurableObject {
  private logic: RoomLogic | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  /** The one socket that speaks for a user in this room. */
  private readonly sockets = new Map<string, Connection>()
  private readonly acceptor: SocketAcceptor
  /** Lobby updates in the order they were made. */
  private publishQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.acceptor = createSocketAcceptor(env)
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (request.method === 'POST' && pathname === INTERNAL_PATHS.init) return this.handleInit(request)
    if (request.method === 'POST' && pathname === INTERNAL_PATHS.close) return this.handleClose(request)
    if (pathname === WS_PATH) return this.handleSocket()
    return new Response(null, { status: 404 })
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = roomInitBodySchema.safeParse(await request.json().catch(() => null))
    // Checked after the `await` and assigned below with none in between: two overlapping `/init`
    // requests cannot both pass, so the heartbeat is never started twice.
    if (this.logic !== null) return new Response(null, { status: 409 })
    if (!body.success || body.data.id !== this.ctx.id.toString()) {
      return new Response(null, { status: 400 })
    }

    const { id, form, hostUid } = body.data
    this.logic = new RoomLogic(
      { id, ...form, hostUid },
      {
        ...runtimeTimers,
        send: (uid, msg) => this.sockets.get(uid)?.send(msg),
        close: (uid, code) => {
          const conn = this.sockets.get(uid)
          this.sockets.delete(uid) // its close event must not read as a leave
          conn?.close(code)
        },
        publish: (summary) => this.publish(summary),
        isAdmin: (uid) => this.acceptor.isAdmin(uid),
      },
    )
    this.publish(this.logic.summary())
    this.heartbeat = setInterval(() => {
      if (this.logic !== null) this.publish(this.logic.summary())
    }, HEARTBEAT_MS)
    return new Response(null, { status: 200 })
  }

  /** Admin close forwarded by the Lobby; the admin UID is checked again here. */
  private async handleClose(request: Request): Promise<Response> {
    if (this.logic === null) return new Response(null, { status: 404 })
    const body = roomCloseBodySchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return new Response(null, { status: 400 })
    if (!this.acceptor.isAdmin(body.data.actorUid)) return new Response(null, { status: 403 })
    this.logic.closeRoom(body.data.actorUid)
    return new Response(null, { status: 200 })
  }

  private handleSocket(): Response {
    return this.acceptor.accept({
      onOpen: (conn) => {
        // The Room was never initialised (early connect or wrong id), see spec Risks.
        if (this.logic !== null) return
        conn.send({ type: 'error', code: 'ROOM_NOT_FOUND' })
        conn.close(NORMAL_CLOSURE)
      },
      onAuthed: (session, conn) => {
        if (!this.sockets.has(session.uid)) this.sockets.set(session.uid, conn)
      },
      onMessage: (session, conn, msg) => {
        const logic = this.logic
        if (logic === null) return
        // A second tab of the same user must not act for the first one (one socket per user).
        if (this.sockets.get(session.uid) !== conn) {
          conn.send({ type: 'error', code: 'INVALID_STATE' })
          return
        }
        switch (msg.type) {
          case 'room.join':
            // Same check as `admin.closeRoom`: the id in the message must be this room's.
            if (msg.roomId !== logic.summary().id) conn.send({ type: 'error', code: 'ROOM_NOT_FOUND' })
            else logic.join(session.uid, msg.nick)
            return
          case 'room.leave':
            logic.leave(session.uid)
            return
          case 'admin.kick':
            logic.kick(session.uid, msg.nick)
            return
          case 'admin.closeRoom':
            if (msg.roomId === logic.summary().id) logic.closeRoom(session.uid)
            else conn.send({ type: 'error', code: 'ROOM_NOT_FOUND' })
            return
          case 'room.create':
            // Rooms are created through the Lobby socket.
            conn.send({ type: 'error', code: 'INVALID_STATE' })
            return
          case 'room.start':
          case 'order':
          case 'close':
            // Round messages: accepted by the parser, handled from M4.
            return
          default:
            assertNever(msg)
        }
      },
      onClose: (session, conn) => {
        if (session === null || this.sockets.get(session.uid) !== conn) return
        this.sockets.delete(session.uid)
        this.logic?.onSocketClosed(session.uid)
      },
    })
  }

  /**
   * Tells the Lobby; `null` means the room is gone, which ends the heartbeat and closes the
   * sockets that are still open (members were closed by `RoomLogic`; these joined and left, or
   * never joined). Without that they would keep the Durable Object alive for a dead room.
   */
  private publish(summary: RoomSummary | null): void {
    let request: Request
    if (summary === null) {
      this.stopHeartbeat()
      this.closeRemainingSockets()
      request = postJson(INTERNAL_PATHS.deregister, { roomId: this.ctx.id.toString() })
    } else {
      request = postJson(INTERNAL_PATHS.register, summary)
    }
    // One request at a time, in order: a heartbeat still in flight must not land after the
    // deregister and list a deleted room. A lost update is repaired by the next heartbeat
    // (FR-008); never let it throw here.
    this.publishQueue = this.publishQueue.then(() =>
      lobbyStub(this.env)
        .fetch(request)
        .then(
          () => undefined,
          () => undefined,
        ),
    )
    this.ctx.waitUntil(this.publishQueue)
  }

  private closeRemainingSockets(): void {
    const remaining = [...this.sockets.values()]
    this.sockets.clear() // their close events must not read as leaves
    for (const conn of remaining) {
      conn.send({ type: 'error', code: 'ROOM_CLOSED' })
      conn.close(CLOSE_CODES.ROOM_CLOSED)
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return
    clearInterval(this.heartbeat)
    this.heartbeat = null
  }
}
