import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vite-plus/test'

// Oxlint JS rules need the real binary. Collect fixtures during describe, then
// lint them together on the first assertion to avoid one subprocess per case.

const VP_BIN = join(
  dirname(fileURLToPath(import.meta.resolve('vite-plus/package.json'))),
  'bin',
  'vp'
)
const PLUGIN_ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

/**
 * Oxlint's `--format=json` payload, narrowed to the fields the harness reads.
 * `decodeReport` is the boundary: everything past it is typed, so the rest of
 * the harness needs no casts or shape probing over subprocess output.
 */
type OxlintReport = {
  diagnostics: Array<{
    code: string
    message: string
    filename: string
  }>
}

type Case = {
  readonly directory: string
  readonly filename: string
  readonly code: string
}

type CaseOptions = {
  /** Fixture file name. Set it when the rule's behaviour depends on the path. */
  readonly filename?: string
}

type Override = {
  readonly files: ReadonlyArray<string>
  readonly rules: Readonly<Record<string, 'off' | 'error' | ReadonlyArray<unknown>>>
}

/** `ruleId` is the fully qualified id from lint.config.ts. */
export function createRuleHarness(
  ruleId: string,
  defaults: CaseOptions = {},
  overrides?: ReadonlyArray<Override>,
  ruleOptions: ReadonlyArray<unknown> = []
) {
  const cases: Array<Case> = []
  let outcome: ReadonlyMap<string, ReadonlyArray<string>> | undefined

  return {
    valid: (name: string, code: string, options: CaseOptions = {}) => {
      register(name, code, options, (messages) => {
        expect(messages.join('\n'), `expected ${ruleId} to stay quiet`).toBe('')
      })
    },
    invalid: (
      name: string,
      code: string,
      assertMessages?: (messages: string) => void,
      options: CaseOptions = {}
    ) => {
      register(name, code, options, (messages) => {
        expect(messages, `expected ${ruleId} to report on this fixture`).not.toEqual([])
        assertMessages?.(messages.join('\n'))
      })
    }
  }

  function register(
    name: string,
    code: string,
    options: CaseOptions,
    check: (messages: ReadonlyArray<string>) => void
  ) {
    const directory = `case-${String(cases.length).padStart(3, '0')}`
    cases.push({
      directory,
      filename: options.filename ?? defaults.filename ?? 'fixture.ts',
      code
    })

    it(name, () => {
      outcome ??= messagesByCase(ruleId, cases, overrides, ruleOptions)
      check(outcome.get(directory) ?? [])
    })
  }
}

function messagesByCase(
  ruleId: string,
  cases: ReadonlyArray<Case>,
  overrides?: ReadonlyArray<Override>,
  ruleOptions: ReadonlyArray<unknown> = []
): ReadonlyMap<string, ReadonlyArray<string>> {
  const [pluginName, ruleName] = ruleId.split('/')
  let pluginEntry = PLUGIN_ENTRY
  if (pluginName === 'effect') {
    pluginEntry = fileURLToPath(import.meta.resolve('oxlint-plugin-effect/plugin'))
  }
  const jsPlugins = []
  if (pluginName !== 'eslint') {
    jsPlugins.push({ name: pluginName, specifier: pluginEntry })
  }
  const rules: Record<string, ReadonlyArray<unknown>> = {}
  if (overrides === undefined) {
    rules[ruleId] = ['error', ...ruleOptions]
  }
  const root = mkdtempSync(join(tmpdir(), 'starter-oxlint-'))
  try {
    writeFileSync(
      join(root, 'oxlintrc.json'),
      // oxlint-disable-next-line effect/noGlobals -- fixture config is four keys of plain data; the harness owns no codec (see decodeReport)
      JSON.stringify({
        plugins: [],
        // Without this, built-in rules report unused fixture variables alongside
        // the rule under test.
        categories: { correctness: 'off' },
        jsPlugins,
        rules,
        overrides: overrides?.map((override) => ({
          ...override,
          files: override.files.map((file) => `case-*/${file}`)
        }))
      })
    )

    for (const testCase of cases) {
      mkdirSync(dirname(join(root, testCase.directory, testCase.filename)), {
        recursive: true
      })
      writeFileSync(join(root, testCase.directory, testCase.filename), testCase.code)
    }

    // `--silent` suppresses the diagnostics themselves, so it must stay off.
    const result = spawnSync(
      VP_BIN,
      ['lint', '-c', join(root, 'oxlintrc.json'), '--format=json', root],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }
    )

    if (result.error !== undefined) {
      throw result.error
    }
    if (result.stdout.length === 0) {
      throw new Error(
        `oxlint produced no output for ${ruleId} (exit ${String(result.status)}): ${result.stderr}`
      )
    }

    const expectedCode = `${pluginName}(${ruleName})`
    const collected = new Map<string, Array<string>>()
    for (const diagnostic of decodeReport(result.stdout).diagnostics) {
      if (diagnostic.code !== expectedCode) {
        continue
      }
      const owner = cases.find((testCase) =>
        diagnostic.filename.includes(`${testCase.directory}/`)
      )
      if (owner === undefined) {
        continue
      }
      const existing = collected.get(owner.directory) ?? []
      existing.push(diagnostic.message)
      collected.set(owner.directory, existing)
    }
    return collected
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function decodeReport(stdout: string): OxlintReport {
  // This tooling package trusts oxlint's documented JSON output and owns no
  // codec dependency. Malformed output fails the fixture run.
  // oxlint-disable-next-line effect/noGlobals -- plain JSON boundary; a Schema here would reintroduce the `effect` dependency the cleanup removed
  const parsed: OxlintReport = JSON.parse(stdout)
  return parsed
}
