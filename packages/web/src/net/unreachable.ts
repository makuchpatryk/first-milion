import type { SocketHandle, SocketStatus } from './ws-client'

/** RFC 6455 "abnormal closure": the code a socket that never opens is reported with, so the network text shows. */
export const NO_CONNECTION = 1006

/**
 * The handle of a socket that cannot open (no `VITE_WORKER_URL`). It reports a network loss at
 * once, so the screen shows a notice instead of throwing during setup. Sends are dropped, as they
 * are on any socket that is not ready.
 */
export function unreachableSocket(handlers: {
  onStatus(status: SocketStatus, closeCode?: number): void
}): SocketHandle {
  handlers.onStatus('closed', NO_CONNECTION)
  return {
    send: () => undefined,
    close: () => undefined,
    refreshToken: () => undefined,
  }
}
