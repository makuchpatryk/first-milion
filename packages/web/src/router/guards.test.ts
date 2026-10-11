import { describe, expect, it } from 'vitest'
import { routeFor } from './guards'

describe('routeFor', () => {
  it('FR-001 AC / BR-001: a logged-out user reaches only /login and /privacy', () => {
    expect(routeFor('out', '/login')).toBeNull()
    expect(routeFor('out', '/privacy')).toBeNull()
    for (const path of ['/menu', '/single', '/verify', '/rooms', '/nope']) {
      expect(routeFor('out', path)).toBe('/login')
    }
  })

  it('FR-001 AC / BR-002: an unverified user reaches only /verify and /privacy', () => {
    expect(routeFor('unverified', '/verify')).toBeNull()
    expect(routeFor('unverified', '/privacy')).toBeNull()
    for (const path of ['/login', '/menu', '/single', '/nope']) {
      expect(routeFor('unverified', path)).toBe('/verify')
    }
  })

  it('FR-006: a verified user reaches /menu and /single', () => {
    expect(routeFor('verified', '/menu')).toBeNull()
    expect(routeFor('verified', '/single')).toBeNull()
  })

  it('FR-006: a verified user is redirected from /login and /verify to /menu', () => {
    expect(routeFor('verified', '/login')).toBe('/menu')
    expect(routeFor('verified', '/verify')).toBe('/menu')
  })

  it('FR-006: there is no /rooms route in M2, so it falls back to /menu', () => {
    expect(routeFor('verified', '/rooms')).toBe('/menu')
  })

  it('FR-018: /privacy is allowed for every status', () => {
    for (const status of ['loading', 'out', 'unverified', 'verified'] as const) {
      expect(routeFor(status, '/privacy')).toBeNull()
    }
  })
})
