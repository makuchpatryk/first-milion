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
  it('the start and the goal are preselected with the defaults', async () => {
    const { wrapper } = await mountForm()
    expect((wrapper.find('#room-start').element as HTMLInputElement).value).toBe('10000')
    expect((wrapper.find('#room-goal').element as HTMLInputElement).value).toBe('30000')
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(2)
  })

  it('a valid form sends exactly the parsed object, with start and goal as numbers', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('  Alpha  ')
    await wrapper.find('#room-start').setValue('5000')
    await wrapper.find('#room-goal').setValue('25000')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledTimes(1)
    expect(lobby.createRoom).toHaveBeenCalledWith({
      name: 'Alpha',
      durationMin: 5,
      speed: 3,
      startCash: 5_000,
      goal: 25_000,
    })
  })

  it('FR-004: the default form is valid, and a goal above the slider range is sent as typed', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('#room-goal').setValue('5000000')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledWith({
      name: 'Alpha',
      durationMin: 5,
      speed: 3,
      startCash: 10_000,
      goal: 5_000_000,
    })
  })

  it('BR-009 AC: the goal is required, so an empty goal creates nothing', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('#room-goal').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain(pl.create.error.goal)
    expect(lobby.createRoom).not.toHaveBeenCalled()
  })

  it('the chips choose the duration and the speed that are sent', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    const chip = (label: string) => wrapper.findAll('button.chip').find((b) => b.text() === label)
    await chip('10 min')?.trigger('click')
    await chip('8×')?.trigger('click')
    await wrapper.find('#room-goal').setValue('40000')
    await wrapper.find('form').trigger('submit')
    expect(lobby.createRoom).toHaveBeenCalledWith({
      name: 'Alpha',
      durationMin: 10,
      speed: 8,
      startCash: 10_000,
      goal: 40_000,
    })
  })

  it('BR-009 AC: a goal equal to the start shows the goal error and creates nothing', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('#room-goal').setValue('10000')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain(pl.create.error.goal)
    expect(wrapper.find('#room-goal-error').attributes('role')).toBe('alert')
    expect(lobby.createRoom).not.toHaveBeenCalled()
  })

  it('BR-003 AC: a start off the 1,000 grid shows the start error and creates nothing', async () => {
    const { lobby, wrapper } = await mountForm()
    await wrapper.find('#room-name').setValue('Alpha')
    await wrapper.find('#room-start').setValue('1500')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain(pl.create.error.start)
    expect(lobby.createRoom).not.toHaveBeenCalled()
  })

  it('FR-004: raising the start to the goal moves the goal one step above it', async () => {
    const { wrapper } = await mountForm()
    await wrapper.find('#room-start').setValue('50000')
    expect((wrapper.find('#room-goal').element as HTMLInputElement).value).toBe('51000')
  })

  it('FR-004: a start below the goal leaves the goal as typed', async () => {
    const { wrapper } = await mountForm()
    await wrapper.find('#room-goal').setValue('40000')
    await wrapper.find('#room-start').setValue('20000')
    expect((wrapper.find('#room-goal').element as HTMLInputElement).value).toBe('40000')
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
    await wrapper.find('#room-goal').setValue('25000')
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
