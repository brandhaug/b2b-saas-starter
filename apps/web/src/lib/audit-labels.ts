import { AUDIT_EVENT_TYPES } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'

/** The human label map for audit event types (issue #87 resolution: web owns
 * the labels, the capabilities package owns the vocabulary). A `Map` keyed by
 * string keeps the lookup assertion-free: an unknown event type — a row
 * written after this map was written, or by a future producer — prettifies
 * from its snake_case verb rather than breaking the page. */
const EVENT_LABELS = new Map<string, string>(
  Object.entries({
    // developer-platform
    'api_token.created': 'API token created',
    'api_token.revoked': 'API token revoked',
    'webhook_endpoint.created': 'Webhook endpoint created',
    'webhook_endpoint.disabled': 'Webhook endpoint disabled',
    'webhook_endpoint.secret_rotated': 'Webhook secret rotated',
    'webhook.delivery_failed': 'Webhook delivery failed',
    'webhook.delivery_dead_lettered': 'Webhook delivery dead-lettered',
    // governance — workspace lifecycle
    'workspace.created': 'Workspace created',
    'workspace.renamed': 'Workspace renamed',
    'workspace.deleted': 'Workspace deleted',
    'workspace.onboarding_dismissed': 'Onboarding checklist dismissed',
    // governance — workspace data export
    'workspace.export_requested': 'Workspace export requested',
    'workspace.export_completed': 'Workspace export ready',
    'workspace.export_downloaded': 'Workspace export downloaded',
    // governance — membership
    'workspace_member.added': 'Member added',
    'workspace_member.removed': 'Member removed',
    'workspace_member.role_changed': 'Member role changed',
    // governance — invitations
    'workspace_invitation.sent': 'Invitation sent',
    'workspace_invitation.canceled': 'Invitation canceled',
    'workspace_invitation.accepted': 'Invitation accepted',
    // billing
    'billing.checkout_started': 'Checkout started',
    'billing.plan_changed': 'Plan changed',
    // account lifecycle over the auth catchall
    'auth.sign_in': 'Signed in',
    'auth.sign_in_failed': 'Sign-in failed',
    'auth.sign_up': 'Account created',
    'auth.sign_up_failed': 'Account creation failed',
    'auth.password_reset_requested': 'Password reset requested',
    'auth.password_reset': 'Password reset',
    'auth.password_reset_failed': 'Password reset failed',
    'auth.email_verified': 'Email verified',
    'auth.email_verification_failed': 'Email verification failed',
    'auth.sign_out': 'Signed out',
    'auth.sign_out_failed': 'Sign-out failed',
    'auth.session_revoked': 'Session revoked',
    'auth.session_revocation_failed': 'Session revocation failed',
    'auth.two_factor_enabled': 'Two-factor enabled',
    'auth.two_factor_enabled_failed': 'Two-factor enable failed',
    'auth.two_factor_disabled': 'Two-factor disabled',
    'auth.two_factor_disable_failed': 'Two-factor disable failed',
    'auth.two_factor_verified': 'Two-factor code verified',
    'auth.two_factor_verification_failed': 'Two-factor verification failed',
    'auth.passkey_added': 'Passkey added',
    'auth.passkey_added_failed': 'Passkey add failed',
    'auth.passkey_removed': 'Passkey removed',
    'auth.passkey_removed_failed': 'Passkey removal failed',
    // Better Auth admin endpoints (system-level)
    'system_admin.user_created': 'System user created',
    'system_admin.user_creation_failed': 'System user creation failed',
    'system_admin.user_removed': 'System user removed',
    'system_admin.user_removal_failed': 'System user removal failed',
    'system_admin.user_role_changed': 'System user role changed',
    'system_admin.user_role_change_failed': 'System user role change failed',
    'system_admin.user_banned': 'User banned',
    'system_admin.user_ban_failed': 'User ban failed',
    'system_admin.user_unbanned': 'User unbanned',
    'system_admin.user_unban_failed': 'User unban failed',
    'system_admin.user_password_set': 'User password set',
    'system_admin.user_password_set_failed': 'User password set failed',
    'system_admin.impersonation_started': 'Impersonation started',
    'system_admin.impersonation_start_failed': 'Impersonation start failed',
    'system_admin.impersonation_stopped': 'Impersonation stopped',
    'system_admin.impersonation_stop_failed': 'Impersonation stop failed',
    'system_admin.user_session_revoked': 'User session revoked',
    'system_admin.user_session_revocation_failed': 'User session revocation failed'
  })
)

/** Prettify fallback for an event type the map does not know yet. */
function prettify(eventType: string): string {
  const [, verb = eventType] = eventType.split('.')
  const words = verb.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function auditEventLabel(eventType: string): string {
  return EVENT_LABELS.get(eventType) ?? prettify(eventType)
}

/**
 * The dropdown options for the event-type filter: every known type, sorted,
 * with their human labels.
 */
export const AUDIT_EVENT_FILTER_OPTIONS: ReadonlyArray<{
  readonly value: string
  readonly label: string
}> = AUDIT_EVENT_TYPES.map((eventType) => ({
  value: eventType,
  label: auditEventLabel(eventType)
})).toSorted((a, b) => a.label.localeCompare(b.label))
