import type { ReadinessPoint } from './catalog/adoption-readiness.ts'
import type { ApiToken } from './developer-platform/api-token-registry.ts'
import type { AuditEvent } from './governance/audit-event-log.ts'
import type { CatalogRefreshRun } from './catalog/catalog-refresh-history.ts'
import type { ImplementationReport } from './catalog/implementation-reports.ts'
import type { IntegrationSurface } from './notifications/integration-surfaces.ts'
import type { Notification } from './notifications/notification-feed.ts'
import type { StarterModuleWithState } from './catalog/starter-module-catalog.ts'
import type { WebhookEndpoint } from './developer-platform/webhook-endpoints.ts'
import type { Member, Workspace } from './governance/workspace-membership.ts'

const now = '2026-05-16T09:00:00.000Z'

export const seedWorkspaceRecord: Workspace = {
  id: 'wrk_starter',
  slug: 'starter-lab',
  name: 'Starter Lab',
  planId: 'team'
}

export const seedMembers: readonly Member[] = [
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
  {
    id: 'usr_dev',
    name: 'Product Engineer',
    email: 'engineer@example.com',
    role: 'member',
    systemRole: 'user'
  }
]

export const seedStarterModules: readonly StarterModuleWithState[] = [
  {
    id: 'tanstack-start',
    name: 'TanStack Start',
    category: 'Web',
    summary: 'SSR React app, file routes, server functions, forms, and router.',
    docsPath: '/docs/architecture/tanstack-start',
    optional: false,
    state: {
      moduleId: 'tanstack-start',
      enabled: true,
      status: 'ready',
      missingConfig: [],
      updatedAt: now
    }
  },
  {
    id: 'better-auth',
    name: 'Better Auth',
    category: 'Auth',
    summary:
      'Email/password, GitHub OAuth example, admin plugin, sessions, and D1 persistence.',
    docsPath: '/docs/modules/better-auth',
    optional: false,
    state: {
      moduleId: 'better-auth',
      enabled: true,
      status: 'needs-config',
      missingConfig: ['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID'],
      updatedAt: now
    }
  },
  {
    id: 'drizzle-d1',
    name: 'Drizzle D1',
    category: 'Data',
    summary:
      'Drizzle ORM rc schema and migrations for Cloudflare D1 shared by all workers.',
    docsPath: '/docs/modules/drizzle-d1',
    optional: false,
    state: {
      moduleId: 'drizzle-d1',
      enabled: true,
      status: 'ready',
      missingConfig: [],
      updatedAt: now
    }
  },
  {
    id: 'effect-v4',
    name: 'Effect v4',
    category: 'Application',
    summary:
      'Typed services, errors, schemas, HTTP API contracts, Effect Atom, and AI boundaries.',
    docsPath: '/docs/modules/effect-v4',
    optional: false,
    state: {
      moduleId: 'effect-v4',
      enabled: true,
      status: 'ready',
      missingConfig: [],
      updatedAt: now
    }
  },
  {
    id: 'rest-mcp',
    name: 'REST and MCP',
    category: 'Interfaces',
    summary: 'Capability interfaces for external API clients and AI coding tools.',
    docsPath: '/docs/modules/rest-mcp',
    optional: false,
    state: {
      moduleId: 'rest-mcp',
      enabled: true,
      status: 'ready',
      missingConfig: [],
      updatedAt: now
    }
  },
  {
    id: 'cloudflare-email',
    name: 'Cloudflare Email',
    category: 'Messaging',
    summary:
      'Outbound transactional email with React Email templates and Cloudflare sending.',
    docsPath: '/docs/modules/cloudflare-email',
    optional: true,
    state: {
      moduleId: 'cloudflare-email',
      enabled: true,
      status: 'needs-config',
      missingConfig: ['CLOUDFLARE_EMAIL_FROM'],
      updatedAt: now
    }
  },
  {
    id: 'observability',
    name: 'Observability',
    category: 'Operations',
    summary: 'Wide events, Sentry, PostHog, audit events, and operational reports.',
    docsPath: '/docs/modules/observability',
    optional: false,
    state: {
      moduleId: 'observability',
      enabled: true,
      status: 'attention',
      missingConfig: ['SENTRY_DSN', 'POSTHOG_KEY'],
      updatedAt: now
    }
  },
  {
    id: 'webhooks',
    name: 'Outbound Webhooks',
    category: 'Integrations',
    summary:
      'Workspace event delivery through Cloudflare Queues with signed retryable attempts.',
    docsPath: '/docs/modules/webhooks',
    optional: true,
    state: {
      moduleId: 'webhooks',
      enabled: true,
      status: 'ready',
      missingConfig: [],
      updatedAt: now
    }
  }
]

