import { type WebhookDeliveryAttempt } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import {
  seedMembers,
  seedWorkspaceRecord
} from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import { type Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { type NotificationPreview } from '@/components/live-notifications'
import { LocalizedError } from '@/lib/localized-error'
import { type WorkspaceViewer } from '@/lib/permissions'
import { type AssistantPagePayload } from '@/lib/server/assistant'
import { type WorkspaceApiTokensPayload } from '@/lib/server/api-tokens'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { type WorkspaceBillingPayload } from '@/lib/server/billing'
import { type BillingPorts } from '@/components/workspace-billing'
import { type WorkspaceDashboardPayload } from '@/lib/server/workspace-dashboard'
import { type WorkspaceMembersPayload } from '@/lib/server/workspace-members'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'
import { type WorkspaceWebhooksPayload } from '@/lib/server/webhooks'
import { m } from '@b2b-saas-starter/i18n/messages'

export type DemoSection =
  | 'overview'
  | 'members'
  | 'billing'
  | 'api-tokens'
  | 'webhooks'
  | 'audit'
  | 'settings'
  | 'assistant'
  | 'notifications'
const demoSections: ReadonlyArray<DemoSection> = [
  'overview',
  'members',
  'billing',
  'api-tokens',
  'webhooks',
  'audit',
  'settings',
  'assistant',
  'notifications'
]
export function isDemoSection(value: string): value is DemoSection {
  return demoSections.some((section) => section === value)
}
const viewer = { role: 'owner' } satisfies WorkspaceViewer
/**
 * The preview roster is the seed workspace's roster. Retyping it here is how
 * the showcase starts claiming members the app never had, so the fixture
 * package owns the list and this module only projects it.
 */
const members = seedMembers satisfies WorkspaceMembersPayload['members']
const notifications = [
  {
    id: 'not_export',
    kind: 'announcement',
    title: 'Workspace export ready',
    message: `Your export of ${seedWorkspaceRecord.name} is ready to download from workspace settings.`,
    read: false,
    createdAt: '2026-05-16T07:30:05.000Z'
  },
  {
    id: 'not_webhook',
    kind: 'webhook.delivery_failed',
    title: 'Webhook delivery gave up',
    message: 'The starter endpoint rejected api_token.created after six attempts.',
    read: false,
    createdAt: '2026-05-16T07:30:00.000Z'
  },
  {
    id: 'not_token',
    kind: 'api_token.created',
    title: 'API token created',
    message: 'Ops Lead minted MCP local client with read and write scopes.',
    read: true,
    createdAt: '2026-05-16T06:00:00.000Z'
  }
] satisfies ReadonlyArray<Notification & NotificationPreview>
const tokens = [
  {
    id: 'tok_docs',
    name: 'Local admin token',
    prefix: 'starter_local_ad',
    scopes: ['read', 'write', 'admin'],
    lastUsedAt: '2026-05-15T16:44:00.000Z',
    createdAt: '2026-05-12T11:15:00.000Z',
    expiresAt: null,
    replacedByTokenId: null
  },
  {
    id: 'tok_mcp',
    name: 'MCP local client',
    prefix: 'starter_mcp_read',
    scopes: ['read'],
    lastUsedAt: null,
    createdAt: '2026-05-14T08:20:00.000Z',
    expiresAt: null,
    replacedByTokenId: null
  }
] satisfies WorkspaceApiTokensPayload['tokens']
const deliveries = [
  {
    id: 'whd_delivered',
    endpointId: 'wh_release',
    eventType: 'api_token.created',
    status: 'delivered',
    attempts: 2,
    lastAttemptAt: '2026-05-16T07:02:00.000Z',
    nextAttemptAt: null,
    responseStatus: 200,
    payload: { tokenId: 'tok_mcp', name: 'MCP local client' },
    requestHeaders: {
      'content-type': 'application/json',
      'user-agent': 'Needlefish/1.0'
    },
    responseBody: '',
    replayedFrom: null
  },
  {
    id: 'whd_failed',
    endpointId: 'wh_release',
    eventType: 'api_token.created',
    status: 'failed',
    attempts: 2,
    lastAttemptAt: '2026-05-16T08:41:30.000Z',
    nextAttemptAt: '2026-05-16T08:42:00.000Z',
    responseStatus: 500,
    payload: { tokenId: 'tok_docs', name: 'Local admin token' },
    requestHeaders: {
      'content-type': 'application/json',
      'user-agent': 'Needlefish/1.0'
    },
    responseBody: 'upstream connect error',
    replayedFrom: null
  }
] satisfies WorkspaceWebhooksPayload['endpoints'][number]['deliveries']
const deliveryAttempts = [
  {
    id: 'whd_delivered_1',
    deliveryId: 'whd_delivered',
    attempts: 1,
    phase: 'http',
    status: 'failed',
    attemptedAt: '2026-05-16T07:01:30.000Z',
    durationMs: 180,
    failureReason: 'http_503',
    responseStatus: 503,
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: 'service unavailable'
  },
  {
    id: 'whd_delivered_2',
    deliveryId: 'whd_delivered',
    attempts: 2,
    phase: 'http',
    status: 'delivered',
    attemptedAt: '2026-05-16T07:02:00.000Z',
    durationMs: 42,
    failureReason: null,
    responseStatus: 200,
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: ''
  },
  {
    id: 'whd_failed_1',
    deliveryId: 'whd_failed',
    attempts: 1,
    phase: 'http',
    status: 'failed',
    attemptedAt: '2026-05-16T08:41:00.000Z',
    durationMs: 180,
    failureReason: 'http_503',
    responseStatus: 503,
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: 'service unavailable'
  },
  {
    id: 'whd_failed_2',
    deliveryId: 'whd_failed',
    attempts: 2,
    phase: 'http',
    status: 'failed',
    attemptedAt: '2026-05-16T08:41:30.000Z',
    durationMs: 180,
    failureReason: 'http_500',
    responseStatus: 500,
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: 'upstream connect error'
  }
] satisfies ReadonlyArray<WebhookDeliveryAttempt>
const endpoints = [
  {
    id: 'wh_release',
    url: 'https://example.com/webhooks/starter',
    enabled: true,
    events: ['api_token.created'],
    successRate: 0.96,
    deliveries
  },
  {
    id: 'wh_billing',
    url: 'https://billing.example.com/hooks/starter',
    enabled: false,
    events: ['webhook_endpoint.created'],
    successRate: 0.8,
    deliveries: []
  }
] satisfies WorkspaceWebhooksPayload['endpoints']
const invitations = [
  {
    id: 'inv_pending',
    email: 'designer@example.com',
    role: 'member',
    status: 'pending',
    expiresAt: '2026-06-01T12:00:00.000Z'
  }
] satisfies NonNullable<WorkspaceMembersPayload['invitations']>
const dashboardWebhooks = endpoints.map((endpoint) => ({
  id: endpoint.id,
  url: endpoint.url,
  enabled: endpoint.enabled,
  events: endpoint.events,
  successRate: endpoint.successRate
})) satisfies NonNullable<WorkspaceDashboardPayload['webhooks']>
export const demoAuditDetails = [
  {
    id: 'aud_export',
    actorType: 'system',
    eventType: 'workspace.export_completed',
    targetType: 'workspace_export',
    targetId: 'exp_ready',
    actor: 'system',
    createdAt: '2026-05-16T07:30:05.000Z',
    actorUserId: null,
    metadata: { sizeBytes: 8192 }
  },
  {
    id: 'aud_token',
    actorType: 'user',
    eventType: 'api_token.created',
    targetType: 'api_token',
    targetId: 'tok_mcp',
    actor: 'Ops Lead',
    createdAt: '2026-05-16T06:00:00.000Z',
    actorUserId: 'usr_ops',
    metadata: {}
  },
  {
    id: 'aud_member',
    actorType: 'user',
    eventType: 'workspace_member.joined',
    targetType: 'member',
    targetId: 'usr_dev',
    actor: 'Demo Admin',
    createdAt: '2026-05-15T14:45:00.000Z',
    actorUserId: 'usr_demo',
    metadata: { role: 'member' }
  }
] satisfies ReadonlyArray<NonNullable<WorkspaceAuditPayload['selectedEvent']>>
const auditEvents = demoAuditDetails.map((event) => ({
  id: event.id,
  eventType: event.eventType,
  targetType: event.targetType,
  targetId: event.targetId,
  actor: event.actor,
  actorType: event.actorType,
  createdAt: event.createdAt
})) satisfies WorkspaceAuditPayload['events']
const selectedResources = {
  apiTokenIds: ['tok_docs', 'tok_mcp'],
  webhookEndpointIds: ['wh_release']
}
// Display-only sample values. The preview never imports the billing catalog or
// evaluates entitlement policy in the browser.
const billingPlans = [
  {
    id: 'starter',
    name: 'Starter',
    price: { amount: 0, currency: 'USD' },
    descriptionKey: 'shell_plan_starter_description',
    pricing: 'flat',
    limits: { apiTokens: 2, webhookEndpoints: 1, seats: 3 },
    stripePriceEnv: null,
    purchase: 'downgrade',
    providerPrice: { amount: 0, currency: 'USD' }
  },
  {
    id: 'team',
    name: 'Team',
    price: { amount: 12, currency: 'USD' },
    descriptionKey: 'shell_plan_team_description',
    pricing: 'per_seat',
    limits: { apiTokens: null, webhookEndpoints: null, seats: null },
    stripePriceEnv: 'STRIPE_PRICE_ID_TEAM',
    purchase: 'self_serve',
    providerPrice: { amount: 12, currency: 'USD' }
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    descriptionKey: 'shell_plan_enterprise_description',
    pricing: 'flat',
    limits: { apiTokens: null, webhookEndpoints: null, seats: null },
    stripePriceEnv: null,
    purchase: 'sales',
    providerPrice: null
  }
] satisfies WorkspaceBillingPayload['plans']
const memberSeatUsage = {
  pricing: 'per_seat',
  included: null,
  used: members.length,
  overLimit: false
} satisfies WorkspaceMembersPayload['seatUsage']
const resourceEntitlements = {
  apiTokens: {
    resource: 'api_token',
    limit: null,
    used: 2,
    eligibleIds: ['tok_docs', 'tok_mcp'],
    selectedIds: ['tok_docs', 'tok_mcp'],
    activeIds: ['tok_docs', 'tok_mcp'],
    paused: false
  },
  webhookEndpoints: {
    resource: 'webhook_endpoint',
    limit: null,
    used: 2,
    eligibleIds: ['wh_release', 'wh_billing'],
    selectedIds: ['wh_release'],
    activeIds: ['wh_release', 'wh_billing'],
    paused: false
  }
} satisfies WorkspaceBillingPayload['resourceEntitlements']

export const demoFixtures = {
  dashboard: {
    workspace: seedWorkspaceRecord,
    viewer,
    unreadCount: 2,
    notifications,
    invitations,
    apiTokens: tokens,
    webhooks: dashboardWebhooks,
    auditEvents,
    progress: {
      steps: [
        { id: 'invite_member', complete: true },
        { id: 'create_api_token', complete: true },
        { id: 'add_webhook_endpoint', complete: true },
        { id: 'enable_two_factor', complete: false },
        { id: 'choose_plan', complete: true }
      ],
      completedCount: 4,
      totalCount: 5,
      dismissedAt: null
    }
  } satisfies WorkspaceDashboardPayload,
  members: {
    viewer,
    unreadCount: 2,
    members,
    invitations,
    emailDeliveries: [],
    seatUsage: memberSeatUsage
  } satisfies WorkspaceMembersPayload,
  apiTokens: { viewer, unreadCount: 2, tokens } satisfies WorkspaceApiTokensPayload,
  webhooks: { viewer, unreadCount: 2, endpoints } satisfies WorkspaceWebhooksPayload,
  audit: {
    viewer,
    events: auditEvents,
    nextCursor: null,
    filters: {},
    members: members.map(({ id, name }) => ({ id, name })),
    selectedEvent: null
  } satisfies WorkspaceAuditPayload,
  billing: {
    viewer,
    workspaceName: seedWorkspaceRecord.name,
    unreadCount: 2,
    plans: billingPlans,
    pricingUnavailable: false,
    currentPlanId: 'team',
    stripeConfigured: false,
    synchronization: { status: 'current', lastSyncedAt: '2026-05-16T07:30:05.000Z' },
    lifecycle: {
      status: 'active',
      planId: 'team',
      currentPeriodEnd: '2026-06-16T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      trialEnd: null,
      graceEndsAt: null
    },
    resourceSelection: selectedResources,
    resourceEntitlements,
    apiTokens: tokens.map(({ id, name }) => ({ id, name })),
    webhookEndpoints: endpoints.map(({ id, url }) => ({ id, url }))
  } satisfies WorkspaceBillingPayload,
  settings: {
    viewer,
    workspaceName: seedWorkspaceRecord.name,
    unreadCount: 2,
    ssoConnections: [
      {
        id: 'sso_example_oidc',
        protocol: 'oidc',
        domain: 'acme-corp.example',
        issuer: 'https://login.acme-corp.example',
        enabled: false,
        requireSso: false,
        defaultWorkspaceRole: 'member',
        clientIdLastFour: '7f2a',
        createdAt: '2026-05-15T09:30:00.000Z'
      }
    ],
    exports: {
      availability: { available: true },
      exports: [
        {
          id: 'exp_ready',
          status: 'ready',
          requestedAt: '2026-05-16T06:30:00.000Z',
          completedAt: '2026-05-16T06:30:05.000Z',
          expiresAt: '2026-05-23T06:30:05.000Z',
          sizeBytes: 8192,
          failureReason: null
        }
      ]
    }
  } satisfies WorkspaceSettingsPayload,
  // Both providers read as inactive, the provider-light default the landing
  // page promises: an unset key leaves the surface honest instead of faking
  // a configured deployment.
  assistant: { viewer, configured: false } satisfies AssistantPagePayload
} satisfies {
  readonly dashboard: WorkspaceDashboardPayload
  readonly members: WorkspaceMembersPayload
  readonly apiTokens: WorkspaceApiTokensPayload
  readonly webhooks: WorkspaceWebhooksPayload
  readonly audit: WorkspaceAuditPayload
  readonly billing: WorkspaceBillingPayload
  readonly settings: WorkspaceSettingsPayload
  readonly assistant: AssistantPagePayload
}

export const demoNotificationPorts = {
  // oxlint-disable-next-line typescript/require-await -- static preview port implements the production promise contract without I/O
  list: async () => notifications,
  // oxlint-disable-next-line effect/noNewPromise -- this port deliberately rejects to make standalone preview usage explicitly read-only
  markRead: () => Promise.reject(new LocalizedError(m.shell_demo_read_only()))
}
/**
 * Billing's server functions, refused. Without these the page falls back to
 * the real checkout and portal server fns, so a guest clicking Upgrade in the
 * preview would reach Stripe — the banner promises no action changes anything.
 */
function refusePreviewAction(): Promise<never> {
  // oxlint-disable-next-line effect/noNewPromise -- a preview port refuses through the same rejected-promise contract the real server fns use
  return Promise.reject(new LocalizedError(m.shell_demo_read_only()))
}
export const demoBillingPorts: BillingPorts = {
  startCheckout: refusePreviewAction,
  startPortalSession: refusePreviewAction,
  selectBillingResources: refusePreviewAction
}
export const demoWebhookPorts = {
  // oxlint-disable-next-line typescript/require-await -- static preview port implements the production promise contract without I/O
  listAttempts: async ({ data }: { readonly data: { readonly deliveryId: string } }) =>
    deliveryAttempts.filter((attempt) => attempt.deliveryId === data.deliveryId)
}
