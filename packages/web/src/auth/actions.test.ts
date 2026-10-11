import type { User } from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  deleteUser: vi.fn(),
  credential: vi.fn(),
  onAuthStateChanged: vi.fn(),
}))

const firebaseAuth = vi.hoisted((): { currentUser: unknown } => ({ currentUser: null }))

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: sdk.createUserWithEmailAndPassword,
  signInWithEmailAndPassword: sdk.signInWithEmailAndPassword,
  signOut: sdk.signOut,
  sendEmailVerification: sdk.sendEmailVerification,
  sendPasswordResetEmail: sdk.sendPasswordResetEmail,
  updateProfile: sdk.updateProfile,
  reauthenticateWithCredential: sdk.reauthenticateWithCredential,
  deleteUser: sdk.deleteUser,
  onAuthStateChanged: sdk.onAuthStateChanged,
  EmailAuthProvider: { credential: sdk.credential },
}))
vi.mock('./firebase', () => ({ auth: firebaseAuth }))

import {
  changeNick,
  checkVerified,
  deleteAccount,
  ensureNick,
  login,
  logout,
  register,
} from './actions'
import { session } from './session'

function fakeUser(overrides: Partial<Record<string, unknown>> = {}): User {
  const user = {
    uid: 'u1',
    email: 'a@b.co',
    displayName: '',
    emailVerified: true,
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  return user as unknown as User
}

beforeEach(() => {
  vi.clearAllMocks()
  firebaseAuth.currentUser = null
  session.status = 'loading'
  session.user = null
})

describe('ensureNick', () => {
  it('BP-001 / FR-002: a verified account with no displayName gets Trader-NNNN', async () => {
    const user = fakeUser({ displayName: '' })
    await ensureNick(user)
    expect(sdk.updateProfile).toHaveBeenCalledTimes(1)
    const [, profile] = sdk.updateProfile.mock.calls[0] as [User, { displayName: string }]
    expect(profile.displayName).toMatch(/^Trader-\d{4}$/)
  })

  it('BP-001: two concurrent calls for one user write a single nickname', async () => {
    const user = fakeUser({ displayName: '' })
    sdk.updateProfile.mockImplementation(
      (u: { displayName: string }, p: { displayName: string }) => {
        u.displayName = p.displayName
        return Promise.resolve()
      },
    )
    await Promise.all([ensureNick(user), ensureNick(user)])
    expect(sdk.updateProfile).toHaveBeenCalledTimes(1)
  })

  it('BP-001: a failed assignment is retried by the next call', async () => {
    const user = fakeUser({ displayName: '' })
    sdk.updateProfile.mockRejectedValueOnce({ code: 'auth/network-request-failed' })
    await expect(ensureNick(user)).rejects.toBeDefined()
    sdk.updateProfile.mockResolvedValueOnce(undefined)
    await ensureNick(user)
    expect(sdk.updateProfile).toHaveBeenCalledTimes(2)
  })

  it('BP-001: an existing nickname is never overwritten', async () => {
    await ensureNick(fakeUser({ displayName: 'Jan_7' }))
    expect(sdk.updateProfile).not.toHaveBeenCalled()
  })

  it('BP-001: an unverified account gets no nickname yet', async () => {
    await ensureNick(fakeUser({ emailVerified: false }))
    expect(sdk.updateProfile).not.toHaveBeenCalled()
  })
})

describe('changeNick', () => {
  it('FR-002 AC: "ab" is rejected with a validation key and no SDK call', async () => {
    firebaseAuth.currentUser = fakeUser()
    const result = await changeNick('ab')
    expect(result).toEqual({ ok: false, errorKey: 'account.error.nickInvalid' })
    expect(sdk.updateProfile).not.toHaveBeenCalled()
  })

  it('FR-002: a valid nickname is saved to displayName and shown in the session', async () => {
    const user = fakeUser({ displayName: 'Trader-0001' })
    firebaseAuth.currentUser = user
    sdk.updateProfile.mockImplementation(
      (u: { displayName: string }, p: { displayName: string }) => {
        u.displayName = p.displayName
        return Promise.resolve()
      },
    )
    const result = await changeNick('Jan_7')
    expect(result.ok).toBe(true)
    expect(session.user?.nick).toBe('Jan_7')
  })
})

describe('register', () => {
  it('FR-001 AC: a 7-character password is rejected before the SDK is called', async () => {
    const result = await register('a@b.co', '1234567')
    expect(result).toEqual({ ok: false, errorKey: 'auth.error.passwordTooShort' })
    expect(sdk.createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('BP-001: an 8-character password creates the account and sends the verification email', async () => {
    const user = fakeUser({ emailVerified: false })
    sdk.createUserWithEmailAndPassword.mockResolvedValue({ user })
    const result = await register('a@b.co', '12345678')
    expect(result.ok).toBe(true)
    expect(sdk.sendEmailVerification).toHaveBeenCalledWith(user)
    expect(session.status).toBe('unverified')
  })

  it('FR-001: an SDK failure becomes an i18n key matched by code', async () => {
    sdk.createUserWithEmailAndPassword.mockRejectedValue({ code: 'auth/email-already-in-use' })
    const result = await register('a@b.co', '12345678')
    expect(result).toEqual({ ok: false, errorKey: 'auth.error.emailInUse' })
  })
})

describe('login, verification and logout', () => {
  it('BP-001: logging in as a verified user assigns a nickname before the session is published', async () => {
    const user = fakeUser({ displayName: '' })
    sdk.signInWithEmailAndPassword.mockResolvedValue({ user })
    sdk.updateProfile.mockImplementation(
      (u: { displayName: string }, p: { displayName: string }) => {
        u.displayName = p.displayName
        return Promise.resolve()
      },
    )
    await login('a@b.co', 'secret-pass')
    expect(session.status).toBe('verified')
    expect(session.user?.nick).toMatch(/^Trader-\d{4}$/)
  })

  it('FR-001: checkVerified reloads the user, then moves unverified -> verified', async () => {
    const user = fakeUser({ displayName: 'Jan_7', emailVerified: false })
    firebaseAuth.currentUser = user
    ;(user as unknown as { reload: () => Promise<void> }).reload = vi.fn(() => {
      ;(user as unknown as { emailVerified: boolean }).emailVerified = true
      return Promise.resolve()
    })
    await checkVerified()
    expect(session.status).toBe('verified')
  })

  it('FR-001: logout clears the session', async () => {
    session.status = 'verified'
    session.user = { uid: 'u1', nick: 'Jan_7', email: 'a@b.co' }
    await logout()
    expect(session.status).toBe('out')
    expect(session.user).toBeNull()
  })
})

describe('deleteAccount', () => {
  it('FR-018 AC: re-authenticates with the password before deleting the account', async () => {
    const user = fakeUser()
    firebaseAuth.currentUser = user
    sdk.credential.mockReturnValue('cred')
    const result = await deleteAccount('secret-pass')
    expect(result.ok).toBe(true)
    expect(sdk.credential).toHaveBeenCalledWith('a@b.co', 'secret-pass')
    expect(sdk.reauthenticateWithCredential).toHaveBeenCalledWith(user, 'cred')
    const reauthOrder = sdk.reauthenticateWithCredential.mock.invocationCallOrder[0] ?? Infinity
    const deleteOrder = sdk.deleteUser.mock.invocationCallOrder[0] ?? -Infinity
    expect(reauthOrder).toBeLessThan(deleteOrder)
    expect(session.status).toBe('out')
  })

  it('FR-018: a wrong password reports its key and deletes nothing', async () => {
    firebaseAuth.currentUser = fakeUser()
    sdk.reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    const result = await deleteAccount('nope')
    expect(result).toEqual({ ok: false, errorKey: 'auth.error.wrongPassword' })
    expect(sdk.deleteUser).not.toHaveBeenCalled()
  })
})
