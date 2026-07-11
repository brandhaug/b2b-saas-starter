import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = join(import.meta.dirname, '..', '..', '..')
const applicationRoots = ['apps', 'packages'].map((directory) =>
  join(repositoryRoot, directory)
)
const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return []
    const path = join(directory, entry)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry)
        ? [path]
        : []
  })

const foundationFiles = [
  'ids.ts',
  'booking/foundations.ts',
  'merchant-catalog/foundations.ts',
  'pricing/index.ts',
  'payments/index.ts',
  'customer-engagement/index.ts',
  'notifications/index.ts',
  'scheduled-work/index.ts'
].map((path) => join(import.meta.dirname, path))
const publicContextIndexes = [
  'booking/index.ts',
  'merchant-catalog/index.ts',
  'scheduling/index.ts',
  'developer-platform/index.ts',
  'pricing/index.ts',
  'payments/index.ts',
  'gift-cards/index.ts',
  'waiting-list/index.ts',
  'walk-ins/index.ts',
  'customer-identity/index.ts',
  'notifications/index.ts',
  'scheduled-work/index.ts'
].map((path) => join(import.meta.dirname, path))

describe('capability architecture boundaries', () => {
  it('keeps public foundation contracts transport-neutral', () => {
    for (const file of foundationFiles) {
      const source = readFileSync(file, 'utf8')
      expect(source, relative(repositoryRoot, file)).not.toContain(
        '@b2b-saas-starter/db'
      )
      expect(source, relative(repositoryRoot, file)).not.toMatch(
        /export\s+(?:const|class|function)\s+Live/
      )
    }
  })

  it('does not expose Live adapters from public context subpaths', () => {
    for (const file of publicContextIndexes)
      expect(readFileSync(file, 'utf8'), relative(repositoryRoot, file)).not.toMatch(
        /\bLive[A-Z]\w*/
      )
  })

  it('keeps application code away from capability Live adapters and product tables', () => {
    const violations = sourceFiles(join(repositoryRoot, 'apps'))
      .filter((file) => !/\.(?:test|spec)\.[^.]+$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        const reasons = [
          /import[\s\S]*?\bLive[A-Z]\w*[\s\S]*?from ['"]@b2b-saas-starter\/capabilities/.test(
            source
          )
            ? 'imports a Live capability adapter'
            : null,
          /from ['"]@b2b-saas-starter\/db\/schema['"]/.test(source)
            ? 'imports product tables'
            : null
        ].filter(Boolean)
        return reasons.map((reason) => `${relative(repositoryRoot, file)}: ${reason}`)
      })
    expect(violations).toEqual([])
  })

  it('requires explicit capability subpaths in every application import', () => {
    const violations = applicationRoots
      .flatMap(sourceFiles)
      .filter((file) =>
        /from ['"]@b2b-saas-starter\/capabilities['"]|import\(['"]@b2b-saas-starter\/capabilities['"]\)/.test(
          readFileSync(file, 'utf8')
        )
      )
      .map((file) => relative(repositoryRoot, file))
    expect(violations).toEqual([])
  })

  it('keeps foundation contexts from depending on one another', () => {
    const violations = foundationFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/from ['"]\.\.\/([^'"]+)['"]/g)]
        .map((match) => match[1] ?? '')
        .filter((path) => !['errors.ts', 'ids.ts'].includes(path))
        .map((path) => `${relative(repositoryRoot, file)} -> ${path}`)
    })
    expect(violations).toEqual([])
  })
})
