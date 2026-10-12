import { goalSchema } from '@fm/shared/validation'

const WHOLE_NUMBER = /^\d+$/

/**
 * The goal typed into a form (BR-009): a whole number of dollars from 20,000, or `null` when the
 * text is empty, not whole, or below the minimum. The shared schema has the rule; the server
 * checks it again (NFR-004).
 */
export function parseGoal(text: string): number | null {
  const trimmed = text.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return null
  const parsed = goalSchema.safeParse(Number(trimmed))
  return parsed.success ? parsed.data : null
}
