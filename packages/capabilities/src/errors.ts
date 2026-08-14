import { Schema } from 'effect'

/**
 * `AuthorizationDenied` belongs to `@b2b-saas-starter/authz`, which sits below
 * this package so `auth` and `capabilities` can raise the same tag. It is
 * re-exported here — not redeclared — so consumers keep one import path and
 * the HTTP contract keeps one class identity.
 */
export { AuthorizationDenied } from '@b2b-saas-starter/authz'

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
