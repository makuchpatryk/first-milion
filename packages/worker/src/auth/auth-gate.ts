import { AUTH_TIMEOUT_MS } from '@fm/shared/config'
import { CLOSE_CODES, parseClientMessage } from '@fm/shared/protocol'
import type { Handle, Timers } from '../timers'
import type { TokenVerifier } from './verify-token'

export interface Session {
  uid: string
  admin: boolean
}

export interface AuthGateDeps extends Timers {
  verify: TokenVerifier
  isAdmin(uid: string): boolean
  close(code: number): void
  sendAuthOk(admin: boolean): void
  onAuthed(session: Session): void
}

/**
 * Per-socket authorization (FR-007). The first message must be a valid `auth` within
 * `AUTH_TIMEOUT_MS`; anything else closes with 4401. After that the shell routes all other
 * messages itself and passes only `auth` frames back here: a refresh re-verifies the token and
 * must keep the same UID (a socket never changes identity).
 */
export class AuthGate {
  private current: Session | null = null
  private timer: Handle | null
  private busy = false
  private done = false

  constructor(private readonly deps: AuthGateDeps) {
    this.timer = deps.schedule(() => {
      if (this.current === null) this.fail()
    }, AUTH_TIMEOUT_MS)
  }

  get session(): Session | null {
    return this.current
  }

  async handle(raw: unknown): Promise<void> {
    if (this.done) return
    const parsed = parseClientMessage(raw)
    if (!parsed.ok || parsed.msg.type !== 'auth' || this.busy) {
      // Before auth, any other frame (or a frame pipelined behind a pending verify) is fatal.
      if (this.current === null) this.fail()
      return
    }

    this.busy = true
    const user = await this.deps.verify(parsed.msg.token)
    this.busy = false
    if (this.done) return // timed out or socket closed while verifying
    if (user === null) return this.fail()
    const previous = this.current
    if (previous !== null && previous.uid !== user.uid) return this.fail()

    const session = { uid: user.uid, admin: this.deps.isAdmin(user.uid) }
    this.current = session
    this.stopTimer()
    this.deps.sendAuthOk(session.admin)
    if (previous === null) this.deps.onAuthed(session)
  }

  /** Socket closed: stop the deadline timer and ignore a verify still in flight. */
  dispose(): void {
    this.done = true
    this.stopTimer()
  }

  private fail(): void {
    this.done = true
    this.stopTimer()
    this.deps.close(CLOSE_CODES.AUTH_FAILED)
  }

  private stopTimer(): void {
    if (this.timer === null) return
    this.deps.cancel(this.timer)
    this.timer = null
  }
}
