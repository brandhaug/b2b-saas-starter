import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { SecurityEvidenceRecord } from '@b2b-saas-starter/capabilities/governance/security-recovery-evidence'
import { Schema } from 'effect'

const execFilePromise = promisify(execFile)

const SecurityEvidenceGap = Schema.Struct({
  evidenceId: Schema.String,
  kind: Schema.String,
  subjectId: Schema.String,
  workspaceId: Schema.NullOr(Schema.String)
})

export const SecurityEvidenceBundle = Schema.Struct({
  version: Schema.Literal(1),
  coverageStart: Schema.String,
  coverageEnd: Schema.String,
  gaps: Schema.Array(SecurityEvidenceGap),
  records: Schema.Array(SecurityEvidenceRecord)
})
export type SecurityEvidenceBundle = typeof SecurityEvidenceBundle.Type
const decodeSecurityEvidenceBundle = Schema.decodeUnknownSync(SecurityEvidenceBundle)

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

/**
 * Build idempotent post-restore sanitation statements. Every restore
 * invalidates sessions and OAuth grants and quarantines uncertain outgoing
 * work. Append-only records then reapply deletions and revocations.
 */
export function buildRecoverySecuritySql(
  bundle: SecurityEvidenceBundle,
  restorePoint: string,
  freezeTime: string
): string {
  const restoreMillis = Date.parse(restorePoint)
  const freezeMillis = Date.parse(freezeTime)
  const coverageStart = Date.parse(bundle.coverageStart)
  const coverageEnd = Date.parse(bundle.coverageEnd)
  if (
    !validTimestamp(restorePoint) ||
    !validTimestamp(freezeTime) ||
    !validTimestamp(bundle.coverageStart) ||
    !validTimestamp(bundle.coverageEnd) ||
    restoreMillis > freezeMillis ||
    coverageStart > coverageEnd ||
    coverageStart > restoreMillis ||
    coverageEnd < freezeMillis
  ) {
    throw new Error('security evidence does not cover the selected restore point')
  }

  for (const record of bundle.records) {
    const occurredAt = Date.parse(record.occurredAt)
    if (
      !validTimestamp(record.occurredAt) ||
      occurredAt < coverageStart ||
      occurredAt > coverageEnd
    ) {
      throw new Error(`security evidence record ${record.id} falls outside coverage`)
    }
  }

  const statements: Array<string> = [
    'PRAGMA foreign_keys = ON',
    // Restored login state and OAuth grants are never trusted.
    'DELETE FROM session',
    'DELETE FROM oauth_access_token',
    'DELETE FROM oauth_refresh_token',
    'DELETE FROM oauth_consent',
    'DELETE FROM verification',
    // A restore cannot establish whether an in-flight delivery already left
    // the system. Mark it terminal/uncertain so only an operator can replay.
    "UPDATE email_deliveries SET status = 'failed', uncertain = 1, reason = 'recovery_quarantined', token = NULL WHERE status IN ('queued', 'accepted', 'delayed', 'temporary_failure', 'ambiguous')",
    "UPDATE webhook_deliveries SET status = 'failed_permanent', next_attempt_at = NULL WHERE status IN ('pending', 'failed')"
  ]

  for (const record of bundle.records) {
    const occurredAt = Date.parse(record.occurredAt)
    if (occurredAt < restoreMillis || occurredAt > freezeMillis) {
      continue
    }
    const subject = sqlString(record.subjectId)
    if (record.kind === 'account_deleted') {
      statements.push(`DELETE FROM user WHERE id = ${subject}`)
    } else if (record.kind === 'workspace_deleted') {
      statements.push(`DELETE FROM workspaces WHERE id = ${subject}`)
    } else if (
      record.kind === 'workspace_access_removed' &&
      record.workspaceId !== null
    ) {
      statements.push(
        `DELETE FROM workspace_members WHERE workspaceId = ${sqlString(record.workspaceId)} AND userId = ${subject}`
      )
    } else if (record.kind === 'api_token_revoked') {
      statements.push(
        `UPDATE api_tokens SET revoked_at = ${sqlString(record.occurredAt)} WHERE id = ${subject}`
      )
    } else if (record.kind === 'sessions_revoked') {
      statements.push(`DELETE FROM session WHERE userId = ${subject}`)
    } else if (record.kind === 'credential_changed') {
      const where = record.subjectId === '*' ? '' : ` WHERE userId = ${subject}`
      const userWhere = record.subjectId === '*' ? '' : ` WHERE id = ${subject}`
      statements.push(
        `DELETE FROM account${where}`,
        `DELETE FROM passkey${where}`,
        `DELETE FROM two_factor${where}`,
        `UPDATE user SET twoFactorEnabled = 0, banned = 1, banReason = 'recovery_credential_reset_required'${userWhere}`
      )
    }
  }

  if (bundle.gaps.length > 0) {
    // A gap has no trustworthy bound. Block every restored account and remove
    // every verifier until an operator establishes validity or resets it.
    statements.push(
      `UPDATE api_tokens SET revoked_at = ${sqlString(freezeTime)} WHERE revoked_at IS NULL`,
      'DELETE FROM account',
      'DELETE FROM passkey',
      'DELETE FROM two_factor',
      "UPDATE user SET twoFactorEnabled = 0, banned = 1, banReason = 'recovery_evidence_gap'"
    )
  }
  return `${statements.join(';\n')};\n`
}

type ApplyOptions = {
  readonly evidence: string
  readonly restorePoint: string
  readonly freezeTime: string
  readonly database: string
  readonly local: boolean
  readonly confirmTarget?: string | undefined
}

function readOption(name: string): string | undefined {
  return process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function parseApplyOptions(): ApplyOptions {
  const evidence = readOption('--evidence')
  const restorePoint = readOption('--restore-point')
  const freezeTime = readOption('--freeze-time')
  const database = readOption('--database')
  const local = process.argv.includes('--local')
  const confirmTarget = readOption('--confirm-target')
  if (
    !evidence ||
    !restorePoint ||
    !freezeTime ||
    !database ||
    (local && confirmTarget)
  ) {
    throw new Error(
      'usage: recovery-security.ts apply --evidence=<bundle.json> --restore-point=<ISO> --freeze-time=<ISO> --database=<name> (--local | --confirm-target=<account-id>/<name>)'
    )
  }
  if (!local) {
    const expected = `${process.env.CLOUDFLARE_ACCOUNT_ID ?? ''}/${database}`
    if (confirmTarget !== expected) {
      throw new Error(`remote sanitation requires --confirm-target=${expected}`)
    }
  }
  return { evidence, restorePoint, freezeTime, database, local, confirmTarget }
}

async function apply(options: ApplyOptions): Promise<void> {
  const decoded = decodeSecurityEvidenceBundle(
    JSON.parse(await readFile(options.evidence, 'utf8'))
  )
  const directory = await mkdtemp(join(tmpdir(), 'recovery-security-'))
  const sqlPath = join(directory, 'sanitize.sql')
  try {
    await writeFile(
      sqlPath,
      buildRecoverySecuritySql(decoded, options.restorePoint, options.freezeTime),
      { mode: 0o600 }
    )
    const targetFlag = options.local ? '--local' : '--remote'
    await execFilePromise('pnpm', [
      'exec',
      'wrangler',
      'd1',
      'execute',
      options.database,
      targetFlag,
      `--file=${sqlPath}`
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  if (process.argv[2] !== 'apply') {
    throw new Error('usage: recovery-security.ts apply ...')
  }
  await apply(parseApplyOptions())
}
