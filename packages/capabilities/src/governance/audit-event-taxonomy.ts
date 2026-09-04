/**
 * The audit event vocabulary (ADR 0025's taxonomy decision): the single source
 * every producer, the seed fixture, and the capability write boundary import
 * from.
 *
 * Naming is `<namespace>.<past_tense_verb>`, snake_case, with a `_failed`
 * suffix for the failure half of a success/failure pair. Namespaces follow the
 * bounded contexts: `auth.` (account lifecycle over the auth catchall,
 * including SSO sign-in), `api_token.` / `webhook_endpoint.` / `mcp_client.`
 * (developer platform), `workspace.` / `workspace_member.` /
 * `workspace_invitation.` / `workspace_sso.` (governance), `system_admin.`
 * (Better Auth admin endpoints — system-level, no workspace), `account.`
 * (self-service account deletion — system-level, actorless because the actor
 * row is gone by the time it records).
 *
 * The unions are enforced at the WRITE boundary (`AuditEventLog.record` /
 * `prepareRecord` input). The read path stays lenient (`Schema.String` on the
 * wire) so legacy or unknown rows never break listing; UI owns a human label
 * map keyed off these constants and prettifies anything unknown.
 */

import { literalTuple } from '../internal/literal-tuple.ts'

/** Every audit event type, for UI dropdowns; the union derives from it. */
export const AUDIT_EVENT_TYPES = literalTuple(
  // developer-platform
  'api_token.created',
  'api_token.revoked',
  'webhook_endpoint.created',
  'webhook_endpoint.updated',
  'webhook_endpoint.deleted',
  'webhook_endpoint.secret_rotated',
  'webhook.delivery_failed',
  'webhook.delivery_dead_lettered',
  'webhook.delivery_replayed',
  // developer-platform — MCP Clients connected through OAuth (ADR 0055)
  'mcp_client.consent_granted',
  'mcp_client.consent_revoked',
  // governance — workspace lifecycle
  'workspace.created',
  'workspace.renamed',
  'workspace.deleted',
  'workspace.onboarding_dismissed',
  // governance — workspace data export (ADR 0055)
  'workspace.export_requested',
  'workspace.export_completed',
  'workspace.export_downloaded',
  // governance — membership
  'workspace_member.added',
  'workspace_member.removed',
  'workspace_member.role_changed',
  // governance — invitations
  'workspace_invitation.sent',
  'workspace_invitation.canceled',
  'workspace_invitation.accepted',
  // governance — SSO connections (ADR 0055). The sign-in pair is `auth.`: it
  // records over the auth catchall, next to the credential sign-in events.
  'workspace_sso.connection_created',
  'workspace_sso.connection_updated',
  'workspace_sso.connection_removed',
  'auth.sso_sign_in',
  'auth.sso_sign_in_failed',
  // billing
  'billing.checkout_started',
  'billing.portal_opened',
  'billing.plan_changed',
  'billing.seats_changed',
  // notifications — a user changed how one kind reaches them by email
  'notification_preference.changed',
  // account lifecycle over the auth catchall
  'auth.sign_in',
  'auth.sign_in_failed',
  'auth.sign_up',
  'auth.sign_up_failed',
  'auth.password_reset_requested',
  'auth.password_reset',
  'auth.password_reset_failed',
  'auth.email_verified',
  'auth.email_verification_failed',
  'auth.sign_out',
  'auth.sign_out_failed',
  'auth.session_revoked',
  'auth.session_revocation_failed',
  // self-service account deletion (system-level, recorded after the row is gone)
  'account.deleted',
  // two-factor lifecycle over the auth catchall
  'auth.two_factor_enabled',
  'auth.two_factor_enabled_failed',
  'auth.two_factor_disabled',
  'auth.two_factor_disable_failed',
  'auth.two_factor_verified',
  'auth.two_factor_verification_failed',
  // passkey lifecycle over the auth catchall (ADR 0056)
  'auth.passkey_added',
  'auth.passkey_added_failed',
  'auth.passkey_removed',
  'auth.passkey_removed_failed',
  // social account linking (from the auth instance's account hooks —
  // successes only; a refused link is the callback's sign-in failure event)
  'auth.account_linked',
  'auth.account_unlinked',
  // Better Auth admin endpoints (system-level)
  'system_admin.user_created',
  'system_admin.user_creation_failed',
  'system_admin.user_removed',
  'system_admin.user_removal_failed',
  'system_admin.user_role_changed',
  'system_admin.user_role_change_failed',
  'system_admin.user_banned',
  'system_admin.user_ban_failed',
  'system_admin.user_unbanned',
  'system_admin.user_unban_failed',
  'system_admin.user_password_set',
  'system_admin.user_password_set_failed',
  'system_admin.impersonation_started',
  'system_admin.impersonation_start_failed',
  'system_admin.impersonation_stopped',
  'system_admin.impersonation_stop_failed',
  'system_admin.user_session_revoked',
  'system_admin.user_session_revocation_failed'
)

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/**
 * Every audit target type. The union is derived from this tuple, same as the
 * event vocabulary above.
 */
export const AUDIT_TARGET_TYPES = literalTuple(
  'user',
  'session',
  'api_token',
  'webhook_endpoint',
  'mcp_client',
  'workspace',
  'workspace_member',
  'workspace_invitation',
  'workspace_export',
  'workspace_sso_connection'
)

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]
