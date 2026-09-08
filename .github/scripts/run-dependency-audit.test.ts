import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'

const runner = new URL('./run-dependency-audit.ts', import.meta.url).pathname
const report = {
  advisories: {
    1: {
      github_advisory_id: 'GHSA-2345-6789-cfgh',
      module_name: 'fixture-package',
      severity: 'high',
      findings: [
        {
          version: '1.0.0',
          paths: ['apps__web>fixture-package'],
          dev: false,
          optional: false
        }
      ]
    }
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } }
}
const exception = {
  finding: 'GHSA-2345-6789-cfgh',
  package: 'fixture-package',
  version: '1.0.0',
  severity: 'high',
  scope: { path: 'apps__web>fixture-package', dev: false, optional: false },
  rationale: 'Synthetic policy',
  owner: '@operator',
  mitigation: 'Synthetic mitigation',
  approvalEvidence:
    'https://github.com/brandhaug/b2b-saas-starter/issues/341#issuecomment-1',
  expires: `${new Date().getUTCFullYear() + 1}-01-01T00:00:00.000Z`
}

await test('AC-12.2: executes only base evaluator/policy while auditing PR dependencies', (context) => {
  const folder = mkdtempSync(join(tmpdir(), 'trusted-dependency-audit-'))
  context.after(() => rmSync(folder, { recursive: true, force: true }))
  const trusted = join(folder, 'base')
  const proposed = join(folder, 'pr')
  mkdirSync(join(trusted, '.git'), { recursive: true })
  mkdirSync(join(trusted, '.github/scripts'), { recursive: true })
  mkdirSync(join(proposed, '.github/scripts'), { recursive: true })
  // There are no node_modules beside this copied evaluator. A package import
  // would fail instead of silently resolving an implementation from the PR.
  cpSync(
    new URL('./dependency-audit.ts', import.meta.url),
    join(trusted, '.github/scripts/dependency-audit.ts')
  )
  writeFileSync(
    join(proposed, '.github/scripts/dependency-audit.ts'),
    "console.log('UNTRUSTED EVALUATOR'); process.exitCode = 0"
  )
  writeFileSync(
    join(proposed, '.github/dependency-audit-exceptions.json'),
    JSON.stringify([exception])
  )
  writeFileSync(join(proposed, 'pnpm-lock.yaml'), 'PR dependency tree')
  writeFileSync(join(trusted, 'pnpm-lock.yaml'), 'BASE dependency tree')
  writeFileSync(
    join(folder, 'pnpm'),
    `#!/usr/bin/env node
const fs = require('node:fs')
if (fs.readFileSync('pnpm-lock.yaml', 'utf8') !== 'PR dependency tree') process.exit(23)
console.log(${JSON.stringify(JSON.stringify(report))})
process.exit(1)
`,
    { mode: 0o755 }
  )
  for (const accepted of [false, true]) {
    writeFileSync(
      join(trusted, '.github/dependency-audit-exceptions.json'),
      JSON.stringify(accepted ? [exception] : [])
    )
    const result = spawnSync(process.execPath, [runner, trusted], {
      cwd: proposed,
      env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` },
      encoding: 'utf8'
    })
    assert.equal(result.status, accepted ? 0 : 1, result.stderr)
    assert.match(result.stdout, accepted ? /accepted until/ : /BLOCKED/)
    assert.doesNotMatch(result.stdout, /UNTRUSTED/)
  }
  rmSync(join(trusted, '.github/dependency-audit-exceptions.json'))
  const missingPolicy = spawnSync(process.execPath, [runner, trusted], {
    cwd: proposed,
    env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` },
    encoding: 'utf8'
  })
  assert.equal(missingPolicy.status, 1)
  assert.match(missingPolicy.stderr, /exception file could not be read/)
})

await test('AC-12.1/AC-12.4: bootstrap uses native high threshold with no exceptions or raw output', (context) => {
  const folder = mkdtempSync(join(tmpdir(), 'bootstrap-dependency-audit-'))
  context.after(() => rmSync(folder, { recursive: true, force: true }))
  const trusted = join(folder, 'base')
  mkdirSync(join(trusted, '.git'), { recursive: true })
  mkdirSync(join(folder, '.github/scripts'), { recursive: true })
  writeFileSync(
    join(folder, '.github/scripts/dependency-audit.ts'),
    "console.log('UNTRUSTED EVALUATOR'); process.exitCode = 0"
  )
  writeFileSync(
    join(folder, '.github/dependency-audit-exceptions.json'),
    JSON.stringify([exception])
  )
  // Observed with native pnpm 11.25 against a synthetic loopback registry:
  // high audit-level exits 0 for lower-only findings, 1 for high/critical,
  // and nonzero for a registry error. Lower counts remain in JSON metadata.
  for (const status of [0, 1, 23]) {
    writeFileSync(
      join(folder, 'pnpm'),
      `#!/usr/bin/env node
if (!process.argv.includes('--audit-level=high')) process.exit(64)
console.log('credential-canary')
console.error('credential-canary')
process.exit(${status})
`,
      { mode: 0o755 }
    )
    const result = spawnSync(process.execPath, [runner, trusted], {
      cwd: folder,
      env: { ...process.env, PATH: `${folder}${delimiter}${process.env.PATH}` },
      encoding: 'utf8'
    })
    assert.equal(result.status, status === 0 ? 0 : 1)
    assert.match(result.stdout + result.stderr, /[Nn]o exceptions applied/)
    assert.doesNotMatch(result.stdout + result.stderr, /credential-canary|UNTRUSTED/)
  }
})

await test('AC-12.2: a missing trusted checkout fails instead of using the PR evaluator', () => {
  const result = spawnSync(
    process.execPath,
    [runner, '/nonexistent-trusted-audit-checkout'],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Trusted audit checkout is missing/)
})
