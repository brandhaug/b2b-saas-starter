import {
  ApiTokenId,
  UserId,
  WebhookDeliveryId,
  WebhookEndpointId,
  WorkspaceId
} from '@b2b-saas-starter/db/ids'
import {
  demoUserIdentity,
  seedWorkspaceRecord
} from '@b2b-saas-starter/capabilities/governance/workspace-identity.seed'
import {
  demoDataset,
  type DemoAuditDetail,
  type DemoDataset,
  type DemoRecords
} from '@/lib/demo-fixtures'
import { type DemoDataKind } from '@/lib/demo-data-kind'

/**
 * Dev-only datasets for `/demo?data=…`: the realistic worst case each page can
 * meet, plus the empty, single-record and 1,000-row extremes. Every value is
 * either a plausible production value or the longest one the schema accepts
 * (workspace name 80, webhook URL 2048, token name 100);
 * user names, notification copy and audit actors have no limit, so they use
 * long but real shapes. Only `demo-stress-preview.tsx` imports this module,
 * and only behind `import.meta.env.DEV`.
 */

const demoUserId = demoUserIdentity.id

// 80 characters: the create/rename schema maximum.
const longWorkspace = {
  id: WorkspaceId.make('wrk_starter'),
  slug: seedWorkspaceRecord.slug,
  name: 'Nordisk Sikkerhetsrådgivning og Compliance AS – Avdeling for antihvitvasking EØS',
  planId: 'team'
} satisfies DemoRecords['workspace']

const worstMembers = [
  {
    ...demoUserIdentity,
    name: 'Maximilian Alexander Konstantin von Hohenzollern-Sigmaringen III'
  },
  {
    id: UserId.make('usr_jo'),
    name: 'Jo',
    email: 'jo@x.io',
    role: 'member',
    systemRole: 'user',
    banned: false
  },
  {
    id: UserId.make('usr_long_email'),
    name: 'Christopher Montgomery',
    email: 'christopher.montgomery-wellington@subsidiary.enterprise-holdings.co.uk',
    role: 'admin',
    systemRole: 'user',
    banned: false
  },
  {
    id: UserId.make('usr_vi'),
    name: 'Nguyễn Thị Phương Thảo',
    email: 'thao.nguyen@ví-dụ.vn',
    role: 'member',
    systemRole: 'user',
    banned: false
  },
  {
    // Social sign-up with no display name: Better Auth stores the email.
    id: UserId.make('usr_nameless'),
    name: 'j.doe+starter-trial-2026@gmail.com',
    email: 'j.doe+starter-trial-2026@gmail.com',
    role: 'member',
    systemRole: 'user',
    banned: true
  },
  {
    id: UserId.make('usr_emoji'),
    name: '🦊 Release Bot',
    email: 'release-bot@ci.example.com',
    role: 'member',
    systemRole: 'user',
    banned: false
  },
  {
    id: UserId.make('usr_ar'),
    name: 'محمد عبد الرحمن',
    email: 'm.abdulrahman@example.ae',
    role: 'member',
    systemRole: 'user',
    banned: false
  },
  {
    id: UserId.make('usr_zh'),
    name: '李小龍',
    email: 'li@example.cn',
    role: 'admin',
    systemRole: 'user',
    banned: false
  }
] satisfies DemoRecords['members']

const worstInvitations = [
  {
    id: 'inv_long',
    // A distribution list on a long subsidiary domain; the schema allows 320.
    email:
      'procurement-and-vendor-onboarding-notifications.nordics@subsidiary.enterprise-holdings-international.co.uk',
    role: 'admin',
    status: 'pending',
    expiresAt: '2026-06-01T12:00:00.000Z'
  },
  {
    id: 'inv_short',
    email: 'a@b.co',
    role: 'member',
    status: 'pending',
    expiresAt: '2026-05-01T12:00:00.000Z'
  }
] satisfies DemoRecords['invitations']

const endpointBase =
  'https://hooks.eu-west-1.integrations.nordisk-sikkerhetsradgivning.no/api/v2/integrations/b2b-saas-starter/webhooks/receive?tenant=8f14e45f-ceea-467a-9a37-0a1f9c2b5d3e&signature_version=2&source=starter-lab&retry_policy=exponential&access_token='
