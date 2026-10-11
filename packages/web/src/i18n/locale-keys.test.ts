import { describe, expect, it } from 'vitest'
import en from './en.json'
import pl from './pl.json'

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  if (typeof node !== 'object' || node === null) throw new Error(`unexpected value at ${prefix}`)
  return Object.entries(node).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...flatten(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  )
}

const plKeys = flatten(pl)
const enKeys = flatten(en)

describe('locale completeness (FR-019)', () => {
  it('FR-019: pl.json and en.json have identical key sets', () => {
    expect(Object.keys(plKeys).sort()).toEqual(Object.keys(enKeys).sort())
  })

  it('FR-019: no value is empty in either language', () => {
    const empty = [...Object.entries(plKeys), ...Object.entries(enKeys)]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('FR-005: all eight shock headlines exist in both languages', () => {
    for (const dir of ['up', 'down']) {
      for (let i = 0; i < 4; i++) {
        expect(plKeys[`news.shock.${dir}.${i}`]).toBeTruthy()
        expect(enKeys[`news.shock.${dir}.${i}`]).toBeTruthy()
      }
    }
  })

  it('FR-018: the privacy policy covers account data, infrastructure, results and deletion', () => {
    for (const key of ['dataBody', 'infraBody', 'gameBody', 'deleteBody']) {
      expect(plKeys[`privacy.${key}`]).toBeTruthy()
      expect(enKeys[`privacy.${key}`]).toBeTruthy()
    }
  })
})
