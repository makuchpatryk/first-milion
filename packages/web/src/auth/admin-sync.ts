import { fetchIsAdmin } from '../net/me'
import { setAdmin } from './admin'
import { getIdToken, session } from './session'

/**
 * Learns the admin flag from the Worker without a game socket, so admin-only chrome (the version
 * footer) shows on every page and after a reload. A failure leaves the flag as it is: the game
 * sockets still set it on `auth.ok`.
 */
export async function syncAdmin(): Promise<void> {
  const baseUrl = import.meta.env.VITE_WORKER_URL
  const uid = session.user?.uid
  if (!baseUrl || uid === undefined) return
  try {
    const admin = await fetchIsAdmin(baseUrl, await getIdToken(false))
    if (session.user?.uid === uid) setAdmin(admin) // not if the user signed out meanwhile
  } catch {
    // Offline or Worker down: nothing to show yet.
  }
}