const base64Url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
// 2,048 characters, the endpoint schema maximum: a receiver that authenticates
// with a signed JWT in the query string, the usual way a URL gets this long.
const longEndpointUrl = `${endpointBase}${Array.from(
  { length: 2048 - endpointBase.length },
  (_, index) => base64Url[(index * 37 + 11) % base64Url.length] ?? 'A'
).join('')}`
const allEventTypes = [
  'api_token.created',
  'api_token.revoked',
  'webhook_endpoint.created',
  'workspace_member.joined',
  'workspace_member.role_changed',
  'workspace_member.removed',
  'billing.plan_changed',
  'workspace.export_completed'
]

const htmlErrorPage =
  '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>cloudflare</center></body></html><!-- a padding to disable MSIE and Chrome friendly error page --><!-- a padding to disable MSIE and Chrome friendly error page -->'

const worstDeliveries = [
  {
    id: WebhookDeliveryId.make('whd_dead'),
    endpointId: WebhookEndpointId.make('wh_long'),
    eventType: 'workspace_member.role_changed',
    status: 'dead_lettered',
    attempts: 12,
    lastAttemptAt: '2026-05-16T08:41:30.000Z',
    nextAttemptAt: null,
    responseStatus: 502,
    payload: {
      memberId: 'usr_long_email',
      previousRole: 'member',
      role: 'admin',
      changedBy: 'Maximilian Alexander Konstantin von Hohenzollern-Sigmaringen III'
    },
    requestHeaders: {
      'content-type': 'application/json',
      'user-agent': 'Needlefish/1.0',
      'x-starter-signature':
        't=1747384890,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd'
    },
    responseBody: htmlErrorPage,
    replayedFrom: null
  },
  {
    id: WebhookDeliveryId.make('whd_network'),
    endpointId: WebhookEndpointId.make('wh_long'),
    eventType: 'api_token.created',
    status: 'pending',
    attempts: 1,
    lastAttemptAt: '2026-05-16T08:40:00.000Z',
    nextAttemptAt: '2026-05-16T08:45:00.000Z',
    // DNS failure: no HTTP response at all.
    responseStatus: null,
    payload: { tokenId: ApiTokenId.make('tok_long'), name: 'CI' },
    requestHeaders: { 'content-type': 'application/json' },
    responseBody: '',
    replayedFrom: WebhookDeliveryId.make('whd_dead')
  }
] satisfies DemoRecords['endpoints'][number]['deliveries']

const worstAttempts = Array.from({ length: 12 }, (_, index) => ({
  id: `whd_dead_${index + 1}`,
  deliveryId: WebhookDeliveryId.make('whd_dead'),
  attempts: index + 1,
  phase: index === 11 ? 'terminal' : 'http',
  status: 'failed',
  attemptedAt: new Date(Date.UTC(2026, 4, 16, 6, index * 4, 30)).toISOString(),
  durationMs: index === 0 ? 30_000 : 1284,
  failureReason: index === 11 ? 'dead_lettered_after_max_attempts' : 'http_502',
  responseStatus: 502,
  requestHeaders: { 'content-type': 'application/json' },
  responseBody: htmlErrorPage
})) satisfies DemoRecords['deliveryAttempts']

const longEndpoint = {
  id: WebhookEndpointId.make('wh_long'),
  url: longEndpointUrl,
  enabled: true,
  events: allEventTypes,
  successRate: 0,
  deliveries: worstDeliveries
} satisfies DemoRecords['endpoints'][number]

const worstEndpoints = [
  longEndpoint,
  {
    id: WebhookEndpointId.make('wh_short'),
    url: 'https://x.io/h',
    enabled: false,
    events: ['api_token.created'],
    successRate: 100,
    deliveries: []
  }
] satisfies DemoRecords['endpoints']

const worstTokens = [
  {
    id: ApiTokenId.make('tok_long'),
    // 99 characters, one under the token-name schema maximum.
    name: 'Production ingestion pipeline – Snowflake → warehouse sync (owner: data-platform, rotate quarterly)',
    prefix: 'starter_prod_in1',
    scopes: ['read', 'write', 'admin'],
    lastUsedAt: '2026-05-16T08:41:00.000Z',
    createdAt: '2025-01-02T09:00:00.000Z',
    expiresAt: '2026-05-17T00:00:00.000Z',
    replacedByTokenId: null
  },
  {
    id: ApiTokenId.make('tok_ci'),
    name: 'CI',
    prefix: 'starter_ci______',
    scopes: ['read'],
    lastUsedAt: null,
    createdAt: '2026-05-16T08:00:00.000Z',
    expiresAt: '2026-04-01T00:00:00.000Z',
    replacedByTokenId: ApiTokenId.make('tok_long')
  }
] satisfies DemoRecords['tokens']

