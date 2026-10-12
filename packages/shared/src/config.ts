// Tunables (PRD §20 #30). Values copied from the prototype
// (first-million.html L191-193, L268-296); do not re-tune here without a decision.

export const TICK_MS = 80

export const HALT_MS = 5_000
// Longest elapsed time one tick interval may count (prototype cap): a stalled Durable Object
// cannot end a halt early by more than this (decision 39).
export const HALT_TICK_CAP_MS = 250

export const FLASH_RECOVER = 0.7
export const FLASH_TICKS = 20

export const VOL_MULT = 3
export const VOL_TICKS = 60

export const TREND_DRIFT = 0.0007
export const TREND_TICKS = 100

// [min, max] ranges in ticks (or fractions for magnitudes).
export const NEWS_FIRST_TICKS = [200, 400] as const
export const NEWS_GAP_TICKS = [250, 650] as const
export const SHOCK_MAG = [0.012, 0.032] as const
export const FLASH_DROP = [0.03, 0.08] as const

export const REGIME_TICKS = [40, 180] as const
export const DRIFT_RANGE = 0.0014
export const VOL_BASE = 0.0006
export const VOL_RANGE = 0.0018

export const NEWS_FADE_TICKS = 90

export const HISTORY_MAX = 2_400

// Worker: auth deadline (FR-007) and Lobby/Room heartbeat (FR-008).
export const AUTH_TIMEOUT_MS = 5_000
export const HEARTBEAT_MS = 30_000
// A room silent for 3 heartbeats is stale (FR-008).
export const STALE_AFTER_MS = 3 * HEARTBEAT_MS
export const LOBBY_SWEEP_MS = 30_000
// Used when the Firebase JWKS response carries no `max-age`.
export const JWKS_FALLBACK_TTL_MS = 3_600_000
// Longest text frame the server parses (NFR-004). The biggest valid message is `auth`: a token of
// up to 4,096 characters plus its envelope.
export const MAX_FRAME_CHARS = 8_192

// Shock headlines are chosen by index; the texts themselves are i18n keys.
export const SHOCK_TEXT_COUNT = 4
