/**
 * Sliding-window limit: orders per player (BR-018, FR-012) and frames per socket (PRD §20 #49).
 * Every attempt is recorded, also the refused ones, so a flood of rejected attempts cannot hide
 * from the counter (planning default).
 */
export class SlidingWindowLimit {
  /** The newest attempt times inside the window, oldest first; never more than `max + 1`. */
  private readonly attempts: number[] = []

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt at `now`; false when it is more than `max` within `windowMs`. */
  attempt(now: number): boolean {
    const oldest = now - this.windowMs
    while ((this.attempts[0] ?? Infinity) <= oldest) this.attempts.shift()
    this.attempts.push(now)
    // `max + 1` newest attempts are enough to tell whether more than `max` fall in the window, so a
    // flood cannot grow this list.
    if (this.attempts.length > this.max + 1) this.attempts.shift()
    return this.attempts.length <= this.max
  }
}
