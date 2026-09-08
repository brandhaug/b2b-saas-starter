import { DateTime } from 'effect'

import { type RetentionPolicy, type RetentionRecordClass } from './retention.ts'

/** Each scan follows its expiry index before testing protocol eligibility.
 * Protected rows still advance the cursor, so they cannot starve later rows. */
export type RetentionRule = {
  readonly key: RetentionRecordClass
  readonly table: string
  readonly index: string
  readonly clock: string
  readonly cutoff: string | number
  readonly cutoffIso: string
  readonly clockType: 'iso' | 'epoch'
  readonly eligible: string
  readonly update?: string
}

const DAY = 86_400_000
const AUTH_SKEW = 5 * 60_000

function iso(time: number) {
  return DateTime.formatIso(DateTime.makeUnsafe(time))
}

export function retentionRules(
  policy: RetentionPolicy,
  now: number
): ReadonlyArray<RetentionRule> {
  function history(
    days: number
  ): Pick<RetentionRule, 'cutoff' | 'cutoffIso' | 'clockType'> {
    return {
      cutoff: iso(now - days * DAY),
      cutoffIso: iso(now - days * DAY),
      clockType: 'iso'
    }
  }
  const auth: Pick<RetentionRule, 'cutoff' | 'cutoffIso' | 'clockType'> = {
    cutoff: Math.floor((now - AUTH_SKEW) / 1000),
    cutoffIso: iso(now - AUTH_SKEW),
    clockType: 'epoch'
  }
  return [
    {
      key: 'audit',
      table: 'audit_events',
      index: 'audit_events_retention_idx',
      clock: 'created_at',
      ...history(policy.auditDays),
      eligible: '1'
    },
    {
      key: 'notifications',
      table: 'notifications',
      index: 'notifications_retention_idx',
      clock: 'created_at',
      ...history(policy.notificationDays),
      eligible: '1'
    },
    {
      key: 'invitations',
      table: 'workspace_invitations',
      index: 'workspace_invitations_retention_idx',
      clock: "CASE WHEN status = 'pending' THEN expiresAt ELSE terminalAt END",
      cutoff: Math.floor((now - policy.invitationDays * DAY) / 1000),
      cutoffIso: iso(now - policy.invitationDays * DAY),
      clockType: 'epoch',
      eligible: "status IN ('pending', 'accepted', 'rejected', 'canceled')"
    },
    {
      key: 'sessions',
      table: 'session',
      index: 'session_expiry_idx',
      clock: 'expiresAt',
      ...auth,
      eligible:
        'NOT EXISTS (SELECT 1 FROM oauth_refresh_token WHERE sessionId = session.id) AND NOT EXISTS (SELECT 1 FROM oauth_access_token WHERE sessionId = session.id)'
    },
    {
      key: 'verification',
      table: 'verification',
      index: 'verification_expiry_idx',
      clock: 'expiresAt',
      ...auth,
      eligible: '1'
    },
    {
      key: 'api_tokens',
      table: 'api_tokens',
      index: 'api_tokens_retention_idx',
      clock:
        'CASE WHEN revoked_at IS NULL THEN expires_at WHEN expires_at IS NULL THEN revoked_at ELSE min(revoked_at, expires_at) END',
      ...history(policy.tokenDays),
      eligible:
        'NOT EXISTS (SELECT 1 FROM api_tokens AS predecessor WHERE predecessor.replaced_by_token_id = api_tokens.id)'
    },
    {
      key: 'exports',
      table: 'workspace_exports',
      index: 'workspace_exports_retention_idx',
      clock: 'completed_at',
      ...history(policy.exportDays),
      eligible: "status IN ('ready', 'failed')"
    },
    {
      key: 'export_secrets',
      table: 'workspace_exports',
      index: 'workspace_exports_secret_expiry_idx',
      clock: "CASE WHEN status = 'failed' THEN completed_at ELSE expires_at END",
      ...history(0),
      eligible: "status IN ('ready', 'failed') AND download_secret <> ''",
      update: "download_secret = ''"
    },
    {
      key: 'webhooks',
      table: 'webhook_deliveries',
      index: 'webhook_deliveries_retention_idx',
      clock: 'last_attempt_at',
      ...history(30),
      eligible: "status IN ('delivered', 'failed_permanent', 'dead_lettered')"
    },
    {
      key: 'webhook_secrets',
      table: 'webhook_endpoints',
      index: 'webhook_endpoints_previous_secret_idx',
      clock: 'previous_secret_expires_at',
      ...history(0),
      eligible: 'previous_signing_secret IS NOT NULL',
      update: 'previous_signing_secret = NULL, previous_secret_expires_at = NULL'
    },
    {
      key: 'billing_events',
      table: 'billing_provider_events',
      index: 'billing_provider_events_retention_idx',
      clock: 'coalesce(resolved_at, completed_at)',
      ...history(policy.billingDays),
      eligible:
        "status = 'completed' OR (status IN ('failed', 'conflict') AND resolved_at IS NOT NULL)"
    },
    {
      key: 'email_deliveries',
      table: 'email_deliveries',
      index: 'email_deliveries_retention_idx',
      clock: 'created_at',
      ...history(policy.emailDays),
      eligible: "status IN ('queued', 'accepted', 'delivered', 'logged')"
    },
    {
      key: 'email_unresolved',
      table: 'email_deliveries',
      index: 'email_deliveries_retention_idx',
      clock: 'created_at',
      ...history(policy.unresolvedEmailDays),
      eligible:
        "status IN ('failed', 'suppressed', 'ambiguous', 'temporary_failure', 'delayed')"
    },
    // Refresh tokens, replay responses and family links remain plugin-owned.
    {
      key: 'oauth_tokens',
      table: 'oauth_access_token',
      index: 'oauth_access_token_expiry_idx',
      clock: 'expiresAt',
      ...auth,
      eligible: '1'
    },
    {
      key: 'oauth_assertions',
      table: 'oauth_client_assertion',
      index: 'oauth_client_assertion_expiry_idx',
      clock: 'expiresAt',
      ...auth,
      eligible: '1'
    },
    {
      key: 'billing_checkouts',
      table: 'billing_checkout_claims',
      index: 'billing_checkout_claims_retention_idx',
      clock: 'updated_at',
      ...history(policy.billingDays),
      eligible: "status IN ('completed', 'expired')"
    },
    {
      key: 'billing_notices',
      table: 'billing_notices',
      index: 'billing_notices_retention_idx',
      clock: 'delivered_at',
      ...history(policy.billingDays),
      eligible: 'delivered_at IS NOT NULL'
    }
  ]
}
