import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The caller checks out the trusted base; cwd remains the dependency PR. */
export function runDependencyAudit(trustedRoot: string): number {
  if (!existsSync(join(trustedRoot, '.git'))) {
    console.error('Trusted audit checkout is missing; dependency audit cannot run.')
    return 1
  }
  const evaluator = resolve(trustedRoot, '.github/scripts/dependency-audit.ts')
  if (existsSync(evaluator)) {
    // The evaluator uses only Node builtins, and reads its policy relative to
    // its own file. It never imports this PR's evaluator, policy or packages.
    const result = spawnSync(process.execPath, [realpathSync(evaluator)], {
      stdio: 'inherit',
      timeout: 8 * 60_000
    })
    return result.status === 0 && !result.error && !result.signal ? 0 : 1
  }
  // Bootstrap bases predate the policy evaluator. Native pnpm's high threshold
  // passes lower-only findings and rejects high/critical and registry errors.
  // No exception is consulted, and raw provider output is never published.
  const result = spawnSync('pnpm', ['audit', '--json', '--audit-level=high'], {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024
  })
  if (result.status === 0 && !result.error && !result.signal) {
    console.log(
      'Bootstrap dependency audit passed the native high/critical baseline; no exceptions applied.'
    )
    return 0
  }
  console.error(
    'Bootstrap dependency audit failed: high/critical findings or an unavailable registry. No exceptions applied; raw output withheld. Run pnpm audit --audit-level=high locally and see docs/dependency-security.md.'
  )
  return 1
}

if (process.argv[1] === import.meta.filename) {
  const trustedRoot = process.argv[2]
  if (trustedRoot) {
    process.exitCode = runDependencyAudit(trustedRoot)
  } else {
    console.error(
      'usage: node .github/scripts/run-dependency-audit.ts <trusted-base-checkout>'
    )
    process.exitCode = 64
  }
}
