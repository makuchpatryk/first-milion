import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic and verifiers run in plain Node (WebCrypto is global there).
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/integration/**'],
        },
      },
      {
        // Real Worker + Durable Objects in workerd (wrangler.toml bindings).
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
            // Test-only env: what `.dev.vars` and secrets provide outside the tests.
            miniflare: {
              bindings: {
                FIREBASE_PROJECT_ID: 'first-million-test',
                AUTH_EMULATOR: 'true',
                ADMIN_UIDS: 'uid-admin',
              },
            },
          }),
        ],
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          // The first test pays for the workerd and Durable Object cold start, which is slow
          // when other checks run in parallel.
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
