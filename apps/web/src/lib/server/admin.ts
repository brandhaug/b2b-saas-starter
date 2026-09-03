import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import {
  WorkspaceRole,
  type SystemRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  WorkspaceMembership,
  type WorkspaceWithMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { adminSystemRole } from '@b2b-saas-starter/db/enums'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { runCapabilities } from '../capabilities'
import { requireRequestSession, UnauthorizedError } from './auth'
import { webUserAdminBinding } from './user-admin-binding'

/**
 * Typed failure for the impersonation server functions when the request's
 * session is not what the action needs: starting one from a session that is
 * already an impersonation (no nesting — the admin cookie holds one token),
 * or stopping one from an ordinary session. Same shape and reason as
 * `UnauthorizedError`: server functions serialize thrown errors with
 * `name`/`message` intact, and the calling control shows `message`.
 */
export class ImpersonationStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImpersonationStateError'
  }
}

export type SystemUser = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: SystemRole
  readonly banned: boolean
}

/**
 * Server-fn inputs, as schemas — every constraint stated once, in the schema,
 * so the handler below never re-checks a field. An identity validator
 * (`(input: T) => input`) types the handler without validating anything: the
 * wire carries whatever the caller sent, and `userId: ''` or an invented role
 * would reach the capability.
 */
const SystemUserInput = Schema.Struct({ userId: Schema.NonEmptyString })

const ChangeWorkspaceRoleInput = Schema.Struct({
  userId: Schema.NonEmptyString,
  workspaceId: Schema.NonEmptyString,
  role: WorkspaceRole
})

const decodeSystemUser = Schema.decodeUnknownSync(SystemUserInput)
const decodeChangeWorkspaceRole = Schema.decodeUnknownSync(ChangeWorkspaceRoleInput)

/**
 * System-level user list for `/admin`, via the `PlatformUserAdmin`
 * capability — not a workspace member list. The route's own gate is
 * `requireAdmin`; the plugin-backed mutations additionally re-enforce the
 * admin role inside Better Auth from the request's session headers, so this
 * surface fails closed twice.
 */
export const listSystemUsersServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ReadonlyArray<SystemUser>> => {
    const users = await runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.listUsers
      })
    )
    return users.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      role: account.systemRole,
      banned: account.banned
    }))
  }
)

/**
 * Admin-role gate for the mutation server functions. The UI hiding a control
 * is presentation, never the check — every mutation re-verifies the session's
 * system role here before riding the capability.
 */
async function requireAdminSession() {
  const session = await requireRequestSession()
  if (session.user.role !== adminSystemRole) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnauthorizedError()
  }
  return session
}

export const banSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSystemUser(input))
  .handler(async ({ data }) => {
    const session = await requireAdminSession()
    return runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.banUser({
          userId: data.userId,
          actorUserId: session.user.id
        })
      }),
      { userAdminBinding: webUserAdminBinding }
    )
  })

export const unbanSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSystemUser(input))
  .handler(async ({ data }) => {
    const session = await requireAdminSession()
    return runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.unbanUser({
          userId: data.userId,
          actorUserId: session.user.id
        })
      }),
      { userAdminBinding: webUserAdminBinding }
    )
  })

/**
 * A user's memberships across workspaces, for the per-user role editor. The
 * same identity-keyed read "my workspaces" uses — an admin sees what the user
 * would, which is exactly the scope the role change acts on.
 */
export const listUserWorkspacesServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSystemUser(input))
  .handler(async ({ data }): Promise<ReadonlyArray<WorkspaceWithMembership>> => {
    await requireAdminSession()
    return runCapabilities(
      Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        return yield* membership.listWorkspacesForUser(data.userId)
      })
    )
  })

export const changeUserWorkspaceRoleServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeChangeWorkspaceRole(input))
  .handler(async ({ data }) => {
    const session = await requireAdminSession()
    return runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.changeWorkspaceRole({
          userId: data.userId,
          workspaceId: data.workspaceId,
          role: data.role,
          actorUserId: session.user.id
        })
      }),
      { userAdminBinding: webUserAdminBinding }
    )
  })

/**
 * Starts an impersonation session (ADR 0054). The route's gate, this gate,
 * the capability's own refusals (unknown user, System Admin target, self) and
 * Better Auth's `adminMiddleware` all have to agree before a cookie moves.
 * No nesting: an impersonation session cannot start another — the browser
 * holds one admin cookie, and the plugin would overwrite it.
 */
export const impersonateUserServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSystemUser(input))
  .handler(async ({ data }) => {
    const session = await requireAdminSession()
    if (session.session.impersonatedBy) {
      // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
      throw new ImpersonationStateError('Stop the current impersonation first.')
    }
    return runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.startImpersonation({
          userId: data.userId,
          actorUserId: session.user.id
        })
      }),
      { userAdminBinding: webUserAdminBinding }
    )
  })

/**
 * Ends the request's impersonation session and restores the admin's own. The
 * actor is read off the session itself (`impersonatedBy`), never off the
 * request body — the impersonated user holds no admin role, so
 * `requireAdminSession` would refuse them; the plugin's own endpoint applies
 * the matching check server-side.
 */
export const stopImpersonatingServerFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const session = await requireRequestSession()
    const actorUserId = session.session.impersonatedBy
    if (!actorUserId) {
      // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
      throw new ImpersonationStateError('This session is not impersonating anyone.')
    }
    return runCapabilities(
      Effect.gen(function* () {
        const admin = yield* PlatformUserAdmin
        return yield* admin.stopImpersonation({
          userId: session.user.id,
          actorUserId
        })
      }),
      { userAdminBinding: webUserAdminBinding }
    )
  }
)
