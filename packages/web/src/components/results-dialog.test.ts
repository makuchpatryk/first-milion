// @vitest-environment happy-dom
import type { LastRound } from '@fm/shared/protocol'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppI18n } from '../i18n'
import pl from '../i18n/pl.json'
import ResultsDialog from './ResultsDialog.vue'

const result = (over: Partial<LastRound> = {}): LastRound => ({
  reason: 'TIME',
  winners: ['Ann'],
  ranking: [
    { nick: 'Ann', equity: 10_500, status: 'active', place: 1 },
    { nick: 'Bob', equity: 9_000, status: 'active', place: 2 },
  ],
  ...over,
})

let current: VueWrapper | null = null

function mountDialog(props: { open: boolean; result: LastRound; me: string }) {
  const wrapper = mount(ResultsDialog, {
    props,
    attachTo: document.body,
    global: { plugins: [createAppI18n('pl')] },
  }) as VueWrapper
  current = wrapper
  return wrapper
}

afterEach(() => {
  current?.unmount()
  current = null
})

describe('ResultsDialog (UF-004 step 3)', () => {
  it('shows the reason, one winner and the ranking with places', () => {
    const wrapper = mountDialog({ open: true, result: result(), me: 'Bob' })
    const text = wrapper.text()
    expect(text).toContain(pl.results.title)
    expect(text).toContain(pl.results.reason.TIME)
    expect(text).toContain('Zwycięzca: Ann')
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0]?.text()).toContain('Ann')
    expect(rows[1]?.text()).toContain(pl.round.you)
  })

  it('BR-010: a shared first place lists both winners and both rows at place 1', () => {
    const wrapper = mountDialog({
      open: true,
      result: result({
        winners: ['Ann', 'Bob'],
        ranking: [
          { nick: 'Ann', equity: 10_500, status: 'active', place: 1 },
          { nick: 'Bob', equity: 10_500, status: 'active', place: 1 },
        ],
      }),
      me: 'Ann',
    })
    expect(wrapper.find('.winners').text()).toBe('Zwycięzcy (miejsce ex aequo): Ann, Bob')
    const places = wrapper.findAll('tbody tr td:first-child').map((td) => td.text())
    expect(places).toEqual(['1', '1'])
  })

  it('BR-009: with every player eliminated there is no winner text for a name', () => {
    const wrapper = mountDialog({
      open: true,
      result: result({ reason: 'ALL_ELIMINATED', winners: [] }),
      me: 'Ann',
    })
    expect(wrapper.find('.winners').text()).toBe('Brak zwycięzcy.')
    expect(wrapper.text()).toContain(pl.results.reason.ALL_ELIMINATED)
  })

  it('opens as a modal dialog and "Back to lobby" asks the parent to close it', async () => {
    const wrapper = mountDialog({ open: true, result: result(), me: 'Ann' })
    await flushPromises()
    expect(wrapper.find('dialog').element.hasAttribute('open')).toBe(true)

    await wrapper
      .findAll('button')
      .find((b) => b.text() === pl.results.back)
      ?.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes the native dialog when the parent sets open to false, without a second close event', async () => {
    const wrapper = mountDialog({ open: true, result: result(), me: 'Ann' })
    await flushPromises()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(wrapper.find('dialog').element.hasAttribute('open')).toBe(false)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('WCAG 4.1.2: the dialog is named by its title and described by its content', () => {
    const wrapper = mountDialog({ open: true, result: result(), me: 'Ann' })
    const dialog = wrapper.find('dialog')
    const title = wrapper.find(`#${CSS.escape(dialog.attributes('aria-labelledby') ?? '')}`)
    const body = wrapper.find(`#${CSS.escape(dialog.attributes('aria-describedby') ?? '')}`)
    expect(title.text()).toBe(pl.results.title)
    expect(body.text()).toContain('Zwycięzca: Ann')
  })

  it('moves focus to the title on open and back to the opener on close', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const wrapper = mountDialog({ open: false, result: result(), me: 'Ann' })
    await wrapper.setProps({ open: true })
    await flushPromises()
    expect(document.activeElement?.tagName).toBe('H2')

    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
