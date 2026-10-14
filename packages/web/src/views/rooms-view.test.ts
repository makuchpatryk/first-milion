// @vitest-environment happy-dom
import type { RoomSummary } from '@fm/shared/protocol'
import { flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LobbyState } from '../room/lobby-state'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

const lobbyMock = vi.hoisted((): { current: unknown } => ({ current: null }))
vi.mock('../composables/use-lobby', () => ({ useLobby: () => lobbyMock.current }))

import { session } from '../auth/session'
import en from '../i18n/en.json'
import pl from '../i18n/pl.json'
import { buttonByText, mountWithApp } from '../test-support'
import RoomsView from './RoomsView.vue'

const room = (over: Partial<RoomSummary> = {}): RoomSummary => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  players: 1,
  observers: 0,
  maxPlayers: 4,
  durationMin: 5,
  startCash: 10_000,
  goal: 30_000,
  speed: 3,
  status: 'lobby',
  ...over,
})

function fakeLobby(rooms: RoomSummary[], isAdmin = false) {
  const state = shallowRef<LobbyState>({ rooms, isAdmin, createdRoomId: null, error: null })
  const lobby = {
    state,
    status: shallowRef('ready'),
    closeCode: shallowRef<number | null>(null),
    createRoom: vi.fn(),
    closeRoom: vi.fn(),
    clearError: vi.fn(),
    dispose: vi.fn(),
  }
  lobbyMock.current = lobby
  return lobby
}

beforeEach(() => {
  document.documentElement.lang = 'pl'
  session.status = 'verified'
  session.user = { uid: 'u1', nick: 'Jan_7', email: 'a@b.co' }
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('RoomsView', () => {
  it('UF-003: an empty list shows the empty state and a Create room button', async () => {
    fakeLobby([])
    const { wrapper } = await mountWithApp(RoomsView)
    expect(wrapper.text()).toContain(pl.rooms.empty)
    expect(wrapper.find('a[href="/rooms/new"]').text()).toBe(pl.rooms.create)
  })

  it('BP-003: each row shows name, host, players x/4, duration, start capital, goal and speed', async () => {
    fakeLobby([room({ startCash: 5_000, goal: 9_000, players: 2 })])
    const { wrapper } = await mountWithApp(RoomsView)
    const text = wrapper.find('li').text()
    expect(text).toContain('Alpha')
    expect(text).toContain('Ann')
    expect(text).toContain('2/4')
    expect(text).toContain('5 min')
    expect(text).toContain(pl.rooms.startCash.replace('{n}', '5000'))
    expect(text).toContain(pl.rooms.goal.replace('{n}', '9000'))
    expect(text).toContain('3×')
  })

  it('BP-003: a lobby room with a free slot offers "join as player"; a running one offers "watch"', async () => {
    fakeLobby([room({ id: 'a' }), room({ id: 'b', status: 'running' })])
    const { wrapper } = await mountWithApp(RoomsView)
    const rows = wrapper.findAll('li')
    expect(rows[0]?.text()).toContain(pl.rooms.joinPlayer)
    expect(rows[1]?.text()).toContain(pl.rooms.watch)
  })

  it('BP-003: a room with 4 observers has a disabled "Full" action', async () => {
    fakeLobby([room({ status: 'running', players: 3, observers: 4 })])
    const { wrapper } = await mountWithApp(RoomsView)
    const button = buttonByText(wrapper, pl.rooms.full)
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('UF-003: joining navigates to the room screen', async () => {
    fakeLobby([room({ id: 'r9' })])
    const { wrapper, router } = await mountWithApp(RoomsView)
    await buttonByText(wrapper, pl.rooms.joinPlayer).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/rooms/r9')
  })

  it('FR-017: an admin sees "Close room" on each row', async () => {
    fakeLobby([room()], true)
    const { wrapper } = await mountWithApp(RoomsView)
    expect(wrapper.find('li').text()).toContain(pl.admin.closeRoom)
  })

  it('FR-017: a non-admin never sees "Close room"', async () => {
    fakeLobby([room()], false)
    const { wrapper } = await mountWithApp(RoomsView)
    expect(wrapper.text()).not.toContain(pl.admin.closeRoom)
  })

  it('FR-017 AC: closing asks for confirmation, then sends admin.closeRoom for that room', async () => {
    const lobby = fakeLobby([room({ id: 'r7', name: 'Spam' })], true)
    const { wrapper } = await mountWithApp(RoomsView)
    await buttonByText(wrapper, pl.admin.closeRoom).trigger('click')
    await flushPromises()
    expect(lobby.closeRoom).not.toHaveBeenCalled()
    expect(wrapper.find('dialog').text()).toContain('Spam')

    const confirm = wrapper
      .find('dialog')
      .findAll('button')
      .find((b) => b.text() === pl.admin.closeRoom)
    await confirm?.trigger('click')
    expect(lobby.closeRoom).toHaveBeenCalledWith('r7')
  })

  it('FR-017: cancelling the confirmation sends nothing', async () => {
    const lobby = fakeLobby([room()], true)
    const { wrapper } = await mountWithApp(RoomsView)
    await buttonByText(wrapper, pl.admin.closeRoom).trigger('click')
    await flushPromises()
    await buttonByText(wrapper, pl.common.cancel).trigger('click')
    expect(lobby.closeRoom).not.toHaveBeenCalled()
  })

  it('BR-016: an invalid nickname blocks joining and explains why', async () => {
    session.user = { uid: 'u1', nick: '', email: 'a@b.co' }
    fakeLobby([room()])
    const { wrapper } = await mountWithApp(RoomsView)
    expect(wrapper.text()).toContain(pl.rooms.nickInvalid)
    expect(buttonByText(wrapper, pl.rooms.joinPlayer).attributes('disabled')).toBeDefined()
  })

  it('FR-019: the English text renders from en.json', async () => {
    fakeLobby([])
    const { wrapper } = await mountWithApp(RoomsView, 'en')
    expect(wrapper.text()).toContain(en.rooms.empty)
  })
})
