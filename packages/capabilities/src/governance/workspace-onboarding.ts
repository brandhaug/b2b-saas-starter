import { user, workspaces } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Context, DateTime, Effect, Layer, Ref } from 'effect'
import { and, eq, isNull } from 'drizzle-orm'

import { type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'

/**
 * The Workspace Onboarding capability: the two facts the onboarding checklist
 * needs that no other capability serves — whether the workspace dismissed its
 * checklist, and whether the acting user has two-factor enabled — plus the one
 * mutation, dismissal. Every other checklist step is derived live from the
 * membership, API-token, webhook, and billing capabilities by the
 * `workspaceProgress` projection (`../workspace-projections.ts`); nothing here
 * stores "step done" flags.
 */

export type WorkspaceOnboardingInterface = {
  /**
   * When an owner or admin dismissed the checklist for this workspace, as an
   * ISO string, or `null` while it is still showing.
   */
  readonly dismissedAt: Effect.Effect<
    string | null,
    CapabilityUnavailable,
    WorkspaceContext
  >
  /**
   * Whether the acting user has two-factor enabled on their account. `false`
   * with no actor in context (a trusted server-side read has no account to
   * ask about).
   */
  readonly actorTwoFactorEnabled: Effect.Effect<
    boolean,
    CapabilityUnavailable,
    WorkspaceContext
  >
  /**
   * Dismisses the checklist for the workspace and records
   * `workspace.onboarding_dismissed`. Idempotent: resolves `false` — and writes
   * no audit event — when the workspace had already dismissed it.
   */
  readonly dismiss: Effect.Effect<boolean, CapabilityUnavailable, WorkspaceContext>
}

export class WorkspaceOnboarding extends Context.Service<
  WorkspaceOnboarding,
  WorkspaceOnboardingInterface
>()('@b2b-saas-starter/capabilities/WorkspaceOnboarding') {}

// ---------------------------------------------------------------------------
// Seed layer
// ---------------------------------------------------------------------------

export type SeedWorkspaceOnboardingOptions = {
  /** User ids whose fixture account has two-factor enabled. */
  readonly twoFactorUserIds?: ReadonlyArray<string> | undefined
  /** Workspaces whose checklist starts dismissed, keyed by workspace id. */
  readonly dismissedAt?: ReadonlyMap<string, string> | undefined
}

export function SeedWorkspaceOnboarding(
  options: SeedWorkspaceOnboardingOptions = {}
): Layer.Layer<WorkspaceOnboarding, never, AuditEventLog> {
  return Layer.effect(WorkspaceOnboarding)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const twoFactorUserIds = new Set(options.twoFactorUserIds ?? [])
      // Mutable, so a dismissal reads back within the same layer — the same
      // read-your-write shape Live gets from the row.
      const dismissals = yield* Ref.make<ReadonlyMap<string, string>>(
        new Map(options.dismissedAt ?? [])
      )

      return {
        dismissedAt: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const map = yield* Ref.get(dismissals)
          return map.get(ctx.workspace.id) ?? null
        }),
        actorTwoFactorEnabled: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return ctx.actor !== null && twoFactorUserIds.has(ctx.actor.userId)
        }),
        dismiss: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const current = yield* Ref.get(dismissals)
          if (current.has(ctx.workspace.id)) {
            return false
          }
          const now = yield* DateTime.now
          yield* Ref.update(dismissals, (map) => {
            const next = new Map(map)
            next.set(ctx.workspace.id, DateTime.formatIso(now))
            return next
          })
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            eventType: 'workspace.onboarding_dismissed',
            targetType: 'workspace',
            targetId: ctx.workspace.id,
            metadata: {}
          })
          return true
        })
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

const unavailable = orUnavailable('workspace-onboarding')

export const LiveWorkspaceOnboarding: Layer.Layer<
  WorkspaceOnboarding,
  never,
  Database | RawD1 | AuditEventLog
> = Layer.effect(WorkspaceOnboarding)(
  Effect.gen(function* () {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })

    /** `null` when the checklist is still showing; the column is nullable. */
    function readDismissedAt(
      workspaceId: string
    ): Effect.Effect<Date | null, CapabilityUnavailable> {
      return unavailable(
        db
          .select({ dismissedAt: workspaces.onboardingDismissedAt })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1)
      ).pipe(Effect.map((rows) => rows[0]?.dismissedAt ?? null))
    }

    return {
      dismissedAt: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const dismissedAt = yield* readDismissedAt(ctx.workspace.id)
        if (dismissedAt === null) {
          return null
        }
        return dismissedAt.toISOString()
      }),
      actorTwoFactorEnabled: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        if (ctx.actor === null) {
          return false
        }
        const rows = yield* unavailable(
          db
            .select({ enabled: user.twoFactorEnabled })
            .from(user)
            .where(eq(user.id, ctx.actor.userId))
            .limit(1)
        )
        return rows[0]?.enabled ?? false
      }),
      dismiss: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const now = yield* DateTime.now
        // The pre-check is "still showing": an already-dismissed workspace
        // matches nothing, so neither the update nor the audit row is written.
        return yield* auditedMutation({
          matched: readDismissedAt(ctx.workspace.id).pipe(
            Effect.map((dismissedAt) => dismissedAt === null)
          ),
          auditEvent: {
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            eventType: 'workspace.onboarding_dismissed',
            targetType: 'workspace',
            targetId: ctx.workspace.id,
            metadata: {}
          },
          write: () =>
            db
              .update(workspaces)
              .set({ onboardingDismissedAt: DateTime.toDate(now) })
              .where(
                and(
                  eq(workspaces.id, ctx.workspace.id),
                  isNull(workspaces.onboardingDismissedAt)
                )
              )
        })
      })
    }
  })
)
