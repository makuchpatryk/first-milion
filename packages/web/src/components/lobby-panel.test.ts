// @vitest-environment happy-dom
import type { RoomView } from '@fm/shared/protocol'
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createAppI18n } from '../i18n'
import pl from '../i18n/pl.json'
import LobbyPanel from './LobbyPanel.vue'

const view = (over: Partial<RoomView> = {}): RoomView => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  durationMin: 5,
  startCash: 5_000,
  goal: 8_000,
  speed: 3,
  status: 'lobby',
  players: [
    { nick: 'Ann', status: 'active' },
    { nick: 'Bob', status: 'active' },
  ],
  observers: [{ nick: 'Cy' }],
  lastRound: null,
  you: { role: 'player', nick: 'Ann', isHost: true },
  ...over,
})

function mountPanel(v: RoomView, isAdmin = false) {
  return mount(LobbyPanel, {
    props: { view: v, isAdmin },
    global: { plugins: [createAppI18n('pl')] },
  })
}

const startButton = (wrapper: ReturnType<typeof mountPanel>) =>
  wrapper.findAll('button').find((b) => b.text() === pl.lobby.start)

describe('LobbyPanel (UF-004 step 1)', () => {
  it('shows the parameters, the players with the host marked, and the observers', () => {
    const wrapper = mountPanel(view())
    const text = wrapper.text()
    expect(text).toContain('5 min')
    expect(text).toContain('3×')
    expect(text).toContain(pl.lobby.startCash)
    expect(text).toContain(pl.rooms.startCash.replace('{n}', '5000'))
    expect(text).toContain(pl.lobby.goal)
    expect(text).toContain(pl.rooms.goal.replace('{n}', '8000'))
    expect(wrapper.findAll('li')[0]?.text()).toContain(pl.lobby.host)
    expect(wrapper.findAll('li')[0]?.text()).toContain(pl.lobby.you)
    expect(wrapper.findAll('li')[1]?.text()).not.toContain(pl.lobby.host)
    expect(text).toContain('Cy')
  })

  it('FR-011: the host can start when at least one player is seated', async () => {
    const wrapper = mountPanel(view())
    const start = startButton(wrapper)
    expect(start?.attributes('disabled')).toBeUndefined()
    await start?.trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
  })

  it('FR-011: Start is disabled with no players, and says why', () => {
    const wrapper = mountPanel(view({ players: [] }))
    expect(startButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain(pl.lobby.needPlayer)
  })

  it('BR-013: a non-host has no Start button and sees the waiting text', () => {
    const wrapper = mountPanel(view({ you: { role: 'player', nick: 'Bob', isHost: false } }))
    expect(startButton(wrapper)).toBeUndefined()
    expect(wrapper.text()).toContain(pl.lobby.waitHost)
  })

  it('FR-017: Kick appears next to other members, only for an admin', () => {
    const admin = mountPanel(view(), true)
    const kicks = admin.findAll('button[aria-label]')
    // Bob and Cy; not the admin themselves
    expect(kicks.map((b) => b.attributes('aria-label'))).toEqual(['Wyrzuć Bob', 'Wyrzuć Cy'])

    const plain = mountPanel(view(), false)
    expect(plain.text()).not.toContain(pl.admin.kick)
  })

  it('FR-017: kick asks for confirmation, then emits the nickname', async () => {
    const wrapper = mountPanel(view(), true)
    await wrapper.find('button[aria-label="Wyrzuć Bob"]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('kick')).toBeUndefined()

    const confirm = wrapper
      .find('dialog')
      .findAll('button')
      .find((b) => b.text() === pl.admin.kick)
    await confirm?.trigger('click')
    expect(wrapper.emitted('kick')).toEqual([['Bob']])
  })

  it('BR-014: the last round result stays visible in the lobby', () => {
    const wrapper = mountPanel(
      view({
        lastRound: {
          reason: 'TIME',
          winners: ['Bob'],
          ranking: [{ nick: 'Bob', equity: 11_000, status: 'active', place: 1 }],
        },
      }),
    )
    expect(wrapper.text()).toContain(pl.lobby.lastRound)
    expect(wrapper.text()).toContain(pl.results.reason.TIME)
  })

  it('leave emits leave', async () => {
    const wrapper = mountPanel(view())
    await wrapper
      .findAll('button')
      .find((b) => b.text() === pl.lobby.leave)
      ?.trigger('click')
    expect(wrapper.emitted('leave')).toHaveLength(1)
  })
})
