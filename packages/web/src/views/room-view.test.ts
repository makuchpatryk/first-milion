// @vitest-environment happy-dom
import type { RoomView as RoomViewData } from '@fm/shared/protocol'
import { flushPromises } from '@vue/test-utils'
import { computed, shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initialRoomState, type RoomState } from '../room/room-state'
import type { SocketStatus } from '../net/ws-client'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

const roomMock = vi.hoisted((): { current: unknown; args: unknown[] } => ({
  current: null,
  args: [],
}))
vi.mock('../composables/use-room', () => ({
  useRoom: (...args: unknown[]) => {
    roomMock.args = args
    return roomMock.current
  },
}))

import { session } from '../auth/session'
import pl from '../i18n/pl.json'
import { buttonByText, mountAsRoute, mountWithApp } from '../test-support'
import RoomView from './RoomView.vue'

const view = (over: Partial<RoomViewData> = {}): RoomViewData => ({
  id: 'r1',
  name: 'Alpha',
  hostNick: 'Ann',
  durationMin: 5,
  startCash: 10_000,
  goal: 30_000,
  speed: 3,
  status: 'lobby',
  players: [{ nick: 'Ann', status: 'active' }],
  observers: [],
  lastRound: null,
  you: { role: 'player', nick: 'Ann', isHost: true },
  ...over,
})

function fakeRoom(init: Partial<RoomState> = {}, status: SocketStatus = 'ready') {
  const state = shallowRef<RoomState>({ ...initialRoomState, view: view(), ...init })
  const statusRef = shallowRef<SocketStatus>(status)
  const reconnectLeftS = shallowRef<number | null>(null)
  const closeCode = shallowRef<number | null>(null)
  const room = {
    state,
    status: statusRef,
    reconnectLeftS,
    closeCode,
    canTrade: computed(() => true),
    start: vi.fn(),
    order: vi.fn(),
    closePosition: vi.fn(),
    kick: vi.fn(),
    leave: vi.fn(),
    clearError: vi.fn(),
    dispose: vi.fn(),
  }
  roomMock.current = room
  return room
}

beforeEach(() => {
  document.documentElement.lang = 'pl'
  session.status = 'verified'
  session.user = { uid: 'u1', nick: 'Ann', email: 'a@b.co' }
})

const mountRoom = () => mountWithApp(RoomView, 'pl', '/rooms/r1')

