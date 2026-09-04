/**
 * The stored enum vocabularies of the schema, in one leaf module with no
 * drizzle imports. The policy layer (`@b2b-saas-starter/authz`), the auth
 * server (`@b2b-saas-starter/auth`) and the capability layer read these names
 * so a change to a stored enum turns into a type error there instead of a
 * silent gap — without pulling the table definitions into those layers.
 */

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const workspaceRoles = ['owner', 'admin', 'member'] as const

/**
 * The system-role axis, stored in `user.role` and owned by Better Auth's
 * `admin` plugin. Orthogonal to `workspaceRoles`: a system `admin` gets the
 * `/admin` surface and nothing at all inside a workspace, where the
 * membership row's role is the only thing that decides.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const systemRoles = ['admin', 'user'] as const
export type SystemRoleValue = (typeof systemRoles)[number]

/**
 * The one system role the admin plugin treats as privileged — its `adminRoles`
 * option reads this rather than restating the literal, so the plugin gate and
 * the stored vocabulary cannot drift apart.
 */
export const adminSystemRole = 'admin' satisfies SystemRoleValue

/**
 * The Better Auth organization plugin's invitation state machine. `canceled`
 * carries the plugin's single-`l` spelling — the value is written by the
 * plugin, so the enum must match it byte for byte.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const invitationStatuses = [
  'pending',
  'accepted',
  'rejected',
  'canceled'
] as const

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const apiTokenScopes = ['read', 'write', 'admin'] as const
export type ApiTokenScopeValue = (typeof apiTokenScopes)[number]

/**
 * The Workspace Roles an SSO Connection may hand a provisioned member, stored
 * in `workspace_sso_connections.defaultWorkspaceRole` and read by Better
 * Auth's `sso` plugin at sign-in. Deliberately narrower than `workspaceRoles`:
 * `owner` is absent, because a connection must never mint the role that can
 * delete the workspace or change the connection itself.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const ssoProvisionedRoles = ['member', 'admin'] as const
export type SsoProvisionedRoleValue = (typeof ssoProvisionedRoles)[number]

/**
 * Whether a stored `defaultWorkspaceRole` is one the SSO connection may
 * provision. Better Auth's `sso` plugin types additional fields as plain
 * nullable strings, so `packages/auth`'s provisioning callback narrows
 * through this rather than restating a literal — anything outside the
 * vocabulary (including a bogus `owner` written by a raw API call)
 * provisions as the first role, `member`. SSO never mints `owner`.
 */
export function isSsoProvisionedRole(
  value: string | null | undefined
): value is SsoProvisionedRoleValue {
  return ssoProvisionedRoles.some((role) => role === value)
}

/**
 * The delivery state machine written by the background worker through
 * `WebhookEndpoints.recordDeliveryAttempt` / `recordTerminalDeliveryAttempt`:
 * `delivered` on a 2xx, `failed` while retries remain, `failed_permanent` on a
 * non-retryable response, `dead_lettered` once attempts are exhausted.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const deliveryStatuses = [
  'delivered',
  'failed',
  'failed_permanent',
  'dead_lettered'
] as const
export type DeliveryStatus = (typeof deliveryStatuses)[number]

/**
 * The workspace export job lifecycle written by `WorkspaceExports`: `pending`
 * from the request until the background worker picks it up, then `ready` with
 * an object in the export bucket, or `failed` with a reason.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const workspaceExportStatuses = ['pending', 'ready', 'failed'] as const
export type WorkspaceExportStatus = (typeof workspaceExportStatuses)[number]

/**
 * What a Notification is about. Stored in `notifications.kind` and keyed on by
 * `notification_preferences`: a user chooses a delivery channel per kind, and
 * the email template is picked per kind. Naming follows the audit taxonomy
 * (`<namespace>.<past_tense_verb>`), but this is a separate, smaller
 * vocabulary — a Notification is user-facing, an Audit Event is governance.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const notificationKinds = [
  'api_token.created',
  'api_token.revoked',
  'workspace_member.role_changed',
  'two_factor.changed',
  'webhook.delivery_failed',
  'workspace_member.joined',
  'billing.plan_changed',
  'account.impersonated',
  'announcement'
] as const
export type NotificationKind = (typeof notificationKinds)[number]

/**
 * The kinds whose default email channel is `instant`: each one is a change to
 * who can act on the account or the workspace, and waiting for the morning
 * digest would leave the affected user last to know. Every other kind defaults
 * to `digest`.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const securityNotificationKinds = [
  'api_token.created',
  'api_token.revoked',
  'workspace_member.role_changed',
  'two_factor.changed',
  'account.impersonated'
] as const satisfies ReadonlyArray<NotificationKind>

/**
 * How a user receives one kind of Notification by email: not at all, one
 * email per Notification as it is created, or folded into the daily digest.
 * The in-app feed is unaffected by the choice.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const notificationChannels = ['off', 'instant', 'digest'] as const
export type NotificationChannel = (typeof notificationChannels)[number]
