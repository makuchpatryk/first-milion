import { describe, expect, it } from 'vitest'
import { parseCreateForm, type CreateFormInput } from './create-form'

const input = (over: Partial<CreateFormInput> = {}): CreateFormInput => ({
  name: 'Alpha',
  durationMin: 5,
  speed: 3,
  targetText: '',
  ...over,
})

describe('parseCreateForm (FR-009)', () => {
  it('an empty target means no target (null)', () => {
    expect(parseCreateForm(input())).toEqual({
      ok: true,
      form: { name: 'Alpha', durationMin: 5, speed: 3, profitTarget: null },
    })
  })

  it('a whole target of at least 100 is a number', () => {
    const result = parseCreateForm(input({ targetText: ' 500 ' }))
    expect(result).toEqual({
      ok: true,
      form: { name: 'Alpha', durationMin: 5, speed: 3, profitTarget: 500 },
    })
  })

  it('FR-009 AC: a target of 99 is refused with the target error', () => {
    expect(parseCreateForm(input({ targetText: '99' }))).toEqual({
      ok: false,
      errors: { name: null, target: 'create.error.target' },
    })
  })

  it.each(['12.5', 'abc', '-200', '1e3'])('a target of "%s" is not a whole number', (text) => {
    const result = parseCreateForm(input({ targetText: text }))
    expect(result.ok).toBe(false)
  })

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
