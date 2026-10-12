import { getIdToken } from '../auth/session'
import type { SocketDeps } from '../net/lobby-socket'

/** Whether a worker is configured; without one no game socket can open. */
export function hasWorkerUrl(): boolean {
  return Boolean(import.meta.env.VITE_WORKER_URL)
}

/** Real worker URL, Firebase token and timers for a game socket; tests pass their own. */
export function runtimeSocketDeps(): Pick<
  SocketDeps,
  'baseUrl' | 'getToken' | 'schedule' | 'cancel'
> {
  return {
    baseUrl: import.meta.env.VITE_WORKER_URL,
    getToken: getIdToken,
    // `window` timers always return a number in the DOM typings, so `cancel` narrows, not casts.
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => {
      if (typeof handle === 'number') window.clearTimeout(handle)
    },
  }
}
