import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

// ARCHITECTURE: `shared` is pure. No clock, no entropy, no DOM, Workers or Firebase.
const FORBIDDEN = [
  'Math.random',
  'Date.now',
  'performance.now',
  'window',
  'document',
  'firebase',
  'cloudflare',
  '@cloudflare',
]

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, code: stripComments(readFileSync(join(SRC, f), 'utf8')) }))

describe('shared stays platform-free', () => {
  it('finds the source files to scan', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  for (const word of FORBIDDEN) {
    it(`no source file uses ${word}`, () => {
      const offenders = sources.filter((s) => s.code.includes(word)).map((s) => s.file)
      expect(offenders).toEqual([])
    })
  }
})
