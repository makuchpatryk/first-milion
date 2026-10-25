import { DISCONNECT_GRACE_MS, type OrderQty } from '@fm/shared/rules'
import { computed, getCurrentScope, onScopeDispose, ref, shallowRef } from 'vue'
import { setAdmin } from '../auth/admin'
import { openRoomSocket } from '../net/room-socket'
import { unreachableSocket } from '../net/unreachable'
import type { AppServerMessage, SocketHandle, SocketStatus } from '../net/ws-client'
import { canTrade, initialRoomState, reduceRoom } from '../room/room-state'
import { hasWorkerUrl, runtimeSocketDeps } from './socket-deps'

export interface RoomHandlers {
  onMessage(msg: AppServerMessage): void
  onStatus(status: SocketStatus, closeCode?: number): void
}

/** Opens the room socket; tests pass a fake. */
export type OpenRoom = (handlers: RoomHandlers) => SocketHandle

export interface RoomOptions {
  open?: OpenRoom
  /** Clock for the reconnect countdown (ms); injectable so tests need no real time. */
  now?: () => number
}

const COUNTDOWN_STEP_MS = 1_000

/**
 * One room over its socket (UF-004, UF-005). State comes from `reduceRoom`; the socket and the
 * reconnect countdown timer stop when the owning scope ends.
 */
export function useRoom(roomId: string, nick: string, options: RoomOptions = {}) {
  const open: OpenRoom =
    options.open ??
    ((handlers) =>
      hasWorkerUrl()
        ? openRoomSocket(roomId, nick, { ...runtimeSocketDeps(), ...handlers })
        : unreachableSocket(handlers))
  const now = options.now ?? (() => Date.now())

  const state = shallowRef(initialRoomState)
  const status = ref<SocketStatus>('connecting')
  const socketCloseCode = ref<number | null>(null)
  /** Seconds left of the 30 s grace (FR-015); `null` while connected. */
  const reconnectLeftS = ref<number | null>(null)

  let countdown: ReturnType<typeof setInterval> | null = null
  let reconnectingSince = 0

  function stopCountdown(): void {
    if (countdown !== null) clearInterval(countdown)
    countdown = null
    reconnectLeftS.value = null
  }

  function updateCountdown(): void {
    const left = Math.ceil((DISCONNECT_GRACE_MS - (now() - reconnectingSince)) / 1_000)
    reconnectLeftS.value = Math.max(0, left)
  }

  function onStatus(next: SocketStatus, code?: number): void {
    status.value = next
    if (next === 'closed') socketCloseCode.value = code ?? null
    if (next !== 'reconnecting') return stopCountdown()
    if (countdown !== null) return
    reconnectingSince = now()
    updateCountdown()
    countdown = setInterval(updateCountdown, COUNTDOWN_STEP_MS)
  }

  const socket = open({
    onMessage: (msg) => {
      if (msg.type === 'auth.ok') setAdmin(msg.admin)
      state.value = reduceRoom(state.value, msg)
    },
    onStatus,
  })

  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    stopCountdown()
    socket.close()
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    state,
    status,
    reconnectLeftS,
    /** Kick (4403), admin room close (4410) or auth failure (4401); no more retries follow. */
    closeCode: computed(() => state.value.closeCode ?? socketCloseCode.value),
    /** Intents are disabled, not queued, while the socket is not ready (spec 05 trade-offs). */
    canTrade: computed(() => status.value === 'ready' && canTrade(state.value.you)),
    start: () => socket.send({ type: 'room.start' }),
    order: (side: 'BUY' | 'SELL', qty: OrderQty) => socket.send({ type: 'order', side, qty }),
    closePosition: () => socket.send({ type: 'close' }),
    kick: (kickNick: string) => socket.send({ type: 'admin.kick', nick: kickNick }),
    /** Tells the server, then ends the socket; the caller navigates away. */
    leave: () => {
      socket.send({ type: 'room.leave' })
      dispose()
    },
    clearError: () => {
      state.value = { ...state.value, error: null }
    },
    dispose,
  }
}
