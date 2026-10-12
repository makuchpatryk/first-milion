import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = import.meta.dirname

const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(ts|vue)$/.test(f))
  .map((f) => f.split('\\').join('/'))
  .map((file) => ({ file, code: readFileSync(join(SRC, file), 'utf8') }))

// Tests mock the SDK by module name; the rules below are about shipped code.
const shipped = files.filter(({ file }) => !file.endsWith('.test.ts') && file !== 'test-support.ts')

const offenders = (list: typeof files, pattern: RegExp) =>
  list.filter(({ code }) => pattern.test(code)).map(({ file }) => file)

describe('web architecture (ARCHITECTURE.md dependency rules)', () => {
  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('the Firebase SDK is imported only under src/auth/', () => {
    const importers = offenders(shipped, /from\s+['"]firebase\/|import\(\s*['"]firebase/)
    expect(importers.filter((f) => !f.startsWith('auth/'))).toEqual([])
    expect(importers.length).toBeGreaterThan(0)
  })

  it('only src/auth/firebase.ts imports firebase/app', () => {
    expect(offenders(shipped, /['"]firebase\/app['"]/)).toEqual(['auth/firebase.ts'])
  })

  it('web never imports the worker package', () => {
    expect(offenders(files, /@fm\/worker|packages\/worker/)).toEqual([])
  })

  it('web reaches shared only through @fm/shared, not by relative path', () => {
    expect(offenders(files, /from\s+['"](\.\.\/)+(shared|packages\/shared)/)).toEqual([])
  })

  it('CODE_QUALITY: no v-html in components', () => {
    expect(
      offenders(
        files.filter((f) => f.file.endsWith('.vue')),
        /v-html/,
      ),
    ).toEqual([])
  })

  it('ARCHITECTURE: the WebSocket is opened only under src/net/', () => {
    const users = offenders(shipped, /new\s+WebSocket\s*\(/)
    expect(users.filter((f) => !f.startsWith('net/'))).toEqual([])
    expect(users.length).toBeGreaterThan(0)
  })

  it('ARCHITECTURE: src/net/ does not import Firebase, auth or views', () => {
    const netFiles = shipped.filter(({ file }) => file.startsWith('net/'))
    expect(offenders(netFiles, /from\s+['"](\.\.\/)+(auth|views|components)|firebase/)).toEqual([])
  })

  it('NFR-004: no socket URL carries a token', () => {
    expect(offenders(shipped, /[?&]token=/)).toEqual([])
  })

  it('BR-020: only the language choice touches browser storage', () => {
    const users = offenders(shipped, /localStorage|sessionStorage|indexedDB/)
    expect(users).toEqual(['i18n/locale.ts'])
  })
})
