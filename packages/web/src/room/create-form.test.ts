import { describe, expect, it } from 'vitest'
import { parseCreateForm, type CreateFormInput } from './create-form'

const input = (over: Partial<CreateFormInput> = {}): CreateFormInput => ({
  name: 'Alpha',
  durationMin: 5,
  speed: 3,
  startText: '10000',
  goalText: '25000',
  ...over,
})

const NO_ERRORS = { name: null, start: null, goal: null }

describe('parseCreateForm (FR-009)', () => {
  it('whole numbers are sent as numbers, spaces around them are ignored', () => {
    expect(parseCreateForm(input({ startText: ' 5000 ', goalText: ' 25000 ' }))).toEqual({
      ok: true,
      form: { name: 'Alpha', durationMin: 5, speed: 3, startCash: 5000, goal: 25000 },
    })
  })

  it('FR-004: a goal above the slider range is accepted', () => {
    const result = parseCreateForm(input({ goalText: '5000000' }))
    expect(result.ok && result.form.goal).toBe(5_000_000)
  })

  it('the goal is required: an empty field is refused with the goal error', () => {
    expect(parseCreateForm(input({ goalText: '' }))).toEqual({
      ok: false,
      errors: { ...NO_ERRORS, goal: 'create.error.goal' },
    })
  })

  it.each(['10000', '9000'])('a goal of %s with a start of 10,000 is refused with the goal error', (goalText) => {
    expect(parseCreateForm(input({ goalText }))).toEqual({
      ok: false,
      errors: { ...NO_ERRORS, goal: 'create.error.goal' },
    })
  })

  it('the start is required: an empty field is refused with the start error', () => {
    expect(parseCreateForm(input({ startText: '' }))).toEqual({
      ok: false,
      errors: { ...NO_ERRORS, start: 'create.error.start' },
    })
  })

  it.each(['500', '0', '101000', '1500', '10001'])(
    'BR-003: a start of %s is outside the range or off the 1,000 grid',
    (startText) => {
      expect(parseCreateForm(input({ startText }))).toMatchObject({
        ok: false,
        errors: { start: 'create.error.start' },
      })
    },
  )

  it.each(['12.5', 'abc', '-25000', '1e5', '20 000'])('"%s" is not a whole number in either field', (text) => {
    expect(parseCreateForm(input({ goalText: text })).ok).toBe(false)
    expect(parseCreateForm(input({ startText: text })).ok).toBe(false)
  })

  it.each(['ab', 'x'.repeat(31), '   '])('a name of "%s" is refused with the name error', (name) => {
    expect(parseCreateForm(input({ name }))).toEqual({
      ok: false,
      errors: { ...NO_ERRORS, name: 'create.error.name' },
    })
  })

  it('the name is trimmed before it is sent', () => {
    const result = parseCreateForm(input({ name: '  Alpha  ' }))
    expect(result.ok && result.form.name).toBe('Alpha')
  })

  it('reports every error at once', () => {
    expect(parseCreateForm(input({ name: 'a', startText: '5', goalText: '5' }))).toEqual({
      ok: false,
      errors: { name: 'create.error.name', start: 'create.error.start', goal: 'create.error.goal' },
    })
  })
})
