/**
 * Sliding-window limit on one player's orders (BR-018, FR-012). Every attempt is recorded, also
 * the refused ones, so a flood of rejected orders cannot hide from the counter (planning default).
 */
export class OrderRateLimit {
  /** Attempt times inside the window, oldest first. */
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
    return this.attempts.length <= this.max
  }
}
