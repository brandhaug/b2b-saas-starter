import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, workspaces } from '@b2b-saas-starter/db'
import { WorkspaceNotFound, type CapabilityUnavailable } from './errors.ts'
import { orUnavailable } from './internal/unavailable.ts'
import {
  findWorkspaceMember,
  SystemRole,
  Workspace,
  WorkspaceRole,
  type Member
} from './governance/workspace-membership.ts'

export const Actor = Schema.Struct({
  userId: Schema.String,
  role: WorkspaceRole,
  systemRole: SystemRole
})
export type Actor = typeof Actor.Type

/**
 * Unresolved reference to the signed-in user, as known at the route boundary
 * (a session only carries the user id). The workspace-context layers resolve
 * it into a full `Actor` by verifying membership of the requested workspace.
 */
export type ActorRef = { readonly userId: string }

const memberToActor = (member: Member): Actor => ({
  userId: member.id,
  role: member.role,
  systemRole: member.systemRole
})

export type WorkspaceContextShape = {
  readonly workspace: Workspace
  readonly actor: Actor | null
}

export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  WorkspaceContextShape
>()('@b2b-saas-starter/capabilities/WorkspaceContext') {}

export const liveWorkspaceContext = (
  slug: string,
  actor?: ActorRef
): Layer.Layer<WorkspaceContext, WorkspaceNotFound | CapabilityUnavailable, Database> =>
  Layer.effect(WorkspaceContext)(
    Effect.gen(function* () {
      const db = yield* Database
      const row = yield* orUnavailable('workspace-context')(
        db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
      ).pipe(Effect.map((rows) => rows[0]))
      if (!row) return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      let resolvedActor: Actor | null = null
      if (actor) {
        const member = yield* findWorkspaceMember(db, {
          workspaceId: row.id,
          userId: actor.userId
        })
        // Non-members get the same WorkspaceNotFound as unknown slugs so a
        // probing user cannot learn whether a workspace exists.
        if (!member) return yield* Effect.fail(new WorkspaceNotFound({ slug }))
        resolvedActor = memberToActor(member)
      }
      return {
        workspace: {
          id: row.id,
          slug: row.slug,
          name: row.name,
          planId: row.planId
        },
        actor: resolvedActor
      }
    })
  )

/**
 * Seed counterpart of `liveWorkspaceContext`, mirroring its semantics: the
 * slug must match the seed workspace, and an `ActorRef` must resolve to one
 * of `members` — unknown user ids fail with the same non-disclosing
 * `WorkspaceNotFound` as the live layer (an empty `members` list therefore
 * fails closed for any actor). Omitting `actor` yields a trusted `actor: null`
 * context. Tests that already hold a fully resolved `Actor` should use
 * `testWorkspaceContext` instead.
 */
export const seedWorkspaceContext = (
  seedWorkspace: Workspace,
  slug: string,
  actor?: ActorRef,
  members: readonly Member[] = []
): Layer.Layer<WorkspaceContext, WorkspaceNotFound> =>
  Layer.effect(WorkspaceContext)(
    Effect.suspend((): Effect.Effect<WorkspaceContextShape, WorkspaceNotFound> => {
      if (slug !== seedWorkspace.slug) {
        return Effect.fail(new WorkspaceNotFound({ slug }))
      }
      if (!actor) {
        return Effect.succeed({ workspace: seedWorkspace, actor: null })
      }
      const member = members.find((candidate) => candidate.id === actor.userId)
      return member
        ? Effect.succeed({ workspace: seedWorkspace, actor: memberToActor(member) })
        : Effect.fail(new WorkspaceNotFound({ slug }))
    })
  )

/** Test injection: a context built from already-resolved values, no membership checks. */
export const testWorkspaceContext = (
  workspace: Workspace,
  actor: Actor | null = null
): Layer.Layer<WorkspaceContext> =>
  Layer.succeed(WorkspaceContext)({ workspace, actor })
