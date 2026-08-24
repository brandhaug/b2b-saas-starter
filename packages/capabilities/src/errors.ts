import { Schema } from 'effect'

/**
 * `AuthorizationDenied` belongs to `@b2b-saas-starter/authz`, which sits below
 * this package so `auth` and `capabilities` can raise the same tag. It is
 * re-exported here — not redeclared — so consumers keep one import path and
 * the HTTP contract keeps one class identity.
 */
export { AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'

export class WorkspaceNotFound extends Schema.TaggedErrorClass<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { slug: Schema.String },
  { httpApiStatus: 404 }
) {}

export class CapabilityUnavailable extends Schema.TaggedErrorClass<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}

/**
 * A membership change the workspace refuses: an unknown user, a user who is
 * not a member, a role the plugin will not accept. The request was answerable
 * and the answer is no — distinct from `CapabilityUnavailable`, which says the
 * store is unreachable and the caller should retry.
 */
export class MembershipChangeRejected extends Schema.TaggedErrorClass<MembershipChangeRejected>()(
  'MembershipChangeRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * A workspace-lifecycle change the plugin refuses: a slug already taken, a
 * rename the session may not make. Same reading as
 * `MembershipChangeRejected` — the request was answerable and the answer is
 * no — but it names the workspace itself rather than one of its members,
 * because the two fail for different reasons and callers word their errors
 * accordingly.
 */
/**
 * A platform-user change the system refuses: an unknown user id, a role the
 * plugin will not accept on that member. Same reading as
 * `MembershipChangeRejected` — the request was answerable and the answer is no
 * — but it names a user account at system level (`/admin`) rather than one of a
 * workspace's members.
 */
export class UserAdminRejected extends Schema.TaggedErrorClass<UserAdminRejected>()(
  'UserAdminRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

export class WorkspaceChangeRejected extends Schema.TaggedErrorClass<WorkspaceChangeRejected>()(
  'WorkspaceChangeRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * An entitlement ceiling the workspace's current plan refuses to cross: a
 * second webhook endpoint on Starter, a third API token. The request was
 * answerable and the plan says no — an upgrade, not a retry, resolves it.
 */
export class PlanLimitExceeded extends Schema.TaggedErrorClass<PlanLimitExceeded>()(
  'PlanLimitExceeded',
  {
    planId: Schema.String,
    resource: Schema.String,
    limit: Schema.Number
  },
  { httpApiStatus: 402 }
) {}
