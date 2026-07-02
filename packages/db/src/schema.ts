import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'

export const workspaceRoles = ['owner', 'admin', 'member'] as const
export const moduleStatuses = [
  'ready',
  'needs-config',
  'disabled',
  'attention'
] as const
export const apiTokenScopes = ['read', 'write', 'admin'] as const
export type ApiTokenScopeValue = (typeof apiTokenScopes)[number]
export type CatalogRefreshSummary = {
  readonly modules: number
  readonly durationMs: number
}
export const providerKinds = [
  'github',
  'stripe',
  'sentry',
  'posthog',
  'turnstile',
  'workers-ai',
  'openai-compatible',
  'cloudflare-email'
] as const

// Shared column helpers. Two timestamp dialects coexist by design: Better Auth
// tables store epoch-seconds in integer columns (its plugin contract), starter
// tables store ISO strings in text columns — see AGENTS.md before normalizing.
// Drizzle column builders are single-use, so every helper returns fresh
// builders per call.
const id = () => text('id').primaryKey()

const authTimestamps = () => ({
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull()
})

const isoCreatedAt = () => text('created_at').notNull()

const isoUpdatedAt = () => text('updated_at').notNull()

const workspaceRef = () =>
  text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })

const workspaceRefNullable = () =>
  text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' })

const workspaceIdIndex = (tableName: string, workspaceId: AnySQLiteColumn) =>
  index(`${tableName}_workspace_id_idx`).on(workspaceId)

export const user = sqliteTable('user', {
  id: id(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).default(false).notNull(),
  role: text('role').default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('banReason'),
  banExpires: integer('banExpires', { mode: 'timestamp' }),
  ...authTimestamps()
})

export const session = sqliteTable(
  'session',
  {
    id: id(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').unique().notNull(),
    ...authTimestamps(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy')
  },
  (table) => [index('session_user_id_idx').on(table.userId)]
)

export const account = sqliteTable(
  'account',
  {
    id: id(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', {
      mode: 'timestamp'
    }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', {
      mode: 'timestamp'
    }),
    scope: text('scope'),
    password: text('password'),
    ...authTimestamps()
  },
  (table) => [index('account_user_id_idx').on(table.userId)]
)

export const verification = sqliteTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    ...authTimestamps()
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  planId: text('plan_id').default('starter').notNull(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: workspaceRef(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRoles }).notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId)
  ]
)

export const workspaceInvitations = sqliteTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: workspaceRef(),
    email: text('email').notNull(),
    role: text('role', { enum: workspaceRoles }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    createdAt: isoCreatedAt(),
    createdByUserId: text('created_by_user_id').references(() => user.id)
  },
  (table) => [workspaceIdIndex('workspace_invitations', table.workspaceId)]
)

export const starterModules = sqliteTable('starter_modules', {
  id: id(),
  name: text('name').notNull(),
  summary: text('summary').notNull(),
  category: text('category').notNull(),
  docsPath: text('docs_path').notNull(),
  optional: integer('optional', { mode: 'boolean' }).default(false).notNull()
})

export const workspaceModuleStates = sqliteTable(
  'workspace_module_states',
  {
    workspaceId: workspaceRef(),
    moduleId: text('module_id')
      .notNull()
      .references(() => starterModules.id, { onDelete: 'cascade' }),
    status: text('status', { enum: moduleStatuses }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    missingConfig: text('missing_config', { mode: 'json' })
      .$type<readonly string[]>()
      .default(sql`'[]'`)
      .notNull(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.moduleId] })]
)

export const integrationConnections = sqliteTable(
  'integration_connections',
  {
    id: id(),
    workspaceId: workspaceRef(),
    provider: text('provider', { enum: providerKinds }).notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull(),
    connectedAt: text('connected_at'),
    lastCheckedAt: text('last_checked_at')
  },
  (table) => [workspaceIdIndex('integration_connections', table.workspaceId)]
)

export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: id(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').unique().notNull(),
    scopes: text('scopes', { mode: 'json' })
      .$type<readonly ApiTokenScopeValue[]>()
      .notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
    createdAt: isoCreatedAt(),
    createdByUserId: text('created_by_user_id').references(() => user.id)
  },
  (table) => [workspaceIdIndex('api_tokens', table.workspaceId)]
)

export const webhookEndpoints = sqliteTable(
  'webhook_endpoints',
  {
    id: id(),
    workspaceId: workspaceRef(),
    url: text('url').notNull(),
    description: text('description'),
    // Stored at rest by design: outbound dispatch must sign payloads with the
    // plaintext secret. See webhook-endpoints.AGENTS.md in packages/capabilities.
    signingSecret: text('signing_secret').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    events: text('events', { mode: 'json' }).$type<readonly string[]>().notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [workspaceIdIndex('webhook_endpoints', table.workspaceId)]
)

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: text('last_attempt_at'),
    nextAttemptAt: text('next_attempt_at'),
    responseStatus: integer('response_status')
  },
  (table) => [index('webhook_deliveries_endpoint_id_idx').on(table.endpointId)]
)

export const implementationReports = sqliteTable(
  'implementation_reports',
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [workspaceIdIndex('implementation_reports', table.workspaceId)]
)

export const reportSchedules = sqliteTable(
  'report_schedules',
  {
    id: id(),
    workspaceId: workspaceRef(),
    frequency: text('frequency').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    recipients: text('recipients', { mode: 'json' })
      .$type<readonly string[]>()
      .notNull(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [workspaceIdIndex('report_schedules', table.workspaceId)]
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    message: text('message').notNull(),
    readAt: text('read_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [workspaceIdIndex('notifications', table.workspaceId)]
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    actorUserId: text('actor_user_id').references(() => user.id),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .default(sql`'{}'`)
      .notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    // Covers plain workspace_id lookups too (leftmost prefix), so no separate
    // single-column index is needed.
    index('audit_events_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt
    )
  ]
)

export const catalogRefreshRuns = sqliteTable('catalog_refresh_runs', {
  id: id(),
  workspaceId: workspaceRefNullable(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  summary: text('summary', { mode: 'json' }).$type<CatalogRefreshSummary>().notNull()
})
