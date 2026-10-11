// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App.vue'
import pl from './i18n/pl.json'
import { buttonByText, mountWithApp } from './test-support'

beforeEach(() => {
  document.documentElement.lang = 'pl'
  localStorage.clear()
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
