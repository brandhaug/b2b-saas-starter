import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The oxlint binary is this plugin's only real harness, so the tests drive it
 * end to end: a throwaway config loads the plugin with every other rule off,
 * oxlint runs over a fixture, and the JSON output is compared against the
 * `/* expect: <rule> *\/` markers in the fixture itself. Markers move with the
 * code they annotate, so the assertions survive reformatting.
 *
 * Run with: bunx vitest run --dir tools/oxlint
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const pluginPath = join(here, 'index.ts')
const fixturesDir = join(here, 'fixtures')

const ruleNames = ['no-direct-fetch', 'no-silent-error-swallow'] as const

const configPath = (() => {
  const directory = mkdtempSync(join(tmpdir(), 'automation-oxlint-'))
  const path = join(directory, 'oxlintrc.json')
  writeFileSync(
    path,
    JSON.stringify({
      plugins: [],
      categories: { correctness: 'off' },
      jsPlugins: [{ name: 'automation', specifier: pluginPath }],
      rules: Object.fromEntries(
        ruleNames.map((name) => [`automation/${name}`, 'error'])
      )
    })
  )
  return path
})()

type Report = {
  readonly rule: string
  readonly line: number
}

const lint = (fixture: string): Report[] => {
  const result = spawnSync(
    'bunx',
    ['oxlint', '-c', configPath, '--format=json', join(fixturesDir, fixture)],
    { cwd: repoRoot, encoding: 'utf8' }
  )
  if (result.error) throw result.error
  const parsed = JSON.parse(result.stdout) as {
    diagnostics: {
      code: string
      labels: { span: { line: number } }[]
    }[]
  }
  return parsed.diagnostics
    .flatMap((diagnostic) => {
      const match = /^automation\((?<rule>[a-z-]+)\)$/.exec(diagnostic.code)
      const rule = match?.groups?.rule
      if (rule === undefined) return []
      return [{ rule, line: diagnostic.labels[0].span.line }]
    })
    .sort(
      (left, right) => left.line - right.line || left.rule.localeCompare(right.rule)
    )
}

const expectedReports = (fixture: string): Report[] =>
  readFileSync(join(fixturesDir, fixture), 'utf8')
    .split('\n')
    .flatMap((text, index) => {
      const match = /\/\* expect: (?<rule>[a-z-]+) \*\//.exec(text)
      const rule = match?.groups?.rule
      if (rule === undefined) return []
      return [{ rule, line: index + 1 }]
    })

describe('automation oxlint plugin', () => {
  it.each(ruleNames)('%s reports every marked violation', (rule) => {
    const fixture = `${rule}.invalid.ts`
    const expected = expectedReports(fixture)
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.every((report) => report.rule === rule)).toBe(true)
    expect(lint(fixture)).toEqual(expected)
  })

  it.each(ruleNames)('%s stays silent on accepted patterns', (rule) => {
    const fixture = `${rule}.valid.ts`
    expect(expectedReports(fixture)).toEqual([])
    expect(lint(fixture)).toEqual([])
  })

  const lintWithRepositoryConfig = (path: string) => {
    const result = spawnSync('bunx', ['oxlint', '--format=json', path], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    if (result.error) throw result.error
    return result.stdout
  }

  it('is wired up by the repository config', () => {
    // A probe outside `fixtures/`, which has its own nested config.
    const probe = join(here, 'repository-config-probe.tmp.ts')
    writeFileSync(probe, 'export const call = () => fetch("https://example.com")\n')
    try {
      expect(lintWithRepositoryConfig(probe)).toContain('automation(no-direct-fetch)')
    } finally {
      rmSync(probe)
    }
  })

  it('keeps the fixtures out of the repository-wide run', () => {
    // Otherwise the deliberate violations would block every commit.
    expect(lintWithRepositoryConfig(fixturesDir)).not.toContain('automation(')
  })
})
