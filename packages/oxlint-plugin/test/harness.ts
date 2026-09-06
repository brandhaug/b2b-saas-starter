import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vite-plus/test'

/**
 * Oxlint has no in-process rule tester for JS plugins: a rule only runs inside the
 * real linter. So each rule's test file drives the actual `oxlint` binary over
 * throwaway fixtures, with a generated config that loads this plugin and enables
 * exactly one rule.
 *
 * Spawning once per case would cost a process per assertion, so the harness
 * collects every case while the `describe` body runs, then lints all of them in a
 * single invocation the first time a case is asserted. Vitest evaluates a `describe`
 * callback fully before running any `it` inside it, which is what makes the deferred
 * single run safe.
 */

const OXLINT_BIN = join(
  dirname(fileURLToPath(import.meta.resolve('oxlint/package.json'))),
  'bin',
  'oxlint'
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

function decodeReport(stdout: string): OxlintReport {
  // The harness deliberately owns no codec: the plugin's only runtime
  // dependency is `@oxlint/plugins`, so the boundary is the documented
  // `--format=json` payload itself — malformed output fails on the first
  // property read, exactly as a decode would.
  // oxlint-disable-next-line effect/noGlobals -- plain JSON boundary; a Schema here would reintroduce the `effect` dependency the cleanup removed
  const parsed: OxlintReport = JSON.parse(stdout)
  return parsed
}

type Case = {
  readonly directory: string
  readonly filename: string
  readonly code: string
}

function messagesByCase(
  ruleId: string,
  cases: ReadonlyArray<Case>
): ReadonlyMap<string, ReadonlyArray<string>> {
  const [pluginName, ruleName] = ruleId.split('/')
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
        jsPlugins: [{ name: pluginName, specifier: PLUGIN_ENTRY }],
        rules: { [ruleId]: 'error' }
      })
    )

    for (const testCase of cases) {
      mkdirSync(join(root, testCase.directory), { recursive: true })
      writeFileSync(join(root, testCase.directory, testCase.filename), testCase.code)
    }

    // `--silent` suppresses the diagnostics themselves, so it must stay off.
    const result = spawnSync(
      OXLINT_BIN,
      ['-c', join(root, 'oxlintrc.json'), '--format=json', '.'],
      { cwd: root, encoding: 'utf8' }
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

type CaseOptions = {
  /** Fixture file name. Set it when the rule's behaviour depends on the path. */
  readonly filename?: string
}

/**
 * `ruleId` is the fully qualified id as it appears in the repo's lint config, for
 * example
 * `starter/no-interface-merge-outside-dts`.
 */
export function createRuleHarness(ruleId: string, defaults: CaseOptions = {}) {
  const cases: Array<Case> = []
  let outcome: ReadonlyMap<string, ReadonlyArray<string>> | undefined

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
      outcome ??= messagesByCase(ruleId, cases)
      check(outcome.get(directory) ?? [])
    })
  }

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
}
