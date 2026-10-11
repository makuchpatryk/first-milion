import { PASSWORD_MIN_LENGTH } from '@fm/shared/rules'
import { randomNick, isValidNick } from '@fm/shared/validation'
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth'
import { authErrorKeyOf, UNKNOWN_AUTH_ERROR_KEY } from './errors'
import { auth } from './firebase'
import { setSessionFromUser } from './session'

/** Actions report failures as i18n keys; views render them, nothing throws into templates. */
export type ActionResult = { ok: true } | { ok: false; errorKey: string }

const OK: ActionResult = { ok: true }

const fail = (errorKey: string): ActionResult => ({ ok: false, errorKey })

async function attempt(run: () => Promise<void>): Promise<ActionResult> {
  try {
    await run()
    return OK
  } catch (error) {
    return fail(authErrorKeyOf(error))
  }
}

async function assignNick(user: User): Promise<void> {
  if (user.emailVerified !== true) return
  if (typeof user.displayName === 'string' && user.displayName !== '') return
  await updateProfile(user, { displayName: randomNick(Math.random) })
}

const nickInFlight = new WeakMap<User, Promise<void>>()

/**
 * BP-001 step 4: a verified account without a nickname gets `Trader-NNNN`. Login reaches this
 * from both the auth listener and `publish`; sharing the running call keeps it to one random nick.
 */
export function ensureNick(user: User): Promise<void> {
  const running = nickInFlight.get(user)
  if (running) return running
  const run = assignNick(user).finally(() => nickInFlight.delete(user))
  nickInFlight.set(user, run)
  return run
}

/** Nickname first, then publish, so the first verified frame already shows it. */
async function publish(user: User): Promise<void> {
  await ensureNick(user)
  setSessionFromUser(user)
}

export function register(email: string, password: string): Promise<ActionResult> {
  // BR-002: checked before any network call.
  if (password.length < PASSWORD_MIN_LENGTH) {
    return Promise.resolve(fail('auth.error.passwordTooShort'))
  }
  return attempt(async () => {
    const { user } = await createUserWithEmailAndPassword(auth, email, password)
    await sendEmailVerification(user)
    await publish(user)
  })
}

export function login(email: string, password: string): Promise<ActionResult> {
  return attempt(async () => {
    const { user } = await signInWithEmailAndPassword(auth, email, password)
    await publish(user)
  })
}

export function logout(): Promise<ActionResult> {
  return attempt(async () => {
    await signOut(auth)
    setSessionFromUser(null)
  })
}

export function resendVerification(): Promise<ActionResult> {
  const user = auth.currentUser
  if (user === null) return Promise.resolve(fail(UNKNOWN_AUTH_ERROR_KEY))
  return attempt(() => sendEmailVerification(user))
}

/** "I've verified": reload the user, since the SDK does not push `emailVerified` by itself. */
export function checkVerified(): Promise<ActionResult> {
  const user = auth.currentUser
  if (user === null) return Promise.resolve(fail(UNKNOWN_AUTH_ERROR_KEY))
  return attempt(async () => {
    await user.reload()
    await publish(user)
  })
}

export function sendReset(email: string): Promise<ActionResult> {
  return attempt(() => sendPasswordResetEmail(auth, email))
}

export function changeNick(nick: string): Promise<ActionResult> {
  // FR-002: validated before any network call.
  if (!isValidNick(nick)) return Promise.resolve(fail('account.error.nickInvalid'))
  const user = auth.currentUser
  if (user === null) return Promise.resolve(fail(UNKNOWN_AUTH_ERROR_KEY))
  return attempt(async () => {
    await updateProfile(user, { displayName: nick })
    setSessionFromUser(user)
  })
}

/** FR-018: re-authenticate with the password, then delete; the listener logs the user out. */
export function deleteAccount(password: string): Promise<ActionResult> {
  const user = auth.currentUser
  if (user === null || typeof user.email !== 'string') {
    return Promise.resolve(fail(UNKNOWN_AUTH_ERROR_KEY))
  }
  const email = user.email
  return attempt(async () => {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password))
    await deleteUser(user)
    setSessionFromUser(null)
  })
}
