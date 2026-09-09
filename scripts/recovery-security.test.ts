import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'
import { listMigrations } from '../packages/db/src/migrations-fs.ts'

import {
  buildRecoverySecuritySql,
  type SecurityEvidenceBundle
} from './recovery-security.ts'

const run = promisify(execFile)
const ROOT = join(import.meta.dirname, '..')
const CONFIG = join(ROOT, 'apps', 'api', 'wrangler.jsonc')

const bundle: SecurityEvidenceBundle = {
  version: 1,
  coverageStart: '2026-09-01T00:00:00.000Z',
  coverageEnd: '2026-09-08T00:00:00.000Z',
  gaps: [],
  records: [
    {
      id: 'sec_1',
      kind: 'workspace_access_removed',
      subjectId: "usr_'quoted",
      workspaceId: 'wrk_1',
      occurredAt: '2026-09-07T12:00:00.000Z',
      source: 'live'
    },
    {
      id: 'sec_2',
      kind: 'account_deleted',
      subjectId: 'usr_deleted',
      workspaceId: null,
      occurredAt: '2026-09-07T13:00:00.000Z',
      source: 'live'
    }
  ]
}

describe('recovery security sanitation', () => {
  it('requires an explicit local persistence path', async () => {
    await expect(
      run(
        'node',
        [
          'scripts/recovery-security.ts',
          'apply',
          '--evidence=missing.json',
          '--restore-point=2026-09-07T00:00:00Z',
          '--freeze-time=2026-09-07T23:00:00Z',
          '--database=recovery-drill',
          '--local'
        ],
        { cwd: ROOT }
      )
    ).rejects.toThrow(/persist-to/)
  })

  it('requires an account identity before remote target confirmation', async () => {
    const environment = { ...process.env }
    delete environment.CLOUDFLARE_ACCOUNT_ID
    await expect(
      run(
        'node',
        [
          'scripts/recovery-security.ts',
          'apply',
          '--evidence=missing.json',
          '--restore-point=2026-09-07T00:00:00Z',
          '--freeze-time=2026-09-07T23:00:00Z',
          '--database=recovery-drill',
          '--confirm-target=/recovery-drill'
        ],
        { cwd: ROOT, env: environment }
      )
    ).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/)
  })

  it('sanitizes an isolated persisted D1 store through the CLI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'recovery-security-test-'))
    const persist = join(directory, 'd1')
    const seed = join(directory, 'seed.sql')
    const evidence = join(directory, 'evidence.json')
    const environment = {
      ...process.env,
      WRANGLER_LOG_PATH: join(directory, 'wrangler.log')
    }
    try {
      const schema = listMigrations()
        .flatMap(({ sql }) => sql.split('--> statement-breakpoint'))
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0)
        .join(';\n')
      await writeFile(
        seed,
        `${schema};\nINSERT INTO user (id,email,name) VALUES ('usr_keep','keep@example.com','Keep'); INSERT INTO session (id,expiresAt,token,userId) VALUES ('ses_restore',4102444800,'restore-token','usr_keep');`
      )
      await run(
        'pnpm',
        [
          'exec',
          'wrangler',
          'd1',
          'execute',
          'DB',
          '--local',
          `--config=${CONFIG}`,
          `--persist-to=${persist}`,
          `--file=${seed}`
        ],
        { cwd: ROOT, env: environment }
      )
      await writeFile(evidence, JSON.stringify(bundle))
      await run(
        'node',
        [
          'scripts/recovery-security.ts',
          'apply',
          `--evidence=${evidence}`,
          '--restore-point=2026-09-07T00:00:00Z',
          '--freeze-time=2026-09-07T23:00:00Z',
          '--database=recovery-drill',
          `--persist-to=${persist}`,
          '--local'
        ],
        { cwd: ROOT, env: environment }
      )
      const result = await run(
        'pnpm',
        [
          'exec',
          'wrangler',
          'd1',
          'execute',
          'DB',
          '--local',
          `--config=${CONFIG}`,
          `--persist-to=${persist}`,
          "--command=SELECT (SELECT COUNT(*) FROM session) AS sessions, (SELECT COUNT(*) FROM user WHERE id = 'usr_keep') AS users"
        ],
        { cwd: ROOT, env: environment }
      )
      expect(result.stdout).toContain('"sessions": 0')
      expect(result.stdout).toContain('"users": 1')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)

  it('invalidates restored authorization state and reapplies later access deletion', () => {
    const sql = buildRecoverySecuritySql(
      bundle,
      '2026-09-07T00:00:00.000Z',
      '2026-09-07T23:00:00.000Z'
    )
    expect(sql).toContain('DELETE FROM session')
    expect(sql).toContain('DELETE FROM oauth_consent')
    expect(sql).toContain("status = 'failed_permanent'")
    expect(sql).toContain("userId = 'usr_''quoted'")
    expect(sql).toContain("DELETE FROM user WHERE id = 'usr_deleted'")
  })

  it('fails closed across an evidence gap', () => {
    const sql = buildRecoverySecuritySql(
      {
        ...bundle,
        gaps: [
          { evidenceId: 'gap_1', kind: 'unknown', subjectId: '*', workspaceId: null }
        ]
      },
      '2026-09-07T00:00:00.000Z',
      '2026-09-07T23:00:00.000Z'
    )
    expect(sql).toContain("banReason = 'recovery_evidence_gap'")
    expect(sql).toContain(
      "UPDATE api_tokens SET revoked_at = '2026-09-07T23:00:00.000Z' WHERE revoked_at IS NULL"
    )
    expect(sql).toContain('DELETE FROM account')
  })

  it('rejects evidence that does not cover the restore point', () => {
    expect(() =>
      buildRecoverySecuritySql(
        bundle,
        '2026-08-01T00:00:00.000Z',
        '2026-09-07T23:00:00.000Z'
      )
    ).toThrow(/does not cover/)
  })

  it('rejects inverted windows and record timestamps outside declared coverage', () => {
    expect(() =>
      buildRecoverySecuritySql(
        bundle,
        '2026-09-07T23:00:00.000Z',
        '2026-09-07T00:00:00.000Z'
      )
    ).toThrow(/does not cover/)
    expect(() =>
      buildRecoverySecuritySql(
        {
          ...bundle,
          records: [
            {
              id: 'sec_invalid_time',
              kind: 'workspace_access_removed',
              subjectId: 'usr_invalid_time',
              workspaceId: 'wrk_1',
              occurredAt: 'not-a-timestamp',
              source: 'live'
            }
          ]
        },
        '2026-09-07T00:00:00.000Z',
        '2026-09-07T23:00:00.000Z'
      )
    ).toThrow(/falls outside coverage/)
  })
})
