import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTokenVerifier } from '../src/auth/verify-token'
import { parseEnv, type Env } from '../src/env'
import { NOW_MS, unsignedToken, validClaims } from './auth/token-helpers'

// NFR-004, PRD §20 #35: the emulator flag and the admin UIDs never ship in `wrangler.toml`.
// This file is what a deploy reads, so the test reads it too.

const vars = z.record(z.string(), z.string())
const bindings = z.array(z.object({ name: z.string(), class_name: z.string() }))
const migrations = z.array(z.object({ tag: z.string(), new_sqlite_classes: z.array(z.string()) }))

const wranglerSchema = z.object({
  vars,
  durable_objects: z.object({ bindings }),
  migrations,
  env: z.object({
    production: z.object({
      vars,
      durable_objects: z.object({ bindings }),
      migrations,
    }),
  }),
})

const wrangler = wranglerSchema.parse(
  parse(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')),
)

const FORBIDDEN_VARS = ['AUTH_EMULATOR', 'ADMIN_UIDS']

/** Every `vars` table in the file: the default one and one per environment. */
const allVarTables: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['default', wrangler.vars],
  ['production', wrangler.env.production.vars],
]

describe('wrangler.toml (NFR-004)', () => {
  it.each(allVarTables)(
    'NFR-004: %s vars hold no emulator flag and no admin UIDs',
    (_name, table) => {
      for (const key of FORBIDDEN_VARS) expect(Object.keys(table)).not.toContain(key)
    },
  )

  it('FR-007: production names the allowed web origins, https only', () => {
    const origins = wrangler.env.production.vars.ALLOWED_ORIGINS?.split(',').map((o) => o.trim())
    expect(origins?.length ?? 0).toBeGreaterThan(0)
    for (const origin of origins ?? []) expect(origin).toMatch(/^https:\/\/[^/\s]+$/)
  })

  it('FR-007: production verifies tokens for a real project, not a demo one', () => {
    const projectId = wrangler.env.production.vars.FIREBASE_PROJECT_ID
    expect(projectId).toBeTruthy()
    expect(projectId).not.toMatch(/^demo-/)
  })

  it('production binds the same Durable Objects and SQLite migration as the default config', () => {
    const production = wrangler.env.production
    expect(production.durable_objects.bindings).toEqual(wrangler.durable_objects.bindings)
    expect(production.migrations).toEqual(wrangler.migrations)
  })
})

describe('production token verifier (NFR-004)', () => {
  const projectId = wrangler.env.production.vars.FIREBASE_PROJECT_ID ?? ''
  // The Worker's environment as a production deploy builds it: the toml vars, no `.dev.vars`.
  const productionEnv = { ...wrangler.env.production.vars, ADMIN_UIDS: '' } as unknown as Env
  const claims = validClaims({
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
  })
  const base = {
    projectId,
    fetchJwks: () => Promise.resolve({ keys: [] }),
    now: () => NOW_MS,
  }

  it('NFR-004: the production config does not turn the emulator on', () => {
    expect(parseEnv(productionEnv).emulator).toBe(false)
  })

  it('NFR-004: an unsigned alg:none token is rejected under the production config', async () => {
    const verify = createTokenVerifier({ ...base, emulator: parseEnv(productionEnv).emulator })
    expect(await verify(unsignedToken(claims))).toBeNull()
  })

  it('control: the same token is accepted only when the emulator flag is on', async () => {
    const verify = createTokenVerifier({ ...base, emulator: true })
    expect(await verify(unsignedToken(claims))).toMatchObject({ uid: 'uid-1' })
  })
})
