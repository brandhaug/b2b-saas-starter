import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, onTestFinished, test } from 'vite-plus/test'

const vulnerability = {
  VulnerabilityID: 'CVE-2099-12345',
  PkgName: 'fixture-package',
  InstalledVersion: '1.0.0',
  FixedVersion: '1.0.1',
  PkgIdentifier: { PURL: 'pkg:npm/fixture-package@1.0.0' },
  Severity: 'HIGH',
  Title: 'credential-canary',
  Description: 'credential-canary',
  PrimaryURL: 'https://user:credential-canary@example.com'
}
const exception = {
  id: vulnerability.VulnerabilityID,
  paths: ['pnpm-lock.yaml'],
  purls: [vulnerability.PkgIdentifier.PURL],
  expired_at: '2999-01-01T00:00:00Z',
  statement: 'Synthetic risk acceptance, never used by the real scan.'
}

// Exercise Trivy's real filter and exit status without a database,
// registry, or installed vulnerable package. The audit job requires this test;
// the general script suite can run without installing a security scanner.
// Run with TRIVY_BINARY=trivy; mandatory in the audit job.
describe.skipIf(!process.env.TRIVY_BINARY)(
  'native Trivy failure, scope and expiry',
  () => {
    const binary = process.env.TRIVY_BINARY ?? 'trivy'
    const template = fileURLToPath(new URL('../trivy-report.tpl', import.meta.url))
    const cases = [
      { name: 'high fails', findings: [vulnerability], exceptions: [], code: 1 },
      {
        name: 'critical fails',
        findings: [{ ...vulnerability, Severity: 'CRITICAL' }],
        exceptions: [],
        code: 1
      },
      { name: 'fixed passes', findings: [], exceptions: [], code: 0 },
      {
        name: 'medium passes',
        findings: [{ ...vulnerability, Severity: 'MEDIUM' }],
        exceptions: [],
        code: 0
      },
      {
        name: 'accepted exception passes',
        findings: [vulnerability],
        exceptions: [exception],
        code: 0
      },
      {
        name: 'expired exception fails',
        findings: [vulnerability],
        exceptions: [{ ...exception, expired_at: '2000-01-01T00:00:00Z' }],
        code: 1
      },
      {
        name: 'different finding fails',
        findings: [vulnerability],
        exceptions: [{ ...exception, id: 'CVE-2099-99999' }],
        code: 1
      },
      {
        name: 'different package fails',
        findings: [vulnerability],
        exceptions: [{ ...exception, purls: ['pkg:npm/other-package@1.0.0'] }],
        code: 1
      },
      {
        name: 'different version fails',
        findings: [vulnerability],
        exceptions: [{ ...exception, purls: ['pkg:npm/fixture-package@2.0.0'] }],
        code: 1
      },
      {
        name: 'different lockfile fails',
        findings: [vulnerability],
        exceptions: [{ ...exception, paths: ['other/pnpm-lock.yaml'] }],
        code: 1
      }
    ]

    test.each(cases)('$name', (scenario) => {
      const folder = mkdtempSync(join(tmpdir(), 'trivy-policy-'))
      onTestFinished(() => rmSync(folder, { recursive: true, force: true }))
      const reportPath = join(folder, 'report.json')
      const ignorePath = join(folder, 'ignore.yaml')
      writeFileSync(
        reportPath,
        JSON.stringify({
          SchemaVersion: 2,
          ArtifactName: 'synthetic',
          ArtifactType: 'filesystem',
          Results: [
            {
              Target: 'pnpm-lock.yaml',
              Class: 'lang-pkgs',
              Type: 'pnpm',
              Vulnerabilities: scenario.findings
            }
          ]
        })
      )
      // JSON is valid YAML; use the .yaml extension required by Trivy.
      writeFileSync(
        ignorePath,
        JSON.stringify({ vulnerabilities: scenario.exceptions })
      )
      const result = spawnSync(
        binary,
        [
          'convert',
          '--config',
          '/dev/null',
          '--quiet',
          '--severity',
          'HIGH,CRITICAL',
          '--exit-code',
          '1',
          '--ignorefile',
          ignorePath,
          '--format',
          'template',
          '--template',
          `@${template}`,
          reportPath
        ],
        { encoding: 'utf8', timeout: 30_000 }
      )
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      assert.equal(result.status, scenario.code, result.stderr)
      assert.doesNotMatch(result.stdout + result.stderr, /credential-canary/)
      if (scenario.code === 1) {
        assert.match(result.stdout, /CVE-2099-12345 fixture-package@1.0.0 fixed=1.0.1/)
      }
    })
  }
)
