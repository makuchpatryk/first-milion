/**
 * Timer seam for the logic classes: they get `schedule`/`cancel` injected and never call
 * `setTimeout` themselves (ARCHITECTURE: injected clock). The DO shells wire the real ones.
 */
export type Handle = number

export interface Timers {
  schedule(fn: () => void, ms: number): Handle
  cancel(handle: Handle): void
}

/**
 * The real timers, for the DO shells. workerd's `setTimeout` already returns a number; `Number()`
 * keeps this compiling under the test tsconfig, where Node's typings return a `Timeout`.
 */
export const runtimeTimers: Timers = {
  schedule: (fn, ms) => Number(setTimeout(fn, ms)),
  cancel: (handle) => clearTimeout(handle),
}
