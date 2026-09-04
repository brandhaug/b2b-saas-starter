import { Schema } from 'effect'

/**
 * The closed vocabulary behind `AuthorizationDenied.reason` — the 403
 * contract shared by both workers. Exactly these producers exist:
 * `requirePermission` raises the first two, the API token registry's bearer
 * verifier (`verifyBearerToken`) raises `invalid_token` for an unknown or
 * revoked token, and the API worker's `enforcePermission` raises
 * `token_workspace_mismatch` when a token reaches across workspaces. A new
 * denial reason means widening this record; anything else is a compile error.
 */
export const AUTHORIZATION_DENIED_REASONS = {
  noPrincipal: 'no_principal',
  insufficientPermission: 'insufficient_permission',
  invalidToken: 'invalid_token',
  tokenWorkspaceMismatch: 'token_workspace_mismatch'
} satisfies Record<AuthorizationDeniedReasonKey, AuthorizationDeniedReasonValue>

/** The record's keys — exactly the denial causes the guards distinguish. */
export type AuthorizationDeniedReasonKey =
  | 'noPrincipal'
  | 'insufficientPermission'
  | 'invalidToken'
  | 'tokenWorkspaceMismatch'

/** The wire vocabulary of `AuthorizationDenied.reason`. */
export type AuthorizationDeniedReasonValue =
  | 'no_principal'
  | 'insufficient_permission'
  | 'invalid_token'
  | 'token_workspace_mismatch'

export const AuthorizationDeniedReason = Schema.Literals(
  Object.values(AUTHORIZATION_DENIED_REASONS)
)
export type AuthorizationDeniedReason = typeof AuthorizationDeniedReason.Type

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
  { reason: AuthorizationDeniedReason },
  { httpApiStatus: 403 }
) {}
