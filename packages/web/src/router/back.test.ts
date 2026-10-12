import { describe, expect, it } from 'vitest'
import { backFor } from './back'

describe('backFor', () => {
  it('rooms list, single play and settings go back to the menu', () => {
    for (const path of ['/rooms', '/single', '/settings']) {
      expect(backFor(path, 'verified')).toEqual({ to: '/menu', labelKey: 'nav.backToMenu' })
    }
  })

  it('the create form and a room go back to the room list', () => {
    for (const path of ['/rooms/new', '/rooms/abc123']) {
      expect(backFor(path, 'verified')).toEqual({ to: '/rooms', labelKey: 'nav.backToRooms' })
    }
  })

  it('FR-018: the privacy page goes back to the home screen of the visitor status', () => {
    expect(backFor('/privacy', 'verified')?.to).toBe('/menu')
    expect(backFor('/privacy', 'unverified')?.to).toBe('/verify')
    expect(backFor('/privacy', 'out')?.to).toBe('/login')
  })

  it('top-level screens have no back link', () => {
    for (const path of ['/menu', '/login', '/verify', '/rooms/']) {
      expect(backFor(path, 'verified')).toBeNull()
    }
  })
})
