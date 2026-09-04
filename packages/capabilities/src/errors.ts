import { Schema } from 'effect'

/**
 * `AuthorizationDenied` belongs to `@b2b-saas-starter/authz`, which sits below
 * this package so `auth` and `capabilities` can raise the same tag. It is
 * re-exported here — not redeclared — so consumers keep one import path and
 * the HTTP contract keeps one class identity.
 */
export { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { slug: Schema.String },
  { httpApiStatus: 404 }
) {}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()(
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
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class MembershipChangeRejected extends Schema.TaggedError<MembershipChangeRejected>()(
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
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class WorkspaceChangeRejected extends Schema.TaggedError<WorkspaceChangeRejected>()(
  'WorkspaceChangeRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * A platform-user change the system refuses: an unknown user id, a role the
 * plugin will not accept on that member. Same reading as
 * `MembershipChangeRejected` — the request was answerable and the answer is no
 * — but it names a user account at system level (`/admin`) rather than one of a
 * workspace's members.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class UserAdminRejected extends Schema.TaggedError<UserAdminRejected>()(
  'UserAdminRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * An entitlement ceiling the workspace's current plan refuses to cross: a
 * second webhook endpoint on Starter, a third API token. The request was
 * answerable and the plan says no — an upgrade, not a retry, resolves it.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class PlanLimitExceeded extends Schema.TaggedError<PlanLimitExceeded>()(
  'PlanLimitExceeded',
  {
    planId: Schema.String,
    resource: Schema.String,
    limit: Schema.Number
  },
  { httpApiStatus: 402 }
) {}

/**
 * An account action refused because the acting session is a System Admin
 * impersonation session: changing the password, the second factor, or the
 * email address, or deleting the account. The request was answerable and the
 * answer is no — the real account holder has to make these changes, so an
 * impersonating admin sees a 403 rather than a retry hint.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class ImpersonationForbidden extends Schema.TaggedError<ImpersonationForbidden>()(
  'ImpersonationForbidden',
  { action: Schema.String },
  { httpApiStatus: 403 }
) {}

/**
 * Account deletion refused by the ownership rule: the user is the only owner of
 * a workspace that still has other members. Nothing was changed. The caller
 * transfers ownership (or removes the others) and retries — `workspaces` names
 * where. Declared here rather than in the capability module so the web
 * boundary maps it beside the other 409s.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AccountDeletionBlocked extends Schema.TaggedError<AccountDeletionBlocked>()(
  'AccountDeletionBlocked',
  {
    workspaces: Schema.Array(
      Schema.Struct({ id: Schema.String, slug: Schema.String, name: Schema.String })
    )
  },
  { httpApiStatus: 409 }
) {}

/**
 * Account deletion the store refused on its merits — a wrong password, an
 * account with no credential to re-authenticate against. Same reading as the
 * other `*Rejected` errors: answerable, and the answer is no.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AccountDeletionRejected extends Schema.TaggedError<AccountDeletionRejected>()(
  'AccountDeletionRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}
