import { Database } from '@b2b-saas-starter/db/service'
import { workspaces } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { type CapabilityUnavailable, WorkspaceChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import { type SeedRoster } from './workspace-membership.ts'
import { Workspace, fabricateSeedMember } from './workspace-identity.ts'

export const CreatedWorkspace = Schema.Struct({
  ...Workspace.fields,
  planId: Schema.String
})
export type CreatedWorkspace = typeof CreatedWorkspace.Type

/**
 * Who is creating. The creator's user id rides in the input because a
 * workspace being created has no `WorkspaceContext` to read an actor from —
 * the same shape as `WorkspaceMembership.listWorkspacesForUser`, which runs
 * before any single workspace has been selected.
 */
export type CreateWorkspaceInput = {
  readonly name: string
  readonly slug: string
  readonly userId: string
}

export type WorkspaceLifecycleInterface = {
  /**
   * Creates a workspace owned by `userId`. Identity-keyed (no
   * `WorkspaceContext`): the actor is not a member of anything yet — creating
   * their first membership is this method's job.
   */
  readonly create: (
    input: CreateWorkspaceInput
  ) => Effect.Effect<CreatedWorkspace, CapabilityUnavailable | WorkspaceChangeRejected>
  /** Renames the workspace in context. */
  readonly rename: (input: {
    readonly name: string
  }) => Effect.Effect<
    Workspace,
    CapabilityUnavailable | WorkspaceChangeRejected,
    WorkspaceContext
  >

  /**
   * Hard-deletes the workspace in context. Members, invitations, tokens,
   * webhooks and deliveries go with it through the schema's cascade deletes;
   * the slug is released with the row.
   */
  readonly remove: Effect.Effect<
    void,
    CapabilityUnavailable | WorkspaceChangeRejected,
    WorkspaceContext
  >
}

export class WorkspaceLifecycle extends Context.Service<
  WorkspaceLifecycle,
  WorkspaceLifecycleInterface
>()('@b2b-saas-starter/capabilities/WorkspaceLifecycle') {}

/**
 * The write half of workspace lifecycle, as this package needs it — the same
 * structural port the other plugin-backed capabilities declare. Only `create`
 * runs headerless (the plugin accepts a `userId` body field there); rename and
 * delete demand the request's session headers, so only the app can supply the
 * adapter.
 */
export type WorkspaceLifecycleBinding = {
  readonly create: (input: {
    readonly name: string
    readonly slug: string
    readonly userId: string
  }) => Promise<void>
  readonly rename: (input: {
    readonly workspaceId: string
    readonly name: string
  }) => Promise<void>
  readonly remove: (input: { readonly workspaceId: string }) => Promise<void>
}

const { callBinding } = makeBindingCaller<
  WorkspaceLifecycleBinding,
  WorkspaceChangeRejected
>({
  capability: 'workspace-lifecycle',
  noBindingReason: 'no_lifecycle_binding',
  Rejected: WorkspaceChangeRejected
})

/**
 * In-memory lifecycle, never Better Auth. Created workspaces land in a local
 * `Ref`; renames and removals act on the fixture workspace resolved by the
 * seed `WorkspaceContext`, mirroring how the live adapter acts on the one the
 * live context resolves. The shared roster receives the creator as owner so
 * the membership fixtures stay consistent with the new workspace.
 */
export function SeedWorkspaceLifecycle(options: {
  readonly roster?: SeedRoster | undefined
  readonly workspace: Workspace
}): Layer.Layer<WorkspaceLifecycle> {
  return Layer.effect(WorkspaceLifecycle)(
    Effect.gen(function* () {
      const created = yield* Ref.make<ReadonlyArray<CreatedWorkspace>>([])

      const requireAvailableSlug = Effect.fnUntraced(function* (
        slug: string,
        taken: ReadonlyArray<string>
      ) {
        if (taken.includes(slug)) {
          return yield* Effect.fail(
            new WorkspaceChangeRejected({ reason: 'slug_taken' })
          )
        }
      })

      return {
        create: (input) =>
          Effect.gen(function* () {
            const existing = yield* Ref.get(created)
            yield* requireAvailableSlug(input.slug, [
              options.workspace.slug,
              ...existing.map((each) => each.slug)
            ])
            const id = yield* newCapabilityId('wrk')
            const workspace: CreatedWorkspace = {
              id,
              slug: input.slug,
              name: input.name,
              planId: 'starter'
            }
            yield* Ref.update(created, (rows) => [...rows, workspace])
            if (options.roster) {
              yield* Ref.update(options.roster, (members) => [
                ...members,
                // Fabricates the identity fields the fixture has no `user`
                // table to join; the creator enters as owner.
                fabricateSeedMember(input.userId, 'owner')
              ])
            }
            return workspace
          }),
        rename: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const renamed: Workspace = { ...ctx.workspace, name: input.name }
            yield* Ref.update(created, (rows) => {
              const next: Array<CreatedWorkspace> = []
              for (const each of rows) {
                if (each.id === ctx.workspace.id) {
                  next.push({ ...each, name: input.name })
                } else {
                  next.push(each)
                }
              }
              return next
            })
            return renamed
          }),
        remove: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          yield* Ref.update(created, (rows) =>
            rows.filter((each) => each.id !== ctx.workspace.id)
          )
        })
      }
    })
  )
}

