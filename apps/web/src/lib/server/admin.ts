import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type SystemRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { WORKSPACE_ROLES } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The `/admin` server functions, in a **client-safe** module — the
 * client-safe half of the `admin.effects.ts` split; see apps/web/AGENTS.md
 * for the rule and `scripts/assert-client-boundary.mjs` for the enforcement.
 * Each input is written once, as its Effect Schema: the validator is the
 * single strict decode, and the derived type types both the client stub and
 * the effects handler.
 */

/**
 * Typed failure for the impersonation server functions when the request's
 * session is not what the action needs: starting one from a session that is
 * already an impersonation (no nesting — the admin cookie holds one token),
 * or stopping one from an ordinary session. Same shape and reason as
 * `UnauthorizedError`: server functions serialize thrown errors with
 * `name`/`message` intact, and the calling control shows `message`.
 *
 * Defined in `admin.effects.ts` (its only thrower) so the client-safe module
 * never imports a value back from its effects sibling — that would be a
 * module cycle the dead-code gate rejects.
 */

export type SystemUser = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: SystemRole
  readonly banned: boolean
}

const SystemUserInput = Schema.Struct({ userId: Schema.NonEmptyString })

const ChangeWorkspaceRoleInput = Schema.Struct({
  userId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  role: Schema.Literals(WORKSPACE_ROLES)
})

export type SystemUserInput = typeof SystemUserInput.Type
export type ChangeWorkspaceRoleInput = typeof ChangeWorkspaceRoleInput.Type

/**
 * System-level user list for `/admin`, via the `PlatformUserAdmin`
 * capability — not a workspace member list. The route's own gate is
 * `requireAdmin`; the plugin-backed mutations additionally re-enforce the
 * admin role inside Better Auth from the request's session headers, so this
 * surface fails closed twice.
 */
export const listSystemUsersServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<SystemUser>> => {
    const { listSystemUsersHandler } = await import('./admin.effects')
    return listSystemUsersHandler()
  }
)

/**
 * The global audit trail for `/admin`'s events table: every recorded event
 * across all workspaces, via the non-workspace capabilities runner. Same
 * trust boundary as the user list — the route's `requireAdmin` gate decides
 * who may ask.
 */
export const loadAdminAuditEventsServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<AuditEvent>> => {
    const { loadAdminAuditEventsHandler } = await import('./admin.effects')
    return loadAdminAuditEventsHandler()
  }
)

export const banSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SystemUserInput))
  .handler(async ({ data }) => {
    const { banSystemUserHandler } = await import('./admin.effects')
    return banSystemUserHandler(data)
  })

export const unbanSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SystemUserInput))
  .handler(async ({ data }) => {
    const { unbanSystemUserHandler } = await import('./admin.effects')
    return unbanSystemUserHandler(data)
  })

/**
 * A user's memberships across workspaces, for the per-user role editor. The
 * same identity-keyed read "my workspaces" uses — an admin sees what the user
 * would, which is exactly the scope the role change acts on.
 */
export const listUserWorkspacesServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SystemUserInput))
  .handler(async ({ data }): Promise<ReadonlyArray<WorkspaceWithMembership>> => {
    const { listUserWorkspacesHandler } = await import('./admin.effects')
    return listUserWorkspacesHandler(data)
  })

export const changeUserWorkspaceRoleServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(ChangeWorkspaceRoleInput))
  .handler(async ({ data }) => {
    const { changeUserWorkspaceRoleHandler } = await import('./admin.effects')
    return changeUserWorkspaceRoleHandler(data)
  })

/**
 * Starts an impersonation session (ADR 0054). The route's gate, the handler's
 * admin gate, the capability's own refusals (unknown user, System Admin
 * target, self) and Better Auth's `adminMiddleware` all have to agree before
 * a cookie moves. No nesting: an impersonation session cannot start another —
 * the browser holds one admin cookie, and the plugin would overwrite it.
 */
export const impersonateUserServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(SystemUserInput))
  .handler(async ({ data }) => {
    const { impersonateUserHandler } = await import('./admin.effects')
    return impersonateUserHandler(data)
  })

/**
 * Ends the request's impersonation session and restores the admin's own. The
 * actor is read off the session itself (`impersonatedBy`), never off the
 * request body — the impersonated user holds no admin role, so the admin gate
 * would refuse them; the plugin's own endpoint applies the matching check
 * server-side.
 */
export const stopImpersonatingServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { stopImpersonatingHandler } = await import('./admin.effects')
    return stopImpersonatingHandler()
  }
)
