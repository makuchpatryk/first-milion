// @vitest-environment happy-dom
import { NICK_MAX } from '@fm/shared/rules'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  deleteUser: vi.fn(),
  signOut: vi.fn(),
}))
const firebaseAuth = vi.hoisted((): { currentUser: unknown } => ({ currentUser: null }))

vi.mock('firebase/auth', () => ({
  ...sdk,
  onAuthStateChanged: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))
vi.mock('../auth/firebase', () => ({ auth: firebaseAuth }))

import { session } from '../auth/session'
import pl from '../i18n/pl.json'
import { buttonByText, mountWithApp } from '../test-support'
import MenuView from './MenuView.vue'

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.lang = 'pl'
  firebaseAuth.currentUser = { uid: 'u1', email: 'a@b.co', displayName: 'Jan_7' }
  session.status = 'verified'
  session.user = { uid: 'u1', nick: 'Jan_7', email: 'a@b.co' }
})

describe('MenuView', () => {
  it('FR-006 AC: a verified user sees both modes, Single play as a link to /single', async () => {
    const { wrapper } = await mountWithApp(MenuView)

    const single = wrapper.find('a[href="/single"]')
    expect(single.text()).toContain(pl.menu.singleTitle)
    expect(wrapper.text()).toContain(pl.menu.roomsTitle)
    expect(wrapper.text()).toContain('Jan_7')
  })

  it('UF-003: the Rooms card links to /rooms', async () => {
    const { wrapper } = await mountWithApp(MenuView)

    const rooms = wrapper.find('a[href="/rooms"]')
    expect(rooms.text()).toContain(pl.menu.roomsTitle)
    expect(wrapper.find('[aria-disabled="true"]').exists()).toBe(false)
  })

  it('FR-002 AC: an invalid nickname shows the error key and makes no SDK call', async () => {
    const { wrapper } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.change).trigger('click')
    await wrapper.find('#new-nick').setValue('ab')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe(pl.account.error.nickInvalid)
    expect(sdk.updateProfile).not.toHaveBeenCalled()
  })

  it('FR-002: the nickname input stops at the 16-character rule limit', async () => {
    const { wrapper } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.change).trigger('click')
    expect(wrapper.find('#new-nick').attributes('maxlength')).toBe(String(NICK_MAX))
  })

  it('FR-002: a valid nickname is saved to the profile and the form closes', async () => {
    sdk.updateProfile.mockResolvedValue(undefined)
    const { wrapper } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.change).trigger('click')
    await wrapper.find('#new-nick').setValue('Nowy_Nick')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(sdk.updateProfile).toHaveBeenCalledTimes(1)
    expect(wrapper.find('#new-nick').exists()).toBe(false)
  })

  it('FR-018 AC: a wrong password shows its error, deletes nothing and does not navigate', async () => {
    sdk.reauthenticateWithCredential.mockRejectedValue({ code: 'auth/wrong-password' })
    const { wrapper, router } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.delete).trigger('click')
    await wrapper.find('#delete-password').setValue('nope')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text()).toBe(pl.auth.error.wrongPassword)
    expect(sdk.deleteUser).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('FR-018 AC: the correct password deletes the account and leaves for /login', async () => {
    sdk.reauthenticateWithCredential.mockResolvedValue(undefined)
    sdk.deleteUser.mockResolvedValue(undefined)
    const { wrapper, router } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.delete).trigger('click')
    await wrapper.find('#delete-password').setValue('secret-pass')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(sdk.deleteUser).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('FR-006: logging out leaves for /login', async () => {
    sdk.signOut.mockResolvedValue(undefined)
    const { wrapper, router } = await mountWithApp(MenuView)
    await buttonByText(wrapper, pl.account.logout).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/login')
  })

  it('FR-019: the language chips switch the language and <html lang>', async () => {
    const { wrapper } = await mountWithApp(MenuView)
    await buttonByText(wrapper, 'EN').trigger('click')

    expect(document.documentElement.lang).toBe('en')
    expect(wrapper.text()).toContain('Single play')
    expect(buttonByText(wrapper, 'EN').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'PL').attributes('aria-pressed')).toBe('false')
  })
})
