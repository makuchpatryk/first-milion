import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSavedLocale, resolveLocale, saveLocale } from './locale'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveLocale', () => {
  it('FR-019: en-GB browser without a saved choice gets English', () => {
    expect(resolveLocale(null, 'en-GB')).toBe('en')
  })

  it('FR-019: pl-PL browser without a saved choice gets Polish', () => {
    expect(resolveLocale(null, 'pl-PL')).toBe('pl')
  })

  it('FR-019: a saved choice overrides the browser language', () => {
    expect(resolveLocale('en', 'pl-PL')).toBe('en')
    expect(resolveLocale('pl', 'en-US')).toBe('pl')
  })

  it('FR-019: an unknown saved value falls back to the browser language', () => {
    expect(resolveLocale('de', 'pl-PL')).toBe('pl')
    expect(resolveLocale(42, 'en-GB')).toBe('en')
  })

  it('FR-019: any non-Polish browser language gets English', () => {
    expect(resolveLocale(null, 'de-DE')).toBe('en')
    expect(resolveLocale(null, '')).toBe('en')
  })
})

describe('language storage', () => {
  it('FR-019: storage that throws yields no saved choice, so the browser language decides', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
    })
    expect(resolveLocale(readSavedLocale(), 'pl-PL')).toBe('pl')
  })

  it('FR-019: saving to a storage that throws does not throw', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => saveLocale('en')).not.toThrow()
  })

  it('FR-019: the choice is written under fm-lang', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    saveLocale('en')
    expect(setItem).toHaveBeenCalledWith('fm-lang', 'en')
  })
})
