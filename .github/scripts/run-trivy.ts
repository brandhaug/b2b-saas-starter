import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const folder = mkdtempSync(join(tmpdir(), 'dependency-scan-'))
try {
  const trustedRoot = process.argv[2]
  if (!trustedRoot) {
    throw new Error('Pass the trusted base checkout path')
  }
  const revision = execFileSync('git', ['-C', trustedRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
  console.log(`Trusted exception revision: ${revision}`)
  const input = join(folder, 'input')
  mkdirSync(input)
  copyFileSync('pnpm-lock.yaml', join(input, 'pnpm-lock.yaml'))
  const policy = resolve(trustedRoot, '.trivyignore.yaml')
  const ignoreFile = join(folder, 'ignore.yaml')
  if (existsSync(policy)) {
    copyFileSync(policy, ignoreFile)
  } else {
    // The initial base predates this policy; no exceptions apply.
    writeFileSync(ignoreFile, 'vulnerabilities: []\n')
  }
  const template = fileURLToPath(new URL('../trivy-report.tpl', import.meta.url))
  const result = spawnSync(
    process.env.TRIVY_BINARY ?? 'trivy',
    [
      'fs',
      '--config',
      '/dev/null',
      '--scanners',
      'vuln',
      '--pkg-types',
      'library',
      '--include-dev-deps',
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
      input
    ],
    {
      // Keep actionable findings visible; provider diagnostics stay out of CI logs.
      stdio: ['ignore', 'inherit', 'pipe'],
      timeout: 10 * 60_000
    }
  )
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error('Trivy scan failed')
  }
} catch {
  console.error(
    'Audit failed: resolve the findings above or diagnose the trusted checkout and Trivy/database availability locally. See docs/dependency-security.md.'
  )
  process.exitCode = 1
} finally {
  rmSync(folder, { recursive: true, force: true })
}
