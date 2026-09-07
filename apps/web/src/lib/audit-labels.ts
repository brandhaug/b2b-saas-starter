import { AUDIT_EVENT_TYPES } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'
import { m } from '@b2b-saas-starter/i18n/messages'

const EVENT_LABELS: Readonly<Record<string, () => string>> = Object.freeze({
  'api_token.created': () => m.audit_api_token_created(),
  'api_token.revoked': () => m.audit_api_token_revoked(),
  'webhook_endpoint.created': () => m.audit_webhook_endpoint_created(),
  'webhook_endpoint.updated': () => m.audit_webhook_endpoint_updated(),
  'webhook_endpoint.deleted': () => m.audit_webhook_endpoint_deleted(),
  'webhook_endpoint.secret_rotated': () => m.audit_webhook_secret_rotated(),
  'webhook.delivery_failed': () => m.audit_webhook_delivery_failed(),
  'webhook.delivery_dead_lettered': () => m.audit_webhook_delivery_dead_lettered(),
  'webhook.delivery_replayed': () => m.audit_webhook_delivery_replayed(),
  'mcp_client.consent_granted': () => m.audit_mcp_client_connected(),
  'mcp_client.consent_revoked': () => m.audit_mcp_client_disconnected(),
  'workspace.created': () => m.audit_workspace_created(),
  'workspace.renamed': () => m.audit_workspace_renamed(),
  'workspace.deleted': () => m.audit_workspace_deleted(),
  'workspace.onboarding_dismissed': () => m.audit_onboarding_dismissed(),
  'workspace.export_requested': () => m.audit_workspace_export_requested(),
  'workspace.export_completed': () => m.audit_workspace_export_ready(),
  'workspace.export_downloaded': () => m.audit_workspace_export_downloaded(),
  'workspace_member.added': () => m.audit_member_added(),
  'workspace_member.removed': () => m.audit_member_removed(),
  'workspace_member.role_changed': () => m.audit_member_role_changed(),
  'workspace_invitation.sent': () => m.audit_invitation_sent(),
  'workspace_invitation.canceled': () => m.audit_invitation_canceled(),
  'workspace_invitation.accepted': () => m.audit_invitation_accepted(),
  'billing.checkout_started': () => m.audit_checkout_started(),
  'billing.plan_changed': () => m.audit_plan_changed(),
  'auth.sign_in': () => m.audit_signed_in(),
  'auth.sign_in_failed': () => m.audit_sign_in_failed(),
  'auth.sign_up': () => m.audit_account_created(),
  'auth.sign_up_failed': () => m.audit_account_creation_failed(),
  'auth.password_reset_requested': () => m.audit_password_reset_requested(),
  'auth.password_reset': () => m.audit_password_reset(),
  'auth.password_reset_failed': () => m.audit_password_reset_failed(),
  'auth.email_verified': () => m.audit_email_verified(),
  'auth.email_verification_failed': () => m.audit_email_verification_failed(),
  'auth.sign_out': () => m.audit_signed_out(),
  'auth.sign_out_failed': () => m.audit_sign_out_failed(),
  'auth.session_revoked': () => m.audit_session_revoked(),
  'auth.session_revocation_failed': () => m.audit_session_revocation_failed(),
  'auth.two_factor_enabled': () => m.audit_two_factor_enabled(),
  'auth.two_factor_enabled_failed': () => m.audit_two_factor_enable_failed(),
  'auth.two_factor_disabled': () => m.audit_two_factor_disabled(),
  'auth.two_factor_disable_failed': () => m.audit_two_factor_disable_failed(),
  'auth.two_factor_verified': () => m.audit_two_factor_verified(),
  'auth.two_factor_verification_failed': () => m.audit_two_factor_verification_failed(),
  'auth.passkey_added': () => m.audit_passkey_added(),
  'auth.passkey_added_failed': () => m.audit_passkey_add_failed(),
  'auth.passkey_removed': () => m.audit_passkey_removed(),
  'auth.passkey_removed_failed': () => m.audit_passkey_removal_failed(),
  'auth.account_linked': () => m.audit_sign_in_provider_linked(),
  'auth.account_unlinked': () => m.audit_sign_in_provider_unlinked(),
  'system_admin.user_created': () => m.audit_system_user_created(),
  'system_admin.user_creation_failed': () => m.audit_system_user_creation_failed(),
  'system_admin.user_removed': () => m.audit_system_user_removed(),
  'system_admin.user_removal_failed': () => m.audit_system_user_removal_failed(),
  'system_admin.user_role_changed': () => m.audit_system_user_role_changed(),
  'system_admin.user_role_change_failed': () =>
    m.audit_system_user_role_change_failed(),
  'system_admin.user_banned': () => m.audit_user_banned(),
  'system_admin.user_ban_failed': () => m.audit_user_ban_failed(),
  'system_admin.user_unbanned': () => m.audit_user_unbanned(),
  'system_admin.user_unban_failed': () => m.audit_user_unban_failed(),
  'system_admin.user_password_set': () => m.audit_user_password_set(),
  'system_admin.user_password_set_failed': () => m.audit_user_password_set_failed(),
  'system_admin.impersonation_started': () => m.audit_impersonation_started(),
  'system_admin.impersonation_start_failed': () => m.audit_impersonation_start_failed(),
  'system_admin.impersonation_stopped': () => m.audit_impersonation_stopped(),
  'system_admin.impersonation_stop_failed': () => m.audit_impersonation_stop_failed(),
  'system_admin.user_session_revoked': () => m.audit_user_session_revoked(),
  'system_admin.user_session_revocation_failed': () =>
    m.audit_user_session_revocation_failed()
})

function prettify(value: string): string {
  const [, verb = value] = value.split('.')
  const words = verb.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function auditEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType]?.() ?? prettify(eventType)
}

const ACTOR_TYPE_LABELS: Readonly<Record<string, () => string>> = Object.freeze({
  user: () => m.audit_actor_user(),
  system: () => m.audit_actor_system(),
  api_token: () => m.audit_actor_api_token()
})

export function auditActorTypeLabel(actorType: string): string {
  return ACTOR_TYPE_LABELS[actorType]?.() ?? prettify(actorType)
}

export function auditEventFilterOptions(): ReadonlyArray<{
  readonly value: string
  readonly label: string
}> {
  return AUDIT_EVENT_TYPES.map((eventType) => ({
    value: eventType,
    label: auditEventLabel(eventType)
  })).toSorted((a, b) => a.label.localeCompare(b.label))
}
