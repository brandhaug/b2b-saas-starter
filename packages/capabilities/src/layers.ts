import { type Database, layerFromD1 } from '@b2b-saas-starter/db/src/service.ts'
import { Effect, Layer } from 'effect'

// developer-platform
import {
  type ApiTokenRegistry,
  LiveApiTokenRegistry,
  SeedApiTokenRegistry
} from './developer-platform/api-token-registry.ts'
import {
  LiveWebhookEndpoints,
  SeedWebhookEndpoints,
  type WebhookEndpoints
} from './developer-platform/webhook-endpoints.ts'
import {
  LiveWebhookPublisher,
  SeedWebhookPublisher,
  type WebhookPublisher,
  type WebhookQueueBinding
} from './developer-platform/webhook-publisher.ts'

// governance
import {
  type AuditEventLog,
  LiveAuditEventLog,
  SeedAuditEventLog
} from './governance/audit-event-log.ts'
import {
  LiveWorkspaceInvitations,
  SeedWorkspaceInvitations,
  type WorkspaceInvitationBinding,
  type WorkspaceInvitations
} from './governance/workspace-invitations.ts'
import {
  LivePlanEntitlements,
  SeedPlanEntitlements,
  type PlanEntitlements
} from './governance/plan-entitlements.ts'
import {
  LiveWorkspaceMembership,
  makeSeedRoster,
  SeedWorkspaceMembership,
  type WorkspaceMemberBinding,
  type WorkspaceMembership
} from './governance/workspace-membership.ts'
import {
  LiveWorkspaceLifecycle,
  SeedWorkspaceLifecycle,
  type WorkspaceLifecycle,
  type WorkspaceLifecycleBinding
} from './governance/workspace-lifecycle.ts'

// notifications
import {
  LiveNotificationFeed,
  type NotificationFeed,
  SeedNotificationFeed
} from './notifications/notification-feed.ts'

import {
  seedApiTokens,
  seedAuditEvents,
  seedMembers,
  seedNotifications,
  seedWebhookEndpoints,
  seedWorkspaceRecord
} from './seed-fixture.ts'

export type CapabilityServices =
  | ApiTokenRegistry
  | AuditEventLog
  | NotificationFeed
  | PlanEntitlements
  | WebhookEndpoints
  | WebhookPublisher
  | WorkspaceInvitations
  | WorkspaceLifecycle
  | WorkspaceMembership

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

/**
 * Membership and invitations share one fixture roster, because accepting an
 * invitation adds a member: built independently, the two adapters would
 * disagree about who is in the workspace. Live needs no equivalent — the
 * plugin owns both writes, and both read back from the same tables.
 */
/**
 * The fixture entitlements the demo workspace runs on: its own plan id and the
 * fixture counts every seed mutation gate reads. Built once and provided into
 * every gated seed adapter, so they and the settings-page read agree about
 * usage.
 */
const seedPlanEntitlements = SeedPlanEntitlements({
  planId: seedWorkspaceRecord.planId,
  apiTokens: seedApiTokens.length,
  webhookEndpoints: seedWebhookEndpoints.length,
  members: seedMembers.length
})

const SeedGovernance = Layer.unwrap(
  Effect.gen(function* () {
    const roster = yield* makeSeedRoster(seedMembers)
    return Layer.mergeAll(
      SeedWorkspaceInvitations({ roster, workspace: seedWorkspaceRecord }),
      SeedWorkspaceMembership(roster, seedWorkspaceRecord),
      SeedWorkspaceLifecycle({ roster, workspace: seedWorkspaceRecord })
    )
  })
)

export const SeedLayer: CapabilitiesLayer = Layer.merge(
  Layer.mergeAll(
    SeedApiTokenRegistry(seedApiTokens),
    SeedAuditEventLog(seedAuditEvents),
    SeedNotificationFeed(seedNotifications),
    SeedWebhookEndpoints(seedWebhookEndpoints),
    SeedWebhookPublisher,
    SeedGovernance
  ),
  // Merged for direct consumers (the settings-page read) and provided into the
  // gated adapters above, so one instance answers both roles.
  seedPlanEntitlements
).pipe(Layer.provide(seedPlanEntitlements))

export type LiveCapabilitiesOptions = {
  readonly webhookQueue?: WebhookQueueBinding | undefined
  /**
   * Adapter onto the organization plugin's member endpoints. Absent, membership
   * reads still work and mutations fail `CapabilityUnavailable` — the same
   * provider-light posture `webhookQueue` takes (CLAUDE.md rule 3).
   */
  readonly memberBinding?: WorkspaceMemberBinding | undefined
  /**
   * Adapter onto the organization plugin's invitation endpoints. Absent,
   * invitation reads still work and mutations fail `CapabilityUnavailable`.
   */
  readonly invitationBinding?: WorkspaceInvitationBinding | undefined
  /**
   * Adapter onto the organization plugin's workspace lifecycle endpoints
   * (create, rename, delete). Only create runs headerless; the other two need
   * the request's session headers, so the app supplies this per call.
   *
   * Absent, workspace reads work and lifecycle mutations fail
   * `CapabilityUnavailable`.
   */
  readonly lifecycleBinding?: WorkspaceLifecycleBinding | undefined
}

export function makeLiveCapabilitiesLayer(
  options: LiveCapabilitiesOptions = {}
): Layer.Layer<CapabilityServices, never, Database> {
  // The entitlements service backs every plan-gated mutation seam, so one
  // instance is provided into each of them (the same shape the audit log uses).
  const liveEntitlements = LivePlanEntitlements
  return Layer.mergeAll(
    LiveApiTokenRegistry.pipe(
      Layer.provide(Layer.merge(LiveAuditEventLog, liveEntitlements))
    ),
    LiveAuditEventLog,
    LiveNotificationFeed,
    LiveWebhookEndpoints.pipe(
      Layer.provide(Layer.merge(LiveAuditEventLog, liveEntitlements))
    ),
    LiveWebhookPublisher(options.webhookQueue),
    LiveWorkspaceInvitations(options.invitationBinding).pipe(
      Layer.provide(Layer.mergeAll(LiveAuditEventLog, liveEntitlements))
    ),
    LiveWorkspaceMembership(options.memberBinding).pipe(
      Layer.provide(LiveAuditEventLog)
    ),
    LiveWorkspaceLifecycle(options.lifecycleBinding).pipe(
      Layer.provide(LiveAuditEventLog)
    ),
    liveEntitlements
  )
}

/**
 * Exported at module level for `runtime.ts` only — not re-exported from the
 * package index. Consumers select layers through `selectCapabilitiesLayer` /
 * `selectWorkspaceLayer`.
 */
export function makeLiveLayerFromD1(
  d1: Parameters<typeof layerFromD1>[0],
  options?: LiveCapabilitiesOptions
) {
  return makeLiveCapabilitiesLayer(options).pipe(Layer.provide(layerFromD1(d1)))
}
