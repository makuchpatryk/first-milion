import type { SessionStatus } from '../auth/session'
import { routeFor } from './guards'

export interface BackTarget {
  to: string
  /** i18n key of the link text. */
  labelKey: string
}

/**
 * The screen one step up from `path`, or `null` on a top-level screen (`/menu`, `/login`,
 * `/verify`). The public `/privacy` page goes back to the visitor's home for their status.
 */
export function backFor(path: string, status: SessionStatus): BackTarget | null {
  if (path === '/rooms' || path === '/single' || path === '/settings') {
    return { to: '/menu', labelKey: 'nav.backToMenu' }
  }
  if (path.startsWith('/rooms/') && path.length > 7) {
    return { to: '/rooms', labelKey: 'nav.backToRooms' }
  }
  if (path === '/privacy') {
    return { to: routeFor(status, '/menu') ?? '/menu', labelKey: 'nav.back' }
  }
  return null
}
