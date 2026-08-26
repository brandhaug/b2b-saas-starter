import {
  type ApiTokenScopeValue,
  type workspaceRoles
} from '@b2b-saas-starter/db/enums'
import { type Role, type Statements } from 'better-auth/plugins/access'
import { adminAc, memberAc, ownerAc } from 'better-auth/plugins/organization/access'
import {
  accessControl,
  starterResources,
  type StarterStatements
} from './statements.ts'

/**
 * The static roles of the starter, plus the synthetic roles that API token
 * scopes map onto. Sessions and bearer tokens therefore reach the same
 * `authorize()` implementation — there is no second permission path.
 *
 * Role and scope names come from `@b2b-saas-starter/db`'s enum module, so a
 * change to either stored enum turns into a type error here instead of a
 * silent gap.
 */

export type WorkspaceRole = (typeof workspaceRoles)[number]
export type ApiTokenScope = ApiTokenScopeValue

/**
 * Every role authorizes against the same statement set, whatever subset of it
 * the role itself grants. Pinning the second type parameter is what lets the
 * roles share one `Record` and one request type.
 */
export type StarterRole = Role<Statements, StarterStatements>

/** Full control, including `organization:delete`. */
export const ownerRole = accessControl.newRole({
  ...ownerAc.statements,
  ...starterResources
})

/** Everything the owner has except deleting the workspace — `adminAc` already omits it. */
export const adminRole = accessControl.newRole({
  ...adminAc.statements,
  ...starterResources
})

/**
 * Read access to the workspace's own content only. The empty lists are
 * deliberate and load-bearing: a member cannot read the audit log or list API
 * tokens, because both leak the workspace's security posture.
 */
export const memberRole = accessControl.newRole({
  ...memberAc.statements,
  apiToken: [],
  webhook: [],
  auditLog: [],
  notification: ['read'],
  assistant: ['read'],
  mcp: ['read']
})

export const workspaceRoleAccess = {
  owner: ownerRole,
  admin: adminRole,
  member: memberRole
} satisfies Record<WorkspaceRole, StarterRole>

/**
 * Every `list` and `read` action. Wider than the `member` role — an API token
 * is minted by an owner or admin, so it may read the audit log the member who
 * holds a session cannot.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const readScopeStatements = {
  ac: ['read'],
  apiToken: ['list'],
  webhook: ['list'],
  auditLog: ['read'],
  notification: ['read'],
  assistant: ['read'],
  mcp: ['read']
} as const

export const readScopeRole = accessControl.newRole(readScopeStatements)

/**
 * The read set plus the mutations a machine client is trusted with.
 *
 * `apiToken: ['create']` is deliberately absent. Minting is the one mutation
 * that would let a token escalate itself — a `write` token allowed to create
 * tokens could issue an `admin` one — so it stays with the owner set, where
 * `admin` scope already reaches it.
 */
export const writeScopeRole = accessControl.newRole({
  ...readScopeStatements,
  invitation: ['create'],
  webhook: ['list', 'create']
})

/**
 * The owner set, shared by reference rather than restated. A token scoped
 * `admin` can do anything a workspace owner can.
 */
export const adminScopeRole = ownerRole

export const apiTokenScopeAccess = {
  read: readScopeRole,
  write: writeScopeRole,
  admin: adminScopeRole
} satisfies Record<ApiTokenScope, StarterRole>
