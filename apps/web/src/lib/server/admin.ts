import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  type SystemRole,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The `/admin` server functions, in a **client-safe** module.
 *
 * This file is statically imported by the admin route and the user-action
 * components, and the route tree ships to the browser — so everything at
 * this module's top level rides on every page. That is why the capability
 * effects and their wiring (the platform user-admin service, the global
 * audit log, the Better Auth session gate, the plugin binding) live in
 * `admin.effects.ts` and are reached only through dynamic `import()` inside
 * each handler: TanStack Start strips handler bodies from the client build,
 * so the capabilities graph never ships. The validators are stripped the
 * same way handler bodies are — `.validator()` runs on the server only — so
 * the plain shape checks below are the server's first decode, a wire-shape
 * gate that declares each fn's input type without dragging the Effect
 * Schema chunk onto the route tree, while the strict schemas (non-empty ids,
 * the role literal) decode again in `admin.effects.ts` before anything runs.
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

/** Input shape of the user-keyed server fns, for their client stubs. */
type SystemUserInput = {
  readonly userId: string
}

type ChangeWorkspaceRoleInput = {
  readonly userId: string
  readonly workspaceId: string
  readonly role: WorkspaceRole
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, and the strict schemas decode again in
 * `admin.effects.ts`. These probes ARE the I/O boundary, so `unknown` in and
 * `throw` out is the contract, the same exemption `pickOptionalStrings`
 * carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, effect/noAs, typescript/no-unsafe-type-assertion
function decodeSystemUser(input: unknown): SystemUserInput {
  const record = expectRecord(input, 'system user input')
  return { userId: expectString(record, 'userId', 'system user input') }
}

function decodeChangeWorkspaceRole(input: unknown): ChangeWorkspaceRoleInput {
  const record = expectRecord(input, 'workspace role input')
  // SAFETY: the strict schema in `admin.effects.ts` re-decodes the role
  // against the literal tuple before anything runs; this check only
  // establishes the wire shape for the client stub's type.
  return {
    userId: expectString(record, 'userId', 'workspace role input'),
    workspaceId: expectString(record, 'workspaceId', 'workspace role input'),
    role: expectString(
      record,
      'role',
      'workspace role input'
    ) as ChangeWorkspaceRoleInput['role']
  }
}
// oxlint-enable anti-slop/no-unknown-parameters, effect/noAs, typescript/no-unsafe-type-assertion

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
    const { loadAdminAuditEvents } = await import('./admin.effects')
    return loadAdminAuditEvents()
  }
)

export const banSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator(decodeSystemUser)
  .handler(async ({ data }) => {
    const { banSystemUserHandler } = await import('./admin.effects')
    return banSystemUserHandler(data)
  })

export const unbanSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator(decodeSystemUser)
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
  .validator(decodeSystemUser)
  .handler(async ({ data }): Promise<ReadonlyArray<WorkspaceWithMembership>> => {
    const { listUserWorkspacesHandler } = await import('./admin.effects')
    return listUserWorkspacesHandler(data)
  })

export const changeUserWorkspaceRoleServerFn = createServerFn({ method: 'POST' })
  .validator(decodeChangeWorkspaceRole)
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
  .validator(decodeSystemUser)
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
