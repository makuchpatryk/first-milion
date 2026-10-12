import { roomFormSchema, type RoomForm } from '@fm/shared/validation'

export interface CreateFormInput {
  name: string
  durationMin: number
  speed: number
  /** Raw text of the optional target field; empty means no target (FR-009). */
  targetText: string
}

export interface CreateFormErrors {
  name: string | null
  target: string | null
}

export type CreateFormResult =
  | { ok: true; form: RoomForm }
  | { ok: false; errors: CreateFormErrors }

const WHOLE_NUMBER = /^\d+$/

/**
 * Room form (FR-009) to the exact object `room.create` carries. The rules live in
 * `roomFormSchema`; this only turns the target text into `number | null` and the schema's issues
 * into i18n keys. The server validates again (NFR-004).
 */
export function parseCreateForm(input: CreateFormInput): CreateFormResult {
  const targetText = input.targetText.trim()
  const targetIsWhole = targetText === '' || WHOLE_NUMBER.test(targetText)
  const parsed = roomFormSchema.safeParse({
    name: input.name,
    durationMin: input.durationMin,
    speed: input.speed,
    profitTarget: targetText === '' ? null : Number(targetText),
  })
  if (parsed.success && targetIsWhole) return { ok: true, form: parsed.data }

  const failed = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]))
  return {
    ok: false,
    errors: {
      name: failed.has('name') ? 'create.error.name' : null,
      target: failed.has('profitTarget') || !targetIsWhole ? 'create.error.target' : null,
    },
  }
}
