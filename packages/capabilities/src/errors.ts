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
export class WorkspaceChangeRejected extends Schema.TaggedErrorClass<WorkspaceChangeRejected>()(
  'WorkspaceChangeRejected',
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

/**
 * A mutation the workspace's plan does not cover: the resource is at its
 * entitled count. Answerable and refused — not a store failure — and distinct
 * from `MembershipChangeRejected`, which names one membership change rather
 * than the workspace's entitlement. 402 because the refusal is about what the
 * plan pays for; actual checkout stays env-gated future work (ADR 0023).
 *
 * Raised by `PlanEntitlements.checkLimit` and re-raised by every mutation seam
 * that enforces it (`ApiTokenRegistry.create`, `WebhookEndpoints.create`,
 * `WorkspaceInvitations.create`), so callers handle one class everywhere.
 */
export class EntitlementExceeded extends Schema.TaggedErrorClass<EntitlementExceeded>()(
  'EntitlementExceeded',
  {
    resource: Schema.String,
    limit: Schema.Number,
    planId: Schema.String
  },
  { httpApiStatus: 402 }
) {}
