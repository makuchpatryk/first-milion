// Firebase error `code` -> i18n key. Matched on the code only, never on message text (CODE_QUALITY).
// `user-not-found` shares the generic credential message so the form does not reveal which
// addresses have an account.
const AUTH_ERROR_KEYS: Readonly<Record<string, string>> = {
  'auth/invalid-email': 'auth.error.invalidEmail',
  'auth/email-already-in-use': 'auth.error.emailInUse',
  'auth/weak-password': 'auth.error.weakPassword',
  'auth/invalid-credential': 'auth.error.invalidCredential',
  'auth/wrong-password': 'auth.error.wrongPassword',
  'auth/user-not-found': 'auth.error.invalidCredential',
  'auth/too-many-requests': 'auth.error.tooManyRequests',
  'auth/network-request-failed': 'auth.error.network',
  'auth/requires-recent-login': 'auth.error.requiresRecentLogin',
}

export const UNKNOWN_AUTH_ERROR_KEY = 'auth.error.unknown'

export const AUTH_ERROR_CODES = Object.keys(AUTH_ERROR_KEYS)

export function authErrorKey(code: unknown): string {
  if (typeof code !== 'string') return UNKNOWN_AUTH_ERROR_KEY
  return AUTH_ERROR_KEYS[code] ?? UNKNOWN_AUTH_ERROR_KEY
}

/** Key for a caught value; the SDK throws objects with a string `code`, anything else is unknown. */
export function authErrorKeyOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return authErrorKey(error.code)
  }
  return UNKNOWN_AUTH_ERROR_KEY
}
