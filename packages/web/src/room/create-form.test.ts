import { describe, expect, it } from 'vitest'
import { parseCreateForm, type CreateFormInput } from './create-form'

const input = (over: Partial<CreateFormInput> = {}): CreateFormInput => ({
  name: 'Alpha',
  durationMin: 5,
  speed: 3,
  targetText: '25000',
  ...over,
})

describe('parseCreateForm (FR-009)', () => {
  it('a whole goal of at least 20,000 is a number', () => {
    expect(parseCreateForm(input({ targetText: ' 25000 ' }))).toEqual({
      ok: true,
      form: { name: 'Alpha', durationMin: 5, speed: 3, profitTarget: 25000 },
    })
  })

  it('the goal is required: an empty field is refused with the target error', () => {
    expect(parseCreateForm(input({ targetText: '' }))).toEqual({
      ok: false,
      errors: { name: null, target: 'create.error.target' },
    })
  })

  it('a goal below 20,000 is refused with the target error', () => {
    expect(parseCreateForm(input({ targetText: '19999' }))).toEqual({
      ok: false,
      errors: { name: null, target: 'create.error.target' },
    })
  })

  it.each(['12.5', 'abc', '-25000', '1e5', '20 000'])(
    'a goal of "%s" is not a whole number',
    (text) => {
      const result = parseCreateForm(input({ targetText: text }))
      expect(result.ok).toBe(false)
    },
  )

  it.each(['ab', 'x'.repeat(31), '   '])('a name of "%s" is refused with the name error', (name) => {
    expect(parseCreateForm(input({ name }))).toEqual({
      ok: false,
      errors: { name: 'create.error.name', target: null },
    })
  })

  it('the name is trimmed before it is sent', () => {
    const result = parseCreateForm(input({ name: '  Alpha  ' }))
    expect(result.ok && result.form.name).toBe('Alpha')
  })

  it('reports both errors at once', () => {
    expect(parseCreateForm(input({ name: 'a', targetText: '5' }))).toEqual({
      ok: false,
      errors: { name: 'create.error.name', target: 'create.error.target' },
    })
  })
})
