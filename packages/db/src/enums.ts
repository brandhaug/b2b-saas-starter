// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const workspaceRoles = ['owner', 'admin', 'member'] as const
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
 * The stored enum vocabularies of the schema, in one leaf module with no
 * drizzle imports. The policy layer (`@b2b-saas-starter/authz`) reads these
 * names so a change to a stored enum turns into a type error there instead of
 * a silent gap — without pulling the table definitions into the policy layer.
 */
