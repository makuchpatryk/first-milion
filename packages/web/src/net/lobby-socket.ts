import { withTokenRefresh } from './token-refresh'
import { lobbyPath, socketUrl } from './url'
import { createSocket, type SocketHandle, type SocketOptions } from './ws-client'

/** Everything a game socket needs except where it connects to. */
export type SocketDeps = Omit<SocketOptions, 'url'> & {
  /** `VITE_WORKER_URL`. */
  baseUrl: string
}

/** `/ws/lobby`: the live room list, room creation and admin room close (UF-003). */
export function openLobbySocket(deps: SocketDeps): SocketHandle {
  const { baseUrl, ...options } = deps
  return withTokenRefresh(createSocket({ ...options, url: socketUrl(baseUrl, lobbyPath()) }))
}
