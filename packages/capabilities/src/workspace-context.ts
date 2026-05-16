import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, workspaces } from '@b2b-saas-starter/db'
import { WorkspaceNotFound } from './errors.ts'
import {
  SystemRole,
  Workspace,
  WorkspaceRole
} from './governance/workspace-membership.ts'

export const Actor = Schema.Struct({
  userId: Schema.String,
  role: WorkspaceRole,
  systemRole: SystemRole
})
export type Actor = typeof Actor.Type

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
  actor?: Actor
): Layer.Layer<WorkspaceContext, WorkspaceNotFound, Database> =>
  Layer.effect(WorkspaceContext)(
    Effect.gen(function* () {
      const db = yield* Database
      const row = yield* Effect.promise(() =>
        db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
      ).pipe(Effect.map((rows) => rows[0]))
      if (!row) return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      return {
        workspace: {
          id: row.id,
          slug: row.slug,
          name: row.name,
          planId: row.planId
        },
        actor: actor ?? null
      }
    })
  )

export const seedWorkspaceContext = (
  seedWorkspace: Workspace,
  slug: string,
  actor?: Actor
): Layer.Layer<WorkspaceContext, WorkspaceNotFound> =>
  Layer.effect(WorkspaceContext)(
    slug === seedWorkspace.slug
      ? Effect.succeed({ workspace: seedWorkspace, actor: actor ?? null })
      : Effect.fail(new WorkspaceNotFound({ slug }))
  )
