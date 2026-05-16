import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
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
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  updatedAt: integer('updatedAt', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull()
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').unique().notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
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
    id: text('id').primaryKey(),
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
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
  },
  (table) => [index('account_user_id_idx').on(table.userId)]
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)]
)

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  planId: text('plan_id').default('starter').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRoles }).notNull(),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_idx').on(table.userId)
  ]
)

export const workspaceInvitations = sqliteTable('workspace_invitations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', { enum: workspaceRoles }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').references(() => user.id)
})

export const starterModules = sqliteTable('starter_modules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  summary: text('summary').notNull(),
  category: text('category').notNull(),
  docsPath: text('docs_path').notNull(),
  optional: integer('optional', { mode: 'boolean' }).default(false).notNull()
})

export const workspaceModuleStates = sqliteTable(
  'workspace_module_states',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    moduleId: text('module_id')
      .notNull()
      .references(() => starterModules.id, { onDelete: 'cascade' }),
    status: text('status', { enum: moduleStatuses }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    missingConfig: text('missing_config', { mode: 'json' })
      .$type<readonly string[]>()
      .default(sql`'[]'`)
      .notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.moduleId] })]
)

export const integrationConnections = sqliteTable('integration_connections', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: providerKinds }).notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  connectedAt: text('connected_at'),
  lastCheckedAt: text('last_checked_at')
})

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenPrefix: text('token_prefix').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes', { mode: 'json' })
    .$type<readonly ApiTokenScopeValue[]>()
    .notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').references(() => user.id)
})

export const webhookEndpoints = sqliteTable('webhook_endpoints', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  description: text('description'),
  signingSecret: text('signing_secret').notNull(),
  signingSecretHash: text('signing_secret_hash').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
  events: text('events', { mode: 'json' }).$type<readonly string[]>().notNull(),
  createdAt: text('created_at').notNull()
})

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  endpointId: text('endpoint_id')
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastAttemptAt: text('last_attempt_at'),
  nextAttemptAt: text('next_attempt_at'),
  responseStatus: integer('response_status')
})

export const implementationReports = sqliteTable('implementation_reports', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull(),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull()
})

export const reportSchedules = sqliteTable('report_schedules', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  frequency: text('frequency').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
  recipients: text('recipients', { mode: 'json' }).$type<readonly string[]>().notNull(),
  updatedAt: text('updated_at').notNull()
})

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id, {
    onDelete: 'cascade'
  }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  message: text('message').notNull(),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull()
})

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id, {
    onDelete: 'cascade'
  }),
  actorUserId: text('actor_user_id').references(() => user.id),
  eventType: text('event_type').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  metadata: text('metadata', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .default(sql`'{}'`)
    .notNull(),
  createdAt: text('created_at').notNull()
})

export const catalogRefreshRuns = sqliteTable('catalog_refresh_runs', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id, {
    onDelete: 'cascade'
  }),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  summary: text('summary', { mode: 'json' }).$type<CatalogRefreshSummary>().notNull()
})
