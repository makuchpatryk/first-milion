// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChipGroup from './ChipGroup.vue'

const SIZES = [10, 50, 100, 250] as const

function mountGroup(props: { modelValue: number; disabled?: boolean } = { modelValue: 50 }) {
  return mount(ChipGroup, {
    props: {
      label: 'Size',
      items: SIZES,
      format: (item: string | number) => String(item),
      ...props,
    },
  })
}

describe('ChipGroup', () => {
  it('UF-002: exactly one chip has aria-pressed="true", the selected one', () => {
    const wrapper = mountGroup({ modelValue: 100 })
    const pressed = wrapper.findAll('button').filter((b) => b.attributes('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]?.text()).toBe('100')
  })

  it('UF-002: is a labelled group of one button per item', () => {
    const wrapper = mountGroup()
    expect(wrapper.attributes('role')).toBe('group')
    expect(wrapper.attributes('aria-label')).toBe('Size')
    expect(wrapper.findAll('button')).toHaveLength(SIZES.length)
  })

  it('UF-002: clicking a chip emits the item as update:modelValue', async () => {
    const wrapper = mountGroup()
    await wrapper.findAll('button')[3]?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[250]])
  })

  it('UF-002: disabled disables every chip', () => {
    const wrapper = mountGroup({ modelValue: 50, disabled: true })
    expect(wrapper.findAll('button').every((b) => b.attributes('disabled') !== undefined)).toBe(
      true,
    )
  })
})
