import { type ApiToken } from './developer-platform/api-token-registry.ts'
import { type SeedAuditEventRow } from './governance/audit-event-log.ts'
import { type Notification } from './notifications/notification-feed.ts'
import { type WebhookEndpoint } from './developer-platform/webhook-endpoints.ts'
import { type Member, type Workspace } from './governance/workspace-identity.ts'

export const seedWorkspaceRecord: Workspace = {
  id: 'wrk_starter',
  slug: 'starter-lab',
  name: 'Starter Lab',
  planId: 'team'
}

/**
 * The demo credential account's identity, shared with the D1 seed
 * (scripts/seed.ts, which adds only the password locally). One constant
 * preserves Seed/Live equivalence: client-side navigations resolve
 * membership against the fixture members, so the demo user must be a member
 * in BOTH layers or SPA navigation 404s while full-page loads succeed.
 */
export const demoUserIdentity: Member = {
  id: 'usr_demo',
  name: 'Demo Admin',
  email: 'demo@starter.local',
  role: 'owner',
  systemRole: 'admin'
}

/**
 * The plain `member` of the seed workspace, named because the seed script gives
 * it a credential account too: signing in as it is how the role-gated UI (the
 * hidden API-token and webhook sections) is visible in local dev and e2e. The
 * demo user is an owner and therefore shows none of it.
 */
export const demoMemberIdentity: Member = {
  id: 'usr_dev',
  name: 'Product Engineer',
  email: 'engineer@example.com',
  role: 'member',
  systemRole: 'user'
}

export const seedMembers: readonly Member[] = [
  demoUserIdentity,
  {
    id: 'usr_martin',
    name: 'Martin Brandhaug',
    email: 'martin@example.com',
    role: 'owner',
    systemRole: 'admin'
  },
  {
    id: 'usr_ops',
    name: 'Ops Lead',
    email: 'ops@example.com',
    role: 'admin',
    systemRole: 'user'
  },
  demoMemberIdentity
]

export const seedApiTokens: readonly ApiToken[] = [
  {
    id: 'tok_docs',
    name: 'Docs automation',
    prefix: 'bsk_seed_docs',
    scopes: ['read'],
    lastUsedAt: '2026-05-15T16:44:00.000Z',
    createdAt: '2026-05-12T11:15:00.000Z'
  },
  {
    id: 'tok_mcp',
    name: 'MCP local client',
    prefix: 'bsk_seed_mcp',
    scopes: ['read', 'write'],
    lastUsedAt: null,
    createdAt: '2026-05-14T08:20:00.000Z'
  }
]

export const seedWebhookEndpoints: readonly WebhookEndpoint[] = [
  {
    id: 'wh_release',
    url: 'https://example.com/webhooks/starter',
    enabled: true,
    events: ['api_token.created'],
    successRate: 98
  }
]

export const seedAuditEvents: readonly SeedAuditEventRow[] = [
  {
    id: 'aud_admin',
    eventType: 'system_admin.user_role_changed',
    targetType: 'user',
    targetId: 'usr_dev',
    actor: 'Martin Brandhaug',
    actorUserId: 'usr_martin',
    createdAt: '2026-05-15T12:10:00.000Z'
  },
  {
    id: 'aud_token',
    eventType: 'api_token.created',
    targetType: 'api_token',
    targetId: 'tok_ops',
    actor: 'Ops Lead',
    actorUserId: 'usr_ops',
    createdAt: '2026-05-14T08:20:00.000Z'
  }
]

export const seedNotifications: readonly Notification[] = [
  {
    id: 'not_email',
    title: 'Cloudflare Email needs configuration',
    message: 'Set CLOUDFLARE_EMAIL_FROM before enabling real email delivery.',
    createdAt: '2026-05-16T08:10:00.000Z',
    read: false
  },
  {
    id: 'not_webhook',
    title: 'Webhook endpoint created',
    message: 'Outbound webhook deliveries will start on the next event.',
    createdAt: '2026-05-16T06:00:00.000Z',
    read: true
  }
]
