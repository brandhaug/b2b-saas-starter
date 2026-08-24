import {
  apiTokens,
  webhookEndpoints,
  workspaceMembers
} from '@b2b-saas-starter/db/src/schema.ts'
import { Database } from '@b2b-saas-starter/db/src/service.ts'
import { Context, Effect, Layer } from 'effect'
import { and, count, eq, isNull } from 'drizzle-orm'

import { type CapabilityUnavailable, EntitlementExceeded } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/**
 * The plans the starter ships. Billing itself stays env-gated future work
 * (ADR 0023) — this module owns only what a plan entitles a workspace to, so
 * enforcement does not have to wait on a payment provider.
 */
// oxlint-disable-next-line effect/noAs -- `as const` on a literal tuple: the PlanId union is derived from it.
export const PLAN_IDS = ['starter', 'pro'] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** The countable resources a plan caps. */
// oxlint-disable-next-line effect/noAs -- `as const` on a literal tuple: the EntitlementResource union is derived from it.
export const ENTITLEMENT_RESOURCES = [
  'api_tokens',
  'webhook_endpoints',
  'members'
] as const
export type EntitlementResource = (typeof ENTITLEMENT_RESOURCES)[number]

/** Named owner contract for one workspace's per-resource usage counts. */
export type UsageCounts = Record<EntitlementResource, number>

/**
 * The entitlement table itself. Data, not code: adding a plan or changing a
 * limit is an edit to this record, never a new branch in an adapter. Both
 * adapters read their limits through `limitFor`, so Seed and Live cannot drift.
 */
export const PLANS = {
  starter: {
    api_tokens: 5,
    webhook_endpoints: 3,
    members: 5
  },
  pro: {
    api_tokens: 50,
    webhook_endpoints: 25,
    members: 50
  }
} satisfies Record<PlanId, Record<EntitlementResource, number>>

/**
 * The limit one plan sets for one resource.
 *
 * An unknown plan id — a row written by a future tier this build does not know
 * (`seed-fixture.ts`'s demo workspace carries `'team'` for exactly this
 * reason) — fails closed to the most restrictive plan's limits rather than
 * throwing or granting unlimited. A workspace can only lose headroom by an
 * unknown id, never gain it.
 */
export function limitFor(planId: string, resource: EntitlementResource): number {
  // A plain scan instead of an indexed read: a string key cannot narrow into
  // the PlanId union without an assertion, and one line of loop beats one.
  for (const [id, limits] of Object.entries(PLANS)) {
    if (id === planId) return limits[resource]
  }
  // Unknown plan ids fail closed to the most restrictive plan.
  return PLANS.starter[resource]
}

/** One resource's standing for the current workspace, as callers see it. */
export type UsageSnapshot = {
  readonly planId: string
  readonly resource: EntitlementResource
  readonly used: number
  readonly limit: number
}

export type PlanEntitlementsInterface = {
  /**
   * The one enforcement seam: resolves the current usage of `resource` and
   * fails typed when the workspace is already at its plan's limit. Mutation
   * seams call this before writing; nothing else about the plan leaks through.
   */
  readonly checkLimit: (
    resource: EntitlementResource
  ) => Effect.Effect<
    UsageSnapshot,
    EntitlementExceeded | CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Every resource's snapshot, without the refusal — this is the settings-page
   * read. It succeeds at and over a limit; saying so is the point.
   */
  readonly usage: Effect.Effect<
    readonly UsageSnapshot[],
    CapabilityUnavailable,
    WorkspaceContext
  >
}

export class PlanEntitlements extends Context.Service<
  PlanEntitlements,
  PlanEntitlementsInterface
>()('@b2b-saas-starter/capabilities/PlanEntitlements') {}

/**
 * Pure decision both adapters enforce identically: the snapshot is over the
 * line exactly when usage has reached the limit. Exported so tests can pin the
 * boundary without planting rows at every offset around it.
 */
export function isAtLimit(snapshot: UsageSnapshot): boolean {
  return snapshot.used >= snapshot.limit
}

function snapshotsFor(planId: string, used: UsageCounts): UsageSnapshot[] {
  return ENTITLEMENT_RESOURCES.map((resource) => ({
    planId,
    resource,
    used: used[resource],
    limit: limitFor(planId, resource)
  }))
}

/**
 * In-memory counts for local dev, Storybook, and tests. Counts arrive as plain
 * numbers rather than fixture arrays because entitlements read only how many —
 * the same reason Live runs `count()` queries instead of selecting rows.
 */
export function SeedPlanEntitlements(counts: {
  /** The fixture workspace whose `planId` names the plan. */
  readonly planId: string
  readonly apiTokens: number
  readonly webhookEndpoints: number
  readonly members: number
}): Layer.Layer<PlanEntitlements> {
  const used = {
    api_tokens: counts.apiTokens,
    webhook_endpoints: counts.webhookEndpoints,
    members: counts.members
  } satisfies UsageCounts
  const snapshots = snapshotsFor(counts.planId, used)
  return Layer.succeed(PlanEntitlements)({
    checkLimit: (resource) =>
      Effect.suspend(() => {
        const snapshot = snapshots.find((each) => each.resource === resource)
        if (!snapshot || isAtLimit(snapshot)) {
          const limit = limitFor(counts.planId, resource)
          return Effect.fail(
            new EntitlementExceeded({ resource, limit, planId: counts.planId })
          )
        }
        return Effect.succeed(snapshot)
      }),
    usage: Effect.succeed(snapshots)
  })
}

const unavailable = orUnavailable('plan-entitlements')

export const LivePlanEntitlements: Layer.Layer<PlanEntitlements, never, Database> =
  Layer.effect(PlanEntitlements)(
    Effect.gen(function* () {
      const db = yield* Database

      function countInWorkspace(
        workspaceId: string
      ): Effect.Effect<UsageCounts, CapabilityUnavailable> {
        return Effect.gen(function* () {
          const [tokenRows, endpointRows, memberRows] = yield* Effect.all(
            [
              unavailable(
                db
                  .select({ total: count() })
                  .from(apiTokens)
                  .where(
                    and(
                      eq(apiTokens.workspaceId, workspaceId),
                      isNull(apiTokens.revokedAt)
                    )
                  )
              ),
              unavailable(
                db
                  .select({ total: count() })
                  .from(webhookEndpoints)
                  .where(eq(webhookEndpoints.workspaceId, workspaceId))
              ),
              unavailable(
                db
                  .select({ total: count() })
                  .from(workspaceMembers)
                  .where(eq(workspaceMembers.workspaceId, workspaceId))
              )
            ],
            { concurrency: 'unbounded' }
          )
          return {
            api_tokens: tokenRows[0]?.total ?? 0,
            webhook_endpoints: endpointRows[0]?.total ?? 0,
            members: memberRows[0]?.total ?? 0
          }
        })
      }

      return {
        checkLimit: (resource) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const planId = ctx.workspace.planId
            const used = yield* countInWorkspace(ctx.workspace.id)
            const snapshot = snapshotsFor(planId, used).find(
              (each) => each.resource === resource
            )
            if (!snapshot || isAtLimit(snapshot)) {
              return yield* Effect.fail(
                new EntitlementExceeded({
                  resource,
                  limit: limitFor(planId, resource),
                  planId
                })
              )
            }
            return snapshot
          }),
        usage: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const used = yield* countInWorkspace(ctx.workspace.id)
          return snapshotsFor(ctx.workspace.planId, used)
        })
      }
    })
  )
