import { describe, expect, it } from 'vitest'
import { backFor } from './back'

describe('backFor', () => {
  it('the rooms list goes back to the menu', () => {
    expect(backFor('/rooms', 'verified')).toEqual({ to: '/menu', labelKey: 'nav.backToMenu' })
  })

  it('FR-018: the privacy page goes back to the home screen of the visitor status', () => {
    expect(backFor('/privacy', 'verified')?.to).toBe('/menu')
    expect(backFor('/privacy', 'unverified')?.to).toBe('/verify')
    expect(backFor('/privacy', 'out')?.to).toBe('/login')
  })

  it('top-level screens have no back link', () => {
    for (const path of ['/menu', '/login', '/verify', '/settings', '/rooms/']) {
      expect(backFor(path, 'verified')).toBeNull()
    }
  })
})
