import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

// BR-020, decision 37: memory only. No Durable Object storage, alarms, hibernation, KV, D1, R2
// or Cache API anywhere in the Worker.
const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: 'ctx.storage / state.storage', pattern: /\b(?:ctx|state)\.storage\b/ },
  { name: 'storage API', pattern: /\.storage\.(?:get|put|delete|list|sql|transaction)\b/ },
  { name: 'alarms', pattern: /\b(?:setAlarm|getAlarm|deleteAlarm|alarm)\s*\(/ },
  { name: 'WebSocket hibernation', pattern: /\b(?:acceptWebSocket|getWebSockets|webSocketMessage|webSocketClose)\b/ },
  { name: 'Cache API', pattern: /\bcaches\b/ },
  { name: 'KV', pattern: /\bKV(?:Namespace)?\b/ },
  { name: 'D1', pattern: /\bD1(?:Database)?\b/ },
  { name: 'R2', pattern: /\bR2(?:Bucket)?\b/ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
]

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, code: stripComments(readFileSync(join(SRC, file), 'utf8')) }))

describe('worker keeps no state outside memory (BR-020)', () => {
  it('finds the source files to scan', () => {
    expect(sources.length).toBeGreaterThan(10)
  })

  for (const { name, pattern } of FORBIDDEN) {
    it(`no source file uses ${name}`, () => {
      const offenders = sources.filter((source) => pattern.test(source.code)).map((source) => source.file)
      expect(offenders).toEqual([])
    })
  }

  it('wrangler.toml binds no storage resource', () => {
    const config = readFileSync(join(SRC, '..', 'wrangler.toml'), 'utf8')
    expect(config).not.toMatch(/\[\[(?:kv_namespaces|d1_databases|r2_buckets)\]\]/)
  })
})
