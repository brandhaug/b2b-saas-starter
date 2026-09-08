import { Effect } from 'effect'

import {
  type RetentionPolicy,
  RetentionPolicyError,
  type RetentionResult
} from './retention.ts'

export const RETENTION_POLICY_VERSION = '2026-09-07.v1'

// oxlint-disable-next-line effect/noAs -- literal defaults stay narrow for policy comparisons
export const RETENTION_DEFAULTS = {
  version: RETENTION_POLICY_VERSION,
  target: 'unbound',
  auditDays: 365,
  notificationDays: 90,
  invitationDays: 30,
  tokenDays: 90,
  exportDays: 30,
  billingDays: 90,
  emailDays: 30,
  unresolvedEmailDays: 90,
  batchSize: 100,
  workBudget: 500
} as const

export function retentionPolicyDigest(policy: RetentionPolicy): string {
  return [
    policy.version,
    policy.target,
    policy.auditDays,
    policy.notificationDays,
    policy.invitationDays,
    policy.tokenDays,
    policy.exportDays,
    policy.billingDays,
    policy.emailDays,
    policy.unresolvedEmailDays,
    policy.batchSize,
    policy.workBudget
  ].join(':')
}

export function approveRetentionPolicy(input: {
  readonly policy: RetentionPolicy
  readonly preview: RetentionResult
  readonly confirmation: string
  readonly recoveryEvidenceRef: string
}): Effect.Effect<RetentionPolicy, RetentionPolicyError> {
  return Effect.gen(function* () {
    yield* validateRetentionPolicy(input.policy)
    const digest = retentionPolicyDigest(input.policy)
    if (
      input.preview.mode !== 'preview' ||
      input.preview.status !== 'success' ||
      input.preview.policyDigest !== digest ||
      input.confirmation !== digest ||
      input.recoveryEvidenceRef.trim().length === 0
    ) {
      return yield* Effect.fail(
        new RetentionPolicyError({
          reason: 'retention_preview_or_confirmation_mismatch'
        })
      )
    }
    return {
      ...input.policy,
      destructiveEnabled: true,
      recoveryVerified: true,
      policyApprovalDigest: digest,
      previewDigest: digest,
      recoveryEvidenceRef: input.recoveryEvidenceRef.trim()
    }
  })
}

export function validateRetentionPolicy(
  policy: RetentionPolicy
): Effect.Effect<void, RetentionPolicyError> {
  return Effect.gen(function* () {
    if (policy.version !== RETENTION_POLICY_VERSION) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_policy_version_invalid' })
      )
    }
    if (policy.target.trim().length === 0) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_policy_target_invalid' })
      )
    }
    const positive: ReadonlyArray<readonly [string, number]> = [
      ['auditDays', policy.auditDays],
      ['notificationDays', policy.notificationDays]
    ]
    for (const [key, value] of positive) {
      if (!Number.isInteger(value) || value < 1) {
        return yield* Effect.fail(
          new RetentionPolicyError({ reason: `retention_${key}_must_be_positive` })
        )
      }
    }
    const safety: ReadonlyArray<readonly [string, number, number]> = [
      ['invitationDays', policy.invitationDays, 30],
      ['tokenDays', policy.tokenDays, 90],
      ['exportDays', policy.exportDays, 30],
      ['billingDays', policy.billingDays, 90],
      ['emailDays', policy.emailDays, 30]
    ]
    for (const [key, value, minimum] of safety) {
      if (!Number.isInteger(value) || value < minimum) {
        return yield* Effect.fail(
          new RetentionPolicyError({ reason: `retention_${key}_below_safety_window` })
        )
      }
    }
    if (policy.emailDays > 90) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_emailDays_above_safety_window' })
      )
    }
    if (
      !Number.isInteger(policy.unresolvedEmailDays) ||
      policy.unresolvedEmailDays < policy.emailDays ||
      policy.unresolvedEmailDays > 90
    ) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_unresolvedEmailDays_invalid' })
      )
    }
    if (
      !Number.isInteger(policy.batchSize) ||
      policy.batchSize < 1 ||
      policy.batchSize > 100
    ) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_batch_size_invalid' })
      )
    }
    if (
      !Number.isInteger(policy.workBudget) ||
      policy.workBudget < 17 ||
      policy.workBudget > 1000
    ) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_work_budget_invalid' })
      )
    }
    if (
      policy.destructiveEnabled &&
      (!policy.recoveryVerified ||
        policy.target.trim().length === 0 ||
        policy.target === RETENTION_DEFAULTS.target ||
        policy.policyApprovalDigest !== retentionPolicyDigest(policy) ||
        policy.previewDigest !== retentionPolicyDigest(policy) ||
        policy.recoveryEvidenceRef === undefined ||
        policy.recoveryEvidenceRef.trim().length === 0)
    ) {
      return yield* Effect.fail(
        new RetentionPolicyError({ reason: 'retention_approval_missing_or_stale' })
      )
    }
  })
}

