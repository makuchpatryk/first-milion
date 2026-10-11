// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

import pl from '../i18n/pl.json'
import { buttonByText, mountWithApp } from '../test-support'
import SinglePlayView from './SinglePlayView.vue'

type Mounted = Awaited<ReturnType<typeof mountWithApp>>['wrapper']

let current: Mounted | null = null

async function mountView(): Promise<Mounted> {
  const { wrapper } = await mountWithApp(SinglePlayView)
  current = wrapper
  return wrapper
}

afterEach(() => {
  current?.unmount()
  current = null
  vi.restoreAllMocks()
})

const press = (key: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('SinglePlayView', () => {
  it('UF-002: starts flat with the starting equity, an empty history and enabled order buttons', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain(pl.single.histEmpty)
    expect(wrapper.text()).toContain(pl.single.none)
    expect(wrapper.text()).toContain('10 000,00')
    for (const button of ['buy', 'close', 'sell']) {
      expect(
        wrapper.find(`button.${button === 'close' ? 'flat' : button}`).attributes('disabled'),
      ).toBe(undefined)
    }
  })

  it('FR-004: the B key buys the chosen size and S sells it back', async () => {
    const wrapper = await mountView()

    press('b')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('+50 @')

    press('s')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(pl.single.none)
    expect(wrapper.text()).not.toContain(pl.single.histEmpty)
  })

  it('FR-004: C closes the position', async () => {
    const wrapper = await mountView()
    press('b')
    press('c')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain(pl.single.none)
    expect(wrapper.findAll('.item')).toHaveLength(1)
  })

  it('UF-002: keystrokes typed into a form field do not trade', async () => {
    const wrapper = await mountView()
    const input = document.createElement('input')
    document.body.appendChild(input)

    press('b', input)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(pl.single.none)
    input.remove()
  })

  it('UF-002: the keyboard listener is removed on unmount', async () => {
    const remove = vi.spyOn(document, 'removeEventListener')
    const wrapper = await mountView()
    wrapper.unmount()
    current = null

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('FR-004: the chosen order size changes the position opened', async () => {
    const wrapper = await mountView()
    await buttonByText(wrapper, `100 ${pl.single.units}`).trigger('click')
    press('b')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('+100 @')
  })

  it('FR-004: pause toggles its label', async () => {
    const wrapper = await mountView()
    await buttonByText(wrapper, pl.single.pause).trigger('click')
    expect(buttonByText(wrapper, pl.single.resume).exists()).toBe(true)
  })
})
