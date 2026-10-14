/** Remaining round time as `m:ss`, rounded up so the display reaches 0:00 only at the end. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Share of the way from the start capital to the goal equity, 0 to 1 (BR-009). */
export function goalProgress(equity: number, startCash: number, goal: number): number {
  if (goal <= startCash) return 0
  return Math.min(1, Math.max(0, (equity - startCash) / (goal - startCash)))
}
