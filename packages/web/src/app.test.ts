// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('./auth/firebase', () => ({ auth: { currentUser: null } }))

import { nextTick } from 'vue'
import App from './App.vue'
import { setAdmin } from './auth/admin'
import { session } from './auth/session'
import pl from './i18n/pl.json'
import { buttonByText, mountWithApp } from './test-support'
import { APP_VERSION } from './version'

beforeEach(() => {
  setAdmin(false)
  document.documentElement.lang = 'pl'
  localStorage.clear()
  session.status = 'loading'
  session.user = null
})

describe('App shell', () => {
  it('WCAG 2.4.1: has a skip link to <main> and renders the routed view inside it', async () => {
    const { wrapper } = await mountWithApp(App)

    expect(wrapper.find('a.skip').attributes('href')).toBe('#main')
    expect(wrapper.find('a.skip').text()).toBe(pl.app.skipToContent)
    expect(wrapper.find('main#main').exists()).toBe(true)
  })

  it('FR-019: the language chips show the current language as pressed', async () => {
    const { wrapper } = await mountWithApp(App, 'pl')

    expect(buttonByText(wrapper, 'PL').attributes('aria-pressed')).toBe('true')
    expect(buttonByText(wrapper, 'EN').attributes('aria-pressed')).toBe('false')
  })

  it('FR-019: choosing EN switches <html lang>, the texts and the saved choice', async () => {
    const { wrapper } = await mountWithApp(App, 'pl')
    await buttonByText(wrapper, 'EN').trigger('click')

    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('fm-lang')).toBe('en')
    expect(wrapper.find('a.skip').text()).toBe('Skip to content')
    expect(buttonByText(wrapper, 'EN').attributes('aria-pressed')).toBe('true')
  })
})

describe('App navigation', () => {
  it('the logo, with its icon, links to the home screen', async () => {
    const { wrapper } = await mountWithApp(App)

    const logo = wrapper.find('header.bar a.logo')
    expect(logo.attributes('href')).toBe('/')
    expect(logo.find('svg').attributes('aria-hidden')).toBe('true')
    expect(logo.text()).toBe(`${pl.app.brandFirst} ${pl.app.brandSecond}`)
  })

  it('a verified user has Settings in the bar next to the logo, no language chips', async () => {
    session.status = 'verified'
    const { wrapper } = await mountWithApp(App, 'pl', '/')

    const links = wrapper.findAll('header.bar a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['/', '/settings'])
    expect(links[1]?.text()).toBe('')
    expect(links[1]?.attributes('aria-label')).toBe(pl.nav.settings)
    expect(wrapper.findAll('header.bar button')).toHaveLength(0)
  })

  it('Back sits in its own row below the bar', async () => {
    session.status = 'verified'
    const { wrapper } = await mountWithApp(App, 'pl', '/rooms')

    const back = wrapper.find('nav.crumbs a.back')
    expect(back.attributes('href')).toBe('/')
    expect(back.text()).toBe(pl.nav.backToMenu)
    expect(wrapper.find('header.bar a.back').exists()).toBe(false)
  })

  it('there is no Back row on the menu', async () => {
    session.status = 'verified'
    const { wrapper } = await mountWithApp(App, 'pl', '/')

    expect(wrapper.find('nav.crumbs').exists()).toBe(false)
  })

  it('a logged-out visitor keeps the language chips in the bar and gets no Settings link', async () => {
    session.status = 'out'
    const { wrapper } = await mountWithApp(App, 'pl', '/privacy')

    expect(wrapper.find('nav.crumbs a.back').attributes('href')).toBe('/login')
    expect(wrapper.find('header.bar a[href="/settings"]').exists()).toBe(false)
    expect(buttonByText(wrapper, 'PL').exists()).toBe(true)
  })
})

describe('App version footer', () => {
  it('shows the release version at the bottom to an admin only', async () => {
    const { wrapper } = await mountWithApp(App)
    expect(wrapper.find('footer.version').exists()).toBe(false)

    setAdmin(true)
    await nextTick()
    expect(wrapper.find('footer.version').text()).toBe(`v${APP_VERSION}`)

    setAdmin(false)
    await nextTick()
    expect(wrapper.find('footer.version').exists()).toBe(false)
  })
})
