import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Structure of the two workflows (spec 06): PRs stay light, heavy checks and deploys are gated,
// and no secret value is written in a file. The workflows themselves are not run here.

const step = z.object({
  name: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
})
const job = z.object({
  needs: z.string().optional(),
  if: z.string().optional(),
  environment: z.string().optional(),
  env: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(step),
})
const workflow = z.object({
  on: z.record(z.string(), z.unknown()),
  jobs: z.record(z.string(), job),
})

const load = (name: string) =>
  workflow.parse(
    parse(readFileSync(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')),
  )

const commands = (steps: Array<{ run?: string | undefined }>) =>
  steps.map((s) => s.run ?? '').join('\n')

describe('ci.yml (ARCHITECTURE A7)', () => {
  const ci = load('ci.yml')

  it('runs on push, pull request and by hand', () => {
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
  })

  it('the light job runs lint, typecheck and Vitest, and nothing heavy', () => {
    const light = commands(ci.jobs.check?.steps ?? [])
    for (const cmd of ['pnpm lint', 'pnpm typecheck', 'pnpm test']) expect(light).toContain(cmd)
    for (const heavy of ['e2e', 'lighthouse', 'build', 'playwright'])
      expect(light).not.toContain(heavy)
    expect(ci.jobs.check?.if).toBeUndefined()
  })

  it('the heavy job needs the light one and runs on main or by hand only', () => {
    const heavy = ci.jobs.heavy
    expect(heavy?.needs).toBe('check')
    expect(heavy?.if).toContain("github.ref == 'refs/heads/main'")
    expect(heavy?.if).toContain('workflow_dispatch')
    expect(heavy?.if).not.toContain('pull_request')
  })

  it('the heavy job builds, checks the bundle, runs e2e and Lighthouse', () => {
    const run = commands(ci.jobs.heavy?.steps ?? [])
    for (const cmd of ['pnpm build', 'pnpm bundle:check', 'pnpm e2e', 'pnpm lighthouse']) {
      expect(run).toContain(cmd)
    }
  })
})

const pushFilters = z.object({
  push: z.object({
    branches: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }),
})

describe('deploy.yml (PRD §20 #36)', () => {
  const deploy = load('deploy.yml')
  const job_ = deploy.jobs.deploy
  const verify = deploy.jobs.verify

  it('runs only when a version tag is pushed: no manual run, branch or pull request', () => {
    expect(Object.keys(deploy.on)).toEqual(['push'])
    const { push } = pushFilters.parse(deploy.on)
    expect(push.tags).toEqual(['v*.*.*'])
    expect(push.branches).toBeUndefined()
  })

  it('ci.yml does not run on tags, so a release is not checked twice', () => {
    const { push } = pushFilters.parse(load('ci.yml').on)
    expect(push.branches).toEqual(['**'])
    expect(push.tags).toBeUndefined()
  })

  it('verify: the tag must be on main, then the light checks pass on that commit', () => {
    expect(verify?.if).toContain("github.ref_type == 'tag'")
    const run = commands(verify?.steps ?? [])
    expect(run).toContain('merge-base --is-ancestor')
    expect(run).toContain('origin/main')
    for (const cmd of ['pnpm lint', 'pnpm typecheck', 'pnpm test']) expect(run).toContain(cmd)
  })

  it('deploy waits for verify and needs the production environment (manual approval)', () => {
    expect(job_?.needs).toBe('verify')
    expect(job_?.environment).toBe('production')
  })

  it('checks the build, then deploys the Worker to production and the web app to Pages', () => {
    const run = commands(job_?.steps ?? [])
    expect(run.indexOf('pnpm bundle:check')).toBeGreaterThan(run.indexOf('pnpm build'))
    expect(run.indexOf('wrangler deploy --env production')).toBeGreaterThan(
      run.indexOf('pnpm bundle:check'),
    )
    expect(run).toContain('wrangler pages deploy')
  })

  it('NFR-004: Cloudflare credentials come from secrets, never from a literal', () => {
    const env = job_?.env ?? {}
    expect(env.CLOUDFLARE_API_TOKEN).toBe('${{ secrets.CLOUDFLARE_API_TOKEN }}')
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}')
  })

  it('PRD §20 #35: no emulator variable in the deploy environment', () => {
    const keys = Object.keys(job_?.env ?? {})
    expect(keys).not.toContain('VITE_AUTH_EMULATOR_URL')
    expect(keys).not.toContain('AUTH_EMULATOR')
  })

  it('BR-017: admin UIDs reach the Worker only as a secret, in one step, after the Worker deploy', () => {
    const steps = job_?.steps ?? []
    expect(Object.keys(job_?.env ?? {})).not.toContain('ADMIN_UIDS')
    const setter = steps.findIndex((s) => s.run?.includes('secret put ADMIN_UIDS'))
    expect(setter).toBeGreaterThan(-1)
    expect(steps[setter]?.env?.ADMIN_UIDS).toBe('${{ secrets.ADMIN_UIDS }}')
    expect(setter).toBeGreaterThan(steps.findIndex((s) => s.run?.includes('wrangler deploy')))
  })

  it('the public web config comes from environment variables', () => {
    const env = job_?.env ?? {}
    for (const key of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_WORKER_URL']) {
      expect(env[key]).toBe(`\${{ vars.${key} }}`)
    }
  })
})
