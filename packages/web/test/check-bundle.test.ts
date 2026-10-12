import { describe, expect, it } from 'vitest'
import { LIMIT_BYTES, checkBundle, formatReport, gzipSize } from '../scripts/check-bundle.mjs'

/** Incompressible bytes from a fixed xorshift seed, so gzip output is about as long as the input. */
function noise(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 0x2545f491
  for (let i = 0; i < length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    bytes[i] = state & 0xff
  }
  return bytes
}

describe('check-bundle (NFR-005)', () => {
  it('the limit is 300 KB', () => {
    expect(LIMIT_BYTES).toBe(300 * 1024)
  })

  it('NFR-005: a bundle of ~299 KB gzip passes', () => {
    const bytes = gzipSize(noise(299 * 1024 - 2_000))
    expect(bytes).toBeLessThan(LIMIT_BYTES)
    expect(checkBundle([{ name: 'index.js', bytes }]).ok).toBe(true)
  })

  it('NFR-005: a bundle of ~301 KB gzip fails', () => {
    const bytes = gzipSize(noise(301 * 1024))
    expect(bytes).toBeGreaterThan(LIMIT_BYTES)
    expect(checkBundle([{ name: 'index.js', bytes }]).ok).toBe(false)
  })

  it('NFR-005: the chunks are summed, not judged one by one', () => {
    const half = 160 * 1024
    const result = checkBundle([
      { name: 'index.js', bytes: half },
      { name: 'firebase.js', bytes: half },
    ])
    expect(result).toEqual({ total: 2 * half, limit: LIMIT_BYTES, ok: false })
  })

  it('exactly the limit passes', () => {
    expect(checkBundle([{ name: 'a.js', bytes: LIMIT_BYTES }]).ok).toBe(true)
  })

  it('the report lists the largest chunk first and ends with the verdict', () => {
    const sizes = [
      { name: 'small.js', bytes: 1024 },
      { name: 'big.js', bytes: 200 * 1024 },
    ]
    const lines = formatReport(sizes, checkBundle(sizes)).split('\n')
    expect(lines[0]).toContain('big.js')
    expect(lines[1]).toContain('small.js')
    expect(lines.at(-1)).toContain('OK')
  })
})
