// Fixed rule values (BR-003 and friends). Tunables live in config.ts (PRD §20 #30).

export const START_CASH = 10_000
export const START_PRICE = 100
export const MIN_PRICE = 5
export const SPREAD = 0.06

export const ORDER_QTYS = [10, 50, 100, 250] as const
export type OrderQty = (typeof ORDER_QTYS)[number]

export const ROUND_DURATIONS_MIN = [3, 5, 10] as const
export type RoundDuration = (typeof ROUND_DURATIONS_MIN)[number]

export const SPEEDS = [1, 3, 8] as const
export type Speed = (typeof SPEEDS)[number]

export const MAX_PLAYERS = 4
export const MAX_OBSERVERS = 4

export const ORDER_RATE_PER_SEC = 10
export const DISCONNECT_GRACE_MS = 30_000
export const EMPTY_ROOM_TTL_MS = 300_000

export const NICK_PATTERN = /^[A-Za-z0-9_-]{3,16}$/

export const ROOM_NAME_MIN = 3
export const ROOM_NAME_MAX = 30

export const PROFIT_TARGET_MIN = 100
