import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'

// Validate the fields used for comparison while retaining Trivy's full report
// for its native exception filtering and restricted output template.
const isReport = Schema.is(
  Schema.Struct({
    SchemaVersion: Schema.Literal(2),
    Results: Schema.optional(
      Schema.Array(
        Schema.Struct({
          Target: Schema.String,
          Type: Schema.Literal('pnpm'),
          Packages: Schema.optional(
            Schema.Array(
              Schema.Struct({
                Name: Schema.String,
                Version: Schema.String
              })
            )
          ),
          Vulnerabilities: Schema.optional(
            Schema.Array(
              Schema.Struct({
                PkgName: Schema.String,
                InstalledVersion: Schema.String
              })
            )
          )
        })
      )
    )
  })
)

function runTrivy(args: Array<string>, output: 'inherit' | 'ignore' = 'ignore') {
  const result = spawnSync(process.env.TRIVY_BINARY ?? 'trivy', args, {
    stdio: ['ignore', output, 'pipe'],
    timeout: 10 * 60_000
  })
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error('Trivy scan failed')
  }
}

function scan(root: string, folder: string, name: string) {
  const input = join(folder, name)
  mkdirSync(input)
  copyFileSync(join(root, 'pnpm-lock.yaml'), join(input, 'pnpm-lock.yaml'))
  const output = join(folder, `${name}.json`)
  runTrivy([
    'fs',
    '--config',
    '/dev/null',
    '--ignorefile',
    '/dev/null',
    '--scanners',
    'vuln',
    '--pkg-types',
    'library',
    '--include-dev-deps',
    '--list-all-pkgs',
    '--severity',
    'HIGH,CRITICAL',
    '--exit-code',
    '0',
    '--format',
    'json',
    '--output',
    output,
    '--quiet',
    input
  ])
  const report: unknown = JSON.parse(readFileSync(output, 'utf8'))
  if (!isReport(report)) {
    throw new Error('Invalid Trivy report')
  }
  return report
}

const folder = mkdtempSync(join(tmpdir(), 'dependency-scan-'))
try {
  const trustedRoot = process.argv[2]
  const mode = process.argv.at(3)
  if (
    !trustedRoot ||
    (mode !== undefined && mode !== '--changes-only') ||
    process.argv.length > 4
  ) {
    throw new Error('Pass the trusted base checkout path and optional --changes-only')
  }
  const revision = execFileSync('git', ['-C', trustedRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
  console.log(`Trusted exception revision: ${revision}`)
  let current = scan('.', folder, 'current')
  if (mode === '--changes-only') {
    const base = scan(trustedRoot, folder, 'base')
    const existing = new Set<string>()
    for (const result of base.Results ?? []) {
      if (!result.Packages) {
        throw new Error('Missing baseline package inventory')
      }
      for (const pkg of result.Packages) {
        existing.add(JSON.stringify([pkg.Name, pkg.Version]))
      }
    }
    current = {
      ...current,
      // oxlint-disable-next-line oxc/no-map-spread -- Preserve native Trivy metadata when replacing findings.
      Results: (current.Results ?? []).map((result) => ({
        ...result,
        Vulnerabilities: (result.Vulnerabilities ?? []).filter(
          (finding) =>
            !existing.has(JSON.stringify([finding.PkgName, finding.InstalledVersion]))
        )
      }))
    }
    console.log('PR dependency gate: package versions absent from the trusted base')
  }
  const reportPath = join(folder, 'report.json')
  writeFileSync(reportPath, JSON.stringify(current))
  const policy = resolve(trustedRoot, '.trivyignore.yaml')
  const ignoreFile = join(folder, 'ignore.yaml')
  if (existsSync(policy)) {
    copyFileSync(policy, ignoreFile)
  } else {
    // The initial base predates this policy; no exceptions apply.
    writeFileSync(ignoreFile, 'vulnerabilities: []\n')
  }
  const template = fileURLToPath(new URL('../trivy-report.tpl', import.meta.url))
  runTrivy(
    [
      'convert',
      '--config',
      '/dev/null',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      '--ignorefile',
      ignoreFile,
      '--format',
      'template',
      '--template',
      `@${template}`,
      '--quiet',
      reportPath
    ],
    'inherit'
  )
} catch {
  console.error(
    'Audit failed: resolve the findings above or diagnose the trusted checkout and Trivy/database availability locally. See docs/dependency-security.md.'
  )
  process.exitCode = 1
} finally {
  rmSync(folder, { recursive: true, force: true })
}
