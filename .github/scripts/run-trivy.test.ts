import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { onTestFinished, test } from 'vite-plus/test'

// Failure cases: unchanged vulnerable versions must pass PRs, new packages and
// upgrades/downgrades must fail, and missing inventory, invalid JSON or scanner
// failure must never turn into a clean audit. Full scans must still catch debt.
const finding = {
  VulnerabilityID: 'CVE-2099-12345',
  PkgName: 'example',
  InstalledVersion: '2.0.0',
  Severity: 'HIGH',
  Title: 'private-scanner-detail'
}
function report(version: string, vulnerable = false) {
  return {
    SchemaVersion: 2,
    Results: [
      {
        Target: 'pnpm-lock.yaml',
        Type: 'pnpm',
        Packages: [{ Name: 'example', Version: version }],
        Vulnerabilities: vulnerable ? [finding] : []
      }
    ]
  }
}

const scenarios = [
  { name: 'unchanged vulnerable version passes', base: report('2.0.0', true), code: 0 },
  { name: 'new advisory on unchanged version passes', base: report('2.0.0'), code: 0 },
  { name: 'upgraded vulnerable version fails', base: report('1.0.0'), code: 1 },
  { name: 'downgraded vulnerable version fails', base: report('3.0.0'), code: 1 },
  {
    name: 'new vulnerable package fails',
    base: { SchemaVersion: 2, Results: [] },
    code: 1
  },
  {
    name: 'missing inventory fails closed',
    base: { SchemaVersion: 2, Results: [{ Type: 'pnpm' }] },
    code: 1
  },
  { name: 'invalid JSON fails closed', base: 'invalid', code: 1 },
  {
    name: 'scanner failure fails closed',
    base: report('2.0.0'),
    scannerFailure: true,
    code: 1
  },
  {
    name: 'full scan still fails existing debt',
    base: report('2.0.0', true),
    full: true,
    code: 1
  },
  { name: 'clean current report passes', base: report('1.0.0'), clean: true, code: 0 }
]

test.each(scenarios)('$name', (scenario) => {
  const folder = mkdtempSync(join(tmpdir(), 'trivy-runner-'))
  onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
  const base = join(folder, 'base')
  mkdirSync(base)
  execFileSync('git', ['init', '-q', base])
  execFileSync('git', [
    '-C',
    base,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-qm',
    'base'
  ])
  writeFileSync(join(base, 'pnpm-lock.yaml'), 'base')
  writeFileSync(join(folder, 'pnpm-lock.yaml'), 'head')
  const binary = join(folder, 'trivy')
  writeFileSync(
    binary,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (${scenario.scannerFailure ?? false}) process.exit(2);
if (args[0] === 'fs') {
  const input = readFileSync(args.at(-1) + '/pnpm-lock.yaml', 'utf8');
  const base = ${JSON.stringify(scenario.base)};
  const report = input === 'base' ? base : ${JSON.stringify(report('2.0.0', !scenario.clean))};
  writeFileSync(args[args.indexOf('--output') + 1], typeof report === 'string' ? report : JSON.stringify(report));
} else if (args[0] === 'convert') {
  const report = JSON.parse(readFileSync(args.at(-1), 'utf8'));
  const failed = report.Results.some(result => result.Vulnerabilities?.length);
  if (failed) console.log('CVE-2099-12345 example@2.0.0');
  process.exit(failed ? 1 : 0);
} else process.exit(3);
`
  )
  chmodSync(binary, 0o755)
  const result = spawnSync(
    process.execPath,
    [
      resolve('.github/scripts/run-trivy.ts'),
      base,
      ...(scenario.full ? [] : ['--changes-only'])
    ],
    {
      cwd: folder,
      env: { ...process.env, TRIVY_BINARY: binary },
      encoding: 'utf8',
      timeout: 30_000
    }
  )
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(result.status, scenario.code, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout + result.stderr, /private-scanner-detail/)
})
