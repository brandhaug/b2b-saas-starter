import { Effect, Layer } from 'effect'
import { Billing } from './billing/billing.ts'
import { STARTER_PLAN } from './billing/plan-catalog.ts'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from './developer-platform/webhook-endpoints.ts'
import { type Workspace } from './governance/workspace-identity.ts'
import { WorkspaceMembership } from './governance/workspace-membership.ts'
import { WorkspaceOnboarding } from './governance/workspace-onboarding.ts'
import { literalTuple } from './internal/literal-tuple.ts'
import {
  NotificationFeed,
  type Notification
} from './notifications/notification-feed.ts'
import { type CapabilityUnavailable } from './errors.ts'
import { memberToActor, WorkspaceContext } from './workspace-context.ts'

/**
 * Named read projections over the per-capability services.
 *
 * These are pure compositions — no Seed/Live adapters of their own (that
 * god-object shape was removed by ADR 0044). They exist so the web loaders
 * and the REST/MCP Capability Interfaces assemble the same aggregates from
 * one place: pre-computed counts and scores ship with the data instead of
 * being re-derived in route handlers and UI components.
 */

export type WorkspaceOverviewProjection = {
  readonly workspace: Workspace
  readonly notifications: ReadonlyArray<Notification>
}

/**
 * The workspace overview served by the REST `overview` endpoint (matches
 * `WorkspaceOverviewDto` in `@b2b-saas-starter/api`) and embedded in the
 * dashboard projection below.
 */
export const workspaceOverview: Effect.Effect<
  WorkspaceOverviewProjection,
  CapabilityUnavailable,
  WorkspaceContext | NotificationFeed
> = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const feed = yield* NotificationFeed
  const notifications = yield* feed.list
  return {
    workspace: ctx.workspace,
    notifications
  }
})

export type WorkspaceDashboardProjection = WorkspaceOverviewProjection & {
  readonly unreadCount: number
}

/**
 * Everything the workspace dashboard renders under one permission, aggregates
 * pre-computed. `notification:read` covers all of it.
 *
 * Webhook endpoints are deliberately NOT here: `webhook:list` is a separate
 * permission a `member` does not hold, and a projection cannot check
 * authorization (see this package's intent node). The caller reads them as its
 * own segment and drops the segment when the actor may not have it — see
 * `apps/web/src/lib/server/workspace-dashboard.ts`. Folding them back in would
 * mean the read runs for every actor and the numbers ship in the page payload.
 */
export const workspaceDashboard: Effect.Effect<
  WorkspaceDashboardProjection,
  CapabilityUnavailable,
  WorkspaceContext | NotificationFeed
> = workspaceOverview.pipe(
  Effect.map((overview) => ({
    ...overview,
    unreadCount: overview.notifications.filter((notification) => !notification.read)
      .length
  }))
)

export type WorkspaceListItemProjection = {
  readonly workspace: Workspace
  readonly memberCount: number
  readonly notificationCount: number
}

/**
 * "My workspaces": every workspace the user is a member of, with the counts
 * the workspace list page renders. Possibly empty — no `WorkspaceNotFound`
 * here; a user with no memberships gets `[]`, not an error. Unlike the other
 * projections this takes no ambient `WorkspaceContext`: it resolves the
 * user's memberships first and scopes each per-workspace read itself, using
 * the membership row the query already proved as the actor.
 */
export function listWorkspacesForUser(
  userId: string
): Effect.Effect<
  ReadonlyArray<WorkspaceListItemProjection>,
  CapabilityUnavailable,
  WorkspaceMembership | NotificationFeed
> {
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    const feed = yield* NotificationFeed
    const memberships = yield* membership.listWorkspacesForUser(userId)
    return yield* Effect.forEach(
      memberships,
      ({ workspace, member }) =>
        Effect.all([membership.listMembers, feed.list], {
          concurrency: 'unbounded'
        }).pipe(
          Effect.map(([members, notifications]) => ({
            workspace,
            memberCount: members.length,
            notificationCount: notifications.length
          })),
          Effect.provide(
            Layer.succeed(WorkspaceContext)({
              workspace,
              actor: memberToActor(member)
            })
          )
        ),
      { concurrency: 'unbounded' }
    )
  })
}

