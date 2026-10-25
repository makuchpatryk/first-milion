import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // Without a key the Firebase SDK throws on start and the app renders nothing, yet the build
  // and the bundle check would still pass; a forgotten deploy variable must fail the build.
  if (mode === 'production' && !loadEnv(mode, import.meta.dirname, 'VITE_').VITE_FIREBASE_API_KEY) {
    throw new Error('VITE_FIREBASE_API_KEY is not set (see packages/web/.env.example)')
  }

  // The deploy sets the root version to the tag before it builds (`.github/workflows/deploy.yml`).
  const { version } = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
  ) as { version?: string }

  return {
    plugins: [vue()],
    define: { __APP_VERSION__: JSON.stringify(version ?? '0.0.0') },
    build: {
      // NFR-005, NFR-004: no source maps in the shipped files; modern syntax only (no transpiling
      // of what every supported browser runs).
      sourcemap: false,
      target: 'es2022',
      rolldownOptions: {
        output: {
          // The Firebase Auth SDK is the largest dependency; its own chunk keeps the app code
          // separate, so a game change does not invalidate it in the browser cache.
          codeSplitting: {
            groups: [{ name: 'firebase-auth', test: /@firebase[\\/]auth/ }],
          },
        },
      },
    },
    test: {
      // Component tests opt in with `// @vitest-environment happy-dom`.
      environment: 'node',
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    },
  }
})
