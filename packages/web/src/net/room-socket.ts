import type { SocketDeps } from './lobby-socket'
import { withTokenRefresh } from './token-refresh'
import { roomPath, socketUrl } from './url'
import { createSocket, type SocketHandle } from './ws-client'

/**
 * `/ws/room/:id` (UF-004). Sends `room.join` each time the connection becomes ready, so a
 * reconnect restores the seat (FR-015). `ready` fires once per connection, never for a token
 * refresh, so a join is never sent twice on one connection.
 */
export function openRoomSocket(roomId: string, nick: string, deps: SocketDeps): SocketHandle {
  const { baseUrl, onStatus, ...options } = deps
  let handle: SocketHandle | null = null
  handle = withTokenRefresh(
    createSocket({
      ...options,
      url: socketUrl(baseUrl, roomPath(roomId)),
      onStatus: (status, closeCode) => {
        onStatus(status, closeCode)
        if (status === 'ready') handle?.send({ type: 'room.join', roomId, nick })
      },
    }),
  )
  return handle
}