export function LiveWorkspaceLifecycle(
  binding?: WorkspaceLifecycleBinding
): Layer.Layer<WorkspaceLifecycle, never, Database | AuditEventLog> {
  return Layer.effect(WorkspaceLifecycle)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('workspace-lifecycle')

      /** Reads the workspace back rather than trusting the binding's response. */
      const readBySlug = Effect.fnUntraced(function* (slug: string) {
        const rows = yield* unavailable(
          db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1)
        )
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new WorkspaceChangeRejected({ reason: 'workspace_not_created' })
          )
        }
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          planId: row.planId
        }
      })

      return {
        create: (input) =>
          Effect.gen(function* () {
            yield* callBinding(binding, (bound) => bound.create(input))
            const workspace = yield* readBySlug(input.slug)
            // Not atomic with the write above, and it cannot be — the same
            // accepted ADR 0051 trade the other plugin-backed capabilities
            // record.
            yield* audit.record({
              workspaceId: workspace.id,
              actorUserId: input.userId,
              eventType: 'workspace.created',
              targetType: 'workspace',
              targetId: workspace.id,
              metadata: { name: workspace.name, slug: workspace.slug }
            })
            return workspace
          }),
        rename: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding(binding, (bound) =>
              bound.rename({ workspaceId: ctx.workspace.id, name: input.name })
            )
            // The plugin's response shape is not this package's contract; the
            // rename is read back through the same table every read uses.
            const rows = yield* unavailable(
              db
                .select()
                .from(workspaces)
                .where(eq(workspaces.id, ctx.workspace.id))
                .limit(1)
            )
            const row = rows[0]
            if (!row) {
              return yield* Effect.fail(
                new WorkspaceChangeRejected({ reason: 'workspace_missing' })
              )
            }
            const renamed: Workspace = {
              id: row.id,
              slug: row.slug,
              name: row.name,
              planId: row.planId
            }
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace.renamed',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: { name: input.name }
            })
            return renamed
          }),
        remove: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          // Captured before the delete: once the row is gone, so are its
          // cascaded children, and the audit event must still name what was
          // removed.
          const removed = ctx.workspace
          yield* callBinding(binding, (bound) =>
            bound.remove({ workspaceId: ctx.workspace.id })
          )
          // A system event on purpose: `audit_events.workspace_id` cascades from
          // `workspaces.id`, so attributing this row to the deleted workspace
          // would delete it alongside the thing it describes.
          yield* audit.record({
            workspaceId: null,
            actorUserId: ctx.actor?.userId ?? null,
            eventType: 'workspace.deleted',
            targetType: 'workspace',
            targetId: removed.id,
            metadata: { name: removed.name, slug: removed.slug }
          })
        })
      }
    })
  )
}
