import { WorkspaceContext as BillingWorkspaceContext } from '@b2b-saas-starter/billing/ports'
import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { Database } from '@b2b-saas-starter/db/service'
import { workspaces } from '@b2b-saas-starter/db/schema/workspaces'
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
  systemRole: SystemRole,
  banned: Schema.Boolean
})
export type Actor = typeof Actor.Type

/**
 * Unresolved reference to the signed-in user, as known at the route boundary
 * (a session only carries the user id). The workspace-context layers resolve
 * it into a full `Actor` by verifying membership of the requested workspace.
 */
export type ActorRef = { readonly userId: string }

/**
 * Who asks for a workspace at a request boundary, before membership resolves.
 * The audit provenance and the identity travel as one value, so a user
 * provenance always names its user and a token or platform caller never
 * claims one. Resolution turns `actor` into a verified `Actor`.
 */
export type WorkspaceCaller = UserWorkspaceCaller | ActorlessWorkspaceCaller
export type UserWorkspaceCaller = {
  readonly actorType: 'user'
  readonly actor: ActorRef
}
/** A bearer token or the platform: the resolved context has `actor: null`. */
export type ActorlessWorkspaceCaller = {
  readonly actorType: Exclude<AuditActorTypeValue, 'user'>
}

export const WorkspaceCaller = {
  user: (userId: string): UserWorkspaceCaller => ({
    actorType: 'user',
    actor: { userId }
  }),
  apiToken: { actorType: 'api_token' } satisfies ActorlessWorkspaceCaller,
  system: { actorType: 'system' } satisfies ActorlessWorkspaceCaller
} as const

/**
 * Projects a resolved member onto the acting identity. Exported because
 * `workspace-projections.ts` builds a context of its own from a membership row
 * the query already proved.
 */
export function memberToActor(member: Member): Actor {
  return {
    userId: member.id,
    role: member.role,
    systemRole: member.systemRole,
    banned: member.banned
  }
}

/**
 * The resolved workspace and caller, read by every capability call and by the
 * audit writes a mutating capability performs. `actorType` says what kind of
 * caller made the request: a session user, the platform, or a bearer API token
 * driving the REST/MCP surface. Only a user caller carries a verified `Actor`.
 */
export type WorkspaceContextInterface = UserWorkspaceContext | ActorlessWorkspaceContext
export type UserWorkspaceContext = {
  readonly workspace: Workspace
  readonly actorType: 'user'
  readonly actor: Actor
}
export type ActorlessWorkspaceContext = {
  readonly workspace: Workspace
  readonly actorType: ActorlessWorkspaceCaller['actorType']
  readonly actor: null
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
  caller: WorkspaceCaller
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
      const workspace = toWorkspace(row)
      if (caller.actorType !== 'user') {
        return { workspace, actor: null, actorType: caller.actorType }
      }
      const member = yield* findWorkspaceMember(db, {
        workspaceId: row.id,
        userId: caller.actor.userId
      })
      // Non-members get the same WorkspaceNotFound as unknown slugs so a
      // probing user cannot learn whether a workspace exists.
      if (!member) {
        return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      }
      return { workspace, actor: memberToActor(member), actorType: caller.actorType }
    })
  ).pipe((context) => BillingWorkspaceContextLayer.pipe(Layer.provideMerge(context)))
}

/**
 * Seed counterpart of `liveWorkspaceContext`, mirroring its semantics: the
 * slug must match the seed workspace, and a user caller must resolve to one
 * of `members` — unknown user ids fail with the same non-disclosing
 * `WorkspaceNotFound` as the live layer (an empty `members` list therefore
 * fails closed for any actor). An actorless caller yields a trusted
 * `actor: null` context. Tests that already hold a fully resolved `Actor` should use
 * `testWorkspaceContext` instead.
 */
export function seedWorkspaceContext(
  seedWorkspace: Workspace,
  slug: string,
  caller: WorkspaceCaller,
  members: ReadonlyArray<Member>
): Layer.Layer<WorkspaceServices, WorkspaceNotFound> {
  return Layer.effect(WorkspaceContext)(
    Effect.suspend((): Effect.Effect<WorkspaceContextInterface, WorkspaceNotFound> => {
      if (slug !== seedWorkspace.slug) {
        return Effect.fail(new WorkspaceNotFound({ slug }))
      }
      if (caller.actorType !== 'user') {
        return Effect.succeed({
          workspace: seedWorkspace,
          actor: null,
          actorType: caller.actorType
        })
      }
      const member = members.find((candidate) => candidate.id === caller.actor.userId)
      if (!member) {
        return Effect.fail(new WorkspaceNotFound({ slug }))
      }
      const resolved = memberToActor(member)
      return Effect.succeed({
        workspace: seedWorkspace,
        actor: resolved,
        actorType: caller.actorType
      })
    })
  ).pipe((context) => BillingWorkspaceContextLayer.pipe(Layer.provideMerge(context)))
}

/**
 * Test injection: a context built from already-resolved values, no membership
 * checks. A resolved `Actor` acts as a user; without one the caller is actorless
 * (`system` unless the test names another provenance), never a user without
 * an identity.
 */
export function testWorkspaceContext(
  workspace: Workspace,
  caller: Actor | ActorlessWorkspaceCaller = WorkspaceCaller.system
): Layer.Layer<WorkspaceServices> {
  if ('actorType' in caller) {
    return testResolvedWorkspaceContext({
      workspace,
      actor: null,
      actorType: caller.actorType
    })
  }
  return testResolvedWorkspaceContext({ workspace, actor: caller, actorType: 'user' })
}

/** Test injection of a whole resolved context, e.g. one read back and re-scoped. */
export function testResolvedWorkspaceContext(
  context: WorkspaceContextInterface
): Layer.Layer<WorkspaceServices> {
  return Layer.succeed(WorkspaceContext)(context).pipe((layer) =>
    BillingWorkspaceContextLayer.pipe(Layer.provideMerge(layer))
  )
}
