// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

import { flushPromises } from '@vue/test-utils'
import pl from '../i18n/pl.json'
import { buttonByText, mountAsRoute, mountWithApp } from '../test-support'
import SinglePlayView from './SinglePlayView.vue'

type Mounted = Awaited<ReturnType<typeof mountWithApp>>['wrapper']

let current: Mounted | null = null

/** Mounts the view and starts a round through the setup screen (5 min, start 5,000, goal 20,000). */
async function mountView(): Promise<Mounted> {
  const { wrapper } = await mountWithApp(SinglePlayView)
  current = wrapper
  await wrapper.find('#single-start').setValue('5000')
  await wrapper.find('#single-goal').setValue('20000')
  await wrapper.find('form.setup').trigger('submit')
  return wrapper
}

afterEach(() => {
  current?.unmount()
  current = null
  vi.restoreAllMocks()
})

const press = (key: string, target: EventTarget = document.body) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('SinglePlayView: leaving a running round', () => {
  async function runningRound() {
    const mounted = await mountAsRoute(SinglePlayView, '/single')
    current = mounted.wrapper
    await mounted.wrapper.find('form.setup').trigger('submit')
    return mounted
  }

  it('going to the menu or settings from the setup screen needs no question', async () => {
    const { wrapper, router } = await mountAsRoute(SinglePlayView, '/single')
    current = wrapper
    await router.push('/settings')
    expect(router.currentRoute.value.path).toBe('/settings')
  })

  it('a running round asks first; "Cancel" keeps the user in the game', async () => {
    const { wrapper, router } = await runningRound()
    const navigation = router.push('/menu')
    await flushPromises()

    const dialog = wrapper.find('dialog')
    expect(dialog.text()).toContain(pl.leaveGame.title)
    expect(dialog.text()).toContain(pl.leaveGame.single)
    await buttonByText(wrapper, pl.common.cancel).trigger('click')
    await navigation
    expect(router.currentRoute.value.path).toBe('/single')
    expect(wrapper.find('.round-bar').exists()).toBe(true)
  })

  it('the round is paused while the question is open and resumes on "Cancel"', async () => {
    const { wrapper, router } = await runningRound()
    expect(buttonByText(wrapper, pl.single.pause).exists()).toBe(true)

    const navigation = router.push('/menu')
    await flushPromises()
    expect(buttonByText(wrapper, pl.single.resume).exists()).toBe(true)

    await buttonByText(wrapper, pl.common.cancel).trigger('click')
    await navigation
    expect(buttonByText(wrapper, pl.single.pause).exists()).toBe(true)
  })

  it('a pause the player set before the question stays after "Cancel"', async () => {
    const { wrapper, router } = await runningRound()
    await buttonByText(wrapper, pl.single.pause).trigger('click')

    const navigation = router.push('/menu')
    await flushPromises()
    await buttonByText(wrapper, pl.common.cancel).trigger('click')
    await navigation
    expect(buttonByText(wrapper, pl.single.resume).exists()).toBe(true)
  })

  it('"Leave the game" confirms and the navigation goes on', async () => {
    const { wrapper, router } = await runningRound()
    const navigation = router.push('/settings')
    await flushPromises()
    await buttonByText(wrapper, pl.leaveGame.confirm).trigger('click')
    await navigation
    expect(router.currentRoute.value.path).toBe('/settings')
  })
})

describe('SinglePlayView', () => {
  it('UF-002: starts flat with the starting equity, an empty history and enabled order buttons', async () => {
    const wrapper = await mountView()

    expect(wrapper.text()).toContain(pl.single.histEmpty)
    expect(wrapper.text()).toContain(pl.single.none)
    expect(wrapper.text()).toContain('5000,00')
    // The chosen capital, not the default one.
    expect(wrapper.text()).not.toContain('10 000,00')
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

  it('BR-009: the setup screen comes first and the goal is required', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    expect(wrapper.find('form.setup').exists()).toBe(true)
    expect(wrapper.find('.round-bar').exists()).toBe(false)

    await wrapper.find('#single-goal').setValue('')
    await wrapper.find('form.setup').trigger('submit')
    expect(wrapper.find('[role="alert"]').text()).toBe(pl.create.error.goal)
    expect(wrapper.find('form.setup').exists()).toBe(true)
  })

  it('FR-003, FR-004: the setup offers a start and a goal slider with the defaults', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(2)
    expect((wrapper.find('#single-start').element as HTMLInputElement).value).toBe('10000')
    expect((wrapper.find('#single-goal').element as HTMLInputElement).value).toBe('30000')
  })

  it('BR-009 AC: a goal not above the start is refused and the game does not start', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    await wrapper.find('#single-goal').setValue('10000')
    await wrapper.find('form.setup').trigger('submit')
    expect(wrapper.find('[role="alert"]').text()).toBe(pl.create.error.goal)
    expect(wrapper.find('form.setup').exists()).toBe(true)
  })

  it('BR-003 AC: a start off the 1,000 grid is refused and the game does not start', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    await wrapper.find('#single-start').setValue('1500')
    await wrapper.find('form.setup').trigger('submit')
    expect(wrapper.find('[role="alert"]').text()).toBe(pl.create.error.start)
    expect(wrapper.find('form.setup').exists()).toBe(true)
  })

  it('FR-004: a goal above the slider range starts the game', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    await wrapper.find('#single-goal').setValue('5000000')
    await wrapper.find('form.setup').trigger('submit')
    expect(wrapper.find('form.setup').exists()).toBe(false)
    expect(wrapper.find('.round-bar').text()).toMatch(/5\s000\s000/)
  })

  it('FR-004: raising the start to the goal moves the goal one step above it', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    await wrapper.find('#single-start').setValue('50000')
    expect((wrapper.find('#single-goal').element as HTMLInputElement).value).toBe('51000')
  })

  it('BR-009: no trade can be made from the setup screen', async () => {
    const { wrapper } = await mountWithApp(SinglePlayView)
    current = wrapper
    press('b')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('form.setup').exists()).toBe(true)
  })

  it('FR-004: the time and goal of the setup screen show in the round bar, with equity against the goal', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('.round-bar').text()).toContain('5:00')
    // The thousands separator is a non-breaking space, hence `\s`.
    expect(wrapper.find('.round-bar').text()).toMatch(/5000\s*\/\s*20\s000/)
  })

  it('BR-009: the progress bar runs from the start capital to the goal', async () => {
    const wrapper = await mountView()
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-valuemin')).toBe('5000')
    expect(bar.attributes('aria-valuemax')).toBe('20000')
    expect(Number(bar.attributes('aria-valuenow'))).toBeGreaterThanOrEqual(5000)
    expect(bar.find('.fill').attributes('style')).toContain('width: 0%')
  })
})