const worstNotifications = [
  {
    id: 'not_long',
    kind: 'webhook.delivery_failed',
    // The producer's own copy (webhook-attempt-completion.ts): the full URL.
    title: 'Webhook delivery failed',
    message: `${longEndpointUrl}: workspace_member.role_changed was rejected and will not be retried.`,
    read: false,
    createdAt: '2026-05-16T08:41:30.000Z'
  },
  {
    id: 'not_short',
    kind: 'announcement',
    title: 'Hi',
    message: '',
    read: false,
    createdAt: '2026-05-16T08:41:00.000Z'
  },
  {
    id: 'not_member',
    kind: 'workspace_member.joined',
    title:
      'Nguyễn Thị Phương Thảo joined Nordisk Sikkerhetsrådgivning og Compliance AS',
    message:
      'Invited by Maximilian Alexander Konstantin von Hohenzollern-Sigmaringen III.',
    read: true,
    createdAt: '2025-12-31T23:59:59.000Z'
  }
] satisfies DemoRecords['notifications']

const worstAudit = [
  {
    id: 'aud_role',
    actorType: 'user',
    eventType: 'workspace_member.role_changed',
    targetType: 'member',
    targetId: 'usr_long_email',
    actor: 'Maximilian Alexander Konstantin von Hohenzollern-Sigmaringen III',
    createdAt: '2026-05-16T08:41:00.000Z',
    actorUserId: demoUserId,
    metadata: { role: 'admin' }
  },
  {
    id: 'aud_token',
    actorType: 'api_token',
    eventType: 'webhook_endpoint.secret_rotated',
    targetType: 'webhook_endpoint',
    targetId: 'wh_long_8f14e45f-ceea-467a-9a37-0a1f9c2b5d3e',
    actor:
      'Production ingestion pipeline – Snowflake → warehouse sync (owner: data-platform, rotate quarterly)',
    createdAt: '2026-05-16T08:40:00.000Z',
    actorUserId: null,
    metadata: { attempts: 12, responseStatus: 502 }
  },
  {
    id: 'aud_short',
    actorType: 'user',
    eventType: 'api_token.created',
    targetType: 'api_token',
    targetId: 'tok_ci',
    actor: 'Jo',
    createdAt: '2025-12-31T23:59:59.000Z',
    actorUserId: UserId.make('usr_jo'),
    metadata: {}
  }
] satisfies ReadonlyArray<DemoAuditDetail>

const worstSso = [
  {
    id: 'sso_long_oidc',
    protocol: 'oidc',
    domain: 'compliance.subsidiary.enterprise-holdings-international.co.uk',
    issuer:
      'https://login.microsoftonline.com/8f14e45f-ceea-467a-9a37-0a1f9c2b5d3e/v2.0/.well-known/openid-configuration',
    enabled: true,
    requireSso: true,
    defaultWorkspaceRole: 'admin',
    clientIdLastFour: '7f2a',
    createdAt: '2026-05-15T09:30:00.000Z'
  }
] satisfies DemoRecords['ssoConnections']

const worstExports = [
  {
    id: 'exp_failed',
    status: 'failed',
    requestedAt: '2026-05-16T08:30:00.000Z',
    completedAt: '2026-05-16T08:31:00.000Z',
    expiresAt: null,
    sizeBytes: null,
    failureReason: 'archive_exceeded_bucket_object_limit'
  },
  {
    id: 'exp_pending',
    status: 'pending',
    requestedAt: '2026-05-16T08:35:00.000Z',
    completedAt: null,
    expiresAt: null,
    sizeBytes: null,
    failureReason: null
  },
  {
    id: 'exp_huge',
    status: 'ready',
    requestedAt: '2026-05-15T06:30:00.000Z',
    completedAt: '2026-05-15T06:42:05.000Z',
    expiresAt: '2026-05-22T06:42:05.000Z',
    sizeBytes: 4_831_838_208,
    failureReason: null
  }
] satisfies DemoRecords['exports']

