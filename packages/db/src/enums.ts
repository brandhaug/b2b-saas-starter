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
