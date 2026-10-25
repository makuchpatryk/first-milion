import { HISTORY_MAX } from '@fm/shared/config'
import { CLOSE_CODES } from '@fm/shared/protocol'
import type {
  ErrorCode,
  LastRound,
  MeRound,
  NewsView,
  RankRow,
  RoomView,
} from '@fm/shared/protocol'
import type { AppServerMessage } from '../net/ws-client'

export interface RoomState {
  /** From `auth.ok`; kick is offered only to admins, the server checks again (FR-017). */
  isAdmin: boolean
  view: RoomView | null
  /** True prices, newest last, at most `HISTORY_MAX` (`room.history`, then each `room.tick`). */
  history: readonly number[]
  price: number | null
  news: NewsView | null
  /** Price steps since `news` was drawn (the engine's `newsAge`). */
  newsAgeTicks: number
  endsInMs: number | null
  ranking: readonly RankRow[]
  you: MeRound | null
  /** From `round.end`; cleared when the next round starts. */
  lastResult: LastRound | null
  error: ErrorCode | null
  /** Set by `kicked` (4403) or an admin room close (4410); the socket is gone for good. */
  closeCode: number | null
}

export const initialRoomState: RoomState = {
  isAdmin: false,
  view: null,
  history: [],
  price: null,
  news: null,
  newsAgeTicks: 0,
  endsInMs: null,
  ranking: [],
  you: null,
  lastResult: null,
  error: null,
  closeCode: null,
}

/**
 * What a new round starts from: nothing of the previous round survives (BR-014 keeps `lastRound`
 * in the view), only what belongs to the connection.
 */
function freshRound(state: RoomState, view: RoomView): RoomState {
  return {
    ...initialRoomState,
    isAdmin: state.isAdmin,
    view,
    closeCode: state.closeCode,
  }
}

/** Appends this interval's prices, keeping the cap the server uses; returns how many fell off the front. */
function appendPrices(history: readonly number[], prices: readonly number[]) {
  const all = [...history, ...prices]
  const dropped = Math.max(0, all.length - HISTORY_MAX)
  return { history: dropped > 0 ? all.slice(dropped) : all, dropped }
}

function applyTick(
  state: RoomState,
  msg: Extract<AppServerMessage, { type: 'room.tick' }>,
): RoomState {
  const { history } = appendPrices(state.history, msg.prices)
  return {
    ...state,
    history,
    price: msg.price,
    // Same interval the event was drawn: age counts the steps since then (FR-005).
    news: msg.news ?? state.news,
    newsAgeTicks: msg.news === null ? state.newsAgeTicks + msg.prices.length : 0,
    endsInMs: msg.endsInMs,
    ranking: msg.ranking,
    you: msg.you,
  }
}

/**
 * Room socket messages to UI state. Pure and DOM-free, so every screen rule below is tested
 * without a socket. The server is the only source of price, ranking and result (BR-007).
 */
export function reduceRoom(state: RoomState, msg: AppServerMessage): RoomState {
  switch (msg.type) {
    case 'room.state': {
      const startsRound = msg.view.status === 'running' && state.view?.status === 'lobby'
      return startsRound ? freshRound(state, msg.view) : { ...state, view: msg.view }
    }
    case 'room.history':
      return { ...state, history: msg.prices.slice(-HISTORY_MAX) }
    case 'room.tick':
      return applyTick(state, msg)
    case 'order.ok':
      return { ...state, you: msg.you, error: null }
    case 'round.end':
      return {
        ...state,
        lastResult: { reason: msg.reason, winners: msg.winners, ranking: msg.ranking },
        ranking: msg.ranking,
        endsInMs: null,
      }
    case 'kicked':
      return { ...state, closeCode: CLOSE_CODES.KICKED }
    case 'error':
      return {
        ...state,
        error: msg.code,
        closeCode: msg.code === 'ROOM_CLOSED' ? CLOSE_CODES.ROOM_CLOSED : state.closeCode,
      }
    case 'auth.ok':
      return { ...state, isAdmin: msg.admin }
    case 'lobby.rooms':
    case 'room.created':
      return state
  }
}

/** Order buttons are live for an active player (UF-004, FR-014). */
export function canTrade(you: MeRound | null): boolean {
  return you !== null && you.role === 'player' && you.status === 'active'
}
