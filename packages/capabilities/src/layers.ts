import { type Database, type RawD1, layerFromD1 } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'

// developer-platform
import { LiveApiTokenRegistry } from './developer-platform/api-token-registry.live.ts'
import { SeedApiTokenRegistry } from './developer-platform/api-token-registry.seed.ts'
import { type ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import { LiveWebhookEndpoints } from './developer-platform/webhook-endpoints.live.ts'
import { SeedWebhookEndpoints } from './developer-platform/webhook-endpoints.seed.ts'
import { type WebhookEndpoints } from './developer-platform/webhook-endpoints.ts'
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
import { LiveWorkspaceInvitations } from './governance/workspace-invitations.live.ts'
import { SeedWorkspaceInvitations } from './governance/workspace-invitations.seed.ts'
import {
  type WorkspaceInvitationBinding,
  type WorkspaceInvitations
} from './governance/workspace-invitations.ts'
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
import {
  LiveWorkspaceOnboarding,
  SeedWorkspaceOnboarding,
  type WorkspaceOnboarding
} from './governance/workspace-onboarding.ts'
import {
  LivePlatformUserAdmin,
  SeedPlatformUserAdmin,
  type PlatformUserAdmin,
  type PlatformUserAdminBinding
} from './governance/platform-user-admin.ts'

// billing
import {
  type Billing,
  LiveBilling,
  SeedBilling,
  type LiveBillingOptions
} from './billing/billing.ts'

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
  seedSystemUsers,
  seedTwoFactorUserIds,
  seedUserAdminMemberships,
  seedWebhookEndpoints,
  seedWorkspaceRecord
} from './seed-fixture.ts'

export type CapabilityServices =
  | ApiTokenRegistry
  | AuditEventLog
  | Billing
  | NotificationFeed
  | PlatformUserAdmin
  | WebhookEndpoints
  | WebhookPublisher
  | WorkspaceInvitations
  | WorkspaceLifecycle
  | WorkspaceMembership
  | WorkspaceOnboarding

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

/**
 * Membership and invitations share one fixture roster, because accepting an
 * invitation adds a member: built independently, the two adapters would
 * disagree about who is in the workspace. Live needs no equivalent — the
 * plugin owns both writes, and both read back from the same tables.
 */
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

/**
 * One fixture audit-log instance, shared by the Seed adapters that write
 * audit events below their interface — separate instances would each hold a
 * private store and recorded events would not read back.
 */
const SeedAuditLog = SeedAuditEventLog(seedAuditEvents, seedSystemUsers)

/**
 * Billing rides the governance seed so its audit writes land in the same
 * fixture log every other capability reads.
 */
const SeedBillingLayer = SeedBilling().pipe(Layer.provide(SeedAuditLog))

/**
 * One fixture notification feed, for the same reason as `SeedAuditLog`: the
 * user-admin seed writes `notifyUser` rows into it, and the feed the shell
 * reads has to be the very instance they landed in.
 */
const SeedNotifications = SeedNotificationFeed(seedNotifications)

export const SeedLayer: CapabilitiesLayer = Layer.mergeAll(
  // The mutating developer-platform capabilities write audit events and fan
  // out webhooks below their interface; the shared fixture audit log and the
  // no-op Seed publisher are provided once on the merged layer so every member
  // sees the same instances.
  SeedApiTokenRegistry(seedApiTokens),
  SeedAuditLog,
  SeedBillingLayer,
  SeedNotifications,
  SeedWebhookEndpoints(seedWebhookEndpoints),
  SeedWebhookPublisher,
  SeedGovernance,
  SeedPlatformUserAdmin(seedSystemUsers, seedUserAdminMemberships),
  SeedWorkspaceOnboarding({ twoFactorUserIds: seedTwoFactorUserIds })
).pipe(
  Layer.provide(SeedAuditLog),
  Layer.provide(SeedNotifications),
  Layer.provide(SeedWebhookPublisher)
)

export type LiveCapabilitiesOptions = {
  readonly webhookQueue?: WebhookQueueBinding | undefined
  /**
   * Stripe checkout configuration (`STRIPE_SECRET_KEY` plus per-plan price
   * ids). Absent, checkout fails `provider_not_configured` and every other
   * surface keeps working — the same provider-light posture `webhookQueue`
   * takes (CLAUDE.md rule 3).
   */
  readonly billing?: LiveBillingOptions | undefined
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
  /**
   * Adapter onto the admin plugin's user endpoints plus one organization-plugin
   * member call. Absent, `/admin` reads work and its mutations fail
   * `CapabilityUnavailable`.
   */
  readonly userAdminBinding?: PlatformUserAdminBinding | undefined
}

export function makeLiveCapabilitiesLayer(
  options: LiveCapabilitiesOptions = {}
): Layer.Layer<CapabilityServices, never, Database | RawD1> {
  // One instance each: `LiveWebhookPublisher(options.webhookQueue)` called at
  // each use site would build distinct layers (Effect does not unify them), so
  // both the fan-out consumers and the merged layer share this value.
  const publisher = LiveWebhookPublisher(options.webhookQueue)
  return Layer.mergeAll(
    LiveApiTokenRegistry,
    LiveAuditEventLog,
    LiveBilling(options.billing),
    LiveNotificationFeed,
    LiveWebhookEndpoints,
    publisher,
    LiveWorkspaceInvitations(options.invitationBinding),
    LiveWorkspaceMembership(options.memberBinding),
    LiveWorkspaceLifecycle(options.lifecycleBinding),
    LivePlatformUserAdmin(options.userAdminBinding),
    LiveWorkspaceOnboarding
  ).pipe(
    Layer.provide(LiveAuditEventLog),
    // The user-admin capability notifies the impersonated user below its
    // interface, so the feed is provided to the merged layer like the audit log.
    Layer.provide(LiveNotificationFeed),
    Layer.provide(publisher)
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
