import { type ApiToken } from './developer-platform/api-token-registry.ts'
import { type SeedAuditEventRow } from './governance/audit-event-log.ts'
import { type SeedNotification } from './notifications/notification-feed.ts'
import { type SeedNotificationPreference } from './notifications/notification-preferences.ts'
import { type WebhookEndpoint } from './developer-platform/webhook-endpoints.ts'
import { type Member, type Workspace } from './governance/workspace-identity.ts'
import {
  type SeedMembership,
  type SystemUserAccount
} from './governance/platform-user-admin.ts'
import { type SeedWorkspaceExportFixture } from './governance/workspace-export.seed.ts'

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

export const seedMembers: ReadonlyArray<Member> = [
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

/**
 * Fixture accounts with two-factor enabled. The demo owner is deliberately not
 * one of them, so the onboarding checklist's two-factor step stays open in
 * the Seed Workspace — the partially complete state the reference app shows.
 */
export const seedTwoFactorUserIds: ReadonlyArray<string> = ['usr_martin']

export const seedSystemUsers: ReadonlyArray<SystemUserAccount> = [
  ...seedMembers.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    systemRole: member.systemRole,
    banned: false
  })),
  // An account with no membership anywhere — the user-admin contract's
  // role-change rejection needs one on the seed side.
  {
    id: 'usr_outsider',
    name: 'No Workspaces',
    email: 'outsider@example.com',
    systemRole: 'user',
    banned: false
  }
]

/** The (workspace, user) pairs the seed `changeWorkspaceRole` treats as real. */
export const seedUserAdminMemberships: ReadonlyArray<SeedMembership> = seedMembers.map(
  (member) => ({
    workspaceId: seedWorkspaceRecord.id,
    userId: member.id,
    role: member.role
  })
)

