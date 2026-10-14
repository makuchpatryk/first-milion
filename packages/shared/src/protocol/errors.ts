// Closed union: the server replies with a code, never text (ARCHITECTURE Errors).
// `web/i18n` maps every code to a PL and EN message.
export const ERROR_CODES = [
  'RATE_LIMITED',
  'ELIMINATED',
  'FORBIDDEN',
  'INVALID_STATE',
  'INVALID_PAYLOAD',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'ROOM_NOT_FOUND',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
