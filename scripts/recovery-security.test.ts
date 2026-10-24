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
  it('reconstructs deleted conversation addresses before restored objects can serve content', () => {
    const sql = buildRecoverySecuritySql(
      {
        ...bundle,
        records: [
          {
            id: 'sec_conversation',
            kind: 'assistant_conversation_deleted',
            subjectId: 'conversation',
            workspaceId: 'workspace',
            creatorUserId: 'creator',
            occurredAt: '2026-09-07T12:00:00.000Z',
            source: 'live'
          }
        ]
      },
      '2026-09-07T00:00:00.000Z',
      '2026-09-07T23:00:00.000Z'
    )
    expect(sql).toContain('DELETE FROM assistant_session_authority')
    expect(sql).toContain('DELETE FROM personal_data_exports')
    expect(sql).toContain('INSERT INTO assistant_conversations')
    expect(sql).toContain("'conversation', 'workspace', 'creator'")
    expect(sql).toContain('cleaned_at = NULL')
  })

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
    Reflect.deleteProperty(environment, 'CLOUDFLARE_ACCOUNT_ID')
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

  // Failure modes: restored owner/admin authority survives, a later grant
  // cancels a restriction, expired bans self-clear, replay is not idempotent,
  // or evidence outside the selected window changes an unrelated account.
  it('replays admin restrictions and non-expiring recovery bans on isolated D1 through the CLI', async () => {
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
        `${schema};
        INSERT INTO user (id,email,name,role,banExpires) VALUES
          ('usr_keep','keep@example.com','Keep','admin',1),
          ('usr_admin','admin@example.com','Admin','admin',1),
          ('usr_banned','banned@example.com','Banned','user',1),
          ('usr_credential','credential@example.com','Credential','user',1),
          ('usr_deleted','deleted@example.com','Deleted','user',1);
        INSERT INTO workspaces (id,slug,name) VALUES ('wrk_restore','restore','Restore');
        INSERT INTO workspaces (id,slug,name) VALUES ('wrk_deleted_account','deleted-account','Deleted account');
        INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES ('mem_deleted','wrk_deleted_account','usr_deleted','owner');
        INSERT INTO oauth_client (id,clientId,userId,redirectUris) VALUES ('client_deleted','client-deleted','usr_deleted','[]');
        INSERT INTO audit_events (id,workspace_id,actor_user_id,actor_type,event_type,target_type,target_id,metadata,created_at) VALUES ('audit_deleted','wrk_restore','usr_deleted','user','workspace.renamed','workspace','wrk_restore','{}','2026-09-01T00:00:00Z');
        INSERT INTO api_tokens (id,workspace_id,name,token_prefix,token_hash,scopes,created_by_user_id,created_at) VALUES ('token_deleted','wrk_restore','Token','prefix','hash','["read"]','usr_deleted','2026-09-01T00:00:00Z');
        INSERT INTO workspace_members (id,workspaceId,userId,role) VALUES ('mem_restore','wrk_restore','usr_admin','owner');
        INSERT INTO session (id,expiresAt,token,userId) VALUES ('ses_restore',4102444800,'restore-token','usr_keep');`
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
      const replayBundle: SecurityEvidenceBundle = {
        ...bundle,
        records: [
          ...bundle.records,
          {
            id: 'ban',
            kind: 'account_banned',
            subjectId: 'usr_banned',
            workspaceId: null,
            occurredAt: '2026-09-07T12:00:00Z',
            source: 'live'
          },
          {
            id: 'demote',
            kind: 'system_role_changed',
            subjectId: 'usr_admin',
            workspaceId: null,
            occurredAt: '2026-09-07T12:00:00Z',
            source: 'live'
          },
          {
            id: 'promote',
            kind: 'system_role_changed',
            subjectId: 'usr_admin',
            workspaceId: null,
            occurredAt: '2026-09-07T13:00:00Z',
            source: 'live'
          },
          {
            id: 'workspace-demote',
            kind: 'workspace_access_removed',
            subjectId: 'usr_admin',
            workspaceId: 'wrk_restore',
            occurredAt: '2026-09-07T12:00:00Z',
            source: 'live'
          },
          {
            id: 'workspace-promote',
            kind: 'workspace_access_removed',
            subjectId: 'usr_admin',
            workspaceId: 'wrk_restore',
            occurredAt: '2026-09-07T13:00:00Z',
            source: 'live'
          },
          {
            id: 'credential',
            kind: 'credential_changed',
            subjectId: 'usr_credential',
            workspaceId: null,
            occurredAt: '2026-09-07T12:00:00Z',
            source: 'live'
          },
          {
            id: 'outside-window',
            kind: 'account_banned',
            subjectId: 'usr_keep',
            workspaceId: null,
            occurredAt: '2026-09-07T23:30:00Z',
            source: 'live'
          }
        ]
      }
      await writeFile(evidence, JSON.stringify(replayBundle))
      function apply() {
        return run(
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
      }
      await apply()
      await apply()
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
          `--command=SELECT
            (SELECT COUNT(*) FROM session) AS sessions,
            (SELECT COUNT(*) FROM user WHERE id = 'usr_deleted') AS deleted_accounts,
            (SELECT COUNT(*) FROM workspace_deletion_fences) AS remaining_fences,
            (SELECT COUNT(*) FROM oauth_client WHERE id = 'client_deleted' AND userId IS NULL) AS detached_clients,
            (SELECT COUNT(*) FROM user WHERE id = 'usr_keep' AND role = 'admin' AND COALESCE(banned, 0) = 0) AS untouched,
            (SELECT COUNT(*) FROM workspace_members WHERE id = 'mem_restore') AS restored_memberships,
            (SELECT COUNT(*) FROM user WHERE id = 'usr_admin' AND role = 'user') AS demoted,
            (SELECT COUNT(*) FROM user WHERE id = 'usr_banned' AND banned = 1 AND banExpires IS NULL AND banReason = 'recovery_ban_replay') AS banned,
            (SELECT COUNT(*) FROM user WHERE id = 'usr_credential' AND banned = 1 AND banExpires IS NULL) AS credential_blocked`
        ],
        { cwd: ROOT, env: environment }
      )
      expect(result.stdout).toContain('"sessions": 0')
      expect(result.stdout).toContain('"deleted_accounts": 0')
      expect(result.stdout).toContain('"remaining_fences": 0')
      expect(result.stdout).toContain('"detached_clients": 1')
      expect(result.stdout).toContain('"untouched": 1')
      expect(result.stdout).toContain('"restored_memberships": 0')
      expect(result.stdout).toContain('"demoted": 1')
      expect(result.stdout).toContain('"banned": 1')
      expect(result.stdout).toContain('"credential_blocked": 1')
      await writeFile(
        evidence,
        JSON.stringify({
          ...replayBundle,
          gaps: [
            {
              evidenceId: 'gap',
              kind: 'account_banned',
              subjectId: 'usr_keep',
              workspaceId: null
            }
          ]
        })
      )
      await apply()
      const gapResult = await run(
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
          "--command=SELECT COUNT(*) AS blocked FROM user WHERE banned = 1 AND banExpires IS NULL AND banReason = 'recovery_evidence_gap'"
        ],
        { cwd: ROOT, env: environment }
      )
      expect(gapResult.stdout).toContain('"blocked": 4')
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
