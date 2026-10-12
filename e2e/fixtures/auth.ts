import type { Page } from '@playwright/test'
import { ADMIN_UID, AUTH_EMULATOR_URL, FIREBASE_PROJECT_ID } from '../env'

// Accounts live in the Firebase Auth emulator only (PRD §20 #35): no real Google account, no
// email, no quota. The project-scoped admin endpoints (`Bearer owner`) can create a verified
// user with a chosen nickname in one call, which the public sign-up API cannot.

const ADMIN_ACCOUNTS = `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}`
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

export const PASSWORD = 'e2e-password-1'

export interface Account {
  readonly uid: string
  readonly email: string
  readonly password: string
  /** The nickname the game shows (`displayName`); valid per BR-016. */
  readonly nick: string
}

export interface AccountOptions {
  /** Leading part of the nickname; a random suffix keeps it unique within one emulator run. */
  prefix?: string
  /** `false` leaves the email unverified (FR-001: the verify screen). Default `true`. */
  verified?: boolean
}

async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${ADMIN_ACCOUNTS}${path}`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Auth emulator ${path} failed: ${response.status} ${text}`)
  return JSON.parse(text) as unknown
}

function localIdOf(created: unknown): string {
  const id =
    typeof created === 'object' && created !== null
      ? (created as { localId?: unknown }).localId
      : null
  if (typeof id !== 'string') throw new Error('Auth emulator returned no localId')
  return id
}

/** A short random suffix; nicknames allow 16 characters (BR-016), so prefixes stay under 11. */
function suffix(): string {
  return Math.random().toString(36).slice(2, 7)
}

/** Creates an emulator account with a known nickname (and verified email unless told otherwise). */
export async function createAccount(options: AccountOptions = {}): Promise<Account> {
  const nick = `${options.prefix ?? 'p'}-${suffix()}`
  const email = `${nick.toLowerCase()}@example.test`
  const created = await post('/accounts', {
    email,
    password: PASSWORD,
    displayName: nick,
    emailVerified: options.verified ?? true,
  })
  return { uid: localIdOf(created), email, password: PASSWORD, nick }
}

/**
 * The account whose UID the e2e Worker treats as admin (BR-017, `ADMIN_UIDS` in the config). Any
 * earlier copy is deleted first, since the UID is fixed and a re-run would collide with it.
 */
export async function createAdminAccount(): Promise<Account> {
  const email = 'e2e-admin@example.test'
  const nick = 'E2eAdmin'
  await post('/accounts:delete', { localId: ADMIN_UID }).catch(() => undefined)
  await post('/accounts', {
    localId: ADMIN_UID,
    email,
    password: PASSWORD,
    displayName: nick,
    emailVerified: true,
  })
  return { uid: ADMIN_UID, email, password: PASSWORD, nick }
}

/** Fills the login form like a user would (FR-001) and waits until the app leaves `/login`. */
export async function signIn(
  page: Page,
  account: Pick<Account, 'email' | 'password'>,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByTestId('auth-submit').click()
  await page.waitForURL((url) => url.pathname !== '/login')
}
