import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  Database,
  user,
  workspaceMembers,
  workspaceRoles,
  workspaces,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
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

type MemberRow = {
  readonly member: typeof workspaceMembers.$inferSelect
  readonly user: typeof user.$inferSelect
}

const toMember = (row: MemberRow): Member => ({
  id: row.user.id,
  name: row.user.name,
  email: row.user.email,
  role: row.member.role,
  systemRole: row.user.role === 'admin' ? 'admin' : 'user'
})

/**
 * Looks up a single member of a workspace by user id. Used by the
 * `WorkspaceContext` live layer to resolve (and enforce) the actor's
 * membership before any capability runs — this is a query helper, not an
 * authorization decision; the non-member failure policy lives in
 * `workspace-context.ts`.
 */
export const findWorkspaceMember = (
  db: EffectDatabase,
  input: { readonly workspaceId: string; readonly userId: string }
): Effect.Effect<Member | undefined, CapabilityUnavailable> =>
  orUnavailable('workspace-membership')(
    db
      .select({ member: workspaceMembers, user })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId)
        )
      )
      .limit(1)
  ).pipe(Effect.map((rows) => (rows[0] ? toMember(rows[0]) : undefined)))

export const WorkspaceWithMembership = Schema.Struct({
  workspace: Workspace,
  member: Member
})
export type WorkspaceWithMembership = typeof WorkspaceWithMembership.Type

export type WorkspaceMembershipShape = {
  readonly listMembers: Effect.Effect<
    readonly Member[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  /**
   * Every workspace the user is a member of, with their membership row.
   * Cross-workspace read keyed by user id (no `WorkspaceContext`) — this is
   * the "my workspaces" model, resolved before any single workspace is
   * selected. Possibly empty; never discloses workspaces the user is not in.
   */
  readonly listWorkspacesForUser: (
    userId: string
  ) => Effect.Effect<readonly WorkspaceWithMembership[], CapabilityUnavailable>
}

export class WorkspaceMembership extends Context.Service<
  WorkspaceMembership,
  WorkspaceMembershipShape
>()('@b2b-saas-starter/capabilities/WorkspaceMembership') {}

export const SeedWorkspaceMembership = (
  members: readonly Member[],
  workspace: Workspace
): Layer.Layer<WorkspaceMembership> =>
  Layer.succeed(WorkspaceMembership)({
    listMembers: Effect.succeed(members),
    listWorkspacesForUser: (userId) => {
      const member = members.find((candidate) => candidate.id === userId)
      return Effect.succeed(member ? [{ workspace, member }] : [])
    }
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
        const rows = yield* orUnavailable('workspace-membership')(
          db
            .select({ member: workspaceMembers, user })
            .from(workspaceMembers)
            .innerJoin(user, eq(user.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, ctx.workspace.id))
        )
        return rows.map(toMember)
      }),
      listWorkspacesForUser: (userId) =>
        orUnavailable('workspace-membership')(
          db
            .select({ workspace: workspaces, member: workspaceMembers, user })
            .from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
            .innerJoin(user, eq(user.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.userId, userId))
        ).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              workspace: {
                id: row.workspace.id,
                slug: row.workspace.slug,
                name: row.workspace.name,
                planId: row.workspace.planId
              },
              member: toMember(row)
            }))
          )
        )
    }
  })
)