const worstRecords: DemoRecords = {
  workspace: longWorkspace,
  unreadCount: 1284,
  members: worstMembers,
  invitations: worstInvitations,
  notifications: worstNotifications,
  tokens: worstTokens,
  endpoints: worstEndpoints,
  deliveryAttempts: worstAttempts,
  auditDetails: worstAudit,
  ssoConnections: worstSso,
  exports: worstExports
}

const emptyRecords: DemoRecords = {
  workspace: seedWorkspaceRecord,
  unreadCount: 0,
  members: [demoUserIdentity],
  invitations: [],
  notifications: [],
  tokens: [],
  endpoints: [],
  deliveryAttempts: [],
  auditDetails: [],
  ssoConnections: [],
  exports: []
}

const oneRecords: DemoRecords = {
  workspace: seedWorkspaceRecord,
  unreadCount: 1,
  members: [demoUserIdentity],
  invitations: worstInvitations.slice(0, 1),
  notifications: worstNotifications.slice(0, 1),
  tokens: worstTokens.slice(0, 1),
  endpoints: [{ ...longEndpoint, events: ['api_token.created'] }],
  deliveryAttempts: worstAttempts.slice(0, 1),
  auditDetails: worstAudit.slice(0, 1),
  ssoConnections: worstSso,
  exports: worstExports.slice(2)
}

const firstNames = ['Ingrid', 'Ola', 'Aisha', 'Mateo', 'Yuki', 'Siobhán', 'Thảo', 'Jo']
const lastNames = ['Hansen', 'Okonkwo', 'García-López', 'Nakamura', "O'Brien", 'Lie']

function hugeMembers(count: number): DemoRecords['members'] {
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) {
      return demoUserIdentity
    }
    const first = firstNames[index % firstNames.length] ?? 'Ola'
    const last =
      lastNames[Math.floor(index / firstNames.length) % lastNames.length] ?? ''
    return {
      id: UserId.make(`usr_bulk_${index}`),
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${index}@example.com`,
      role: index % 50 === 0 ? 'admin' : 'member',
      systemRole: 'user',
      banned: false
    }
  })
}

const bulkMembers = hugeMembers(1284)
// Bulk rows cite every member but the demo owner in row 0.
function bulkMember(index: number) {
  const position = (index % (bulkMembers.length - 1)) + 1
  return { id: `usr_bulk_${position}`, name: bulkMembers[position]?.name ?? 'Ola' }
}
const hugeRecords: DemoRecords = {
  ...worstRecords,
  workspace: seedWorkspaceRecord,
  members: bulkMembers,
  invitations: Array.from({ length: 120 }, (_, index) => ({
    id: `inv_bulk_${index}`,
    email: `contractor.${index}@agency.example`,
    role: 'member',
    status: 'pending',
    expiresAt: '2026-06-01T12:00:00.000Z'
  })),
  notifications: Array.from({ length: 1000 }, (_, index) => ({
    id: `not_bulk_${index}`,
    kind: 'workspace_member.joined',
    title: `${bulkMember(index).name} joined Starter Lab`,
    message: 'Invited by Demo Admin.',
    read: index > 40,
    createdAt: new Date(Date.UTC(2026, 4, 16, 8) - index * 3_600_000).toISOString()
  })),
  tokens: Array.from({ length: 60 }, (_, index) => ({
    id: ApiTokenId.make(`tok_bulk_${index}`),
    name: `Service account ${index + 1}`,
    prefix: `starter_bulk_${String(index).padStart(3, '0')}`,
    scopes: ['read'],
    lastUsedAt: null,
    createdAt: '2026-05-01T00:00:00.000Z',
    expiresAt: null,
    replacedByTokenId: null
  })),
  auditDetails: Array.from({ length: 1000 }, (_, index) => ({
    id: `aud_bulk_${index}`,
    actorType: 'user',
    eventType: 'workspace_member.joined',
    targetType: 'member',
    targetId: bulkMember(index).id,
    actor: bulkMember(index).name,
    createdAt: new Date(Date.UTC(2026, 4, 16, 8) - index * 3_600_000).toISOString(),
    actorUserId: UserId.make(bulkMember(index).id),
    metadata: { role: 'member' }
  }))
}

export const stressDatasets: Record<Exclude<DemoDataKind, 'demo'>, DemoDataset> = {
  worst: demoDataset(worstRecords),
  empty: demoDataset(emptyRecords),
  one: demoDataset(oneRecords),
  huge: demoDataset(hugeRecords)
}
