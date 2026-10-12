// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils'
import { shallowRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LobbyState } from '../room/lobby-state'

vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn() }))
vi.mock('../auth/firebase', () => ({ auth: { currentUser: null } }))

const lobbyMock = vi.hoisted((): { current: unknown } => ({ current: null }))
vi.mock('../composables/use-lobby', () => ({ useLobby: () => lobbyMock.current }))

import pl from '../i18n/pl.json'
import { mountWithApp } from '../test-support'
import CreateRoomView from './CreateRoomView.vue'

function fakeLobby() {
  const state = shallowRef<LobbyState>({
    rooms: [],
    isAdmin: false,
    createdRoomId: null,
    error: null,
  })
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
})

async function mountForm() {
  const lobby = fakeLobby()
  const { wrapper, router } = await mountWithApp(CreateRoomView)
  return { lobby, wrapper, router }
}

describe('CreateRoomView (UF-003, FR-009)', () => {
  it('a valid form sends exactly the parsed object, with null for an empty target', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('  Alpha  ')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledTimes(1)
    expect(lobby.createRoom).toHaveBeenCalledWith({
      name: 'Alpha',
      durationMin: 5,
      speed: 3,
      profitTarget: null,
    })
  })

  it('the chips choose the duration and the speed that are sent', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    const chip = (label: string) => wrapper.findAll('button.chip').find((b) => b.text() === label)
    await chip('10 min')?.trigger('click')
    await chip('8×')?.trigger('click')
    await wrapper.find('#room-target').setValue('250')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledWith({
      name: 'Alpha',
      durationMin: 10,
      speed: 8,
      profitTarget: 250,
    })
  })

  it('FR-009 AC: a target of 99 shows the target error and creates nothing', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('#room-target').setValue('99')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain(pl.create.error.target)
    expect(lobby.createRoom).not.toHaveBeenCalled()
  })

  it('an invalid name shows the name error live and creates nothing', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('ab')
    expect(wrapper.text()).toContain(pl.create.error.name)
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).not.toHaveBeenCalled()
  })

  it('no error is shown before the user touches the form', async () => {
    const { wrapper } = await mountForm()
    expect(wrapper.text()).not.toContain(pl.create.error.name)
  })

  it('UF-003 step 3: on room.created the user goes to that room', async () => {
    const { lobby, wrapper, router } = await mountForm()
    lobby.state.value = { ...lobby.state.value, createdRoomId: 'new1' }
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/rooms/new1')
    wrapper.unmount()
  })

  it('shows a server error code as text', async () => {
    const { lobby, wrapper } = await mountForm()
    lobby.state.value = { ...lobby.state.value, error: 'INVALID_PAYLOAD' }
    await flushPromises()
    expect(wrapper.text()).toContain(pl.error.invalidPayload)
  })

  it('submit waits for a ready socket', async () => {
    const { lobby, wrapper } = await mountForm()
    lobby.status.value = 'connecting'
    await flushPromises()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('a double submit sends one room.create; a server error allows the next attempt', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledTimes(1)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()

    lobby.state.value = { ...lobby.state.value, error: 'ROOM_FULL' }
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledTimes(2)
  })
})
