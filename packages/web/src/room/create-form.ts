import { roomFormSchema, type RoomForm } from '@fm/shared/validation'
import { parseGoal } from './goal'

export interface CreateFormInput {
  name: string
  durationMin: number
  speed: number
  /** Raw text of the required goal field. */
  targetText: string
}

export interface CreateFormErrors {
  name: string | null
  target: string | null
}

export type CreateFormResult =
  | { ok: true; form: RoomForm }
  | { ok: false; errors: CreateFormErrors }

/**
 * Room form (FR-009) to the exact object `room.create` carries. The rules live in
 * `roomFormSchema`; this only turns the goal text into a number and the schema's issues into
 * i18n keys. The server validates again (NFR-004).
 */
export function parseCreateForm(input: CreateFormInput): CreateFormResult {
  const parsed = roomFormSchema.safeParse({
    name: input.name,
    durationMin: input.durationMin,
    speed: input.speed,
    // Text that is not a goal stays text, so the schema reports `profitTarget` as the issue.
    profitTarget: parseGoal(input.targetText) ?? input.targetText,
  })
  if (parsed.success) return { ok: true, form: parsed.data }

  const failed = new Set(parsed.error.issues.map((issue) => issue.path[0]))
  return {
    ok: false,
    errors: {
      name: failed.has('name') ? 'create.error.name' : null,
      target: failed.has('profitTarget') ? 'create.error.target' : null,
    },
  }
}
