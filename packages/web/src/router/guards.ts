import type { SessionStatus } from '../auth/session'

/** Reachable by a logged-in, verified user. */
const VERIFIED_PATHS: readonly string[] = ['/menu', '/single']

/**
 * Where a visitor in `status` must go from `path`, or `null` when `path` is allowed.
 * Logged out reach only `/login`; unverified only `/verify` (BR-001, BR-002, FR-001). `/privacy`
 * is public (FR-018). A verified user is sent away from `/login` and `/verify` to `/menu`
 * (FR-006). Unknown paths fall to the status' home screen.
 */
export function routeFor(status: SessionStatus, path: string): string | null {
  if (path === '/privacy') return null
  switch (status) {
    case 'loading':
      // The router guard waits for `session.ready`; this status never reaches a decision.
      return null
    case 'out':
      return path === '/login' ? null : '/login'
    case 'unverified':
      return path === '/verify' ? null : '/verify'
    case 'verified':
      return VERIFIED_PATHS.includes(path) ? null : '/menu'
  }
}
