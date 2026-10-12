// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

import { session } from '../auth/session'
import pl from '../i18n/pl.json'
import { mountWithApp } from '../test-support'
import MenuView from './MenuView.vue'

beforeEach(() => {
  document.documentElement.lang = 'pl'
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

  it('account actions live in settings, not on the menu', async () => {
    const { wrapper } = await mountWithApp(MenuView)

    expect(wrapper.text()).not.toContain(pl.account.logout)
    expect(wrapper.text()).not.toContain(pl.account.delete)
    expect(wrapper.find('#new-nick').exists()).toBe(false)
  })
})
