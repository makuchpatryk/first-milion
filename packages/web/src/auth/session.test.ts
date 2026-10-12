import { describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  tokenListeners: [] as Array<() => void>,
  currentUser: null as { getIdToken: (force: boolean) => Promise<string> } | null,
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  onIdTokenChanged: (_auth: unknown, listener: () => void) => {
    sdk.tokenListeners.push(listener)
  },
}))
vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return sdk.currentUser
    },
  },
}))

import { withTokenRefresh } from '../net/token-refresh'
import type { SocketHandle } from '../net/ws-client'
import { getIdToken, init } from './session'

function fakeHandle(): SocketHandle & { refreshes: number } {
  const handle = {
    refreshes: 0,
    send: () => undefined,
    close: () => undefined,
    refreshToken() {
      handle.refreshes += 1
    },
  }
  return handle
}

describe('session token glue (FR-007 edge)', () => {
  it('a token change refreshes every open socket exactly once', () => {
    init(() => Promise.resolve())
    const first = fakeHandle()
    const second = fakeHandle()
    const closed = fakeHandle()
    withTokenRefresh(first)
    withTokenRefresh(second)
    withTokenRefresh(closed).close()

    for (const listener of sdk.tokenListeners) listener()

    expect([first.refreshes, second.refreshes, closed.refreshes]).toEqual([1, 1, 0])
  })

  it('getIdToken asks the SDK, forcing a refresh when told to', async () => {
    const getToken = vi.fn((force: boolean) => Promise.resolve(force ? 'fresh' : 'cached'))
    sdk.currentUser = { getIdToken: getToken }
    await expect(getIdToken(false)).resolves.toBe('cached')
    await expect(getIdToken(true)).resolves.toBe('fresh')
    expect(getToken.mock.calls).toEqual([[false], [true]])
  })

  it('getIdToken fails when nobody is signed in', async () => {
    sdk.currentUser = null
    await expect(getIdToken(false)).rejects.toThrow()
  })
})
