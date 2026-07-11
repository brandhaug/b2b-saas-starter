import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

export const platformApiTokenScopes = [
  'merchant:read',
  'services:read',
  'providers:read',
  'appointments:read',
  'api_tokens:manage',
  'webhooks:manage'
] as const
export type PlatformApiTokenScopeValue = (typeof platformApiTokenScopes)[number]
export const merchantMemberRoles = ['owner'] as const
export const merchantPlans = ['solo', 'team'] as const
export const providerStatuses = ['active', 'inactive'] as const
export const serviceStatuses = ['active', 'inactive'] as const
export const publicPageStatuses = ['published', 'unpublished'] as const
export const bookingSessionCheckoutPaths = ['pay_in_person'] as const
export const bookingSessionLifecycles = ['active', 'consumed'] as const
export const appointmentStatuses = [
  'scheduled',
  'completed',
  'cancelled',
  'no_show'
] as const

export type StoredBookingQuote = {
  readonly startsAt: string
  readonly endsAt: string
  readonly providerPreference:
    | { readonly kind: 'any' }
    | { readonly kind: 'specific'; readonly providerId: string }
  readonly assignedProvider: {
    readonly id: string
    readonly displayName: string
  }
  readonly services: ReadonlyArray<{
    readonly id: string
    readonly role: 'primary' | 'additional'
    readonly name: string
    readonly durationMinutes: number
    readonly priceMinor: number
    readonly currency: string
  }>
  readonly durationMinutes: number
  readonly currency: string
  readonly totalMinor: number
}

export type StoredAppointmentSnapshot = StoredBookingQuote & {
  readonly merchantTimezone: string
  readonly customerDetails: {
    readonly name: string
    readonly email: string
    readonly phone: string | null
  }
  readonly checkoutPath: 'pay_in_person'
}

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
    checkoutPath: text('checkout_path', { enum: bookingSessionCheckoutPaths }).default(
      'pay_in_person'
    ),
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
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerPhone: text('customer_phone'),
    confirmedAppointmentId: text('confirmed_appointment_id'),
    confirmedAt: text('confirmed_at'),
    replayExpiresAt: text('replay_expires_at'),
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

export const appointments = sqliteTable(
  'appointments',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    bookingSessionId: text('booking_session_id').unique(),
    status: text('status', { enum: appointmentStatuses })
      .default('scheduled')
      .notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    snapshot: text('snapshot', { mode: 'json' }).$type<StoredAppointmentSnapshot>(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('appointments_merchant_id_idx').on(table.merchantId),
    index('appointments_provider_interval_idx').on(
      table.providerId,
      table.startsAt,
      table.endsAt
    ),
    check(
      'appointments_valid_status',
      sql`${table.status} in ('scheduled', 'completed', 'cancelled', 'no_show')`
    ),
    check('appointments_valid_interval', sql`${table.startsAt} < ${table.endsAt}`)
  ]
)

export const confirmationAccess = sqliteTable(
  'confirmation_access',
  {
    routeId: text('route_id').primaryKey(),
    appointmentId: text('appointment_id')
      .notNull()
      .unique()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    tokenVersion: integer('token_version').default(1).notNull(),
    signingKeyId: text('signing_key_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [index('confirmation_access_expiry_idx').on(table.expiresAt)]
)

export const bookingOutbox = sqliteTable(
  'booking_outbox',
  {
    id: id(),
    appointmentId: text('appointment_id')
      .notNull()
      .unique()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['appointment.created'] }).notNull(),
    traceId: text('trace_id').notNull(),
    createdAt: isoCreatedAt(),
    claimedAt: text('claimed_at'),
    emailStatus: text('email_status')
      .$type<'pending' | 'delivered' | 'skipped' | 'failed'>()
      .default('pending')
      .notNull(),
    emailFailureCode: text('email_failure_code'),
    webhookStatus: text('webhook_status')
      .$type<'pending' | 'completed' | 'dead_lettered'>()
      .default('pending')
      .notNull(),
    processedAt: text('processed_at')
  },
  (table) => [
    index('booking_outbox_pending_idx').on(table.processedAt, table.createdAt)
  ]
)

export const platformWebhookEvents = sqliteTable(
  'platform_webhook_events',
  {
    id: text('id').primaryKey(),
    outboxId: text('outbox_id')
      .notNull()
      .unique()
      .references(() => bookingOutbox.id, { onDelete: 'cascade' }),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    rawBody: text('raw_body').notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('platform_webhook_events_merchant_created_idx').on(
      table.merchantId,
      table.createdAt
    )
  ]
)

export const timeSlotHolds = sqliteTable(
  'time_slot_holds',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    bookingSessionId: text('booking_session_id')
      .notNull()
      .references(() => bookingSessions.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    createdAt: isoCreatedAt(),
    expiresAt: text('expires_at').notNull(),
    quote: text('quote', { mode: 'json' }).$type<StoredBookingQuote>().notNull()
  },
  (table) => [
    index('time_slot_holds_merchant_id_idx').on(table.merchantId),
    index('time_slot_holds_session_expiry_idx').on(
      table.bookingSessionId,
      table.expiresAt
    ),
    index('time_slot_holds_provider_interval_idx').on(
      table.providerId,
      table.startsAt,
      table.endsAt,
      table.expiresAt
    ),
    check('time_slot_holds_valid_interval', sql`${table.startsAt} < ${table.endsAt}`),
    check('time_slot_holds_valid_expiry', sql`${table.createdAt} < ${table.expiresAt}`)
  ]
)

export const platformApiTokens = sqliteTable(
  'platform_api_tokens',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').unique().notNull(),
    scopes: text('scopes', { mode: 'json' })
      .$type<readonly PlatformApiTokenScopeValue[]>()
      .notNull(),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
    createdAt: isoCreatedAt(),
    createdByUserId: text('created_by_user_id').references(() => user.id)
  },
  (table) => [
    index('platform_api_tokens_merchant_created_idx').on(
      table.merchantId,
      table.createdAt,
      table.id
    ),
    index('platform_api_tokens_created_by_user_id_idx').on(table.createdByUserId)
  ]
)

export const platformWebhookEndpoints = sqliteTable(
  'platform_webhook_endpoints',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    signingSecret: text('signing_secret').notNull(),
    status: text('status').$type<'active' | 'disabled'>().notNull(),
    events: text('events', { mode: 'json' }).$type<readonly string[]>().notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt(),
    disabledAt: text('disabled_at')
  },
  (table) => [
    index('platform_webhook_endpoints_merchant_updated_idx').on(
      table.merchantId,
      table.updatedAt,
      table.id
    )
  ]
)

export const platformWebhookDeliveries = sqliteTable(
  'platform_webhook_deliveries',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => platformWebhookEndpoints.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull(),
    failureCode: text('failure_code'),
    attemptNumber: integer('attempt_number').notNull(),
    responseStatus: integer('response_status'),
    durationMs: integer('duration_ms').notNull(),
    attemptedAt: text('attempted_at').notNull(),
    nextAttemptAt: text('next_attempt_at')
  },
  (table) => [
    index('platform_webhook_deliveries_endpoint_attempted_idx').on(
      table.endpointId,
      table.attemptedAt,
      table.id
    )
  ]
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    merchantId: text('merchant_id').references(() => merchants.id, {
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
    createdAt: isoCreatedAt()
  },
  (table) => [
    // Covers plain merchant_id lookups too (leftmost prefix).
    index('audit_events_merchant_created_at_idx').on(table.merchantId, table.createdAt),
    index('audit_events_actor_user_id_idx').on(table.actorUserId)
  ]
)
