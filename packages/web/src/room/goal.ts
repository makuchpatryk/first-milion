import { START_CASH_MIN } from '@fm/shared/rules'
import { stakesSchema, type Stakes } from '@fm/shared/validation'

const WHOLE_NUMBER = /^\d+$/

/** Slider scale of the goal field (UI only); the text field accepts any whole number above the start (BR-009). */
export const GOAL_SLIDER_MAX = 1_000_000
export const GOAL_SLIDER_STEP = 1_000

/** Lowest goal on the slider: one step above the start (a start that is no number yet counts as the lowest). */
export function goalSliderMin(startCash: number | null): number {
  return (startCash ?? START_CASH_MIN) + GOAL_SLIDER_STEP
}

/**
 * A number typed into a form: a whole number of dollars, or `null` when the text is empty, not
 * whole or not a safe integer. The range and the goal-above-start rule live in the shared
 * schemas; the server checks them again (NFR-004).
 */
export function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export type StakesResult =
  | { ok: true; stakes: Stakes }
  | { ok: false; errors: { start: string | null; goal: string | null } }

/**
 * Start capital and goal texts of the single-play setup (FR-003, FR-004). The rules live in
 * `stakesSchema`; this turns the texts into numbers and the schema's issues into i18n keys.
 */
export function parseStakes(startText: string, goalText: string): StakesResult {
  const parsed = stakesSchema.safeParse({
    // Text that is not a whole number stays text, so the schema reports its field as the issue.
    startCash: parseWholeNumber(startText) ?? startText,
    goal: parseWholeNumber(goalText) ?? goalText,
  })
  if (parsed.success) return { ok: true, stakes: parsed.data }

  const failed = new Set(parsed.error.issues.map((issue) => issue.path[0]))
  return {
    ok: false,
    errors: {
      start: failed.has('startCash') ? 'create.error.start' : null,
      goal: failed.has('goal') ? 'create.error.goal' : null,
    },
  }
}

/**
 * The goal text after the start capital changed: a goal that is no longer above the new start
 * moves to one step above it, anything else (also text that is not a number yet) stays as typed.
 */
export function bumpGoal(startCash: number, goalText: string): string {
  const goal = parseWholeNumber(goalText)
  return goal !== null && goal <= startCash ? String(startCash + GOAL_SLIDER_STEP) : goalText
}
