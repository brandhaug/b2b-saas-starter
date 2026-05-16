import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, user, workspaceMembers, workspaceRoles } from '@b2b-saas-starter/db'
import { WorkspaceContext } from '../workspace-context.ts'

export const WORKSPACE_ROLES = workspaceRoles
export const SYSTEM_ROLES = ['admin', 'user'] as const

export const WorkspaceRole = Schema.Literals(WORKSPACE_ROLES)
export type WorkspaceRole = typeof WorkspaceRole.Type

export const SystemRole = Schema.Literals(SYSTEM_ROLES)
export type SystemRole = typeof SystemRole.Type

export const Workspace = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  planId: Schema.String
})
export type Workspace = typeof Workspace.Type

export const Member = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: WorkspaceRole,
  systemRole: SystemRole
})
export type Member = typeof Member.Type

export type WorkspaceMembershipShape = {
  readonly listMembers: Effect.Effect<readonly Member[], never, WorkspaceContext>
}

export class WorkspaceMembership extends Context.Service<
  WorkspaceMembership,
  WorkspaceMembershipShape
>()('@b2b-saas-starter/capabilities/WorkspaceMembership') {}

export const SeedWorkspaceMembership = (
  members: readonly Member[]
): Layer.Layer<WorkspaceMembership> =>
  Layer.succeed(WorkspaceMembership)({
    listMembers: Effect.succeed(members)
  })

export const LiveWorkspaceMembership: Layer.Layer<
  WorkspaceMembership,
  never,
  Database
> = Layer.effect(WorkspaceMembership)(
  Effect.gen(function* () {
    const db = yield* Database

    return {
      listMembers: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* Effect.promise(() =>
          db
            .select({ member: workspaceMembers, user })
            .from(workspaceMembers)
            .innerJoin(user, eq(user.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, ctx.workspace.id))
        )
        return rows.map((row) => ({
          id: row.user.id,
          name: row.user.name,
          email: row.user.email,
          role: row.member.role,
          systemRole: row.user.role === 'admin' ? 'admin' : 'user'
        }))
      })
    }
  })
)
