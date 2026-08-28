import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  WorkspaceMembership,
  type WorkspaceWithMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { createServerFn } from '@tanstack/react-start'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { requireRequestSession, UnauthorizedError } from './auth'
import { webUserAdminBinding } from './user-admin-binding'

export type SystemUser = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly role: 'admin' | 'user'
  readonly banned: boolean
}

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
  if (session.user.role !== 'admin') {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnauthorizedError()
  }
  return session
}

export const banSystemUserServerFn = createServerFn({ method: 'POST' })
  .validator((input: { userId: string }) => input)
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
  .validator((input: { userId: string }) => input)
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
  .validator((input: { userId: string }) => input)
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
  .validator(
    (input: { userId: string; workspaceId: string; role: WorkspaceRole }) => input
  )
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
