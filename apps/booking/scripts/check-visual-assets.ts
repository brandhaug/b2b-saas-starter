import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'
import { visualAssetManifest } from '../src/assets/visual-asset-manifest.ts'
import {
  generateVisualAssetNotices,
  validateVisualAssetManifest,
  type ShippingVisualAsset,
  type VisualAssetManifestEntry
} from '../src/assets/visual-asset-policy.ts'

const visualExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.lottie',
  '.mov',
  '.mp4',
  '.otf',
  '.png',
  '.svg',
  '.ttf',
  '.webm',
  '.webp',
  '.woff',
  '.woff2'
])
const sourceExtensions = new Set(['.css', '.ts', '.tsx'])

const normalizedRelativePath = (root: string, file: string) =>
  relative(root, file).split(sep).join('/')

const walkFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw error
  })
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? walkFiles(path) : Promise.resolve([path])
    })
  )
  return nested.flat().sort()
}

const isVisualSourceFile = (file: string, publicRoot: string) => {
  const extension = extname(file).toLowerCase()
  if (visualExtensions.has(extension)) return true
  return (
    file.startsWith(`${publicRoot}${sep}`) &&
    extension === '.json' &&
    /(animation|lottie)/i.test(file)
  )
}

const sha256Identity = async (file: string) => {
  const bytes = await readFile(file)
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

const discoverVisuals = async (
  root: string,
  directories: readonly string[]
): Promise<ShippingVisualAsset[]> => {
  const publicRoot = join(root, 'public')
  const files = (await Promise.all(directories.map(walkFiles))).flat()
  return Promise.all(
    files
      .filter((file) => isVisualSourceFile(file, publicRoot))
      .map(async (file) => ({
        file: normalizedRelativePath(root, file),
        integrity: await sha256Identity(file)
      }))
  )
}

const findBundledFontImports = async (
  root: string,
  entries: readonly VisualAssetManifestEntry[]
) => {
  const files = await walkFiles(join(root, 'src'))
  const errors: string[] = []
  for (const file of files.filter((candidate) =>
    sourceExtensions.has(extname(candidate))
  )) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/@fontsource-variable\/([a-z-]+)/g)) {
      const packageName = match[1]!
      const authorized = entries.some(
        (entry) =>
          entry.class === 'font' &&
          entry.file.startsWith(
            `node_modules/@fontsource-variable/${packageName}/files/`
          )
      )
      if (authorized) continue
      errors.push(
        `Bundled font package import bypasses the visual asset manifest: ${normalizedRelativePath(root, file)}`
      )
    }
  }
  return errors
}

export const inspectVisualAssetSources = async (input: {
  readonly root: string
  readonly entries: readonly VisualAssetManifestEntry[]
  readonly today: string
}): Promise<string[]> => {
  const shippingAssets = await discoverVisuals(input.root, [
    join(input.root, 'src'),
    join(input.root, 'public')
  ])
  const dependencyAssets = await Promise.all(
    input.entries
      .filter((entry) => entry.file.startsWith('node_modules/'))
      .map(async (entry) => ({
        file: entry.file,
        integrity: await sha256Identity(join(input.root, entry.file))
      }))
  )
  const manifestErrors = validateVisualAssetManifest({
    entries: input.entries,
    shippingAssets: [...shippingAssets, ...dependencyAssets],
    today: input.today
  })
  const noticeErrors = (
    await Promise.all(
      input.entries.map(async (entry) => {
        const noticeFile = entry.permission.noticeFile
        if (!noticeFile) return null
        const exists = await readFile(join(input.root, noticeFile))
          .then(() => true)
          .catch(() => false)
        return exists ? null : `Required visual asset notice is missing: ${noticeFile}`
      })
    )
  ).filter((error): error is string => error !== null)
  return [
    ...manifestErrors.map((error) => error.message),
    ...noticeErrors,
    ...(await findBundledFontImports(input.root, input.entries))
  ].sort()
}

export const inspectBuiltVisualAssets = async (input: {
  readonly root: string
  readonly entries: readonly VisualAssetManifestEntry[]
}): Promise<string[]> => {
  const builtAssets = await discoverVisuals(input.root, [
    join(input.root, 'dist/client')
  ])
  const entriesByHash = new Map(
    input.entries.map((entry) => [entry.integrity.derived, entry])
  )
  const errors = builtAssets
    .filter((asset) => !entriesByHash.has(asset.integrity))
    .map((asset) => `Unauthorized visual in built output: ${asset.file}`)

  for (const entry of input.entries) {
    const matches = builtAssets.filter(
      (asset) => asset.integrity === entry.integrity.derived
    )
    if (matches.length === 0) {
      errors.push(`Manifest visual is missing from built output: ${entry.id}`)
    } else if (matches.length > 1) {
      errors.push(
        `Manifest identity emitted more than once: ${entry.id} (${matches.length} built files)`
      )
    }
  }
  return errors.sort()
}

export const inspectBuiltVisualAssetNotices = async (input: {
  readonly root: string
  readonly entries: readonly VisualAssetManifestEntry[]
}): Promise<string[]> => {
  const files = [
    'THIRD_PARTY_VISUAL_ASSETS.md',
    ...input.entries.flatMap((entry) =>
      entry.permission.noticeFile ? [entry.permission.noticeFile] : []
    )
  ]
  const errors = await Promise.all(
    [...new Set(files)].map(async (file) => {
      const source = await readFile(join(input.root, file)).catch(() => null)
      const built = await readFile(join(input.root, 'dist/client', file)).catch(
        () => null
      )
      if (!built) return `Visual asset notice is missing from built output: ${file}`
      if (!source || !source.equals(built)) {
        return `Visual asset notice differs from source: ${file}`
      }
      return null
    })
  )
  return errors.filter((error): error is string => error !== null).sort()
}

const bookingRoot = resolve(import.meta.dirname, '..')
const noticesPath = join(bookingRoot, 'THIRD_PARTY_VISUAL_ASSETS.md')

const run = async () => {
  const today = new Date().toISOString().slice(0, 10)
  const errors = process.argv.includes('--dist')
    ? [
        ...(await inspectBuiltVisualAssets({
          root: bookingRoot,
          entries: visualAssetManifest
        })),
        ...(await inspectBuiltVisualAssetNotices({
          root: bookingRoot,
          entries: visualAssetManifest
        }))
      ]
    : await inspectVisualAssetSources({
        root: bookingRoot,
        entries: visualAssetManifest,
        today
      })

  const expectedNotices = generateVisualAssetNotices(visualAssetManifest)
  const actualNotices = await readFile(noticesPath, 'utf8').catch(() => '')
  if (actualNotices !== expectedNotices) {
    errors.push('Generated visual asset notices are missing or stale.')
  }

  if (errors.length > 0) {
    throw new Error(`Visual asset provenance check failed:\n- ${errors.join('\n- ')}`)
  }
  process.stdout.write(
    `Visual asset provenance check passed (${visualAssetManifest.length} manifested binaries).\n`
  )
}

if (import.meta.main) await run()
