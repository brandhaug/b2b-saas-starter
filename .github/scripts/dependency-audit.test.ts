import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

import { evaluateAudit } from './dependency-audit.ts'

// Synthetic pnpm 11 report. No vulnerable package is installed by these tests.
const advisory = {
  github_advisory_id: 'GHSA-2345-6789-cfgh',
  module_name: 'fixture-package',
  severity: 'high',
  findings: [
    {
      version: '1.0.0',
      paths: ['apps/web>fixture-package'],
      dev: false,
      optional: false
    }
  ],
  title: 'Do not print arbitrary registry text: credential-canary',
  url: 'https://user:credential-canary@registry.example/advisory'
}
function report(entries = [advisory]): string {
  return JSON.stringify({
    advisories: Object.fromEntries(entries.map((entry, index) => [index, entry])),
    metadata: {
      vulnerabilities: Object.fromEntries(
        ['info', 'low', 'moderate', 'high', 'critical'].map((severity) => [
          severity,
          entries.filter((entry) => entry.severity === severity).length
        ])
      )
    }
  })
}
const exception = {
  finding: advisory.github_advisory_id,
  package: 'fixture-package',
  version: '1.0.0',
  severity: 'high',
  scope: { path: 'apps/web>fixture-package', dev: false, optional: false },
  rationale: 'Synthetic acceptance evidence only',
  owner: '@fixture-owner',
  approvalEvidence:
    'https://github.com/brandhaug/b2b-saas-starter/issues/341#issuecomment-1',
  mitigation: 'Disable the affected parser until the upgrade is deployed',
  expires: '2030-02-01T00:00:00.000Z'
}
const now = new Date('2030-01-01T00:00:00.000Z')

await test('AC-12.1/AC-12.3: high and critical findings fail across dependency types', () => {
  for (const severity of ['high', 'critical']) {
    for (const flags of [
      { dev: false, optional: false },
      { dev: true, optional: false },
      { dev: false, optional: true }
    ]) {
      const result = evaluateAudit(
        report([
          { ...advisory, severity, findings: [{ ...advisory.findings[0], ...flags }] }
        ]),
        '[]',
        now
      )
      assert.equal(result.code, 1)
      assert.match(result.lines.join('\n'), /BLOCKED.*fixture-package@1.0.0/)
    }
  }
})

await test('AC-12.3: fixed findings and lower severities pass', () => {
  assert.equal(evaluateAudit(report([]), '[]', now).code, 0)
  for (const severity of ['info', 'low', 'moderate']) {
    assert.equal(evaluateAudit(report([{ ...advisory, severity }]), '[]', now).code, 0)
  }
})

await test('AC-12.2/AC-12.3: reviewed matching exception passes only before expiry', () => {
  const accepted = evaluateAudit(report(), JSON.stringify([exception]), now)
  assert.equal(accepted.code, 0)
  assert.match(accepted.lines.join('\n'), /accepted until 2030-02-01/)
  assert.equal(
    evaluateAudit(report(), JSON.stringify([exception]), new Date(exception.expires))
      .code,
    1
  )
  assert.equal(
    evaluateAudit(report(), JSON.stringify([exception]), new Date('2030-02-02')).code,
    1
  )
})

await test('AC-12.2: another advisory, package, version, severity or scope is never suppressed', () => {
  for (const mismatch of [
    { finding: 'GHSA-2345-6789-cfgj' },
    { package: 'another-package' },
    { version: '1.0.1' },
    { severity: 'critical' },
    { scope: { ...exception.scope, path: 'apps/api>fixture-package' } },
    { scope: { ...exception.scope, dev: true } },
    { scope: { ...exception.scope, optional: true } }
  ]) {
    assert.equal(
      evaluateAudit(report(), JSON.stringify([{ ...exception, ...mismatch }]), now)
        .code,
      1
    )
  }
  const expanded = {
    ...advisory,
    findings: [
      {
        ...advisory.findings[0],
        paths: ['apps/web>fixture-package', 'apps/api>fixture-package']
      }
    ]
  }
  assert.equal(
    evaluateAudit(report([expanded]), JSON.stringify([exception]), now).code,
    1
  )
})

