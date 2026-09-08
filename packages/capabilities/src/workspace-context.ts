import { WorkspaceContext as BillingWorkspaceContext } from '@b2b-saas-starter/billing/ports'
import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { Database } from '@b2b-saas-starter/db/service'
import { workspaces } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { WorkspaceNotFound } from './errors.ts'
import {
  type CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'

import {
  findWorkspaceMember,
  SystemRole,
  toWorkspace,
  type Workspace,
  WorkspaceRole,
  type Member
} from './governance/workspace-identity.ts'

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

/**
 * Projects a resolved member onto the acting identity. Exported because
 * `workspace-projections.ts` builds a context of its own from a membership row
 * the query already proved.
 */
export function memberToActor(member: Member): Actor {
  return {
    userId: member.id,
    role: member.role,
    systemRole: member.systemRole
  }
}

export type WorkspaceContextInterface = {
  readonly workspace: Workspace
  readonly actor: Actor | null
  /**
   * What kind of caller made the request, read by the audit writes a
   * mutating capability performs: a session user, the platform, or a bearer
   * API token driving the REST/MCP surface. Independent of whether a user
   * identity is available; the request boundary must supply provenance.
   */
  readonly actorType: AuditActorTypeValue
}

export class WorkspaceContext extends Context.Service<
  WorkspaceContext,
  WorkspaceContextInterface
>()('@b2b-saas-starter/capabilities/WorkspaceContext') {}

export type WorkspaceServices = WorkspaceContext | BillingWorkspaceContext

/** Billing receives the same verified identity as the workspace capabilities. */
const BillingWorkspaceContextLayer = Layer.effect(
  BillingWorkspaceContext,
  WorkspaceContext
)

export function liveWorkspaceContext(
  slug: string,
  actor: ActorRef | undefined,
  actorType: AuditActorTypeValue
): Layer.Layer<WorkspaceServices, WorkspaceNotFound | CapabilityUnavailable, Database> {
  return Layer.effect(WorkspaceContext)(
    Effect.gen(function* () {
      const db = yield* Database
      const row = yield* orUnavailable('workspace-context')(
        db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
      ).pipe(Effect.map((rows) => rows[0]))
      if (!row) {
        return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      }
      let resolvedActor: Actor | null = null
      if (actor) {
        const member = yield* findWorkspaceMember(db, {
          workspaceId: row.id,
          userId: actor.userId
        })
        // Non-members get the same WorkspaceNotFound as unknown slugs so a
        // probing user cannot learn whether a workspace exists.
        if (!member) {
          return yield* Effect.fail(new WorkspaceNotFound({ slug }))
        }
        resolvedActor = memberToActor(member)
      }
      return {
        workspace: toWorkspace(row),
        actor: resolvedActor,
        actorType
      }
    })
  ).pipe((context) => BillingWorkspaceContextLayer.pipe(Layer.provideMerge(context)))
}

/**
 * Seed counterpart of `liveWorkspaceContext`, mirroring its semantics: the
 * slug must match the seed workspace, and an `ActorRef` must resolve to one
 * of `members` — unknown user ids fail with the same non-disclosing
 * `WorkspaceNotFound` as the live layer (an empty `members` list therefore
 * fails closed for any actor). Omitting `actor` yields a trusted `actor: null`
 * context. Tests that already hold a fully resolved `Actor` should use
 * `testWorkspaceContext` instead.
 */
export function seedWorkspaceContext(
  seedWorkspace: Workspace,
  slug: string,
  actor: ActorRef | undefined,
  members: ReadonlyArray<Member>,
  actorType: AuditActorTypeValue
): Layer.Layer<WorkspaceServices, WorkspaceNotFound> {
  return Layer.effect(WorkspaceContext)(
    Effect.suspend((): Effect.Effect<WorkspaceContextInterface, WorkspaceNotFound> => {
      if (slug !== seedWorkspace.slug) {
        return Effect.fail(new WorkspaceNotFound({ slug }))
      }
      if (!actor) {
        return Effect.succeed({
          workspace: seedWorkspace,
          actor: null,
          actorType
        })
      }
      const member = members.find((candidate) => candidate.id === actor.userId)
      if (!member) {
        return Effect.fail(new WorkspaceNotFound({ slug }))
      }
      const resolved = memberToActor(member)
      return Effect.succeed({
        workspace: seedWorkspace,
        actor: resolved,
        actorType
      })
    })
  ).pipe((context) => BillingWorkspaceContextLayer.pipe(Layer.provideMerge(context)))
}

/** Test injection: a context built from already-resolved values, no membership checks. */
export function testWorkspaceContext(
  workspace: Workspace,
  actor: Actor | null = null,
  actorType: AuditActorTypeValue = 'user'
): Layer.Layer<WorkspaceServices> {
  return Layer.succeed(WorkspaceContext)({
    workspace,
    actor,
    actorType
  }).pipe((context) => BillingWorkspaceContextLayer.pipe(Layer.provideMerge(context)))
}
