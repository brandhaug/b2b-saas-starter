import { describe, expect, it } from 'vite-plus/test'

import {
  buildRecoverySecuritySql,
  type SecurityEvidenceBundle
} from './recovery-security.ts'

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
