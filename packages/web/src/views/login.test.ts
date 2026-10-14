// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import type { User } from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  ...sdk,
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(),
  deleteUser: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

import pl from '../i18n/pl.json'
import { session } from '../auth/session'
import { buttonByText, mountWithApp } from '../test-support'
import LoginView from './LoginView.vue'

beforeEach(() => {
  vi.clearAllMocks()
  session.status = 'out'
  session.user = null
})

async function fill(wrapper: Awaited<ReturnType<typeof mountWithApp>>['wrapper'], pw: string) {
  await wrapper.find('#email').setValue('a@b.co')
  await wrapper.find('#password').setValue(pw)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('LoginView', () => {
  it('FR-001 AC: registering with a 7-character password shows the validation error', async () => {
    const { wrapper } = await mountWithApp(LoginView)
    await buttonByText(wrapper, pl.auth.register).trigger('click')
    await fill(wrapper, '1234567')

    expect(wrapper.find('[role="alert"]').text()).toBe(pl.auth.error.passwordTooShort)
    expect(sdk.createUserWithEmailAndPassword).not.toHaveBeenCalled()
  })

  it('UF-001: the mode toggle marks exactly one mode as pressed', async () => {
    const { wrapper } = await mountWithApp(LoginView)
    const login = buttonByText(wrapper, pl.auth.login)
    const register = buttonByText(wrapper, pl.auth.register)
    expect(login.attributes('aria-pressed')).toBe('true')
    expect(register.attributes('aria-pressed')).toBe('false')

    await register.trigger('click')
    expect(login.attributes('aria-pressed')).toBe('false')
    expect(register.attributes('aria-pressed')).toBe('true')
  })

  it('UF-001: wrong credentials show the translated error from the SDK code', async () => {
    sdk.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/invalid-credential' })
    const { wrapper, router } = await mountWithApp(LoginView, 'pl', '/login')
    await fill(wrapper, 'secret-pass')

    expect(wrapper.find('[role="alert"]').text()).toBe(pl.auth.error.invalidCredential)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('UF-001: a successful login leaves for the home screen', async () => {
    const user = { uid: 'u1', email: 'a@b.co', displayName: 'Jan_7', emailVerified: true }
    sdk.signInWithEmailAndPassword.mockResolvedValue({ user: user as unknown as User })
    const { wrapper, router } = await mountWithApp(LoginView, 'pl', '/login')
    await fill(wrapper, 'secret-pass')

    expect(router.currentRoute.value.path).toBe('/')
  })

  it('UF-001: "Forgot password" opens the reset form and shows the neutral confirmation', async () => {
    sdk.sendPasswordResetEmail.mockResolvedValue(undefined)
    const { wrapper } = await mountWithApp(LoginView)
    await buttonByText(wrapper, pl.auth.forgot).trigger('click')
    await wrapper.find('#reset-email').setValue('a@b.co')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(sdk.sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="status"]').text()).toBe(pl.auth.resetSent)
  })
})
