/* oxlint-disable effect/noNewPromise -- this build boundary uses Node's async filesystem and compiler APIs */
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { compile } from '@inlang/paraglide-js'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  flattenCatalog,
  mergeInto,
  validateCatalogs,
  validateProjectLocales
} from './catalog-validation.mjs'
import { LOCALES } from '../src/locale.ts'

const packageRoot = resolve(import.meta.dirname, '..')
// The SDK evaluates local project modules from a data URL, so the bridge
// resolves this package's dependency through the process working directory.
// Normalize it for callers such as the root build and web Vite config.
process.chdir(packageRoot)
const sourceRoot = join(packageRoot, 'messages')
const generatedMessagesRoot = join(packageRoot, '.generated', 'messages')

// `src/locale.ts` owns the closed locale set; the inlang project is checked
// against it below rather than restating it.
const locales = LOCALES
const settingsRaw = await readFile(
  join(packageRoot, 'project.inlang/settings.json'),
  'utf8'
)
validateProjectLocales(JSON.parse(settingsRaw), locales)
const routeConfig = JSON.parse(await readFile(join(packageRoot, 'routes.json'), 'utf8'))

async function filesUnder(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted((left, right) => left.localeCompare(right))
}

async function loadLocale(locale) {
  const allFiles = await filesUnder(sourceRoot)
  const files = allFiles.filter((file) => file.endsWith(`/${locale}.json`))
  const merged = {}
  const rawFiles = await Promise.all(files.map((file) => readFile(file, 'utf8')))
  for (const [index, raw] of rawFiles.entries()) {
    const file = files[index]
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`Invalid JSON in ${file}`, { cause: error })
    }
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse returns unknown data at this I/O boundary
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Catalog must contain an object: ${file}`)
    }
    mergeInto(merged, parsed, '')
  }
  if (Object.keys(merged).length === 0) {
    throw new Error(`No ${locale} catalogs found under ${sourceRoot}`)
  }
  return merged
}

async function localeEntry(locale) {
  const catalog = await loadLocale(locale)
  return [locale, catalog]
}

const sourceCatalogs = Object.fromEntries(await Promise.all(locales.map(localeEntry)))

const catalogs = Object.fromEntries(
  locales.map((locale) => [locale, flattenCatalog(sourceCatalogs[locale], locale)])
)
validateCatalogs(catalogs)

// Recursive workspace checks and Vite environments share this output. Avoid
// regenerating identical modules and triggering hundreds of unnecessary HMR events.
const compilerInputs = await Promise.all([
  readFile(import.meta.filename, 'utf8'),
  Promise.resolve(settingsRaw),
  readFile(join(packageRoot, 'package.json'), 'utf8'),
  readFile(join(packageRoot, 'plugin-message-format.js'), 'utf8'),
  readFile(join(packageRoot, 'scripts/catalog-validation.mjs'), 'utf8'),
  readFile(join(packageRoot, 'src/locale.ts'), 'utf8'),
  readFile(join(packageRoot, 'routes.json'), 'utf8')
])
const fingerprint = createHash('sha256')
  .update(JSON.stringify(catalogs))
  .update(compilerInputs.join('\0'))
  .digest('hex')
const fingerprintPath = join(packageRoot, '.generated', 'fingerprint')
const generatedManifestPath = join(packageRoot, '.generated', 'generated-files.json')
const previousFingerprint = await readFile(fingerprintPath, 'utf8').catch(() => null)
const generatedFiles = await readFile(generatedManifestPath, 'utf8')
  .then((raw) => {
    const parsed = JSON.parse(raw)
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON.parse returns unknown data at this I/O boundary
    return Array.isArray(parsed) && parsed.every((file) => typeof file === 'string')
      ? parsed
      : null
  })
  .catch(() => null)
if (
  previousFingerprint === fingerprint &&
  generatedFiles !== null &&
  generatedFiles.length > 0 &&
  generatedFiles.every((file) => existsSync(join(packageRoot, 'src/generated', file)))
) {
  process.exit(0)
}

await mkdir(generatedMessagesRoot, { recursive: true })
await Promise.all(
  locales.map((locale) =>
    writeFile(
      join(generatedMessagesRoot, `${locale}.json`),
      `${JSON.stringify(catalogs[locale], null, '\t')}\n`
    )
  )
)

await compile({
  project: join(packageRoot, 'project.inlang'),
  outdir: join(packageRoot, 'src', 'generated'),
  emitTsDeclarations: true,
  outputStructure: 'message-modules',
  // Keep the previous graph readable while dev servers and recursive checks
  // consume it. Barrels are regenerated, so removed keys stop being exported.
  cleanOutdir: false,
  strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],
  cookieName: 'starter_locale',
  trailingSlash: 'never',
  urlPatterns: [
    {
      pattern: '/',
      localized: [
        ['en', '/en'],
        ['nb', '/nb']
      ]
    },
    ...['pricing', 'privacy', 'terms', 'help', 'changelog', 'faq'].map((path) => ({
      pattern: `/${path}`,
      localized: [
        ['en', `/en/${path}`],
        ['nb', `/nb/${path}`]
      ]
    })),
    {
      pattern: '/docs',
      localized: [
        ['en', '/en/docs'],
        ['nb', '/nb/docs']
      ]
    },
    {
      pattern: '/blog',
      localized: [
        ['en', '/en/blog'],
        ['nb', '/nb/blog']
      ]
    },
    ...['docs', 'blog'].map((path) => ({
      pattern: `/${path}/:path(.*)?`,
      localized: [
        ['en', `/en/${path}/:path(.*)?`],
        ['nb', `/nb/${path}/:path(.*)?`]
      ]
    }))
  ],
  routeStrategies: [
    ...routeConfig.unlocalizedPaths.map((path) => ({
      match: `${path}/:path(.*)?`,
      exclude: true
    })),
    ...routeConfig.unlocalizedExactPaths.map((path) => ({
      match: path,
      exclude: true
    })),
    ...[
      ...routeConfig.accountPresentationPaths,
      ...routeConfig.guestPresentationPaths
    ].map((path) => ({
      match: `${path}/:path(.*)?`,
      strategy: ['cookie', 'preferredLanguage', 'baseLocale']
    }))
  ]
})

const outputRoot = join(packageRoot, 'src', 'generated')
const outputFiles = await filesUnder(outputRoot)
const emittedFiles = outputFiles.map((file) => relative(outputRoot, file))
if (emittedFiles.length === 0) {
  throw new Error('Compiler emitted no files under src/generated')
}
await writeFile(generatedManifestPath, `${JSON.stringify(emittedFiles, null, 2)}\n`)
await writeFile(fingerprintPath, fingerprint)
