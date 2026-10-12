import type { SocketHandle } from './ws-client'

const listeners = new Set<() => void>()

/** Called by `auth/session.ts` when Firebase issues a new ID token (FR-007 edge). */
export function notifyTokenChanged(): void {
  for (const refresh of listeners) refresh()
}

/**
 * Keeps `handle` re-authenticated on every token change until it is closed, so a long round
 * survives token expiry without a reconnect (spec 05 risks).
 */
export function withTokenRefresh(handle: SocketHandle): SocketHandle {
  const refresh = () => handle.refreshToken()
  listeners.add(refresh)
  return {
    ...handle,
    close() {
      listeners.delete(refresh)
      handle.close()
    },
  }
}
