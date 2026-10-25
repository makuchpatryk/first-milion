// WebSocket close codes in the application range 4000-4999. The web client maps them to i18n keys (M5).
export const CLOSE_CODES = {
  /** Bad token, unverified account or no `auth` within the deadline (FR-007). */
  AUTH_FAILED: 4401,
  /** Admin removed the player (BR-017). */
  KICKED: 4403,
  /** Admin closed the room (BR-017). */
  ROOM_CLOSED: 4410,
  /** A newer socket of the same user took over the room; terminal for the old one (decision 47). */
  REPLACED: 4409,
} as const
export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES]
