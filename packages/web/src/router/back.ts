import type { SessionStatus } from '../auth/session'
import { routeFor } from './guards'

export interface BackTarget {
  to: string
  /** i18n key of the link text. */
  labelKey: string
}

/**
 * The screen one step up from `path`, or `null` on a top-level screen (`/`, `/login`,
 * `/verify`). The public `/privacy` page goes back to the visitor's home for their status.
 */
export function backFor(path: string, status: SessionStatus): BackTarget | null {
  if (path === '/rooms') {
    return { to: '/', labelKey: 'nav.backToMenu' }
  }
  if (path === '/privacy') {
    return { to: routeFor(status, '/') ?? '/', labelKey: 'nav.back' }
  }
  return null
}
