import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
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
export const merchantMemberRoles = ['owner'] as const
export const merchantPlans = ['solo', 'team'] as const
export const providerStatuses = ['active', 'inactive'] as const
export const serviceStatuses = ['active', 'inactive'] as const
export const publicPageStatuses = ['published', 'unpublished'] as const
export const bookingSessionCheckoutPaths = ['pay_in_person'] as const
export const bookingSessionLifecycles = ['active', 'consumed'] as const

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

export const merchants = sqliteTable('merchants', {
  id: id(),
  publicName: text('public_name').notNull(),
  slug: text('slug').unique().notNull(),
  timezone: text('timezone').notNull(),
  currency: text('currency').notNull(),
  plan: text('plan', { enum: merchantPlans }).default('solo').notNull(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const merchantMemberships = sqliteTable(
  'merchant_memberships',
  {
    // A primary key on merchant_id prevents a second Owner. Merchant creation
    // batches this required row with the Merchant, supplying the "one" side.
    merchantId: text('merchant_id')
      .primaryKey()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    // A unique user_id prevents active-Merchant selection from emerging by
    // accident: one authenticated person can own at most one Merchant.
    userId: text('user_id')
      .unique()
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    role: text('role', { enum: merchantMemberRoles }).default('owner').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    check('merchant_memberships_owner_only', sql`${table.role} = 'owner'`),
    uniqueIndex('merchant_memberships_user_unique').on(table.userId)
  ]
)

export const providers = sqliteTable(
  'providers',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    // Linking a Provider to a person does not grant Merchant authority. The
    // membership table remains the only authorization source.
    linkedUserId: text('linked_user_id').references(() => user.id, {
      onDelete: 'set null'
    }),
    displayName: text('display_name').notNull(),
    status: text('status', { enum: providerStatuses }).default('active').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).default(false).notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('providers_merchant_id_idx').on(table.merchantId),
    uniqueIndex('providers_one_default_per_merchant_idx')
      .on(table.merchantId)
      .where(sql`${table.isDefault} = 1`)
  ]
)

export const services = sqliteTable(
  'services',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    status: text('status', { enum: serviceStatuses }).default('active').notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('services_merchant_id_idx').on(table.merchantId),
    check('services_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('services_positive_price', sql`${table.priceMinor} > 0`),
    check('services_positive_duration', sql`${table.durationMinutes} > 0`),
    check(
      'services_currency_format',
      sql`length(${table.currency}) = 3 AND ${table.currency} = upper(${table.currency})`
    )
  ]
)

export const providerServiceEligibility = sqliteTable(
  'provider_service_eligibility',
  {
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    createdAt: isoCreatedAt()
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.serviceId] }),
    index('provider_service_eligibility_merchant_id_idx').on(table.merchantId),
    index('provider_service_eligibility_service_id_idx').on(table.serviceId)
  ]
)

export const scheduleRules = sqliteTable(
  'schedule_rules',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('schedule_rules_merchant_id_idx').on(table.merchantId),
    index('schedule_rules_provider_id_idx').on(table.providerId),
    check('schedule_rules_valid_weekday', sql`${table.weekday} between 0 and 6`),
    check(
      'schedule_rules_valid_interval',
      sql`${table.startTime} glob '[0-2][0-9]:[0-5][0-9]' AND ${table.endTime} glob '[0-2][0-9]:[0-5][0-9]' AND ${table.startTime} < ${table.endTime}`
    )
  ]
)

export const publicBookingPages = sqliteTable(
  'public_booking_pages',
  {
    id: id(),
    merchantId: text('merchant_id')
      .unique()
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    status: text('status', { enum: publicPageStatuses })
      .default('unpublished')
      .notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    check(
      'public_booking_pages_valid_status',
      sql`${table.status} in ('published', 'unpublished')`
    )
  ]
)

export const bookingSessions = sqliteTable(
  'booking_sessions',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    capabilityHash: text('capability_hash').unique().notNull(),
    checkoutPath: text('checkout_path', { enum: bookingSessionCheckoutPaths })
      .default('pay_in_person')
      .notNull(),
    lifecycle: text('lifecycle', { enum: bookingSessionLifecycles })
      .default('active')
      .notNull(),
    providerPreference: text('provider_preference', {
      enum: ['specific', 'any']
    }),
    providerId: text('provider_id').references(() => providers.id, {
      onDelete: 'set null'
    }),
    primaryServiceId: text('primary_service_id').references(() => services.id, {
      onDelete: 'set null'
    }),
    createdAt: isoCreatedAt(),
    lastActivityAt: text('last_activity_at').notNull(),
    idleExpiresAt: text('idle_expires_at').notNull(),
    absoluteExpiresAt: text('absolute_expires_at').notNull()
  },
  (table) => [
    index('booking_sessions_merchant_id_idx').on(table.merchantId),
    index('booking_sessions_expiry_idx').on(
      table.lifecycle,
      table.idleExpiresAt,
      table.absoluteExpiresAt
    ),
    check(
      'booking_sessions_pay_in_person_only',
      sql`${table.checkoutPath} = 'pay_in_person'`
    ),
    check(
      'booking_sessions_valid_lifecycle',
      sql`${table.lifecycle} in ('active', 'consumed')`
    )
  ]
)

export const bookingSessionAdditionalServices = sqliteTable(
  'booking_session_additional_services',
  {
    bookingSessionId: text('booking_session_id')
      .notNull()
      .references(() => bookingSessions.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    position: integer('position').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.bookingSessionId, table.serviceId] }),
    uniqueIndex('booking_session_additional_services_position_unique').on(
      table.bookingSessionId,
      table.position
    ),
    check(
      'booking_session_additional_services_non_negative_position',
      sql`${table.position} >= 0`
    )
  ]
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
  (table) => [
    workspaceIdIndex('workspace_invitations', table.workspaceId),
    index('workspace_invitations_created_by_user_id_idx').on(table.createdByUserId)
  ]
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
  (table) => [
    workspaceIdIndex('api_tokens', table.workspaceId),
    index('api_tokens_created_by_user_id_idx').on(table.createdByUserId)
  ]
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
    ),
    index('audit_events_actor_user_id_idx').on(table.actorUserId)
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
