import type { BrowserContext, Page, WebSocketRoute } from '@playwright/test'
import { serverMessageSchema, type ClientMessage, type ServerMessage } from '@fm/shared/protocol'

// The game sockets are observed inside the page, with the page's own clock, so a latency number
// has no Playwright or CDP overhead in it (NFR-001). The tap wraps `window.WebSocket`, records
// every text frame of the game sockets (`/ws/...`; Vite's HMR socket is left alone) and keeps the
// sockets so a spec can send on them or cut them.

export interface TapFrame {
  readonly dir: 'in' | 'out'
  /** `performance.now()` of the page when the frame was sent or received. */
  readonly t: number
  readonly data: string
}

interface TappedSocket {
  readonly url: string
  readonly ws: WebSocket
}

interface Tap {
  readonly frames: TapFrame[]
  readonly sockets: TappedSocket[]
}

declare global {
  interface Window {
    __fm?: Tap
  }
}

/** Runs in the page before any app script. Self-contained: Playwright serialises its source. */
function installWsTap(): void {
  const NativeWebSocket = window.WebSocket
  const frames: TapFrame[] = []
  const sockets: TappedSocket[] = []
  const tracked = new WeakSet<WebSocket>()

  class TappedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      if (!String(url).includes('/ws/')) return
      tracked.add(this)
      sockets.push({ url: String(url), ws: this })
      this.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (typeof event.data === 'string') {
          frames.push({ dir: 'in', t: performance.now(), data: event.data })
        }
      })
    }

    override send(data: Parameters<WebSocket['send']>[0]): void {
      if (typeof data === 'string' && tracked.has(this)) {
        frames.push({ dir: 'out', t: performance.now(), data })
      }
      super.send(data)
    }
  }

  window.WebSocket = TappedWebSocket
  window.__fm = { frames, sockets }
}

/** Installs the tap in every page of `context`; call before the first navigation. */
export async function installTap(context: BrowserContext): Promise<void> {
  await context.addInitScript(installWsTap)
}

export async function rawFrames(page: Page): Promise<TapFrame[]> {
  return page.evaluate(() => window.__fm?.frames.slice() ?? [])
}

export interface ServerFrame {
  readonly t: number
  readonly msg: ServerMessage
}

export interface ClientFrame {
  readonly t: number
  readonly msg: { readonly type: string }
}

/** Every server message the page received, parsed with the shared schema (drift fails loudly). */
export async function serverFrames(page: Page): Promise<ServerFrame[]> {
  const frames = await rawFrames(page)
  return frames
    .filter((frame) => frame.dir === 'in')
    .map((frame) => ({ t: frame.t, msg: serverMessageSchema.parse(JSON.parse(frame.data)) }))
}

/** Every message the page sent after `auth`, with its type; `auth` is left out (it holds the token). */
export async function clientFrames(page: Page): Promise<ClientFrame[]> {
  const frames = await rawFrames(page)
  return frames
    .filter((frame) => frame.dir === 'out')
    .map((frame) => ({ t: frame.t, msg: JSON.parse(frame.data) as { type: string } }))
    .filter((frame) => frame.msg.type !== 'auth')
}

/** Sends messages back to back, in one task, on the page's room socket (the burst of FR-012). */
export async function sendOnRoomSocket(
  page: Page,
  messages: readonly ClientMessage[],
): Promise<void> {
  await page.evaluate((batch) => {
    const entry = window.__fm?.sockets.filter((s) => s.url.includes('/ws/room/')).at(-1)
    if (entry === undefined || entry.ws.readyState !== WebSocket.OPEN) {
      throw new Error('no open room socket')
    }
    for (const msg of batch) entry.ws.send(JSON.stringify(msg))
  }, messages)
}

/** Closes the page's room socket from the client side; the app then starts its reconnect loop. */
export async function dropRoomSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const entry = window.__fm?.sockets.filter((s) => s.url.includes('/ws/room/')).at(-1)
    entry?.ws.close()
  })
}

/** A switch on the page's room socket: while cut, the connection is down and every retry fails. */
export interface RoomSocketGate {
  /** Drops the live connection (the server sees a close) and refuses new ones. */
  cut(): void
  /** Lets the client's own reconnect loop connect again. */
  restore(): void
  /**
   * Every message the server sent through the gate, parsed. The gate replaces the page's
   * `WebSocket`, so the in-page tap does not see this page's room frames.
   */
  serverMessages(): ServerMessage[]
}

/**
 * Proxies the page's room sockets through Playwright so a spec can make a real network outage
 * (FR-015): the server only starts its 30 s grace when the connection really closes. The page is
 * reloaded so the proxy is in place before the app opens a socket; the session survives a reload.
 */
export async function gateRoomSocket(page: Page): Promise<RoomSocketGate> {
  let cut = false
  const live: Array<{ page: WebSocketRoute; server: WebSocketRoute }> = []
  const received: ServerMessage[] = []
  await page.routeWebSocket(/\/ws\/room\//, (ws) => {
    if (cut) {
      void ws.close({ code: 1001 })
      return
    }
    const server = ws.connectToServer()
    server.onMessage((message) => {
      if (typeof message === 'string') {
        received.push(serverMessageSchema.parse(JSON.parse(message)))
      }
      ws.send(message)
    })
    live.push({ page: ws, server })
  })
  await page.reload()
  return {
    serverMessages: () => received.slice(),
    cut() {
      cut = true
      for (const { page: ws, server } of live.splice(0)) {
        void server.close({ code: 1000 })
        void ws.close({ code: 1001 })
      }
    },
    restore() {
      cut = false
    },
  }
}

/** How many room sockets the page has opened; more than one means it reconnected (FR-015). */
export async function roomSocketCount(page: Page): Promise<number> {
  return page.evaluate(
    () => window.__fm?.sockets.filter((s) => s.url.includes('/ws/room/')).length ?? 0,
  )
}

export interface RoundTrip {
  readonly ms: number
  readonly reply: 'order.ok' | 'error'
}

/**
 * Pairs each `order` / `close` the page sent with the next answer (`order.ok` or `error`). The
 * server answers in order, so a queue is enough; ticks and other messages are skipped.
 */
export async function orderRoundTrips(page: Page): Promise<RoundTrip[]> {
  const frames = await rawFrames(page)
  const pending: number[] = []
  const trips: RoundTrip[] = []
  for (const frame of frames) {
    const { type } = JSON.parse(frame.data) as { type?: string }
    if (frame.dir === 'out') {
      if (type === 'order' || type === 'close') pending.push(frame.t)
    } else if (type === 'order.ok' || type === 'error') {
      const sent = pending.shift()
      if (sent !== undefined) trips.push({ ms: frame.t - sent, reply: type })
    }
  }
  return trips
}