describe('RoomView', () => {
  it('opens the room named in the route with the session nickname', async () => {
    fakeRoom()
    await mountRoom()
    expect(roomMock.args).toEqual(['r1', 'Ann'])
  })

  it('UF-004 step 1: a lobby-state room shows the lobby panel', async () => {
    fakeRoom()
    const { wrapper } = await mountRoom()
    expect(wrapper.text()).toContain(pl.lobby.start)
    expect(wrapper.find('.clock').exists()).toBe(false)
  })

  it('UF-004 step 2: a running room shows the round panel', async () => {
    fakeRoom({
      view: view({ status: 'running' }),
      price: 100,
      endsInMs: 30_000,
      you: {
        role: 'player',
        status: 'active',
        units: 0,
        avg: 0,
        realized: 0,
        equity: 10_000,
        closedTrades: 0,
        wins: 0,
      },
    })
    const { wrapper } = await mountRoom()
    expect(wrapper.find('.clock').text()).toBe('0:30')
    expect(wrapper.text()).not.toContain(pl.lobby.start)
  })

  it('UF-004: Start sends the start intent through the room', async () => {
    const room = fakeRoom()
    const { wrapper } = await mountRoom()
    await buttonByText(wrapper, pl.lobby.start).trigger('click')
    expect(room.start).toHaveBeenCalledTimes(1)
  })

  it('UF-004: leaving tells the server and goes back to the room list', async () => {
    const room = fakeRoom()
    const { wrapper, router } = await mountRoom()
    await buttonByText(wrapper, pl.lobby.leave).trigger('click')
    await flushPromises()
    expect(room.leave).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/rooms')
  })

  describe('leaving a running round', () => {
    const youActive = {
      role: 'player',
      status: 'active',
      units: 0,
      avg: 0,
      realized: 0,
      equity: 10_000,
      closedTrades: 0,
      wins: 0,
    } as const
    const mountRouted = () => mountAsRoute(RoomView, '/rooms/:id')

    it('a player in a running round is asked; "Cancel" keeps them in the room', async () => {
      fakeRoom({ view: view({ status: 'running' }), price: 100, endsInMs: 30_000, you: youActive })
      const { wrapper, router } = await mountRouted()
      const navigation = router.push('/menu')
      await flushPromises()
      expect(wrapper.find('dialog').text()).toContain(pl.leaveGame.room)
      await buttonByText(wrapper, pl.common.cancel).trigger('click')
      await navigation
      expect(router.currentRoute.value.path).toBe('/rooms/:id')
    })

    it('"Leave the game" lets the navigation go on', async () => {
      fakeRoom({ view: view({ status: 'running' }), price: 100, endsInMs: 30_000, you: youActive })
      const { wrapper, router } = await mountRouted()
      const navigation = router.push('/settings')
      await flushPromises()
      await buttonByText(wrapper, pl.leaveGame.confirm).trigger('click')
      await navigation
      expect(router.currentRoute.value.path).toBe('/settings')
    })

    it('the lobby, an observer and an eliminated player leave without a question', async () => {
      const cases: Partial<RoomState>[] = [
        {},
        {
          view: view({ status: 'running', you: { role: 'observer', nick: 'Cy', isHost: false } }),
          you: { ...youActive, role: 'observer' },
        },
        { view: view({ status: 'running' }), you: { ...youActive, status: 'eliminated' } },
      ]
      for (const init of cases) {
        fakeRoom(init)
        const { router } = await mountRouted()
        await router.push('/settings')
        expect(router.currentRoute.value.path).toBe('/settings')
      }
    })
  })

  it('FR-017: an admin kicks through the lobby panel confirmation', async () => {
    const room = fakeRoom({
      isAdmin: true,
      view: view({
        players: [
          { nick: 'Ann', status: 'active' },
          { nick: 'Bob', status: 'active' },
        ],
      }),
    })
    const { wrapper } = await mountRoom()
    await wrapper.find('button[aria-label="Wyrzuć Bob"]').trigger('click')
    await flushPromises()
    const confirm = wrapper
      .find('dialog')
      .findAll('button')
      .find((b) => b.text() === pl.admin.kick)
    await confirm?.trigger('click')
    expect(room.kick).toHaveBeenCalledWith('Bob')
  })

  it('UF-004 error state: a lost connection shows the banner with the 30 s countdown', async () => {
    const room = fakeRoom()
    const { wrapper } = await mountRoom()
    room.status.value = 'reconnecting'
    room.reconnectLeftS.value = 22
    await flushPromises()
    const banner = wrapper.find('[role="status"]')
    expect(banner.text()).toContain('22 s')
  })

  it('FR-015: once the 30 s are up the banner says the seat is lost', async () => {
    const room = fakeRoom()
    const { wrapper } = await mountRoom()
    room.status.value = 'reconnecting'
    room.reconnectLeftS.value = 0
    await flushPromises()
    expect(wrapper.text()).toContain(pl.round.reconnectLost)
  })

  it('BR-017: a kick (4403) shows its message in a dialog and goes back to the list', async () => {
    const room = fakeRoom()
    const { wrapper, router } = await mountRoom()
    room.closeCode.value = 4403
    await flushPromises()
    expect(wrapper.find('dialog').text()).toContain(pl.close.kicked)
    await buttonByText(wrapper, pl.round.backToRooms).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/rooms')
  })

  it('FR-017 AC: an admin room close (4410) shows the closed message', async () => {
    const room = fakeRoom()
    const { wrapper } = await mountRoom()
    room.closeCode.value = 4410
    await flushPromises()
    expect(wrapper.find('dialog').text()).toContain(pl.close.roomClosed)
  })

  it('UF-004 step 3: the results dialog opens on round.end and "Back to lobby" closes it', async () => {
    const room = fakeRoom()
    const { wrapper } = await mountRoom()
    room.state.value = {
      ...room.state.value,
      lastResult: {
        reason: 'TIME',
        winners: ['Ann'],
        ranking: [{ nick: 'Ann', equity: 10_100, status: 'active', place: 1 }],
      },
    }
    await flushPromises()
    const dialogs = wrapper.findAll('dialog')
    const results = dialogs.find((d) => d.text().includes(pl.results.title))
    expect(results?.element.hasAttribute('open')).toBe(true)

    await buttonByText(wrapper, pl.results.back).trigger('click')
    await flushPromises()
    expect(results?.element.hasAttribute('open')).toBe(false)
  })

  it('UF-004 step 3: the trade buttons are off while the round result is open', async () => {
    const room = fakeRoom({
      view: view({ status: 'running' }),
      you: {
        role: 'player',
        status: 'active',
        units: 0,
        avg: 0,
        realized: 0,
        equity: 10_000,
        closedTrades: 0,
        wins: 0,
      },
    })
    const { wrapper } = await mountRoom()
    expect(wrapper.find('button.buy').attributes('disabled')).toBeUndefined()

    room.state.value = {
      ...room.state.value,
      lastResult: { reason: 'TIME', winners: ['Ann'], ranking: [] },
    }
    await flushPromises()
    expect(wrapper.find('button.buy').attributes('disabled')).toBeDefined()
  })

  it('BP-003 exception: a join error (room full) is shown with a way back to the list', async () => {
    const room = fakeRoom({ view: null, error: 'ROOM_FULL' })
    room.status.value = 'ready'
    const { wrapper } = await mountRoom()
    expect(wrapper.text()).toContain(pl.error.roomFull)
    expect(wrapper.find('a[href="/rooms"]').exists()).toBe(true)
  })
})