/**
 * The onboarding checklist steps, in display order. Labels and links are the
 * UI's — this is the vocabulary, the way the audit taxonomy is.
 */
export const WORKSPACE_PROGRESS_STEPS = literalTuple(
  'invite_member',
  'create_api_token',
  'add_webhook_endpoint',
  'enable_two_factor',
  'choose_plan'
)

export type WorkspaceProgressStepId = (typeof WORKSPACE_PROGRESS_STEPS)[number]

export type WorkspaceProgressStep = {
  readonly id: WorkspaceProgressStepId
  readonly complete: boolean
}

export type WorkspaceProgressProjection = {
  /** The steps the caller may see, in display order. Never empty. */
  readonly steps: ReadonlyArray<WorkspaceProgressStep>
  readonly completedCount: number
  readonly totalCount: number
  /** When an owner or admin dismissed the checklist, or `null` while it shows. */
  readonly dismissedAt: string | null
}

export type WorkspaceProgressOptions = {
  /**
   * Whether to read (and therefore show) the API-token and webhook steps.
   * Those two reads sit behind `apiToken:list` and `webhook:list`, which a
   * `member` does not hold, and a projection cannot check authorization — so
   * the caller decides, the way `whenPermitted` does for a segment. `false`
   * skips the reads: the steps are absent from the result, not hidden later.
   */
  readonly developerPlatform: boolean
}

/** The list's length, or `null` when the caller may not read the list at all. */
function countWhen<E, R>(
  permitted: boolean,
  list: Effect.Effect<ReadonlyArray<unknown>, E, R>
): Effect.Effect<number | null, E, R> {
  if (!permitted) {
    return Effect.succeed(null)
  }
  return Effect.map(list, (items) => items.length)
}

/**
 * The workspace onboarding checklist, computed live on every read: a step is
 * complete when the owning capability says the thing exists — more than one
 * Member, at least one API Token, at least one Webhook Endpoint, two-factor on
 * the actor's account, a plan other than the free one. No step is stored, so
 * revoking the last token reopens its step. Billing's step appears only when
 * the provider is configured (`Billing.configured`); an unconfigured deploy
 * cannot choose a plan, so it is not asked to.
 */
export function workspaceProgress(
  options: WorkspaceProgressOptions
): Effect.Effect<
  WorkspaceProgressProjection,
  CapabilityUnavailable,
  | WorkspaceContext
  | WorkspaceMembership
  | ApiTokenRegistry
  | WebhookEndpoints
  | Billing
  | WorkspaceOnboarding
> {
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    const tokens = yield* ApiTokenRegistry
    const webhooks = yield* WebhookEndpoints
    const billing = yield* Billing
    const onboarding = yield* WorkspaceOnboarding

    const facts = yield* Effect.all(
      {
        members: membership.listMembers,
        tokenCount: countWhen(options.developerPlatform, tokens.list),
        webhookCount: countWhen(options.developerPlatform, webhooks.list),
        billingConfigured: billing.configured,
        plan: billing.currentPlan,
        twoFactor: onboarding.actorTwoFactorEnabled,
        dismissedAt: onboarding.dismissedAt
      },
      { concurrency: 'unbounded' }
    )

    const steps: Array<WorkspaceProgressStep> = [
      { id: 'invite_member', complete: facts.members.length > 1 }
    ]
    if (facts.tokenCount !== null) {
      steps.push({ id: 'create_api_token', complete: facts.tokenCount > 0 })
    }
    if (facts.webhookCount !== null) {
      steps.push({ id: 'add_webhook_endpoint', complete: facts.webhookCount > 0 })
    }
    steps.push({ id: 'enable_two_factor', complete: facts.twoFactor })
    if (facts.billingConfigured) {
      steps.push({ id: 'choose_plan', complete: facts.plan.id !== STARTER_PLAN.id })
    }

    return {
      steps,
      completedCount: steps.filter((step) => step.complete).length,
      totalCount: steps.length,
      dismissedAt: facts.dismissedAt
    }
  })
}
