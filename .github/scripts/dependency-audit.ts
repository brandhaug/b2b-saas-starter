import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

// This trusted evaluator must not import dependencies from the PR checkout.
/* oxlint-disable anti-slop/no-runtime-typeof -- Dependency-free boundary decoders validate untrusted JSON without loading PR packages. */
const severities = ['info', 'low', 'moderate', 'high', 'critical']
const ghsaPattern = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/
const packagePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/
const pathPattern = /^[a-zA-Z0-9@._/>()+-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, keys?: ReadonlyArray<string>) {
  if (
    !isRecord(value) ||
    (keys && Object.keys(value).some((key) => !keys.includes(key)))
  ) {
    throw new TypeError('Invalid audit record')
  }
  return value
}

function array(value: unknown): Array<unknown> {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid audit array')
  }
  return value
}

function text(value: unknown, pattern = /\S/) {
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) {
    throw new TypeError('Invalid audit text')
  }
  return value
}

function flag(value: unknown) {
  if (typeof value !== 'boolean') {
    throw new TypeError('Invalid dependency flag')
  }
  return value
}

function count(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('Invalid vulnerability count')
  }
  return value
}

function decodeFinding(value: unknown) {
  const finding = record(value)
  const paths = array(finding.paths).map((path) => text(path, pathPattern))
  if (paths.length === 0) {
    throw new Error('Missing dependency paths')
  }
  return {
    version: text(finding.version, versionPattern),
    paths,
    dev: flag(finding.dev),
    optional: flag(finding.optional)
  }
}

function decodeAdvisory(value: unknown) {
  const advisory = record(value)
  const severity = text(advisory.severity)
  if (!severities.includes(severity)) {
    throw new Error('Invalid advisory severity')
  }
  const findings = array(advisory.findings).map(decodeFinding)
  if (findings.length === 0) {
    throw new Error('Missing advisory findings')
  }
  return {
    github_advisory_id: text(advisory.github_advisory_id, ghsaPattern),
    module_name: text(advisory.module_name, packagePattern),
    severity,
    findings
  }
}

function decodeReport(value: unknown) {
  const report = record(value)
  const counts = record(record(report.metadata).vulnerabilities)
  return {
    advisories: Object.values(record(report.advisories)).map(decodeAdvisory),
    vulnerabilities: Object.fromEntries(
      severities.map((severity) => [severity, count(counts[severity])])
    )
  }
}

function decodeException(value: unknown) {
  const exception = record(value, [
    'finding',
    'package',
    'version',
    'severity',
    'scope',
    'rationale',
    'owner',
    'approvalEvidence',
    'mitigation',
    'expires'
  ])
  const scope = record(exception.scope, ['path', 'dev', 'optional'])
  const severity = text(exception.severity)
  if (severity !== 'high' && severity !== 'critical') {
    throw new Error('Invalid exception severity')
  }
  return {
    finding: text(exception.finding, ghsaPattern),
    package: text(exception.package, packagePattern),
    version: text(exception.version, versionPattern),
    severity,
    scope: {
      path: text(scope.path, pathPattern),
      dev: flag(scope.dev),
      optional: flag(scope.optional)
    },
    rationale: text(exception.rationale),
    owner: text(exception.owner),
    mitigation: text(exception.mitigation),
    approvalEvidence: text(
      exception.approvalEvidence,
      /^https:\/\/github\.com\/brandhaug\/b2b-saas-starter\/(?:issues|pull)\/\d+#(?:issuecomment-\d+|pullrequestreview-\d+)$/
    ),
    expires: text(exception.expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/)
  }
}

/** AC-12: evaluate the complete pnpm report with exact, expiring exceptions. */
export function evaluateAudit(
  reportJson: string,
  exceptionsJson: string,
  now = new Date()
) {
  // Never emit decoder errors: their input can contain registry credentials.
  const report = decodeReport(JSON.parse(reportJson))
  const exceptions = array(JSON.parse(exceptionsJson)).map(decodeException)
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
  const advisories = report.advisories
  for (const severity of severities) {
    if (
      advisories.filter((advisory) => advisory.severity === severity).length !==
      report.vulnerabilities[severity]
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
    // pnpm filters advisories by audit-level but retains all severity counts.
    // Request the complete report; evaluateAudit owns the high/critical gate.
    const result = spawnSync('pnpm', ['audit', '--json', '--audit-level=info'], {
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
