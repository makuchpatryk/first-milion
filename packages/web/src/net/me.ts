import { mePath } from './url'

/**
 * Asks the Worker whether the signed-in user is an admin (BR-017), for pages that open no game
 * socket. The token goes in the `Authorization` header, never in the URL (NFR-004). Throws on any
 * failure so the caller keeps what it already knows.
 */
export async function fetchIsAdmin(
  baseUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchFn(new URL(mePath(), baseUrl), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`/api/me failed: ${response.status}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('admin' in body) || typeof body.admin !== 'boolean') {
    throw new Error('/api/me returned an unexpected body')
  }
  return body.admin
}
