import { describe, expect, it } from 'vitest'
import { routeFor } from './guards'

describe('routeFor', () => {
  it('FR-001 AC / BR-001: a logged-out user reaches only /login and /privacy', () => {
    expect(routeFor('out', '/login')).toBeNull()
    expect(routeFor('out', '/privacy')).toBeNull()
    for (const path of ['/', '/single', '/verify', '/rooms', '/nope']) {
      expect(routeFor('out', path)).toBe('/login')
    }
  })

  it('FR-001 AC / BR-002: an unverified user reaches only /verify and /privacy', () => {
    expect(routeFor('unverified', '/verify')).toBeNull()
    expect(routeFor('unverified', '/privacy')).toBeNull()
    for (const path of ['/login', '/', '/single', '/nope']) {
      expect(routeFor('unverified', path)).toBe('/verify')
    }
  })

  it('FR-006: a verified user reaches /, /single and /settings', () => {
    expect(routeFor('verified', '/')).toBeNull()
    expect(routeFor('verified', '/single')).toBeNull()
    expect(routeFor('verified', '/settings')).toBeNull()
  })

  it('settings are for verified users only', () => {
    expect(routeFor('out', '/settings')).toBe('/login')
    expect(routeFor('unverified', '/settings')).toBe('/verify')
  })

  it('FR-006: a verified user is redirected from /login and /verify to /', () => {
    expect(routeFor('verified', '/login')).toBe('/')
    expect(routeFor('verified', '/verify')).toBe('/')
  })

  it('UF-003: a verified user reaches the room list, the create form and a room', () => {
    for (const path of ['/rooms', '/rooms/new', '/rooms/abc123']) {
      expect(routeFor('verified', path)).toBeNull()
    }
  })

  it('FR-001 AC: an unverified user cannot open /rooms/:id', () => {
    expect(routeFor('unverified', '/rooms/abc123')).toBe('/verify')
    expect(routeFor('out', '/rooms/abc123')).toBe('/login')
  })

  it('BR-016: without a valid nickname a room or the create form is out of reach, the list is not', () => {
    expect(routeFor('verified', '/rooms/abc123', false)).toBe('/rooms')
    expect(routeFor('verified', '/rooms/new', false)).toBe('/rooms')
    expect(routeFor('verified', '/rooms', false)).toBeNull()
    expect(routeFor('verified', '/single', false)).toBeNull()
  })

  it('an unknown path under /rooms/ with a trailing slash only falls back to /', () => {
    expect(routeFor('verified', '/rooms/')).toBe('/')
  })

  it('FR-018: /privacy is allowed for every status', () => {
    for (const status of ['loading', 'out', 'unverified', 'verified'] as const) {
      expect(routeFor(status, '/privacy')).toBeNull()
    }
  })
})