export const seedIntegrationSurfaces: readonly IntegrationSurface[] = [
  {
    id: 'int_github',
    provider: 'github',
    displayName: 'GitHub OAuth',
    status: 'needs-config',
    summary: 'Example OAuth provider for sign-in and integration wiring.'
  },
  {
    id: 'int_stripe',
    provider: 'stripe',
    displayName: 'Stripe billing',
    status: 'disabled',
    summary: 'Checkout, portal, and webhook surfaces are env-gated.'
  },
  {
    id: 'int_turnstile',
    provider: 'turnstile',
    displayName: 'Cloudflare Turnstile',
    status: 'disabled',
    summary: 'Anti-abuse for sign-up and sensitive public forms.'
  }
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
    events: ['module.ready', 'catalog.refresh.failed'],
    successRate: 98
  }
]

export const seedImplementationReports: readonly ImplementationReport[] = [
  {
    id: 'rep_weekly',
    title: 'Weekly implementation report',
    status: 'delivered',
    summary:
      'Auth, D1, REST/MCP, and module readiness are on track; email and observability need provider configuration.',
    createdAt: '2026-05-16T07:30:00.000Z'
  }
]

export const seedAuditEvents: readonly AuditEvent[] = [
  {
    id: 'aud_admin',
    eventType: 'system_admin.user_role_changed',
    targetType: 'user',
    actor: 'Martin Brandhaug',
    createdAt: '2026-05-15T12:10:00.000Z'
  },
  {
    id: 'aud_token',
    eventType: 'api_token.created',
    targetType: 'api_token',
    actor: 'Ops Lead',
    createdAt: '2026-05-14T08:20:00.000Z'
  }
]

export const seedNotifications: readonly Notification[] = [
  {
    id: 'not_email',
    title: 'Cloudflare Email needs configuration',
    message: 'Set CLOUDFLARE_EMAIL_FROM before enabling report delivery.',
    createdAt: '2026-05-16T08:10:00.000Z',
    read: false
  },
  {
    id: 'not_catalog',
    title: 'Catalog refresh completed',
    message: 'Dependency catalog metadata was refreshed for 8 starter modules.',
    createdAt: '2026-05-16T06:00:00.000Z',
    read: true
  }
]

export const seedReadinessTrend: readonly ReadinessPoint[] = [
  { label: 'Mon', score: 61 },
  { label: 'Tue', score: 65 },
  { label: 'Wed', score: 69 },
  { label: 'Thu', score: 72 },
  { label: 'Fri', score: 76 },
  { label: 'Sat', score: 78 }
]

export const seedCatalogRefreshHistory: readonly CatalogRefreshRun[] = [
  {
    id: 'crr_mon',
    label: 'Mon',
    status: 'ok',
    modules: 8,
    durationMs: 412,
    startedAt: '2026-05-11T06:00:00.000Z'
  },
  {
    id: 'crr_tue',
    label: 'Tue',
    status: 'ok',
    modules: 8,
    durationMs: 503,
    startedAt: '2026-05-12T06:00:00.000Z'
  },
  {
    id: 'crr_wed',
    label: 'Wed',
    status: 'ok',
    modules: 8,
    durationMs: 471,
    startedAt: '2026-05-13T06:00:00.000Z'
  },
  {
    id: 'crr_thu',
    label: 'Thu',
    status: 'failed',
    modules: 7,
    durationMs: 612,
    startedAt: '2026-05-14T06:00:00.000Z'
  },
  {
    id: 'crr_fri',
    label: 'Fri',
    status: 'ok',
    modules: 8,
    durationMs: 446,
    startedAt: '2026-05-15T06:00:00.000Z'
  },
  {
    id: 'crr_sat',
    label: 'Sat',
    status: 'ok',
    modules: 8,
    durationMs: 423,
    startedAt: '2026-05-16T06:00:00.000Z'
  }
]
