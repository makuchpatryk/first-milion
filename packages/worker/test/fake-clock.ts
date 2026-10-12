import type { Handle, Timers } from '../src/timers'

interface Pending {
  at: number
  fn: () => void
}

/** Deterministic clock and timers for logic tests: time moves only through `advance`. */
export class FakeClock implements Timers {
  private time = 0
  private nextHandle = 1
  private readonly pending = new Map<Handle, Pending>()

  readonly now = (): number => this.time

  schedule = (fn: () => void, ms: number): Handle => {
    const handle = this.nextHandle++
    this.pending.set(handle, { at: this.time + ms, fn })
    return handle
  }

  cancel = (handle: Handle): void => {
    this.pending.delete(handle)
  }

  get pendingCount(): number {
    return this.pending.size
  }

  /** Runs timers due within `ms` in time order; timers they schedule inside the window run too. */
  advance(ms: number): void {
    const target = this.time + ms
    for (;;) {
      let nextHandle: Handle | null = null
      let next: Pending | null = null
      for (const [handle, timer] of this.pending) {
        if (timer.at <= target && (next === null || timer.at < next.at)) {
          nextHandle = handle
          next = timer
        }
      }
      if (next === null || nextHandle === null) break
      this.pending.delete(nextHandle)
      this.time = Math.max(this.time, next.at)
      next.fn()
    }
    this.time = target
  }
}
