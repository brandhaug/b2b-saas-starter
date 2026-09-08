import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

import { Schema } from 'effect'

const Text = Schema.String.check(Schema.isPattern(/\S/))
const Ghsa = Schema.String.check(
  Schema.isPattern(/^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/)
)
const PackageName = Schema.String.check(
  Schema.isPattern(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/)
)
const Version = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/)
)
// Dependency paths are identifiers, never registry URLs or arbitrary diagnostics.
const Path = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9@._/>()+-]+$/))
const Severity = Schema.Literals(['info', 'low', 'moderate', 'high', 'critical'])
const Finding = Schema.Struct({
  version: Version,
  paths: Schema.NonEmptyArray(Path),
  dev: Schema.Boolean,
  optional: Schema.Boolean
})
const Advisory = Schema.Struct({
  github_advisory_id: Ghsa,
  module_name: PackageName,
  severity: Severity,
  findings: Schema.NonEmptyArray(Finding)
})
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const Report = Schema.Struct({
  advisories: Schema.Record(Schema.String, Advisory),
  metadata: Schema.Struct({
    vulnerabilities: Schema.Struct({
      info: Count,
      low: Count,
      moderate: Count,
      high: Count,
      critical: Count
    })
  })
})
const Exception = Schema.Struct({
  finding: Ghsa,
  package: PackageName,
  version: Version,
  severity: Schema.Literals(['high', 'critical']),
  scope: Schema.Struct({ path: Path, dev: Schema.Boolean, optional: Schema.Boolean }),
  rationale: Text,
  owner: Text,
  approvalEvidence: Schema.String.check(
    Schema.isPattern(
      /^https:\/\/github\.com\/brandhaug\/b2b-saas-starter\/(?:issues|pull)\/\d+#(?:issuecomment-\d+|pullrequestreview-\d+)$/
    )
  ),
  mitigation: Text,
  expires: Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  )
})

const decodeReport = Schema.decodeUnknownSync(Report)
const decodeExceptions = Schema.decodeUnknownSync(Schema.Array(Exception))

/** AC-12: evaluate the complete pnpm report with exact, expiring exceptions. */
export function evaluateAudit(
  reportJson: string,
  exceptionsJson: string,
  now = new Date()
) {
  // Never emit decoder errors: their input can contain registry credentials.
  const report = decodeReport(JSON.parse(reportJson))
  const exceptions = decodeExceptions(JSON.parse(exceptionsJson), {
    onExcessProperty: 'error'
  })
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError('Invalid audit clock')
  }
  for (const exception of exceptions) {
    const expiry = new Date(exception.expires)
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString() !== exception.expires
    ) {
      throw new Error('Invalid exception expiry')
    }
  }
  const advisories = Object.values(report.advisories)
  for (const severity of Severity.literals) {
    if (
      advisories.filter((advisory) => advisory.severity === severity).length !==
      report.metadata.vulnerabilities[severity]
    ) {
      throw new Error('Incomplete audit report')
    }
  }
  const lines: Array<string> = []
  let blocked = 0
  for (const advisory of advisories) {
    for (const finding of advisory.findings) {
      // pnpm 11.25 caps paths at 100. A saturated report cannot prove that
      // scoped exceptions cover every affected path, so none can suppress it.
      const completePaths = finding.paths.length < 100
      if (!completePaths) {
        lines.push(
          'Dependency path report may be truncated; exceptions are disabled for this finding.'
        )
      }
      for (const path of finding.paths) {
        const exception = exceptions.find(
          (entry) =>
            completePaths &&
            entry.finding === advisory.github_advisory_id &&
            entry.package === advisory.module_name &&
            entry.version === finding.version &&
            entry.severity === advisory.severity &&
            entry.scope.path === path &&
            entry.scope.dev === finding.dev &&
            entry.scope.optional === finding.optional &&
            new Date(entry.expires).getTime() > now.getTime()
        )
        const relevant =
          advisory.severity === 'high' || advisory.severity === 'critical'
        if (relevant && !exception) {
          blocked += 1
        }
        let status = relevant ? 'BLOCKED' : 'informational'
        if (exception) {
          status = `accepted until ${exception.expires}`
        }
        lines.push(
          `${status}: ${advisory.severity} ${advisory.github_advisory_id} ${advisory.module_name}@${finding.version} path=${path} dev=${finding.dev} optional=${finding.optional}`,
          `  https://github.com/advisories/${advisory.github_advisory_id}`
        )
      }
    }
  }
  lines.push(`Dependency audit: ${blocked} unaccepted high/critical dependency paths.`)
  if (blocked > 0) {
    lines.push(
      'Update the affected dependency or record a reviewed, scoped exception in .github/dependency-audit-exceptions.json. See docs/dependency-security.md.'
    )
  }
  return { code: blocked > 0 ? 1 : 0, lines }
}

export async function main(pause = () => setTimeout(60_000)): Promise<number> {
  let exceptions: string
  try {
    exceptions = readFileSync(
      new URL('../dependency-audit-exceptions.json', import.meta.url),
      'utf8'
    )
  } catch {
    console.error('Dependency audit exception file could not be read.')
    return 1
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync('pnpm', ['audit', '--json', '--audit-level=high'], {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024
    })
    // A valid report with findings may exit 1. Signals, spawn errors and other
    // exit codes are operational failures, even if stdout resembles a report.
    if (
      !result.error &&
      !result.signal &&
      (result.status === 0 || result.status === 1)
    ) {
      try {
        const evaluation = evaluateAudit(result.stdout, exceptions)
        for (const line of evaluation.lines) {
          console.log(line)
        }
        return evaluation.code
      } catch {
        // Raw stdout/stderr, registry errors and policy text stay out of logs.
      }
    }
    console.error(
      `Dependency audit could not be evaluated (attempt ${attempt}/3). Check registry availability and exception/report format; raw output withheld.`
    )
    if (attempt < 3) {
      // oxlint-disable-next-line no-await-in-loop -- registry retries run in sequence
      await pause()
    }
  }
  return 1
}

if (process.argv[1] === import.meta.filename) {
  process.exitCode = await main()
}
