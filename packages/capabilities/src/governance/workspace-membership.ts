import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, user, workspaceMembers, workspaces } from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { Member, toMember, Workspace } from './workspace-identity.ts'

export const WorkspaceWithMembership = Schema.Struct({
  workspace: Workspace,
  member: Member
})
export type WorkspaceWithMembership = typeof WorkspaceWithMembership.Type

export type WorkspaceMembershipInterface = {
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
  WorkspaceMembershipInterface
>()('@b2b-saas-starter/capabilities/WorkspaceMembership') {}

export function SeedWorkspaceMembership(
  members: readonly Member[],
  workspace: Workspace
): Layer.Layer<WorkspaceMembership> {
  return Layer.succeed(WorkspaceMembership)({
    listMembers: Effect.succeed(members),
    listWorkspacesForUser: (userId) => {
      const member = members.find((candidate) => candidate.id === userId)
      if (!member) return Effect.succeed([])
      return Effect.succeed([{ workspace, member }])
    }
  })
}

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
