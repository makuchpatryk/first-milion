import type { SessionStatus } from '../auth/session'

/** Reachable by a logged-in, verified user. */
const VERIFIED_PATHS: readonly string[] = ['/menu', '/single', '/rooms', '/settings']

/** `/rooms/new` and `/rooms/:id`: screens that create or enter a room. */
const isRoomScreen = (path: string): boolean => path.startsWith('/rooms/') && path.length > 7

/**
 * Where a visitor in `status` must go from `path`, or `null` when `path` is allowed.
 * Logged out reach only `/login`; unverified only `/verify` (BR-001, BR-002, FR-001). `/privacy`
 * is public (FR-018). A verified user is sent away from `/login` and `/verify` to `/menu`
 * (FR-006), and into a room or the create form only with a valid nickname (BR-016); the list at
 * `/rooms` explains what is wrong. Unknown paths fall to the status' home screen.
 */
export function routeFor(status: SessionStatus, path: string, nickValid = true): string | null {
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
      if (isRoomScreen(path)) return nickValid ? null : '/rooms'
      return VERIFIED_PATHS.includes(path) ? null : '/menu'
  }
}
