import type { RoomForm } from '@fm/shared/validation'
import { getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import { openLobbySocket } from '../net/lobby-socket'
import { unreachableSocket } from '../net/unreachable'
import type { AppServerMessage, SocketHandle, SocketStatus } from '../net/ws-client'
import { initialLobbyState, reduceLobby } from '../room/lobby-state'
import { hasWorkerUrl, runtimeSocketDeps } from './socket-deps'

export interface LobbyHandlers {
  onMessage(msg: AppServerMessage): void
  onStatus(status: SocketStatus, closeCode?: number): void
}

/** Opens the lobby socket; tests pass a fake. */
export type OpenLobby = (handlers: LobbyHandlers) => SocketHandle

const openRuntimeLobby: OpenLobby = (handlers) =>
  hasWorkerUrl()
    ? openLobbySocket({ ...runtimeSocketDeps(), ...handlers })
    : unreachableSocket(handlers)

/**
 * The room list and creation (UF-003) over the lobby socket. State comes from `reduceLobby`; the
 * socket is closed when the owning scope ends (CODE_QUALITY cleanup rule).
 */
export function useLobby(open: OpenLobby = openRuntimeLobby) {
  const state = shallowRef(initialLobbyState)
  const status = ref<SocketStatus>('connecting')
  const closeCode = ref<number | null>(null)

  const socket = open({
    onMessage: (msg) => {
      state.value = reduceLobby(state.value, msg)
    },
    onStatus: (next, code) => {
      status.value = next
      if (next === 'closed') closeCode.value = code ?? null
    },
  })

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    socket.close()
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    state,
    status,
    closeCode,
    /** Intent only: the server validates the form again (FR-009). */
    createRoom: (form: RoomForm) => socket.send({ type: 'room.create', form }),
    closeRoom: (roomId: string) => socket.send({ type: 'admin.closeRoom', roomId }),
    clearError: () => {
      state.value = { ...state.value, error: null }
    },
    dispose,
  }
}
