// @vitest-environment happy-dom
import type { MeRound, RoomView } from '@fm/shared/protocol'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppI18n } from '../i18n'
import pl from '../i18n/pl.json'
import { initialRoomState, type RoomState } from '../room/room-state'
import RoundPanel from './RoundPanel.vue'

const view = (over: Partial<RoomView> = {}): RoomView => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  durationMin: 5,
  profitTarget: null,
  speed: 3,
  status: 'running',
  players: [
    { nick: 'Ann', status: 'active' },
    { nick: 'Bob', status: 'active' },
  ],
  observers: [],
  lastRound: null,
  you: { role: 'player', nick: 'Ann', isHost: true },
  ...over,
})

const me = (over: Partial<MeRound> = {}): MeRound => ({
  role: 'player',
  status: 'active',
  units: 0,
  avg: 0,
  realized: 0,
  equity: 10_000,
  closedTrades: 0,
  wins: 0,
  ...over,
})

const roundState = (over: Partial<RoomState> = {}): RoomState => ({
  ...initialRoomState,
  history: [100, 101, 102],
  price: 102,
  endsInMs: 61_000,
  ranking: [
    { nick: 'Bob', equity: 10_400, status: 'active', place: 1 },
    { nick: 'Ann', equity: 10_000, status: 'active', place: 2 },
  ],
  you: me(),
  ...over,
})

let current: VueWrapper | null = null

function mountPanel(props: { view: RoomView; state: RoomState; canTrade: boolean }) {
  const wrapper = mount(RoundPanel, {
    props,
    global: { plugins: [createAppI18n('pl')] },
  }) as VueWrapper
  current = wrapper
  return wrapper
}

afterEach(() => {
  current?.unmount()
  current = null
})

const tradeButtons = (w: VueWrapper) => w.findAll('button.big')

describe('RoundPanel (UF-004 step 2, UF-005)', () => {
  it('shows the countdown, the price and the live ranking as an ordered list', () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    expect(wrapper.find('.clock').text()).toBe('1:01')
    expect(wrapper.find('.price').text()).toContain('102,00')
    const rows = wrapper.findAll('ol > li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Bob')
    expect(rows[1]?.text()).toContain(pl.round.you)
  })

  it('UF-005 AC: an observer sees the chart, news, timer and ranking but no trade buttons', () => {
    const wrapper = mountPanel({
      view: view({ you: { role: 'observer', nick: 'Cy', isHost: false } }),
      state: roundState({ you: me({ role: 'observer' }) }),
      canTrade: false,
    })
    expect(tradeButtons(wrapper)).toHaveLength(0)
    expect(wrapper.find('canvas').exists()).toBe(true)
    expect(wrapper.find('.clock').exists()).toBe(true)
    expect(wrapper.findAll('ol > li')).toHaveLength(2)
    expect(wrapper.text()).toContain(pl.round.observerHint)
  })

  it('an active player can trade: Buy emits the chosen size, Close and Sell emit too', async () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    const [buy, close, sell] = tradeButtons(wrapper)
    expect(buy?.attributes('disabled')).toBeUndefined()
    await buy?.trigger('click')
    await sell?.trigger('click')
    await close?.trigger('click')
    expect(wrapper.emitted('order')).toEqual([
      ['BUY', 50],
      ['SELL', 50],
    ])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('FR-005: during a halt the buttons are disabled and the halt bar is announced', () => {
    const wrapper = mountPanel({
      view: view(),
      state: roundState({ halt: { msLeft: 3_500 } }),
      canTrade: false,
    })
    for (const button of tradeButtons(wrapper)) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    const halt = wrapper.find('.halt')
    expect(halt.attributes('aria-live')).toBe('assertive')
    expect(halt.text()).toContain(pl.single.haltBar)
  })

  it('FR-014: an eliminated player keeps the ranking, with buttons disabled and a banner', () => {
    const wrapper = mountPanel({
      view: view(),
      state: roundState({ you: me({ status: 'eliminated', equity: 0 }) }),
      canTrade: false,
    })
    expect(wrapper.text()).toContain(pl.round.eliminated)
    expect(tradeButtons(wrapper)).toHaveLength(3)
    for (const button of tradeButtons(wrapper)) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    expect(wrapper.findAll('ol > li')).toHaveLength(2)
  })

  it('BR-009: a profit target shows a labelled progress bar with the share reached', () => {
    const wrapper = mountPanel({
      view: view({ profitTarget: 1_000 }),
      state: roundState({ you: me({ equity: 10_250 }) }),
      canTrade: true,
    })
    const bar = wrapper.find('[role="progressbar"]')
    expect(bar.attributes('aria-label')).toBe(pl.round.targetProgress)
    expect(bar.attributes('aria-valuemax')).toBe('1000')
    expect(bar.attributes('aria-valuenow')).toBe('250')
  })

  it('no progress bar without a target', () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  })

  it('FR-004 keys: B buys, S sells, C closes while trading is allowed', () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    for (const key of ['b', 's', 'c']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    }
    expect(wrapper.emitted('order')).toEqual([
      ['BUY', 50],
      ['SELL', 50],
    ])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('UF-002 guard: keys typed into a form field do not trade', () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    input.remove()
    expect(wrapper.emitted('order')).toBeUndefined()
  })

  it('FR-005: keys do nothing during a halt', () => {
    const halted = mountPanel({
      view: view(),
      state: roundState({ halt: { msLeft: 1_000 } }),
      canTrade: false,
    })
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(halted.emitted('order')).toBeUndefined()
  })

  it('the size chips change the quantity that is sent', async () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    await wrapper
      .findAll('button.chip')
      .find((b) => b.text() === `250 ${pl.single.units}`)
      ?.trigger('click')
    await tradeButtons(wrapper)[0]?.trigger('click')
    expect(wrapper.emitted('order')).toEqual([['BUY', 250]])
  })

  it('removes its key listener on unmount', () => {
    const wrapper = mountPanel({ view: view(), state: roundState(), canTrade: true })
    wrapper.unmount()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))
    expect(wrapper.emitted('order')).toBeUndefined()
  })
})
