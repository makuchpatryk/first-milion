import { describe, expect, it } from 'vitest'
import { findEmulatorTraces } from '../scripts/check-no-emulator.mjs'

describe('check-no-emulator (PRD §20 #35, NFR-004)', () => {
  it('a clean production build has no trace', () => {
    const files = [
      { name: 'assets/index.js', text: 'const a=import("./firebase.js");' },
      { name: 'index.html', text: '<script type="module" src="/assets/index.js"></script>' },
    ]
    expect(findEmulatorTraces(files)).toEqual([])
  })

  it('an inlined emulator URL is reported with its file', () => {
    const files = [{ name: 'assets/index.js', text: 'c(auth,"http://127.0.0.1:9099")' }]
    expect(findEmulatorTraces(files)).toEqual(['assets/index.js: emulator URL (port 9099)'])
  })

  it('the env variable name is reported', () => {
    const files = [{ name: 'assets/index.js', text: '({}).VITE_AUTH_EMULATOR_URL' }]
    expect(findEmulatorTraces(files)).toEqual(['assets/index.js: env name VITE_AUTH_EMULATOR_URL'])
  })

  it("Firebase's own error text that names connectAuthEmulator() is not a trace", () => {
    const text = 'Try calling "connectAuthEmulator()" sooner than that.'
    expect(findEmulatorTraces([{ name: 'assets/auth.js', text }])).toEqual([])
  })
})
