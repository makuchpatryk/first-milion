// PRD §20 #35, NFR-004: the production build must not carry the Auth emulator hook. In
// `web/auth/firebase.ts` the hook is `import.meta.env.DEV && VITE_AUTH_EMULATOR_URL`; a build
// with the variable set would inline its URL, and a leaked env object would keep its name. Run
// after `pnpm --filter @fm/web build`: `node scripts/check-no-emulator.mjs`.
//
// `connectAuthEmulator` itself is not searched: Firebase's own error text mentions it.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TRACES = [
  { label: 'env name VITE_AUTH_EMULATOR_URL', pattern: /VITE_AUTH_EMULATOR_URL/ },
  { label: 'emulator URL (port 9099)', pattern: /(?:127\.0\.0\.1|localhost):9099/ },
]

const TEXT_FILE = /\.(?:js|mjs|css|html|json|map)$/

/**
 * @param {ReadonlyArray<{ name: string, text: string }>} files
 * @returns {string[]} one line per file and trace found
 */
export function findEmulatorTraces(files) {
  return files.flatMap((file) =>
    TRACES.filter((trace) => trace.pattern.test(file.text)).map(
      (trace) => `${file.name}: ${trace.label}`,
    ),
  )
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
    ),
  )
  return nested.flat()
}

async function main() {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
  const names = (await listFiles(dist)).filter((name) => TEXT_FILE.test(name))
  if (names.length === 0) throw new Error(`no build output in ${dist}; run the build first`)
  const files = await Promise.all(
    names.map(async (name) => ({
      name: name.slice(dist.length + 1),
      text: await readFile(name, 'utf8'),
    })),
  )
  const found = findEmulatorTraces(files)
  if (found.length === 0) {
    console.log(`OK: no emulator trace in ${files.length} files`)
    return
  }
  console.error(['Emulator traces in the production build:', ...found].join('\n'))
  process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
