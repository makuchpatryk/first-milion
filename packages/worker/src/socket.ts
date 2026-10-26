import { FRAME_BUDGET_PER_SEC, MAX_PENDING_SOCKETS } from '@fm/shared/config'
import { parseClientMessage, type ClientMessage, type ServerMessage } from '@fm/shared/protocol'
import { AuthGate, type Session } from './auth/auth-gate'
import { createVerifier } from './auth/verifier'
import { parseEnv, type Env } from './env'
import { SlidingWindowLimit } from './rate-limit'
import { runtimeTimers } from './timers'

/** The window `FRAME_BUDGET_PER_SEC` is counted in. */
const FRAME_WINDOW_MS = 1_000

/** What a DO shell can do with one accepted socket. */
export interface Connection {
  send(msg: ServerMessage): void
  close(code: number): void
}

/** A message after auth; `auth` (token refresh) is consumed by the gate, `ping` is answered here. */
export type PostAuthMessage = Exclude<ClientMessage, { type: 'auth' | 'ping' }>

export interface SocketHandlers {
  /** Right after the upgrade, before auth. */
  onOpen?(conn: Connection): void
  onAuthed(session: Session, conn: Connection): void
  /** A parsed, strictly valid message from an authenticated socket. */
  onMessage(session: Session, conn: Connection, msg: PostAuthMessage): void
  /** The socket is gone; `session` is null if it never authenticated. */
  onClose(session: Session | null, conn: Connection): void
}

export interface SocketAcceptor {
  accept(handlers: SocketHandlers): Response
  isAdmin(uid: string): boolean
}

/** Compile-time proof that a `switch` over a message union is exhaustive. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`)
}

/** Plain WebSocket close code for "nothing wrong, done". */
export const NORMAL_CLOSURE = 1000

/**
 * Wires the WebSocket plumbing both DO shells share: plain `accept()` (no hibernation, decision
 * 37), the auth gate (FR-007) and schema validation of every later frame (NFR-004). Runtime
 * clock and timers are used here, never in the logic classes.
 *
 * Abuse limits (PRD §20 #49): one acceptor lives in each Durable Object, so `pending` counts the
 * sockets of that object that have not authenticated yet; at `MAX_PENDING_SOCKETS` the next upgrade
 * is refused with 503 before a socket exists. An authenticated socket may send
 * `FRAME_BUDGET_PER_SEC` frames per second, of any type; more get `RATE_LIMITED` and are dropped,
 * without a disconnect (decision 41).
 */
export function createSocketAcceptor(env: Env): SocketAcceptor {
  const config = parseEnv(env)
  const verify = createVerifier(config)
  const isAdmin = (uid: string) => config.adminUids.has(uid)
  let pending = 0

  function accept(handlers: SocketHandlers): Response {
    if (pending >= MAX_PENDING_SOCKETS) return new Response(null, { status: 503 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()

    const conn: Connection = {
      send: (msg) => {
        try {
          server.send(JSON.stringify(msg))
        } catch {
          // Socket already closing; its close event does the cleanup.
        }
      },
      close: (code) => {
        try {
          server.close(code)
        } catch {
          // Already closed.
        }
      },
    }

    // Counted from accept until the first `auth` succeeds or the socket goes, whichever is first.
    pending++
    let counted = true
    const releasePending = () => {
      if (!counted) return
      counted = false
      pending--
    }
    const frames = new SlidingWindowLimit(FRAME_BUDGET_PER_SEC, FRAME_WINDOW_MS)

    const gate = new AuthGate({
      ...runtimeTimers,
      verify,
      isAdmin,
      close: (code) => conn.close(code),
      sendAuthOk: (admin) => conn.send({ type: 'auth.ok', admin }),
      onAuthed: (session) => {
        releasePending()
        handlers.onAuthed(session, conn)
      },
    })

    server.addEventListener('message', (event) => {
      const session = gate.session
      if (session === null) {
        void gate.handle(event.data)
        return
      }
      // Before parsing: a flood of junk frames must not cost a parse each.
      if (!frames.attempt(Date.now())) {
        conn.send({ type: 'error', code: 'RATE_LIMITED' })
        return
      }
      const parsed = parseClientMessage(event.data)
      if (!parsed.ok) {
        conn.send({ type: 'error', code: 'INVALID_PAYLOAD' })
        return
      }
      if (parsed.msg.type === 'auth') {
        void gate.handle(parsed.msg)
        return
      }
      // Keepalive (decision 48): answered once here for both DOs, so it never reaches the rules or
      // the BR-018 rate limit.
      if (parsed.msg.type === 'ping') {
        conn.send({ type: 'pong' })
        return
      }
      handlers.onMessage(session, conn, parsed.msg)
    })

    let closed = false
    const onGone = () => {
      if (closed) return
      closed = true
      releasePending()
      gate.dispose()
      handlers.onClose(gate.session, conn)
    }
    server.addEventListener('close', onGone)
    server.addEventListener('error', onGone)

    handlers.onOpen?.(conn)
    return new Response(null, { status: 101, webSocket: client })
  }

  return { accept, isAdmin }
}
