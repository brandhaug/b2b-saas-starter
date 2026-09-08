import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

export const RetentionPolicy = Schema.Struct({
  version: Schema.String,
  target: Schema.String,
  auditDays: Schema.Number,
  notificationDays: Schema.Number,
  invitationDays: Schema.Number,
  tokenDays: Schema.Number,
  exportDays: Schema.Number,
  billingDays: Schema.Number,
  emailDays: Schema.Number,
  unresolvedEmailDays: Schema.Number,
  batchSize: Schema.Number,
  workBudget: Schema.Number,
  destructiveEnabled: Schema.Boolean,
  recoveryVerified: Schema.Boolean,
  policyApprovalDigest: Schema.optionalKey(Schema.String),
  previewDigest: Schema.optionalKey(Schema.String),
  recoveryEvidenceRef: Schema.optionalKey(Schema.String)
})
export type RetentionPolicy = typeof RetentionPolicy.Type

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried error factory
export class RetentionPolicyError extends Schema.TaggedError<RetentionPolicyError>()(
  'RetentionPolicyError',
  { reason: Schema.String }
) {}

export const RetentionMode = Schema.Literals(['preview', 'execute'])
export type RetentionMode = typeof RetentionMode.Type

export const RetentionRecordClass = Schema.Literals([
  'audit',
  'notifications',
  'invitations',
  'sessions',
  'verification',
  'api_tokens',
  'exports',
  'billing_events',
  'email_deliveries',
  'oauth_tokens',
  'webhooks',
  'export_secrets',
  'webhook_secrets',
  'email_unresolved',
  'oauth_assertions',
  'billing_checkouts',
  'billing_notices'
])
export type RetentionRecordClass = typeof RetentionRecordClass.Type

export const RetentionCounts = Schema.Struct({
  audit: Schema.Number,
  notifications: Schema.Number,
  invitations: Schema.Number,
  sessions: Schema.Number,
  verification: Schema.Number,
  api_tokens: Schema.Number,
  exports: Schema.Number,
  billing_events: Schema.Number,
  email_deliveries: Schema.Number,
  oauth_tokens: Schema.Number,
  webhooks: Schema.Number,
  export_secrets: Schema.Number,
  webhook_secrets: Schema.Number,
  email_unresolved: Schema.Number,
  oauth_assertions: Schema.Number,
  billing_checkouts: Schema.Number,
  billing_notices: Schema.Number
})
export type RetentionCounts = typeof RetentionCounts.Type

export const RetentionRuleResult = Schema.Struct({
  recordClass: RetentionRecordClass,
  cutoff: Schema.String,
  scanned: Schema.Number,
  candidates: Schema.Number,
  deleted: Schema.Number,
  hasMore: Schema.Boolean,
  lastSuccessAt: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String)
})
export type RetentionRuleResult = typeof RetentionRuleResult.Type

export const RetentionResult = Schema.Struct({
  mode: RetentionMode,
  evaluatedAt: Schema.String,
  policyDigest: Schema.String,
  cutoffs: Schema.Record(Schema.String, Schema.String),
  candidates: RetentionCounts,
  deleted: RetentionCounts,
  failed: Schema.Number,
  backlog: Schema.Number,
  status: Schema.Literals(['success', 'disabled', 'failed', 'inactive']),
  records: Schema.Array(RetentionRuleResult),
  recovery: Schema.Struct({
    exports: Schema.Number,
    webhooks: Schema.Number,
    capped: Schema.Boolean
  })
})
export type RetentionResult = typeof RetentionResult.Type

export type RetentionRunInput = {
  readonly now?: Date
  readonly mode: RetentionMode
  readonly policy: RetentionPolicy
}

export type RetentionService = {
  readonly run: (
    input: RetentionRunInput
  ) => Effect.Effect<RetentionResult, RetentionPolicyError | CapabilityUnavailable>
}

export class Retention extends Context.Service<Retention, RetentionService>()(
  '@b2b-saas-starter/capabilities/Retention'
) {}

export function emptyCounts(): RetentionCounts {
  return {
    audit: 0,
    notifications: 0,
    invitations: 0,
    sessions: 0,
    verification: 0,
    api_tokens: 0,
    exports: 0,
    billing_events: 0,
    email_deliveries: 0,
    oauth_tokens: 0,
    webhooks: 0,
    export_secrets: 0,
    webhook_secrets: 0,
    email_unresolved: 0,
    oauth_assertions: 0,
    billing_checkouts: 0,
    billing_notices: 0
  }
}