export function validateRetentionPolicyTarget(
  policy: RetentionPolicy,
  databaseTarget: string | undefined
): Effect.Effect<void, RetentionPolicyError> {
  if (databaseTarget === undefined || databaseTarget.trim().length === 0) {
    return Effect.fail(
      new RetentionPolicyError({ reason: 'retention_database_target_missing' })
    )
  }
  if (policy.destructiveEnabled && policy.target !== databaseTarget) {
    return Effect.fail(
      new RetentionPolicyError({ reason: 'retention_database_target_mismatch' })
    )
  }
  return Effect.void
}

function environmentBoolean(name: string, value: string | undefined) {
  if (value === undefined) {
    return Effect.succeed(false)
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') {
    return Effect.succeed(true)
  }
  if (normalized === 'false') {
    return Effect.succeed(false)
  }
  return Effect.fail(new RetentionPolicyError({ reason: `retention_${name}_invalid` }))
}

function environmentNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  const normalized = value.trim()
  if (normalized.length === 0) {
    return Number.NaN
  }
  return Number(normalized)
}

export function retentionPolicyFromEnv(env: {
  readonly RETENTION_CLEANUP_ENABLED?: string | undefined
  readonly RETENTION_RECOVERY_VERIFIED?: string | undefined
  readonly RETENTION_AUDIT_DAYS?: string | undefined
  readonly RETENTION_NOTIFICATION_DAYS?: string | undefined
  readonly RETENTION_INVITATION_DAYS?: string | undefined
  readonly RETENTION_TOKEN_DAYS?: string | undefined
  readonly RETENTION_EXPORT_DAYS?: string | undefined
  readonly RETENTION_BILLING_DAYS?: string | undefined
  readonly RETENTION_EMAIL_DAYS?: string | undefined
  readonly RETENTION_UNRESOLVED_EMAIL_DAYS?: string | undefined
  readonly RETENTION_BATCH_SIZE?: string | undefined
  readonly RETENTION_WORK_BUDGET?: string | undefined
  readonly RETENTION_POLICY_APPROVAL_DIGEST?: string | undefined
  readonly RETENTION_PREVIEW_DIGEST?: string | undefined
  readonly RETENTION_RECOVERY_EVIDENCE?: string | undefined
  readonly RETENTION_POLICY_VERSION?: string | undefined
  readonly RETENTION_POLICY_TARGET?: string | undefined
}): Effect.Effect<RetentionPolicy, RetentionPolicyError> {
  return Effect.gen(function* () {
    const destructiveEnabled = yield* environmentBoolean(
      'cleanup_enabled',
      env.RETENTION_CLEANUP_ENABLED
    )
    const recoveryVerified = yield* environmentBoolean(
      'recovery_verified',
      env.RETENTION_RECOVERY_VERIFIED
    )
    let policy: RetentionPolicy = {
      ...RETENTION_DEFAULTS,
      version: env.RETENTION_POLICY_VERSION?.trim() ?? RETENTION_POLICY_VERSION,
      target: env.RETENTION_POLICY_TARGET?.trim() ?? RETENTION_DEFAULTS.target,
      auditDays: environmentNumber(
        env.RETENTION_AUDIT_DAYS,
        RETENTION_DEFAULTS.auditDays
      ),
      notificationDays: environmentNumber(
        env.RETENTION_NOTIFICATION_DAYS,
        RETENTION_DEFAULTS.notificationDays
      ),
      invitationDays: environmentNumber(
        env.RETENTION_INVITATION_DAYS,
        RETENTION_DEFAULTS.invitationDays
      ),
      tokenDays: environmentNumber(
        env.RETENTION_TOKEN_DAYS,
        RETENTION_DEFAULTS.tokenDays
      ),
      exportDays: environmentNumber(
        env.RETENTION_EXPORT_DAYS,
        RETENTION_DEFAULTS.exportDays
      ),
      billingDays: environmentNumber(
        env.RETENTION_BILLING_DAYS,
        RETENTION_DEFAULTS.billingDays
      ),
      emailDays: environmentNumber(
        env.RETENTION_EMAIL_DAYS,
        RETENTION_DEFAULTS.emailDays
      ),
      unresolvedEmailDays: environmentNumber(
        env.RETENTION_UNRESOLVED_EMAIL_DAYS,
        RETENTION_DEFAULTS.unresolvedEmailDays
      ),
      batchSize: environmentNumber(
        env.RETENTION_BATCH_SIZE,
        RETENTION_DEFAULTS.batchSize
      ),
      workBudget: environmentNumber(
        env.RETENTION_WORK_BUDGET,
        RETENTION_DEFAULTS.workBudget
      ),
      destructiveEnabled,
      recoveryVerified
    }
    if (env.RETENTION_POLICY_APPROVAL_DIGEST !== undefined) {
      policy = {
        ...policy,
        policyApprovalDigest: env.RETENTION_POLICY_APPROVAL_DIGEST.trim()
      }
    }
    if (env.RETENTION_PREVIEW_DIGEST !== undefined) {
      policy = { ...policy, previewDigest: env.RETENTION_PREVIEW_DIGEST.trim() }
    }
    if (env.RETENTION_RECOVERY_EVIDENCE !== undefined) {
      policy = {
        ...policy,
        recoveryEvidenceRef: env.RETENTION_RECOVERY_EVIDENCE.trim()
      }
    }
    yield* validateRetentionPolicy(policy)
    return policy
  })
}
