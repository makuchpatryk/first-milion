import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clientMessageSchema, parseClientMessage, type ClientMessage } from '@fm/shared/protocol'
import { describe, expect, it } from 'vitest'
import { isAllowedOrigin } from '../src/origin'

// NFR-004: the server trusts no number from the client, validates every message against a
// strict schema, never reads the token from the URL, and checks `Origin`. Wire-level cases
// (INVALID_PAYLOAD answer with the socket kept open, 4401 for a URL token, 403 for a bad Origin)
// run in workerd: `integration/rooms.test.ts`, `integration/auth.test.ts`,
// `integration/routing.test.ts`. This file holds the table-driven rules over all messages.

const form = { name: 'Friday round', durationMin: 5, speed: 3, profitTarget: 20_000 } as const

/** One valid message per client type; `satisfies` makes a new message type a compile error here. */
const SAMPLES = {
  auth: { type: 'auth', token: 'abc' },
  'room.create': { type: 'room.create', form },
  'room.join': { type: 'room.join', roomId: 'a1b2', nick: 'Jan' },
  'room.leave': { type: 'room.leave' },
  'room.start': { type: 'room.start' },
  order: { type: 'order', side: 'BUY', qty: 50 },
  close: { type: 'close' },
  'admin.kick': { type: 'admin.kick', nick: 'Jan' },
  'admin.closeRoom': { type: 'admin.closeRoom', roomId: 'a1b2' },
} as const satisfies { [T in ClientMessage['type']]: Extract<ClientMessage, { type: T }> }

const schemaTypes = clientMessageSchema.options.map((option) => option.shape.type.value)

describe('client schemas are strict (NFR-004)', () => {
  it('the sample table covers every client message type', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...schemaTypes].sort())
  })

  it.each(Object.entries(SAMPLES))('%s: the sample is valid', (_type, sample) => {
    expect(parseClientMessage(sample)).toEqual({ ok: true, msg: sample })
  })

  it.each(Object.entries(SAMPLES))('%s: an unknown field is rejected', (_type, sample) => {
    expect(parseClientMessage({ ...sample, extra: 1 })).toEqual({ ok: false })
  })

  it('room.create: an unknown field inside the form is rejected', () => {
    expect(parseClientMessage({ type: 'room.create', form: { ...form, hostNick: 'x' } }).ok).toBe(
      false,
    )
  })

  it.each(schemaTypes)('%s: sent bare, only the payload-free types pass', (type) => {
    const bare = parseClientMessage({ type }).ok
    expect(bare).toBe(['room.leave', 'room.start', 'close'].includes(type))
  })

  it('an unknown message type is rejected', () => {
    for (const type of ['admin.ban', 'room.setPrice', '', 'ORDER']) {
      expect(parseClientMessage({ type }).ok).toBe(false)
    }
  })
})

describe('the server owns every number (BR-007, FR-012 AC)', () => {
  it.each(['price', 'fill', 'pnl', 'equity', 'units', 'result', 'ranking'])(
    'an order carrying `%s` is rejected',
    (field) => {
      expect(parseClientMessage({ type: 'order', side: 'BUY', qty: 10, [field]: 1 })).toEqual({
        ok: false,
      })
    },
  )

  it('a close carrying a price is rejected', () => {
    expect(parseClientMessage({ type: 'close', price: 100 })).toEqual({ ok: false })
  })

  it('only the four fixed order sizes pass (FR-012)', () => {
    for (const qty of [1, 9, 11, 49, 251, 1_000_000, -50, 0, 50.5, Number.NaN]) {
      expect(parseClientMessage({ type: 'order', side: 'BUY', qty }).ok).toBe(false)
    }
  })

  it('a client cannot pick the side CLOSE or a lowercase side', () => {
    for (const side of ['CLOSE', 'buy', 'LONG', '']) {
      expect(parseClientMessage({ type: 'order', side, qty: 10 }).ok).toBe(false)
    }
  })
})

describe('Origin allowlist (FR-007, NFR-004)', () => {
  const allowlist = 'https://first-million.pages.dev,http://localhost:5173'

  it.each([
    ['an exact entry', 'https://first-million.pages.dev', true],
    ['a second entry', 'http://localhost:5173', true],
    ['a missing header', null, false],
    ['the string "null" (sandboxed frames)', 'null', false],
    ['a foreign site', 'https://evil.example', false],
    ['a lookalike subdomain', 'https://first-million.pages.dev.evil.example', false],
    ['a prefix of an entry', 'https://first-million.pages', false],
    ['http where https is listed', 'http://first-million.pages.dev', false],
    ['a trailing slash', 'https://first-million.pages.dev/', false],
    ['another port', 'http://localhost:5174', false],
    ['an empty header', '', false],
  ])('%s', (_name, origin, allowed) => {
    expect(isAllowedOrigin(origin, allowlist)).toBe(allowed)
  })

  it('no allowlist entry means nothing is allowed', () => {
    expect(isAllowedOrigin('https://first-million.pages.dev', '')).toBe(false)
  })
})

describe('the token travels in the first message only (FR-007, NFR-004)', () => {
  const SRC = join(import.meta.dirname, '..', 'src')
  const stripComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => ({ file, code: stripComments(readFileSync(join(SRC, file), 'utf8')) }))

  it('no Worker source reads the query string', () => {
    const offenders = sources
      .filter(({ code }) => /\bsearchParams\b|\bURLSearchParams\b|\.search\b|\.href\b/.test(code))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('no Worker source logs: a token, email or UID can never reach a log line', () => {
    const offenders = sources.filter(({ code }) => /\bconsole\./.test(code)).map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
