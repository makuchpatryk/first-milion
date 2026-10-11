// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isTypingTarget, orderKey } from './keys'

const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
  orderKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('isTypingTarget', () => {
  it('UF-002: INPUT, TEXTAREA and SELECT are typing targets', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('UF-002: buttons, the body and a missing target are not', () => {
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('orderKey', () => {
  it('FR-004: b, s and c map to buy, sell and close, in either case', () => {
    expect(key('b')).toBe('buy')
    expect(key('B')).toBe('buy')
    expect(key('s')).toBe('sell')
    expect(key('S')).toBe('sell')
    expect(key('c')).toBe('close')
    expect(key('C')).toBe('close')
  })

  it('FR-004: other keys do nothing', () => {
    expect(key('x')).toBeNull()
    expect(key('Enter')).toBeNull()
    expect(key(' ')).toBeNull()
  })

  it('FR-004: a modified key (Ctrl+S, Cmd+C, Alt+B) never trades', () => {
    expect(key('s', { ctrlKey: true })).toBeNull()
    expect(key('c', { metaKey: true })).toBeNull()
    expect(key('b', { altKey: true })).toBeNull()
  })
})
