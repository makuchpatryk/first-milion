// NFR-005: the JS of the production build, gzipped, must stay within 300 KB. Run after
// `pnpm --filter @fm/web build` (review and CI on `main`): `node scripts/check-bundle.mjs`.
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const LIMIT_BYTES = 300 * 1024

/**
 * Gzip size of one file's content (level 9, like a static host's precompressed best case).
 * @param {Uint8Array} content
 */
export function gzipSize(content) {
  return gzipSync(content, { level: 9 }).length
}

/**
 * Sums the gzip sizes and compares them with the limit.
 * @param {ReadonlyArray<{ name: string, bytes: number }>} sizes
 * @param {number} [limit]
 */
export function checkBundle(sizes, limit = LIMIT_BYTES) {
  const total = sizes.reduce((sum, file) => sum + file.bytes, 0)
  return { total, limit, ok: total <= limit }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

/**
 * A small table, largest chunk first, then the total against the limit.
 * @param {ReadonlyArray<{ name: string, bytes: number }>} sizes
 * @param {{ total: number, limit: number, ok: boolean }} result
 */
export function formatReport(sizes, result) {
  const rows = [...sizes]
    .sort((a, b) => b.bytes - a.bytes)
    .map((file) => `${kb(file.bytes).padStart(10)}  ${file.name}`)
  const verdict = result.ok ? 'OK' : 'OVER THE LIMIT'
  return [
    ...rows,
    `${kb(result.total).padStart(10)}  total (limit ${kb(result.limit)}) ${verdict}`,
  ].join('\n')
}

async function main() {
  const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assets')
  const names = (await readdir(assets)).filter((name) => name.endsWith('.js'))
  if (names.length === 0) throw new Error(`no .js files in ${assets}; run the build first`)
  const sizes = await Promise.all(
    names.map(async (name) => ({ name, bytes: gzipSize(await readFile(join(assets, name))) })),
  )
  const result = checkBundle(sizes)
  console.log(formatReport(sizes, result))
  if (!result.ok) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
