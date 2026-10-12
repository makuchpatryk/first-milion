import { exports } from 'cloudflare:workers'
import type { ClientMessage, ServerMessage } from '@fm/shared/protocol'

export const ORIGIN = 'http://localhost:5173'
export const PROJECT_ID = 'first-million-test'
export const ADMIN_UID = 'uid-admin'

const b64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** An unsigned token in the shape the Firebase Auth emulator issues (AUTH_EMULATOR is on). */
export function emulatorToken(uid: string, claims: Record<string, unknown> = {}): string {
  const nowSec = Math.floor(Date.now() / 1000)
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: uid,
    iat: nowSec - 60,
    exp: nowSec + 3_600,
    email_verified: true,
    ...claims,
  }
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.`
}

export function upgrade(path: string, headers: Record<string, string> = { Origin: ORIGIN }) {
  return exports.default.fetch(`http://worker.test${path}`, {
    headers: { Upgrade: 'websocket', ...headers },
  })
}

const waitFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A test-side WebSocket that queues what the server sends and lets a test await it. */
export class TestSocket {
  readonly messages: ServerMessage[] = []
  closeCode: number | null = null
  private cursor = 0
  /** Resolvers of the calls waiting for the next frame; woken on every message and on close. */
  private waiters: Array<() => void> = []

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      this.messages.push(JSON.parse(String(event.data)) as ServerMessage)
      this.wake()
    })
    ws.addEventListener('close', (event) => {
      this.closeCode = event.code
      this.wake()
    })
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  static async open(path: string): Promise<TestSocket> {
    const response = await upgrade(path)
    const ws = response.webSocket
    if (response.status !== 101 || ws === null) {
      throw new Error(`upgrade to ${path} failed: ${response.status}`)
    }
    ws.accept()
    return new TestSocket(ws)
  }

  /** Opens, sends `auth` and waits for `auth.ok`. */
  static async authed(path: string, uid: string): Promise<TestSocket> {
    const socket = await TestSocket.open(path)
    socket.send({ type: 'auth', token: emulatorToken(uid) })
    await socket.next('auth.ok')
    return socket
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg))
  }

  /** A frame exactly as given, for input `send` cannot produce. */
  sendRaw(text: string): void {
    this.ws.send(text)
  }

  /** The next message of `type` not yet consumed; earlier ones of other types are skipped. */
  next<T extends ServerMessage['type']>(
    type: T,
    within = 2_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.nextWhere(type, () => true, within)
  }

  /**
   * The next unconsumed message of `type` that `match` accepts; others are skipped. Woken by the
   * socket's own events and bounded by one timer, so a message that never comes fails after
   * `within` ms with what did arrive, instead of hanging until the test timeout.
   */
  async nextWhere<T extends ServerMessage['type']>(
    type: T,
    match: (msg: Extract<ServerMessage, { type: T }>) => boolean,
    within = 2_000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    let expired = false
    const timer = setTimeout(() => {
      expired = true
      this.wake()
    }, within)
    try {
      for (;;) {
        while (this.cursor < this.messages.length) {
          const msg = this.messages[this.cursor++]
          if (msg?.type !== type) continue
          const typed = msg as Extract<ServerMessage, { type: T }>
          if (match(typed)) return typed
        }
        if (expired) {
          throw new Error(`no ${type} within ${within} ms; got ${JSON.stringify(this.messages)}`)
        }
        await new Promise<void>((resolve) => this.waiters.push(resolve))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async nextError(within = 2_000) {
    return (await this.next('error', within)).code
  }

  /** Waits until the server closes the socket and returns the close code. */
  async closed(within = 2_000): Promise<number> {
    const deadline = Date.now() + within
    while (this.closeCode === null) {
      if (Date.now() >= deadline) throw new Error(`socket not closed within ${within} ms`)
      await waitFor(10)
    }
    return this.closeCode
  }

  close(): void {
    this.ws.close(1000)
  }
}

export const validForm = { name: 'Friday round', durationMin: 5, speed: 1, profitTarget: 20_000 } as const

/** Creates a room through the lobby socket and returns its id. */
export async function createRoom(lobby: TestSocket): Promise<string> {
  lobby.send({ type: 'room.create', form: validForm })
  return (await lobby.next('room.created')).roomId
}
