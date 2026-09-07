import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { Database } from '@b2b-saas-starter/db/service'
import {
  session,
  workspaceSsoAuthProofs,
  workspaceSsoConnections,
  workspaceSsoRecoveryExceptions,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import {
  WorkspaceNotFound,
  WorkspaceSsoRequired,
  type CapabilityUnavailable
} from './errors.ts'
import { orUnavailable } from './internal/unavailable.ts'
import { type SsoRecoveryPurpose } from './governance/sso-policy.ts'
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
export type ActorRef = {
  readonly userId: string
  readonly sessionId?: string | undefined
}

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
  readonly sessionId?: string | null
  readonly purpose?: SsoRecoveryPurpose
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

export function liveWorkspaceContext(
  slug: string,
  actor: ActorRef | undefined,
  actorType: AuditActorTypeValue,
  purpose: SsoRecoveryPurpose = 'workspace'
): Layer.Layer<
  WorkspaceContext,
  WorkspaceNotFound | WorkspaceSsoRequired | CapabilityUnavailable,
  Database
> {
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
        if (purpose === 'sso_repair') {
          const nowDateTime = yield* DateTime.now
          const now = DateTime.formatIso(nowDateTime)
          if (resolvedActor.role !== 'owner' || actor.sessionId === undefined) {
            return yield* Effect.fail(new WorkspaceSsoRequired({ workspaceId: row.id }))
          }
          const [activeRecovery] = yield* orUnavailable('workspace-context')(
            db
              .select({ id: workspaceSsoRecoveryExceptions.id })
              .from(workspaceSsoRecoveryExceptions)
              .innerJoin(
                session,
                and(
                  eq(session.id, workspaceSsoRecoveryExceptions.sessionId),
                  eq(session.userId, workspaceSsoRecoveryExceptions.userId),
                  gt(session.expiresAt, DateTime.toDate(nowDateTime)),
                  isNull(session.impersonatedBy)
                )
              )
              .where(
                and(
                  eq(workspaceSsoRecoveryExceptions.workspaceId, row.id),
                  eq(workspaceSsoRecoveryExceptions.userId, actor.userId),
                  eq(workspaceSsoRecoveryExceptions.sessionId, actor.sessionId),
                  isNotNull(workspaceSsoRecoveryExceptions.usedAt),
                  isNull(workspaceSsoRecoveryExceptions.expiredAt),
                  gt(workspaceSsoRecoveryExceptions.expiresAt, now)
                )
              )
              .limit(1)
          )
          if (activeRecovery === undefined) {
            return yield* Effect.fail(new WorkspaceSsoRequired({ workspaceId: row.id }))
          }
          return {
            workspace: toWorkspace(row),
            actor: resolvedActor,
            sessionId: actor.sessionId,
            actorType,
            purpose
          }
        }
        if (actorType !== 'api_token') {
          const required = yield* orUnavailable('workspace-context')(
            db
              .select({
                providerId: workspaceSsoConnections.providerId,
                generation: workspaceSsoConnections.connectionGeneration
              })
              .from(workspaceSsoConnections)
              .where(
                and(
                  eq(workspaceSsoConnections.workspaceId, row.id),
                  eq(workspaceSsoConnections.requireSso, true)
                )
              )
          )
          if (required.length > 0) {
            const nowDateTime = yield* DateTime.now
            const now = DateTime.formatIso(nowDateTime)
            if (actor.sessionId === undefined) {
              return yield* Effect.fail(
                new WorkspaceSsoRequired({ workspaceId: row.id })
              )
            }
            const validSession = yield* orUnavailable('workspace-context')(
              db
                .select({ id: session.id })
                .from(session)
                .where(
                  and(
                    eq(session.id, actor.sessionId),
                    eq(session.userId, actor.userId),
                    gt(session.expiresAt, DateTime.toDate(nowDateTime)),
                    isNull(session.impersonatedBy)
                  )
                )
                .limit(1)
            )
            if (validSession.length === 0) {
              return yield* Effect.fail(
                new WorkspaceSsoRequired({ workspaceId: row.id })
              )
            }
            const proofs = yield* orUnavailable('workspace-context')(
              db
                .select({
                  providerId: workspaceSsoAuthProofs.providerId,
                  generation: workspaceSsoAuthProofs.connectionGeneration
                })
                .from(workspaceSsoAuthProofs)
                .where(
                  and(
                    eq(workspaceSsoAuthProofs.workspaceId, row.id),
                    eq(workspaceSsoAuthProofs.userId, actor.userId),
                    eq(workspaceSsoAuthProofs.sessionId, actor.sessionId),
                    gt(workspaceSsoAuthProofs.expiresAt, now)
                  )
                )
            )
            const admitted = required.some((connection) =>
              proofs.some(
                (proof) =>
                  proof.providerId === connection.providerId &&
                  proof.generation === connection.generation
              )
            )
            if (!admitted) {
              return yield* Effect.fail(
                new WorkspaceSsoRequired({ workspaceId: row.id })
              )
            }
          }
        }
      }
      return {
        workspace: toWorkspace(row),
        actor: resolvedActor,
        sessionId: actor?.sessionId ?? null,
        actorType,
        purpose
      }
    })
  )
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
  actorType: AuditActorTypeValue,
  purpose: SsoRecoveryPurpose = 'workspace',
  requiredSsoProofs: ReadonlyArray<{
    readonly workspaceId: string
    readonly userId: string
    readonly sessionId: string
    readonly providerId: string
    readonly connectionGeneration: number
    readonly expiresAt: string
  }> = [],
  activeRecoveries: ReadonlyArray<{
    readonly workspaceId: string
    readonly userId: string
    readonly sessionId: string
    readonly expiresAt: string
  }> = []
): Layer.Layer<WorkspaceContext, WorkspaceNotFound | WorkspaceSsoRequired> {
  return Layer.effect(WorkspaceContext)(
    Effect.gen(function* () {
      if (slug !== seedWorkspace.slug) {
        return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      }
      if (!actor) {
        return {
          workspace: seedWorkspace,
          actor: null,
          sessionId: null,
          actorType,
          purpose
        }
      }
      const member = members.find((candidate) => candidate.id === actor.userId)
      if (!member) {
        return yield* Effect.fail(new WorkspaceNotFound({ slug }))
      }
      const resolved = memberToActor(member)
      if (purpose === 'sso_repair') {
        const now = DateTime.formatIso(yield* DateTime.now)
        const recovered =
          resolved.role === 'owner' &&
          actor.sessionId !== undefined &&
          activeRecoveries.some(
            (recovery) =>
              recovery.workspaceId === seedWorkspace.id &&
              recovery.userId === actor.userId &&
              recovery.sessionId === actor.sessionId &&
              recovery.expiresAt > now
          )
        if (!recovered) {
          return yield* Effect.fail(
            new WorkspaceSsoRequired({ workspaceId: seedWorkspace.id })
          )
        }
        return {
          workspace: seedWorkspace,
          actor: resolved,
          sessionId: actor.sessionId,
          actorType,
          purpose
        }
      }
      if (actorType !== 'api_token') {
        const now = DateTime.formatIso(yield* DateTime.now)
        const required = requiredSsoProofs.filter(
          (proof) => proof.workspaceId === seedWorkspace.id
        )
        if (
          required.length > 0 &&
          (actor.sessionId === undefined ||
            !required.some(
              (proof) =>
                proof.userId === actor.userId &&
                proof.sessionId === actor.sessionId &&
                proof.expiresAt > now
            ))
        ) {
          return yield* Effect.fail(
            new WorkspaceSsoRequired({ workspaceId: seedWorkspace.id })
          )
        }
      }
      return {
        workspace: seedWorkspace,
        actor: resolved,
        sessionId: actor.sessionId ?? null,
        actorType,
        purpose
      }
    })
  )
}

/** Test injection: a context built from already-resolved values, no membership checks. */
export function testWorkspaceContext(
  workspace: Workspace,
  actor: Actor | null = null,
  actorType: AuditActorTypeValue = 'user',
  sessionId: string | null = null,
  purpose: SsoRecoveryPurpose = 'workspace'
): Layer.Layer<WorkspaceContext> {
  return Layer.succeed(WorkspaceContext)({
    workspace,
    actor,
    sessionId,
    actorType,
    purpose
  })
}
