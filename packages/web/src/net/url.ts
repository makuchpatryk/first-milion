const SCHEME: Readonly<Record<string, string>> = {
  'http:': 'ws:',
  'https:': 'wss:',
  'ws:': 'ws:',
  'wss:': 'wss:',
}

/**
 * Worker WebSocket URL for `path` under `base` (`VITE_WORKER_URL`). The token is never part of
 * it: it travels in the first `auth` message (NFR-004, FR-007), so the URL has no query string.
 */
export function socketUrl(base: string, path: string): string {
  const url = new URL(path, base)
  const scheme = SCHEME[url.protocol]
  if (scheme === undefined) throw new Error(`unsupported worker URL scheme: ${url.protocol}`)
  url.protocol = scheme
  url.search = ''
  url.hash = ''
  return url.toString()
}

export const lobbyPath = (): string => '/ws/lobby'

export const roomPath = (roomId: string): string => `/ws/room/${encodeURIComponent(roomId)}`
