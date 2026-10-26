import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchIsAdmin: vi.fn<(baseUrl: string, token: string) => Promise<boolean>>(),
}))

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn(), onIdTokenChanged: vi.fn() }))
vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: () => Promise.resolve('tok') } },
}))
vi.mock('../net/me', () => ({ fetchIsAdmin: mocks.fetchIsAdmin }))

import { isAdmin, setAdmin } from './admin'
import { syncAdmin } from './admin-sync'
import { session } from './session'

const signIn = () => {
  session.status = 'verified'
  session.user = { uid: 'u1', nick: 'Ala', email: 'ala@example.com' }
}

beforeEach(() => {
  setAdmin(false)
  mocks.fetchIsAdmin.mockReset()
  vi.stubEnv('VITE_WORKER_URL', 'http://w.test')
  signIn()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('syncAdmin (BR-017)', () => {
  it('sets the admin flag from the Worker answer', async () => {
    mocks.fetchIsAdmin.mockResolvedValue(true)

    await syncAdmin()

    expect(mocks.fetchIsAdmin).toHaveBeenCalledWith('http://w.test', 'tok')
    expect(isAdmin.value).toBe(true)
  })

  it('does nothing without a Worker URL or a user', async () => {
    vi.stubEnv('VITE_WORKER_URL', '')
    await syncAdmin()
    vi.stubEnv('VITE_WORKER_URL', 'http://w.test')
    session.user = null
    await syncAdmin()

    expect(mocks.fetchIsAdmin).not.toHaveBeenCalled()
  })

  it('keeps the flag when the Worker cannot be reached', async () => {
    setAdmin(true)
    mocks.fetchIsAdmin.mockRejectedValue(new Error('offline'))

    await syncAdmin()

    expect(isAdmin.value).toBe(true)
  })

  it('ignores an answer that arrives after sign-out', async () => {
    mocks.fetchIsAdmin.mockImplementation(() => {
      session.status = 'out'
      session.user = null
      return Promise.resolve(true)
    })

    await syncAdmin()

    expect(isAdmin.value).toBe(false)
  })
})
