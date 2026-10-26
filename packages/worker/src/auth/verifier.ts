import type { WorkerConfig } from '../env'
import { fetchFirebaseJwks } from './jwks'
import { createTokenVerifier, type TokenVerifier } from './verify-token'

/** The verifier wired to the real clock and the cached Firebase JWKS; shared by sockets and `/api/me`. */
export function createVerifier(config: WorkerConfig): TokenVerifier {
  return createTokenVerifier({
    projectId: config.projectId,
    emulator: config.emulator,
    fetchJwks: fetchFirebaseJwks,
    now: () => Date.now(),
  })
}
