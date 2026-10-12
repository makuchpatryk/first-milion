import { CLOSE_CODES, serverMessageSchema } from '@fm/shared/protocol'
import type { ClientMessage, ServerMessage } from '@fm/shared/protocol'

/** Backoff for reconnects: 500 ms, doubled each try, capped (spec 05 trade-offs). */
const BACKOFF_START_MS = 500
const BACKOFF_CAP_MS = 8_000

const NORMAL_CLOSURE = 1000

export type SocketStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed'

/** The slice of `WebSocket` the client uses; a fake implements it in tests. */
export interface WebSocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number }) => void) | null
  send(data: string): void
  close(code?: number): void
}

export interface SocketHandle {
  /** Dropped, not queued, while the socket is not ready: a late order at a new price is unfair. */
  send(msg: ClientMessage): void
  /** Ends the socket for good; safe to call twice. */
  close(): void
  /** Sends a fresh `auth` on the open socket (FR-007 edge); the round is not interrupted. */
  refreshToken(): void
}

export interface SocketOptions {
  url: string
  /** Firebase ID token; `forceRefresh` after a 4401 close. */
  getToken(forceRefresh: boolean): Promise<string>
  /** Already zod-parsed. */
  onMessage(msg: ServerMessage): void
  /** `ready` fires once per connection, on the first `auth.ok`; a refresh's `auth.ok` is not one. */
  onStatus(status: SocketStatus, closeCode?: number): void
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
  /** Test seam; defaults to the platform `WebSocket`. */
  openSocket?: (url: string) => WebSocketLike
}

/** Narrows the DOM socket to `WebSocketLike`, so nothing else of its API leaks into the client. */
function platformSocket(url: string): WebSocketLike {
  const ws = new WebSocket(url)
  const like: WebSocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: (data) => ws.send(data),
    close: (code) => ws.close(code),
  }
  ws.onopen = () => like.onopen?.()
  ws.onmessage = (event: MessageEvent<unknown>) => like.onmessage?.({ data: event.data })
  ws.onclose = (event) => like.onclose?.({ code: event.code })
  return like
}

/**
 * Typed game socket (FR-007, FR-015). Sends `auth` first on every connection, parses every
 * incoming frame with the shared schema, reconnects with backoff, and stops on a kick or an
 * admin room close. Server frames are `unknown` until parsed (CODE_QUALITY boundaries).
 */
export function createSocket(options: SocketOptions): SocketHandle {
  const open = options.openSocket ?? platformSocket
  let ws: WebSocketLike | null = null
  let ready = false
  let disposed = false
  let attempt = 0
  let retry: unknown = null
  // One forced token refresh per 4401 streak; a successful `auth.ok` resets it.
  let refreshedAfter4401 = false
  let forceNextToken = false
  let everConnected = false

  function sendAuth(socket: WebSocketLike, force: boolean): void {
    options.getToken(force).then(
      (token) => {
        if (socket === ws && !disposed) socket.send(JSON.stringify({ type: 'auth', token }))
      },
      // No token to offer: drop the socket, the close handler retries with backoff.
      () => socket.close(),
    )
  }

  function handleFrame(data: unknown): void {
    let json: unknown
    try {
      json = typeof data === 'string' ? JSON.parse(data) : null
    } catch {
      json = null
    }
    const parsed = serverMessageSchema.safeParse(json)
    if (!parsed.success) {
      if (import.meta.env.DEV) console.warn('ignored invalid server message')
      return
    }
    const msg = parsed.data
    if (msg.type === 'auth.ok' && !ready) {
      ready = true
      attempt = 0
      refreshedAfter4401 = false
      options.onStatus('ready')
    }
    options.onMessage(msg)
  }

  function reconnectLater(): void {
    options.onStatus('reconnecting')
    const delay = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_CAP_MS)
    attempt += 1
    retry = options.schedule(connect, delay)
  }

  function handleClose(code: number): void {
    ready = false
    ws = null
    if (disposed) return
    if (code === CLOSE_CODES.KICKED || code === CLOSE_CODES.ROOM_CLOSED) {
      disposed = true
      options.onStatus('closed', code)
      return
    }
    if (code === CLOSE_CODES.AUTH_FAILED) {
      if (refreshedAfter4401) {
        disposed = true
        options.onStatus('closed', code)
        return
      }
      refreshedAfter4401 = true
      forceNextToken = true
      options.onStatus('reconnecting')
      connect()
      return
    }
    reconnectLater()
  }

  function connect(): void {
    retry = null
    if (disposed) return
    if (!everConnected) options.onStatus('connecting')
    everConnected = true
    const socket = open(options.url)
    ws = socket
    const force = forceNextToken
    forceNextToken = false
    socket.onopen = () => sendAuth(socket, force)
    socket.onmessage = (event) => {
      if (socket === ws) handleFrame(event.data)
    }
    socket.onclose = (event) => {
      if (socket === ws) handleClose(event.code)
    }
  }

  connect()

  return {
    send(msg) {
      if (ws !== null && ready) ws.send(JSON.stringify(msg))
    },
    close() {
      if (disposed) return
      disposed = true
      if (retry !== null) options.cancel(retry)
      retry = null
      const socket = ws
      ws = null
      ready = false
      socket?.close(NORMAL_CLOSURE)
    },
    refreshToken() {
      const socket = ws
      if (socket !== null && ready) sendAuth(socket, false)
    },
  }
}