export const seedApiTokens: ReadonlyArray<ApiToken> = [
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

export const seedWebhookEndpoints: ReadonlyArray<WebhookEndpoint> = [
  {
    id: 'wh_release',
    url: 'https://example.com/webhooks/starter',
    enabled: true,
    events: ['api_token.created'],
    successRate: 98
  },
  {
    id: 'wh_billing',
    url: 'https://billing.example.com/hooks/starter',
    enabled: false,
    events: ['webhook_endpoint.created'],
    successRate: 100
  }
]

export const seedAuditEvents: ReadonlyArray<SeedAuditEventRow> = [
  {
    id: 'aud_admin',
    eventType: 'system_admin.user_role_changed',
    targetType: 'user',
    targetId: 'usr_dev',
    actor: 'Martin Brandhaug',
    actorUserId: 'usr_martin',
    createdAt: '2026-05-15T12:10:00.000Z'
  },
  // One completed impersonation (ADR 0054), so `/admin`'s trail and the
  // showcase show the start/stop pair against the same admin and target.
  {
    id: 'aud_impersonation_started',
    eventType: 'system_admin.impersonation_started',
    targetType: 'user',
    targetId: 'usr_dev',
    actor: 'Martin Brandhaug',
    actorUserId: 'usr_martin',
    createdAt: '2026-05-15T13:00:00.000Z'
  },
  {
    id: 'aud_impersonation_stopped',
    eventType: 'system_admin.impersonation_stopped',
    targetType: 'user',
    targetId: 'usr_dev',
    actor: 'Martin Brandhaug',
    actorUserId: 'usr_martin',
    createdAt: '2026-05-15T13:12:00.000Z'
  },
  // System-level like the two-factor changes it sits beside: a passkey add is
  // account security, not workspace activity, so it carries no workspace.
  {
    id: 'aud_passkey',
    eventType: 'auth.passkey_added',
    targetType: 'user',
    targetId: 'usr_demo',
    actor: 'Demo Admin',
    actorUserId: 'usr_demo',
    createdAt: '2026-05-15T09:30:00.000Z'
  },
  {
    id: 'aud_token',
    eventType: 'api_token.created',
    targetType: 'api_token',
    targetId: 'tok_ops',
    actor: 'Ops Lead',
    actorUserId: 'usr_ops',
    // Workspace-scoped events carry their workspace so the per-workspace
    // audit page (issue #118) has something to show in Seed/dev.
    workspaceId: 'wrk_starter',
    createdAt: '2026-05-14T08:20:00.000Z'
  },
  {
    id: 'aud_export',
    eventType: 'workspace.export_completed',
    targetType: 'workspace_export',
    targetId: 'exp_seed_ready',
    actor: 'system',
    actorUserId: null,
    workspaceId: 'wrk_starter',
    createdAt: '2026-05-16T07:30:05.000Z'
  }
]

/**
 * The fixture's one finished export (ADR 0055): `ready` and downloadable, so
 * the settings page lists an archive and the API worker's signed download
 * route has bytes to serve before anyone clicks "Request export". The secret
 * is a fixture credential like `SEED_API_TOKEN` — it signs demo links only.
 */
export const seedWorkspaceExportFixture: SeedWorkspaceExportFixture = {
  id: 'exp_seed_ready',
  requestedByUserId: demoUserIdentity.id,
  downloadSecret: 'seed-export-download-secret',
  ageMs: 60 * 60 * 1000,
  buildMs: 5000
}

export const seedNotifications: ReadonlyArray<SeedNotification> = [
  // The user-facing half of the seeded impersonation above: targeted at the
  // impersonated member, so only `usr_dev` sees it.
  {
    id: 'not_impersonation',
    kind: 'account.impersonated',
    title: 'A System Admin accessed your account',
    message:
      'Martin Brandhaug started an impersonation session on your account. It ends when they stop it or after 60 minutes, and it cannot change your password, two-factor settings, or email.',
    createdAt: '2026-05-15T13:00:00.000Z',
    read: false,
    userId: 'usr_dev'
  },
  {
    id: 'not_export',
    kind: 'announcement',
    title: 'Workspace export ready',
    message: 'Your export of Starter Lab is ready to download from workspace settings.',
    createdAt: '2026-05-16T07:30:05.000Z',
    read: false
  },
  {
    id: 'not_email',
    kind: 'announcement',
    title: 'Cloudflare Email needs configuration',
    message: 'Set CLOUDFLARE_EMAIL_FROM before enabling real email delivery.',
    createdAt: '2026-05-16T08:10:00.000Z',
    read: false
  },
  {
    id: 'not_webhook',
    kind: 'webhook.delivery_failed',
    title: 'Webhook delivery gave up',
    message:
      'https://example.com/webhooks/starter rejected api_token.created after six attempts.',
    createdAt: '2026-05-16T07:30:00.000Z',
    read: false
  },
  {
    id: 'not_token',
    kind: 'api_token.created',
    title: 'API token created',
    message: 'Ops Lead minted "MCP local client" with read and write scopes.',
    createdAt: '2026-05-16T06:00:00.000Z',
    read: true
  },
  {
    id: 'not_token_call',
    kind: 'announcement',
    title: 'API token created',
    message: 'MCP local client can now call the workspace API.',
    createdAt: '2026-05-14T08:20:00.000Z',
    read: true
  },
  {
    id: 'not_billing',
    kind: 'billing.plan_changed',
    title: 'Plan changed to Team',
    message: 'The workspace now serves the Team plan limits.',
    createdAt: '2026-05-13T10:05:00.000Z',
    read: true
  },
  {
    id: 'not_rotation',
    kind: 'announcement',
    title: 'Signing secret rotated',
    message: 'Rotate the verifier before the grace window closes.',
    createdAt: '2026-05-12T09:30:00.000Z',
    read: false
  },
  {
    id: 'not_invite',
    kind: 'workspace_member.joined',
    title: 'Invitation accepted',
    message: 'Product Engineer joined Starter Lab as a member.',
    createdAt: '2026-05-11T14:45:00.000Z',
    read: true
  }
]

/**
 * The demo owner's explicit choices, one per channel, so the `/account`
 * preferences section shows a mix on first load: a security kind moved to the
 * digest, a digest kind moved to instant, and announcements turned off. Every
 * other kind stays on its default. The D1 seed writes exactly these rows.
 */
export const seedNotificationPreferences: ReadonlyArray<SeedNotificationPreference> = [
  { userId: demoUserIdentity.id, kind: 'api_token.created', channel: 'digest' },
  { userId: demoUserIdentity.id, kind: 'webhook.delivery_failed', channel: 'instant' },
  { userId: demoUserIdentity.id, kind: 'announcement', channel: 'off' }
]
