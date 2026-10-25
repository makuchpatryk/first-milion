import { CLOSE_CODES, type ErrorCode } from '@fm/shared/protocol'

/**
 * Server error code to i18n key. The server sends codes, never text (ARCHITECTURE Errors); the
 * `never` default makes a new `ErrorCode` a compile error until it gets a message.
 */
export function errorKey(code: ErrorCode): string {
  switch (code) {
    case 'RATE_LIMITED':
      return 'error.rateLimited'
    case 'ELIMINATED':
      return 'error.eliminated'
    case 'FORBIDDEN':
      return 'error.forbidden'
    case 'INVALID_STATE':
      return 'error.invalidState'
    case 'INVALID_PAYLOAD':
      return 'error.invalidPayload'
    case 'ROOM_FULL':
      return 'error.roomFull'
    case 'ROOM_CLOSED':
      return 'error.roomClosed'
    case 'ROOM_NOT_FOUND':
      return 'error.roomNotFound'
    default:
      return assertNever(code)
  }
}

function assertNever(value: never): never {
  throw new Error(`unmapped error code: ${String(value)}`)
}

/** Close code to i18n key; any code the server does not define is a network loss. */
export function closeKey(code: number): string {
  switch (code) {
    case CLOSE_CODES.AUTH_FAILED:
      return 'close.authFailed'
    case CLOSE_CODES.KICKED:
      return 'close.kicked'
    case CLOSE_CODES.ROOM_CLOSED:
      return 'close.roomClosed'
    case CLOSE_CODES.REPLACED:
      return 'close.replaced'
    default:
      return 'close.network'
  }
}
