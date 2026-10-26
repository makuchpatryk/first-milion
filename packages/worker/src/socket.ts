import { parseClientMessage, type ClientMessage, type ServerMessage } from '@fm/shared/protocol'
import { AuthGate, type Session } from './auth/auth-gate'
import { createVerifier } from './auth/verifier'
import { parseEnv, type Env } from './env'
import { runtimeTimers } from './timers'

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
 */
export function createSocketAcceptor(env: Env): SocketAcceptor {
  const config = parseEnv(env)
  const verify = createVerifier(config)
  const isAdmin = (uid: string) => config.adminUids.has(uid)

  function accept(handlers: SocketHandlers): Response {
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

    const gate = new AuthGate({
      ...runtimeTimers,
      verify,
      isAdmin,
      close: (code) => conn.close(code),
      sendAuthOk: (admin) => conn.send({ type: 'auth.ok', admin }),
      onAuthed: (session) => handlers.onAuthed(session, conn),
    })

    server.addEventListener('message', (event) => {
      const session = gate.session
      if (session === null) {
        void gate.handle(event.data)
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
