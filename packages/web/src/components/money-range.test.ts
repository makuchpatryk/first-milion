// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createAppI18n } from '../i18n'
import MoneyRange from './MoneyRange.vue'

/** Mounts the field with a v-model that feeds updates back into the props, like a parent would. */
function mountRange(over: { modelValue?: string; error?: string | null } = {}): VueWrapper {
  const wrapper: VueWrapper = mount(MoneyRange, {
    props: {
      id: 'goal',
      label: 'Goal ($)',
      modelValue: '30000',
      min: 11_000,
      max: 1_000_000,
      step: 1_000,
      hint: 'Above the start.',
      error: null,
      ...over,
      'onUpdate:modelValue': (value: string) => void wrapper.setProps({ modelValue: value }),
    },
    global: { plugins: [createAppI18n('en')] },
  })
  return wrapper
}

const valueOf = (w: VueWrapper, selector: string) => (w.get(selector).element as HTMLInputElement).value
const SLIDER = 'input[type="range"]'
const FIELD = 'input[type="text"]'

describe('MoneyRange (FR-003, FR-004)', () => {
  it('shows one value on the slider and in the text field', () => {
    const w = mountRange()
    expect(valueOf(w, SLIDER)).toBe('30000')
    expect(valueOf(w, FIELD)).toBe('30000')
  })

  it('moving the slider writes the number into the text field', async () => {
    const w = mountRange()
    await w.get(SLIDER).setValue('50000')
    expect(valueOf(w, FIELD)).toBe('50000')
  })

  it('typing updates the slider position', async () => {
    const w = mountRange()
    await w.get(FIELD).setValue('75000')
    expect(valueOf(w, SLIDER)).toBe('75000')
  })

  it('FR-004: a text above the slider scale is kept, the slider stops at its end', async () => {
    const w = mountRange()
    await w.get(FIELD).setValue('5000000')
    expect(valueOf(w, FIELD)).toBe('5000000')
    expect(valueOf(w, SLIDER)).toBe('1000000')
  })

  it('text that is not a number yet is kept and the slider rests at its start', async () => {
    const w = mountRange()
    await w.get(FIELD).setValue('3x')
    expect(valueOf(w, FIELD)).toBe('3x')
    expect(valueOf(w, SLIDER)).toBe('11000')
  })

  it('NFR-003: the slider takes its scale and the text field is numeric', () => {
    const w = mountRange()
    expect(w.get(SLIDER).attributes()).toMatchObject({ min: '11000', max: '1000000', step: '1000' })
    expect(w.get(FIELD).attributes('inputmode')).toBe('numeric')
  })

  it('NFR-003: both controls are named, the label points at the text field', () => {
    const w = mountRange()
    expect(w.get('label').attributes('for')).toBe('goal')
    expect(w.get(FIELD).attributes('id')).toBe('goal')
    expect(w.get(SLIDER).attributes('aria-label')).toBe('Goal ($)')
    expect(w.get(SLIDER).attributes('aria-valuetext')).toBe('$30,000')
  })

  it('NFR-003: the hint describes the field; an error replaces it as an alert and marks it invalid', () => {
    const calm = mountRange()
    expect(calm.get(FIELD).attributes('aria-describedby')).toBe('goal-hint')
    expect(calm.get(FIELD).attributes('aria-invalid')).toBe('false')
    expect(calm.find('[role="alert"]').exists()).toBe(false)

    const failed = mountRange({ error: 'Too low.' })
    const alert = failed.get('[role="alert"]')
    expect(alert.text()).toBe('Too low.')
    expect(alert.attributes('id')).toBe('goal-error')
    expect(failed.get(FIELD).attributes('aria-describedby')).toBe('goal-error')
    expect(failed.get(FIELD).attributes('aria-invalid')).toBe('true')
  })
})