await test('AC-12.2: incomplete, wildcard, malformed and impossible-date exceptions fail closed', () => {
  for (const field of Object.keys(exception)) {
    const incomplete = Object.fromEntries(
      Object.entries(exception).filter(([key]) => key !== field)
    )
    assert.throws(() => evaluateAudit(report(), JSON.stringify([incomplete]), now))
  }
  for (const malformed of [
    { rationale: ' ' },
    { owner: '' },
    { mitigation: '' },
    { approvalEvidence: 'approved' },
    { version: '*' },
    { scope: { ...exception.scope, path: '*' } },
    { expires: '2030-02-30T00:00:00.000Z' },
    { expires: 'never' },
    { typo: true }
  ]) {
    assert.throws(() =>
      evaluateAudit(report(), JSON.stringify([{ ...exception, ...malformed }]), now)
    )
  }
})

await test('AC-12.2: capped pnpm paths cannot establish complete exception scope', () => {
  const paths = Array.from(
    { length: 100 },
    (_, index) => `app-${index}>fixture-package`
  )
  const capped = { ...advisory, findings: [{ ...advisory.findings[0], paths }] }
  // oxlint-disable-next-line no-map-spread -- each synthetic exception needs its own scope; the fixture must stay immutable.
  const exceptions = paths.map((path) => ({
    ...exception,
    scope: { path, dev: false, optional: false }
  }))
  const result = evaluateAudit(report([capped]), JSON.stringify(exceptions), now)
  assert.equal(result.code, 1)
  assert.match(result.lines.join('\n'), /report may be truncated/)
})

await test('AC-12.1: missing, malformed and incomplete registry reports fail closed', () => {
  for (const value of [
    '',
    '{}',
    '{"error":"credential-canary"}',
    report().replace('"high":1', '"high":2'),
    report().replace('"paths":["apps/web>fixture-package"]', '"paths":[]')
  ]) {
    assert.throws(() => evaluateAudit(value, '[]', now))
  }
})

await test('AC-12.4: actionable output excludes arbitrary registry and policy text', () => {
  const result = evaluateAudit(
    report(),
    JSON.stringify([
      { ...exception, rationale: 'credential-canary', mitigation: 'credential-canary' }
    ]),
    now
  )
  assert.doesNotMatch(result.lines.join('\n'), /credential-canary|registry\.example/)
  assert.match(
    result.lines.join('\n'),
    /https:\/\/github.com\/advisories\/GHSA-2345-6789-cfgh/
  )
})

await test('AC-12.3: CLI exits failing and fixed using synthetic pnpm responses', (context) => {
  const folder = mkdtempSync(join(tmpdir(), 'dependency-audit-'))
  context.after(() => rmSync(folder, { recursive: true, force: true }))
  for (const [json, expected] of [
    [report(), 1],
    [report([]), 0]
  ] satisfies Array<[string, number]>) {
    writeFileSync(
      join(folder, 'pnpm'),
      `#!/usr/bin/env node\nconsole.log(${JSON.stringify(json)})\nprocess.exit(${expected})\n`,
      { mode: 0o755 }
    )
    const result = spawnSync(
      process.execPath,
      [new URL('./dependency-audit.ts', import.meta.url).pathname],
      {
        env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` },
        encoding: 'utf8'
      }
    )
    assert.equal(result.status, expected, result.stderr)
    assert.match(result.stdout, /Dependency audit:/)
    assert.doesNotMatch(result.stdout + result.stderr, /credential-canary/)
  }
})

await test('AC-12.1/AC-12.4: registry retries recover or fail closed without exposing diagnostics', (context) => {
  const folder = mkdtempSync(join(tmpdir(), 'dependency-audit-retry-'))
  context.after(() => rmSync(folder, { recursive: true, force: true }))
  const counter = join(folder, 'attempts')
  for (const recover of [true, false]) {
    writeFileSync(counter, '0')
    writeFileSync(
      join(folder, 'pnpm'),
      `#!/usr/bin/env node
const fs = require('node:fs')
const counter = ${JSON.stringify(counter)}
const attempt = Number(fs.readFileSync(counter, 'utf8')) + 1
fs.writeFileSync(counter, String(attempt))
console.error('https://user:credential-canary@registry.example')
if (${recover} && attempt === 2) {
  console.log(${JSON.stringify(report([]))})
  process.exit(0)
}
console.log(JSON.stringify({error: 'credential-canary'}))
process.exit(23)
`,
      { mode: 0o755 }
    )
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { main } from ${JSON.stringify(new URL('./dependency-audit.ts', import.meta.url).href)}; process.exitCode = await main(() => Promise.resolve())`
      ],
      {
        env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` },
        encoding: 'utf8'
      }
    )
    assert.equal(result.status, recover ? 0 : 1, result.stderr)
    assert.equal(readFileSync(counter, 'utf8'), recover ? '2' : '3')
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /credential-canary|registry\.example/
    )
    assert.match(result.stderr, /could not be evaluated/)
  }
})
