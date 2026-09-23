import {
  AssistantTaskEvidenceLayer,
  type AssistantTaskEvidence
} from './developer-platform/assistant-task-evidence.ts'
import {
  type ConversationModel,
  selectConversationModelLayer
} from '@b2b-saas-starter/ai/conversation'
import { makeSeedAssistantConversationHost } from './developer-platform/assistant-conversations.seed.ts'
import {
  type AssistantConversations,
  AssistantConversationsLayer
} from './developer-platform/assistant-conversations.ts'
import { type AssistantConversationTransport } from './developer-platform/assistant-conversation-transport.ts'
import {
  type AssistantAuthority,
  LiveAssistantAuthority,
  SeedAssistantAuthority,
  type AssistantAuthorityState
} from './developer-platform/assistant-authority.ts'
import {
  type AssistantDirectory,
  type ConversationInvalidationBinding
} from './assistant/directory.ts'
import { SeedAssistantDirectory } from './assistant/directory.seed.ts'
import { LiveAssistantDirectory } from './assistant/directory.live.ts'
import { type AssistantAdmission } from './assistant/admission.ts'
import { SeedAssistantAdmission } from './assistant/admission.seed.ts'
import { LiveAssistantAdmission } from './assistant/admission.live.ts'
import {
  AssistantConversationLifecycleLayer,
  type AssistantConversationLifecycle,
  type AssistantLifecycleBinding
} from './assistant/lifecycle.ts'
import { type WebhookInvestigationTasks } from './developer-platform/webhook-investigation-tasks.ts'
import { SeedWebhookInvestigationTasks } from './developer-platform/webhook-investigation-tasks.seed.ts'
import { LiveWebhookInvestigationTasks } from './developer-platform/webhook-investigation-tasks.live.ts'
import {
  BillingAuditLayer,
  BillingNotificationLayer,
  BillingWebhookLayer
} from './billing-adapters.ts'
import { type Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Clock, DateTime, Effect, Layer, Ref } from 'effect'
import { type EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { SeedEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.seed'
import { LiveEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.live'

// developer-platform
import { LiveApiTokenRegistry } from './developer-platform/api-token-registry.live.ts'
import { SeedApiTokenRegistry } from './developer-platform/api-token-registry.seed.ts'
import { type ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import { LiveMcpClientConnections } from './developer-platform/mcp-client-connections.live.ts'
import { SeedMcpClientConnections } from './developer-platform/mcp-client-connections.seed.ts'
import { type McpClientConnections } from './developer-platform/mcp-client-connections.ts'
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
import { type Workspace } from './governance/workspace-identity.ts'
import {
  type AccountLifecycle,
  type AccountLifecycleBinding
} from './governance/account-lifecycle.ts'
import {
  type AccountPreferencesService,
  LiveAccountPreferences,
  SeedAccountPreferences
} from './governance/account-preferences.ts'
import { SeedAccountLifecycle } from './governance/account-lifecycle.seed.ts'
import { LiveAccountLifecycle } from './governance/account-lifecycle.live.ts'
import { type AuditEventLog, SeedAuditEventLog } from './governance/audit-event-log.ts'
import { LiveAuditEventLog } from './governance/audit-event-log.live.ts'
import { LiveWorkspaceInvitations } from './governance/workspace-invitations.live.ts'
import { SeedWorkspaceInvitations } from './governance/workspace-invitations.seed.ts'
import {
  type WorkspaceInvitationBinding,
  type WorkspaceInvitations
} from './governance/workspace-invitations.ts'
import {
  makeSeedRoster,
  SeedWorkspaceMembership,
  type WorkspaceMemberBinding,
  type WorkspaceMembership
} from './governance/workspace-membership.ts'
import { LiveWorkspaceMembership } from './governance/workspace-membership.live.ts'
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
import { type SecurityEvidenceSink } from './governance/security-recovery-evidence.ts'
import {
  LiveStrongAuthentication,
  SeedStrongAuthentication,
  type StrongAuthentication
} from './governance/strong-authentication.ts'
import { type Retention } from './governance/retention.ts'
import { LiveRetention } from './governance/retention.live.ts'
import { SeedRetention } from './governance/retention.seed.ts'
import {
  type PlatformUserAdmin,
  type PlatformUserAdminBinding
} from './governance/platform-user-admin.ts'
import { LivePlatformUserAdmin } from './governance/platform-user-admin.live.ts'
import { SeedPlatformUserAdmin } from './governance/platform-user-admin.seed.ts'
import {
  LiveWorkspaceExports,
  type LiveWorkspaceExportsOptions
} from './governance/workspace-export.live.ts'
import { SeedWorkspaceExports } from './governance/workspace-export.seed.ts'
import { type WorkspaceExports } from './governance/workspace-export.ts'
import { type PersonalDataExports } from './governance/personal-data-export.ts'
import { LivePersonalDataExports } from './governance/personal-data-export.live.ts'
import { SeedPersonalDataExports } from './governance/personal-data-export.seed.ts'
import { WorkspaceSuspensionService } from './governance/workspace-suspension.ts'
import { LiveWorkspaceSuspension } from './governance/workspace-suspension.live.ts'
import { SeedWorkspaceSuspension } from './governance/workspace-suspension.seed.ts'
import { LiveSsoConnections } from './governance/workspace-sso-connections.live.ts'
import { SeedSsoConnections } from './governance/workspace-sso-connections.seed.ts'
import {
  type SsoConnections,
  type WorkspaceSsoBinding
} from './governance/workspace-sso-connections.ts'

// billing
import { type Billing } from '@b2b-saas-starter/billing/billing'
import { type ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import { LiveResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements.live'
import { SeedResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements.seed'
import { type BillingOptions } from '@b2b-saas-starter/billing/billing-config'
import { LiveBilling } from '@b2b-saas-starter/billing/billing.live'
import { SeedBilling } from '@b2b-saas-starter/billing/billing.seed'
import {
  LiveSeatSyncPublisher,
  SeedSeatSyncPublisher,
  type SeatSyncPublisher,
  type SeatSyncQueueBinding
} from '@b2b-saas-starter/billing/seat-sync'

// notifications
import { type NotificationEmailQueueBinding } from './notifications/notification-email-queue.ts'
import { LiveNotificationFeed } from './notifications/notification-feed.live.ts'
import { SeedNotificationFeed } from './notifications/notification-feed.seed.ts'
import { type NotificationFeed } from './notifications/notification-feed.ts'
import {
  type NotificationEmailEligibility,
  layerWithoutDependencies as NotificationEmailEligibilityLayer
} from './notifications/notification-email-eligibility.ts'
import {
  LiveNotificationPreferences,
  type NotificationPreferences,
  SeedNotificationPreferences
} from './notifications/notification-preferences.ts'

import {
  seedApiTokens,
  seedAccountPreferences,
  seedAccountProfiles,
  seedPersonalAccountArtifacts,
  seedAuditEvents,
  seedDeliveries,
  seedDeliveryAttempts,
  seedMcpClientConnections,
  seedMcpClients,
  seedMembers,
  seedNotificationPreferences,
  seedNotifications,
  seedSsoConnections,
  seedSystemUsers,
  seedTwoFactorUserIds,
  seedUserAdminMemberships,
  seedWebhookEndpoints,
  seedWorkspaceExportFixture,
  seedWorkspaceRecord,
  demoUserIdentity,
  seedAssistantSessionId
} from './seed-fixture.ts'

export type CapabilityServices =
  | AssistantConversations
  | AssistantTaskEvidence
  | AssistantAuthority
  | AssistantDirectory
  | AssistantAdmission
  | AssistantConversationLifecycle
  | WebhookInvestigationTasks
  | EmailDelivery
  | AccountLifecycle
  | AccountPreferencesService
  | ApiTokenRegistry
  | AuditEventLog
  | Billing
  | ResourceEntitlements
  | McpClientConnections
  | NotificationFeed
  | NotificationEmailEligibility
  | NotificationPreferences
  | PlatformUserAdmin
  | SeatSyncPublisher
  | SsoConnections
  | WebhookEndpoints
  | WebhookPublisher
  | WorkspaceExports
  | PersonalDataExports
  | Retention
  | WorkspaceInvitations
  | WorkspaceLifecycle
  | WorkspaceMembership
  | WorkspaceOnboarding
  | WorkspaceSuspensionService
  | StrongAuthentication

export type CapabilitiesLayer = Layer.Layer<CapabilityServices>

/**
 * Membership, invitations, and billing share one fixture roster, because
 * accepting an invitation adds a member and `SeedBilling.syncSeats` counts it:
 * built independently, the adapters would disagree about who is in the
 * workspace. Live needs no equivalent — the plugin owns the member writes,
 * and billing counts them from D1.
 */
const SeedGovernance = Layer.unwrap(
  Effect.gen(function* () {
    const roster = yield* makeSeedRoster(seedMembers)
    const catalog = yield* Ref.make<ReadonlyArray<Workspace>>([seedWorkspaceRecord])
    const billingAdapters = Layer.merge(
      Layer.merge(
        BillingAuditLayer.pipe(Layer.provide(SeedAuditLog)),
        BillingNotificationLayer.pipe(Layer.provide(SeedNotifications))
      ),
      BillingWebhookLayer.pipe(Layer.provide(SeedWebhookPublisher))
    )
    const suspension = SeedWorkspaceSuspension({
      workspace: seedWorkspaceRecord,
      catalog,
      systemUsers: seedSystemUsers
    }).pipe(
      Layer.provide(SeedAuditLog),
      Layer.provide(SeedNotifications),
      Layer.provide(SeedAssistantDirectory)
    )
    const initializedAt = yield* Clock.currentTimeMillis
    const authority = SeedAssistantAuthority(undefined, (input) =>
      Effect.gen(function* () {
        if (
          input.credential.kind !== 'session' ||
          input.credential.sessionId !== seedAssistantSessionId ||
          input.credential.userId !== demoUserIdentity.id
        ) {
          return null
        }
        const members = yield* Ref.get(roster)
        const member = members.find(
          (candidate) => candidate.id === input.credential.userId
        )
        const workspaces = yield* Ref.get(catalog)
        const workspace = workspaces.find(
          (candidate) => candidate.id === input.workspaceId
        )
        if (!member || !workspace) {
          return null
        }
        const state = yield* (yield* WorkspaceSuspensionService).get(workspace.id)
        const proof = {
          expiresAt: DateTime.toDate(DateTime.makeUnsafe(initializedAt + 43_200_000)),
          impersonatedBy: null,
          passwordVerifiedAt: null,
          strongAuthAt: DateTime.toDate(DateTime.makeUnsafe(initializedAt)),
          strongAuthMethod: 'passkey',
          strongAuthCredentialId: 'seed-assistant-passkey',
          recoveryUntil: null
        }
        return {
          context: {
            workspace,
            actor: {
              userId: member.id,
              role: member.role,
              systemRole: member.systemRole
            },
            actorType: 'user'
          },
          banned: false,
          suspended: state.status === 'suspended',
          currentSession: proof,
          retainedSession: { ...proof, revokedAt: null },
          totpId: null,
          passkeyIds: ['seed-assistant-passkey'],
          grant: null
        } satisfies AssistantAuthorityState
      }).pipe(
        Effect.provide(suspension),
        Effect.catchTag('WorkspaceSuspended', () => Effect.succeed(null))
      )
    )
    return Layer.mergeAll(
      authority,
      // The account-lifecycle seed shares the roster so the ownership rule
      // reads the same membership state the membership and invitation seeds
      // write, and it writes its audit events into the shared fixture log
      // provided on the merged layer below.
      SeedAccountLifecycle({ roster, workspace: seedWorkspaceRecord }).pipe(
        Layer.provide(SeedAuditLog),
        Layer.provide(suspension),
        Layer.provide(SeedAssistantDirectory)
      ),
      SeedWorkspaceInvitations({ roster, workspace: seedWorkspaceRecord }),
      SeedWorkspaceMembership(roster, seedWorkspaceRecord).pipe(
        Layer.provide(SeedAssistantDirectory)
      ),
      SeedWorkspaceLifecycle({ roster, workspace: seedWorkspaceRecord, catalog }).pipe(
        Layer.provide(suspension),
        Layer.provide(SeedAssistantDirectory)
      ),
      /**
       * Billing rides the governance seed so its audit writes land in the
       * same fixture log every other capability reads, and its seat counts
       * read the same roster the membership adapters mutate.
       */
      SeedBilling({
        members: Ref.get(roster),
        workspacePlans: { [seedWorkspaceRecord.id]: seedWorkspaceRecord.planId }
      }).pipe(Layer.provide(billingAdapters)),
      billingAdapters,
      suspension
    )
  })
)

/**
 * One fixture audit-log instance, shared by the Seed adapters that write
 * audit events below their interface — separate instances would each hold a
 * private store and recorded events would not read back.
 */
const SeedAuditLog = SeedAuditEventLog(seedAuditEvents, seedSystemUsers)

const SeedAccountPrefs = SeedAccountPreferences(seedAccountPreferences).pipe(
  Layer.provide(SeedAuditLog)
)

/**
 * One fixture preference store + feed, shared for the same reason as
 * `SeedAuditLog`: the feed resolves channels against the same preference store
 * the `/account` page reads and writes, and the user-admin seed writes
 * `notifyUser` rows into the very feed instance the shell reads — the webhook
 * capability's dead-letter path writes through the same instance.
 */
const SeedPreferences = SeedNotificationPreferences(seedNotificationPreferences).pipe(
  Layer.provide(SeedAuditLog)
)

const SeedNotifications = Layer.merge(
  SeedPreferences,
  SeedNotificationFeed(seedNotifications, {
    workspace: seedWorkspaceRecord,
    members: seedMembers
  }).pipe(Layer.provide(Layer.merge(SeedPreferences, SeedAccountPrefs)))
)

const SeedEntitlements = SeedResourceEntitlements().pipe(
  Layer.provide(SeedGovernance),
  Layer.provide(SeedAuditLog)
)

const SeedCore = Layer.mergeAll(
  SeedAssistantDirectory,
  SeedAssistantAdmission.pipe(Layer.provide(SeedAssistantDirectory)),
  SeedRetention,
  SeedEmailDelivery(seedSystemUsers),
  // The mutating developer-platform capabilities write audit events and fan
  // out webhooks below their interface; the shared fixture audit log and the
  // no-op Seed publisher are provided once on the merged layer so every member
  // sees the same instances.
  SeedApiTokenRegistry(seedApiTokens).pipe(
    Layer.provide(SeedEntitlements),
    Layer.provide(SeedGovernance)
  ),
  SeedEntitlements,
  SeedAuditLog,
  SeedMcpClientConnections({
    clients: seedMcpClients,
    connections: seedMcpClientConnections
  }),
  SeedNotifications,
  SeedAccountPrefs,
  SeedSeatSyncPublisher,
  SeedSsoConnections(seedSsoConnections),
  SeedWebhookEndpoints(
    seedWebhookEndpoints,
    seedDeliveries,
    undefined,
    seedDeliveryAttempts
  ).pipe(Layer.provide(SeedEntitlements), Layer.provide(SeedGovernance)),
  SeedWebhookPublisher,
  SeedGovernance,
  SeedPlatformUserAdmin(seedSystemUsers, seedUserAdminMemberships),
  SeedWorkspaceOnboarding({ twoFactorUserIds: seedTwoFactorUserIds }),
  SeedStrongAuthentication
).pipe(
  Layer.provide(SeedAuditLog),
  Layer.provide(SeedNotifications),
  Layer.provide(SeedWebhookPublisher),
  Layer.provide(SeedSeatSyncPublisher)
)

/**
 * The export adapter reads every other capability to build its archive, so it
 * sits on top of the core seed rather than inside it. `SeedCore` is one layer
 * value, provided here and merged below: Effect memoizes it, so the archive is
 * built from the same instances the rest of the fixture serves.
 */
/** A synthetic model is opt-in for tests and demos; ordinary Seed never generates automatically. */
export function makeSeedCapabilitiesLayer(
  options: { readonly conversationModel?: Layer.Layer<ConversationModel> } = {}
): CapabilitiesLayer {
  const tasks = SeedWebhookInvestigationTasks.pipe(Layer.provide(SeedCore))
  const evidence = AssistantTaskEvidenceLayer.pipe(Layer.provide(tasks))
  const conversations = Layer.unwrap(
    Effect.gen(function* () {
      const host = yield* makeSeedAssistantConversationHost()
      return Layer.merge(
        AssistantConversationsLayer(host.transport),
        AssistantConversationLifecycleLayer(host.lifecycle)
      )
    })
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        SeedCore,
        tasks,
        evidence,
        options.conversationModel ?? selectConversationModelLayer({})
      )
    )
  )
  const core = Layer.merge(SeedCore, conversations)
  const exports = SeedWorkspaceExports({
    workspace: seedWorkspaceRecord,
    fixture: seedWorkspaceExportFixture
  }).pipe(Layer.provide(core))
  const personalExports = SeedPersonalDataExports(
    seedAccountProfiles,
    seedNotifications,
    seedWorkspaceRecord.id,
    seedPersonalAccountArtifacts
  ).pipe(Layer.provide(core))
  return Layer.mergeAll(
    core,
    tasks,
    evidence,
    exports,
    personalExports,
    NotificationEmailEligibilityLayer.pipe(Layer.provide(core))
  )
}
export const SeedLayer = makeSeedCapabilitiesLayer()

/**
 * The optional provider ports and option bags `makeLiveCapabilitiesLayer`
 * consumes, declared once. Adding an optional binding means adding one field
 * here; `StarterEnv` composes this record beside its worker-binding names, and
 * the live-harness bag passes it straight through — no per-site field list to
 * keep in step.
 *
 * Every field is optional and explicitly `| undefined` (the repo runs with
 * `exactOptionalPropertyTypes`, so a bare `?:` would forbid passing a key
 * whose value is `undefined` — exactly what a worker env bag hands over for
 * an unset var).
 */
export type CapabilityBindings = {
  readonly assistantInvalidation?: ConversationInvalidationBinding | undefined
  readonly assistantTransport?: AssistantConversationTransport | undefined
  readonly assistantResource?: string | undefined
  readonly assistantLifecycle?: AssistantLifecycleBinding | undefined
  /** Independent append-only recovery evidence. Absent in local development. */
  readonly securityEvidence?: SecurityEvidenceSink | undefined
  readonly webhookQueue?: WebhookQueueBinding | undefined
  /**
   * The seat-sync queue the membership and invitation mutations enqueue onto.
   * Absent, those mutations publish nothing — the same provider-light posture
   * `webhookQueue` takes (CLAUDE.md rule 3).
   */
  readonly seatSyncQueue?: SeatSyncQueueBinding | undefined
  /**
   * The instant-email producer binding. Absent, Notifications persist and
   * show in the feed but no instant email is enqueued — the digest cron still
   * runs (CLAUDE.md rule 3).
   */
  readonly notificationEmailQueue?: NotificationEmailQueueBinding | undefined
  /**
   * Stripe checkout configuration (`STRIPE_SECRET_KEY` plus per-plan price
   * ids). Absent, checkout fails `provider_not_configured` and every other
   * surface keeps working — the same provider-light posture `webhookQueue`
   * takes (CLAUDE.md rule 3).
   */
  readonly billing?: BillingOptions | undefined
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
  /**
   * Adapter onto the organization plugin's leave/delete endpoints and the
   * core delete-user endpoint — all session-bound, so the app supplies it.
   * Absent, the deletion plan still reads and every teardown step fails
   * `CapabilityUnavailable`.
   */
  readonly accountLifecycleBinding?: AccountLifecycleBinding | undefined
  /**
   * The export queue and R2 bucket (ADR 0055). Absent, `WorkspaceExports`
   * reports unavailable and the settings page explains why — provider-light.
   */
  readonly workspaceExports?: LiveWorkspaceExportsOptions | undefined
  /**
   * Adapter onto the `sso` plugin's register/update/delete endpoints (ADR
   * 0055). Absent, connection reads and domain routing still work and the
   * settings mutations fail `CapabilityUnavailable` — the same provider-light
   * posture the other bindings take.
   */
  readonly ssoBinding?: WorkspaceSsoBinding | undefined
}

export function makeLiveCapabilitiesLayer(
  options: CapabilityBindings = {}
): Layer.Layer<CapabilityServices, never, Database | RawD1> {
  // One instance each: `LiveWebhookPublisher(options.webhookQueue)` called at
  // each use site would build distinct layers (Effect does not unify them), so
  // both the fan-out consumers and the merged layer share this value. The
  // seat-sync publisher follows the same rule for the same reason.
  const publisher = LiveWebhookPublisher(options.webhookQueue).pipe(
    Layer.provide(LiveAuditEventLog)
  )
  const seatSyncPublisher = LiveSeatSyncPublisher(options.seatSyncQueue)
  // Same one-instance rule for the preference store the feed resolves against.
  const preferences = LiveNotificationPreferences.pipe(Layer.provide(LiveAuditEventLog))
  const accountPreferences = LiveAccountPreferences.pipe(
    Layer.provide(LiveAuditEventLog)
  )
  const directory = LiveAssistantDirectory(
    options.securityEvidence,
    options.assistantInvalidation
  ).pipe(Layer.provide(LiveAuditEventLog))
  const membership = LiveWorkspaceMembership(
    options.memberBinding,
    options.securityEvidence
  ).pipe(Layer.provide(directory))
  // And for the feed: a mergeAll member the shell reads AND the layer
  // `PlatformUserAdmin` is provided so its impersonation `notifyUser` lands in
  // the same instance every other consumer reads.
  const feed = LiveNotificationFeed({
    emailQueue: options.notificationEmailQueue
  }).pipe(Layer.provide(preferences), (notificationLayer) =>
    BillingNotificationLayer.pipe(Layer.provideMerge(notificationLayer))
  )
  const billing = LiveBilling(options.billing).pipe(
    Layer.provide(BillingWebhookLayer.pipe(Layer.provideMerge(publisher)))
  )
  const entitlements = LiveResourceEntitlements.pipe(Layer.provide(billing))
  const suspension = LiveWorkspaceSuspension.pipe(
    Layer.provide(directory),
    Layer.provide(LiveAuditEventLog),
    Layer.provide(feed)
  )
  const emailEligibility = NotificationEmailEligibilityLayer.pipe(
    Layer.provide(feed),
    Layer.provide(preferences),
    Layer.provide(suspension),
    Layer.provide(LiveEmailDelivery)
  )
  const webhooks = LiveWebhookEndpoints.pipe(
    Layer.provide(entitlements),
    Layer.provide(billing)
  )
  const tasks = LiveWebhookInvestigationTasks.pipe(Layer.provide(webhooks))
  const conversationLifecycle = AssistantConversationLifecycleLayer(
    options.assistantLifecycle
  ).pipe(Layer.provide(directory))
  return Layer.mergeAll(
    directory,
    AssistantConversationsLayer(options.assistantTransport).pipe(
      Layer.provide(
        LiveAssistantAuthority(options.assistantResource).pipe(
          Layer.provide(LiveMcpClientConnections(options.securityEvidence))
        )
      )
    ),
    LiveAssistantAuthority(options.assistantResource).pipe(
      Layer.provide(LiveMcpClientConnections(options.securityEvidence))
    ),
    LiveAssistantAdmission.pipe(Layer.provide(LiveAuditEventLog)),
    conversationLifecycle,
    tasks,
    AssistantTaskEvidenceLayer.pipe(Layer.provide(tasks)),
    LiveRetention,
    LiveEmailDelivery,
    LiveAccountLifecycle(options.accountLifecycleBinding, options.securityEvidence),
    LiveApiTokenRegistry(options.securityEvidence).pipe(
      Layer.provide(entitlements),
      Layer.provide(billing)
    ),
    LiveAuditEventLog,
    billing,
    entitlements,
    LiveMcpClientConnections(options.securityEvidence),
    preferences,
    accountPreferences,
    feed,
    emailEligibility,
    LiveSsoConnections(options.ssoBinding),
    webhooks,
    publisher,
    LiveWorkspaceInvitations(options.invitationBinding),
    membership,
    LiveWorkspaceLifecycle(options.lifecycleBinding, options.securityEvidence).pipe(
      Layer.provide(suspension)
    ),
    LivePlatformUserAdmin(options.userAdminBinding),
    LiveWorkspaceOnboarding,
    LiveStrongAuthentication,
    LiveWorkspaceExports(options.workspaceExports).pipe(Layer.provide(suspension)),
    LivePersonalDataExports.pipe(
      Layer.provide(LiveEmailDelivery),
      Layer.provide(preferences),
      Layer.provide(accountPreferences),
      Layer.provide(membership),
      Layer.provide(LiveAuditEventLog)
    ),
    suspension,
    seatSyncPublisher
  ).pipe(
    Layer.provide(directory),
    Layer.provide(conversationLifecycle),
    Layer.provide(BillingAuditLayer.pipe(Layer.provideMerge(LiveAuditEventLog))),
    // The user-admin capability notifies the impersonated user below its
    // interface, the export adapter notifies the requester below its, and the
    // webhook capability's dead-letter notification rides the same provide —
    // the same queue-wired `feed` value is a member above, so one instance
    // serves all three.
    Layer.provide(feed),
    Layer.provide(publisher),
    Layer.provide(seatSyncPublisher)
  )
}
