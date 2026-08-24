import { Schema } from 'effect'

/**
 * The one authorization failure of the system: the actor is known, and is not
 * allowed to do this. It maps to 403, never 404 — hiding a workspace's
 * existence from a non-member is the `WorkspaceContext` layer's job, and it
 * raises `WorkspaceNotFound` for that.
 *
 * This error lives here, below `auth` and `capabilities`, so both raise the
 * same tag. `@b2b-saas-starter/capabilities` re-exports it for consumers.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class AuthorizationDenied extends Schema.TaggedError<AuthorizationDenied>()(
  'AuthorizationDenied',
  { reason: Schema.String },
  { httpApiStatus: 403 }
) {}
