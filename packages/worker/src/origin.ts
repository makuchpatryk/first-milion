import { splitList } from './env'

/** Exact match against a comma-separated allowlist; no wildcards. Missing `Origin` is refused (FR-007). */
export function isAllowedOrigin(origin: string | null, allowlist: string): boolean {
  if (origin === null) return false
  return splitList(allowlist).includes(origin)
}
