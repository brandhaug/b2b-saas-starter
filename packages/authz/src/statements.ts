import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'

/**
 * The permission vocabulary of the starter, expressed as Better Auth access
 * control statements: one entry per resource, listing every action that
 * resource understands.
 *
 * `createAccessControl` is pure — no database, no auth instance, no plugin
 * registration — so this module stays below `auth` and `capabilities` and can
 * be imported from either side of a request.
 */

/**
 * Resources the starter owns. Kept separate from `starterStatements` so the
 * owner and admin roles can grant all of them by spreading one object instead
 * of restating the action lists.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const starterResources = {
  apiToken: ['list', 'create', 'revoke'],
  webhook: ['list', 'create', 'disable', 'rotateSecret'],
  auditLog: ['read'],
  module: ['read', 'update'],
  notification: ['read'],
  integration: ['read']
} as const

/**
 * The full statement set: the organization plugin's own resources
 * (`organization`, `member`, `invitation`, `team`, `ac`) plus the starter's.
 *
 * The plugin defaults are not optional. Every custom role is checked against
 * them by the plugin's own endpoints, so dropping one breaks member and
 * invitation management rather than merely narrowing a permission.
 */
export const starterStatements = { ...defaultStatements, ...starterResources }
export type StarterStatements = typeof starterStatements

/** The access controller every role in this package is minted from. */
export const accessControl = createAccessControl(starterStatements)
