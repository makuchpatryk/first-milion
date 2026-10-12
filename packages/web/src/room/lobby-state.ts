import type { ErrorCode, RoomSummary, ServerMessage } from '@fm/shared/protocol'
import { MAX_OBSERVERS, MAX_PLAYERS } from '@fm/shared/rules'

export interface LobbyState {
  rooms: readonly RoomSummary[]
  /** From `auth.ok`; the server checks every admin action again (FR-017). */
  isAdmin: boolean
  /** Set by `room.created`; the create screen navigates to it. */
  createdRoomId: string | null
  /** Last server error on the lobby socket (e.g. a rejected `room.create`). */
  error: ErrorCode | null
}

export const initialLobbyState: LobbyState = {
  rooms: [],
  isAdmin: false,
  createdRoomId: null,
  error: null,
}

export function reduceLobby(state: LobbyState, msg: ServerMessage): LobbyState {
  switch (msg.type) {
    case 'auth.ok':
      return { ...state, isAdmin: msg.admin }
    case 'lobby.rooms':
      return { ...state, rooms: msg.rooms }
    case 'room.created':
      return { ...state, createdRoomId: msg.roomId, error: null }
    case 'error':
      return { ...state, error: msg.code }
    default:
      return state
  }
}

export type JoinPolicy = 'player' | 'observer' | 'closed'

/**
 * How a click on a list row will seat the user (BP-003, FR-010). Mirrors the server's
 * `assignRole`: a lobby-state room with a free player slot seats a player, anything else an
 * observer while observer slots remain. The server decides; this only labels the button.
 */
export function joinPolicy(room: Pick<RoomSummary, 'status' | 'players' | 'observers'>): JoinPolicy {
  if (room.status === 'lobby' && room.players < MAX_PLAYERS) return 'player'
  return room.observers < MAX_OBSERVERS ? 'observer' : 'closed'
}
