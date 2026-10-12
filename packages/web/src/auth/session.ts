import { onAuthStateChanged, onIdTokenChanged, type User } from 'firebase/auth'
import { reactive } from 'vue'
import { notifyTokenChanged } from '../net/token-refresh'
import { auth } from './firebase'

export type SessionStatus = 'loading' | 'out' | 'unverified' | 'verified'

export interface SessionUser {
  readonly uid: string
  readonly nick: string
  readonly email: string
}

interface Session {
  status: SessionStatus
  user: SessionUser | null
}

export const session = reactive<Session>({ status: 'loading', user: null })

let markReady: () => void = () => undefined
/** Resolves on the first auth event, so the router never guards against `loading` (FR-001). */
export const ready = new Promise<void>((resolve) => {
  markReady = resolve
})

/**
 * The current user's ID token for the socket `auth` message (FR-007). The SDK refreshes an
 * expired token by itself; `forceRefresh` is for a 4401 close.
 */
export async function getIdToken(forceRefresh: boolean): Promise<string> {
  const user = auth.currentUser
  if (user === null) throw new Error('not signed in')
  return user.getIdToken(forceRefresh)
}

/** SDK values are narrowed with `typeof` at the boundary instead of trusting their types. */
function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    nick: typeof user.displayName === 'string' ? user.displayName : '',
    email: typeof user.email === 'string' ? user.email : '',
  }
}

/** Single place that turns an SDK user into session state (BP-001: out -> unverified -> verified). */
export function setSessionFromUser(user: User | null): void {
  if (user === null) {
    session.status = 'out'
    session.user = null
    return
  }
  session.status = user.emailVerified === true ? 'verified' : 'unverified'
  session.user = toSessionUser(user)
}

/**
 * Starts listening to the Firebase session. `onVerified` runs before a verified user is
 * published, so the first frame already has the nickname (BP-001 step 4).
 */
export function init(onVerified: (user: User) => Promise<void>): void {
  onAuthStateChanged(auth, (user) => {
    void settle(user, onVerified)
  })
  // A new ID token re-authenticates the open game sockets without a reconnect (FR-007 edge).
  onIdTokenChanged(auth, () => notifyTokenChanged())
}

async function settle(user: User | null, onVerified: (user: User) => Promise<void>): Promise<void> {
  try {
    if (user?.emailVerified === true) await onVerified(user)
  } catch {
    // Nickname assignment is retried on the next load; the user still enters the menu.
  }
  setSessionFromUser(user)
  markReady()
}
