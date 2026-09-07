import { Effect } from 'effect'
import { it } from '@effect/vitest'
import { describe, expect } from 'vite-plus/test'

import { emptyCounts, type RetentionPolicy, type RetentionResult } from './retention.ts'
import {
  approveRetentionPolicy,
  RETENTION_DEFAULTS,
  retentionPolicyDigest,
  retentionPolicyFromEnv,
  validateRetentionPolicy,
  validateRetentionPolicyTarget
} from './retention-policy.ts'

const policy: RetentionPolicy = {
  ...RETENTION_DEFAULTS,
  target: 'remote:prod:database-1',
  destructiveEnabled: false,
  recoveryVerified: false
}

function failure(configuration: RetentionPolicy) {
  return Effect.flip(validateRetentionPolicy(configuration))
}

function preview(overrides: Partial<RetentionResult> = {}): RetentionResult {
  return {
    mode: 'preview',
    evaluatedAt: '2026-09-07T12:00:00.000Z',
    policyDigest: retentionPolicyDigest(policy),
    cutoffs: {},
    candidates: emptyCounts(),
    deleted: emptyCounts(),
    failed: 0,
    backlog: 0,
    status: 'success',
    records: [],
    recovery: { exports: 0, webhooks: 0, capped: false },
    ...overrides
  }
}

describe('retention policy', () => {
  it.effect(
    'keeps the safe default windows and normalizes absent environment values',
    () =>
      Effect.gen(function* () {
        expect(yield* retentionPolicyFromEnv({})).toEqual({
          ...RETENTION_DEFAULTS,
          destructiveEnabled: false,
          recoveryVerified: false
        })
      })
  )

  it.effect(
    'rejects malformed environment values instead of replacing them with defaults',
    () =>
      Effect.gen(function* () {
        const malformedNumber = yield* Effect.flip(
          retentionPolicyFromEnv({ RETENTION_EMAIL_DAYS: 'thirty' })
        )
        expect(malformedNumber.reason).toBe('retention_emailDays_below_safety_window')
        const malformedBoolean = yield* Effect.flip(
          retentionPolicyFromEnv({ RETENTION_CLEANUP_ENABLED: 'yes' })
        )
        expect(malformedBoolean.reason).toBe('retention_cleanup_enabled_invalid')
        const staleVersion = yield* failure({ ...policy, version: 'stale-version' })
        expect(staleVersion.reason).toBe('retention_policy_version_invalid')
      })
  )

  it.effect('enforces email caps, ordering, and one unit of work per rule', () =>
    Effect.gen(function* () {
      const longNormal = yield* failure({ ...policy, emailDays: 91 })
      expect(longNormal.reason).toBe('retention_emailDays_above_safety_window')
      const reversed = yield* failure({
        ...policy,
        emailDays: 60,
        unresolvedEmailDays: 59
      })
      expect(reversed.reason).toBe('retention_unresolvedEmailDays_invalid')
      const longUnresolved = yield* failure({ ...policy, unresolvedEmailDays: 91 })
      expect(longUnresolved.reason).toBe('retention_unresolvedEmailDays_invalid')
      const smallBudget = yield* failure({ ...policy, workBudget: 16 })
      expect(smallBudget.reason).toBe('retention_work_budget_invalid')
    })
  )

  it.effect(
    'approves only a successful preview with exact policy and recovery evidence',
    () =>
      Effect.gen(function* () {
        const digest = retentionPolicyDigest(policy)
        const approved = yield* approveRetentionPolicy({
          policy,
          preview: preview(),
          confirmation: digest,
          recoveryEvidenceRef: ' restore-drill-2026-09-07 '
        })
        expect(approved).toMatchObject({
          destructiveEnabled: true,
          recoveryVerified: true,
          policyApprovalDigest: digest,
          previewDigest: digest,
          recoveryEvidenceRef: 'restore-drill-2026-09-07'
        })
        yield* validateRetentionPolicyTarget(approved, policy.target)
        const wrongDatabase = yield* Effect.flip(
          validateRetentionPolicyTarget(approved, 'remote:prod:database-2')
        )
        expect(wrongDatabase.reason).toBe('retention_database_target_mismatch')

        const rejected = yield* Effect.flip(
          approveRetentionPolicy({
            policy,
            preview: preview({ mode: 'execute' }),
            confirmation: digest,
            recoveryEvidenceRef: 'restore-drill-2026-09-07'
          })
        )
        expect(rejected.reason).toBe('retention_preview_or_confirmation_mismatch')
      })
  )
})
