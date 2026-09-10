/* oxlint-disable effect/noNewPromise -- this build-tooling boundary uses Node's async filesystem APIs directly */
/**
 * Lists catalog keys that no source file calls. A key counts as used when some
 * file under an app or package `src` directory mentions `m.<key>` — the
 * generated message functions are always reached through the `m` namespace, so
 * a bare identifier match would report false negatives for keys that only share
 * a prefix with a longer one.
 *
 * Reports rather than deletes: a key may be intentionally staged ahead of the
 * surface that will render it, and only a human knows which.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { flattenCatalog, mergeInto } from './catalog-validation.mjs'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const sourceRoot = join(packageRoot, 'messages')
const SCANNED_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.js',
  '.jsx',
  '.mjs',
  '.json',
  '.mdx',
  '.md'
]
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.generated',
  'generated',
  '.output',
  '.nitro',
  '.tanstack',
  '.wrangler',
  'coverage',
  '.git'
])

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        return SKIPPED_DIRECTORIES.has(entry.name) ? [] : filesUnder(path)
      }
      return entry.isFile() ? [path] : []
    })
  )
  return nested.flat()
}

async function catalogKeys() {
  const catalogFiles = await filesUnder(sourceRoot)
  const files = catalogFiles.filter((file) => file.endsWith('/en.json'))
  const merged = {}
  const raws = await Promise.all(files.map((file) => readFile(file, 'utf8')))
  for (const raw of raws) {
    mergeInto(merged, JSON.parse(raw), '')
  }
  return Object.keys(flattenCatalog(merged, 'en'))
}

async function sourceRoots() {
  const groups = await Promise.all(
    ['apps', 'packages'].map(async (group) => {
      const entries = await readdir(join(repoRoot, group), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(repoRoot, group, entry.name, 'src'))
    })
  )
  // Messages can also be referenced from browser tests, MDX content, and
  // repository scripts, so those trees count as consumers too.
  const extra = ['apps/web/e2e', 'apps/web/content', 'scripts', '.github'].map((path) =>
    join(repoRoot, path)
  )
  return [...groups.flat(), ...extra]
}

const [keys, roots] = await Promise.all([catalogKeys(), sourceRoots()])
const rootFiles = await Promise.all(roots.map(filesUnder))
const scanned = rootFiles
  .flat()
  .filter((file) => SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension)))
const contents = await Promise.all(scanned.map((file) => readFile(file, 'utf8')))
const haystack = contents.join('\n')

const unused = keys.filter((key) => !haystack.includes(`m.${key}`))

if (unused.length === 0) {
  process.stdout.write(`All ${keys.length} catalog keys are referenced.\n`)
} else {
  process.stdout.write(
    `${unused.length} of ${keys.length} catalog keys have no m.<key> reference:\n${unused
      .map((key) => `  ${key}`)
      .join('\n')}\n`
  )
  process.exitCode = 1
}
