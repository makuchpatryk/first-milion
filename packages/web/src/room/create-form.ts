import { roomFormSchema, type RoomForm } from '@fm/shared/validation'
import { parseWholeNumber } from './goal'

export interface CreateFormInput {
  name: string
  durationMin: number
  speed: number
  /** Raw text of the start capital field. */
  startText: string
  /** Raw text of the required goal field. */
  goalText: string
}

export interface CreateFormErrors {
  name: string | null
  start: string | null
  goal: string | null
}

export type CreateFormResult =
  | { ok: true; form: RoomForm }
  | { ok: false; errors: CreateFormErrors }

/**
 * Room form (FR-009) to the exact object `room.create` carries. The rules live in
 * `roomFormSchema`; this only turns the money texts into numbers and the schema's issues into
 * i18n keys. The server validates again (NFR-004).
 */
export function parseCreateForm(input: CreateFormInput): CreateFormResult {
  const parsed = roomFormSchema.safeParse({
    name: input.name,
    durationMin: input.durationMin,
    speed: input.speed,
    // Text that is not a whole number stays text, so the schema reports its field as the issue.
    startCash: parseWholeNumber(input.startText) ?? input.startText,
    goal: parseWholeNumber(input.goalText) ?? input.goalText,
  })
  if (parsed.success) return { ok: true, form: parsed.data }

  const failed = new Set(parsed.error.issues.map((issue) => issue.path[0]))
  return {
    ok: false,
    errors: {
      name: failed.has('name') ? 'create.error.name' : null,
      start: failed.has('startCash') ? 'create.error.start' : null,
      goal: failed.has('goal') ? 'create.error.goal' : null,
    },
  }
}
