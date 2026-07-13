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
export const providerBookingAccess = ['public', 'restricted'] as const
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
export const bookingPartyLifecycles = [
  'active',
  'confirming',
  'confirmed',
  'expired',
  'abandoned'
] as const
export const paymentStatuses = [
  'pending',
  'authorized',
  'partially_captured',
  'captured',
  'partially_refunded',
  'refunded',
  'cancelled'
] as const
export const giftCardSaleStatuses = [
  'pending_payment',
  'issuing',
  'issued',
  'cancelled',
  'refunded'
] as const
export const giftCardStatuses = ['active', 'suspended', 'expired', 'voided'] as const
export const waitingListStatuses = [
  'active',
  'fulfilled',
  'withdrawn',
  'expired'
] as const
export const availabilityOfferStatuses = [
  'pending',
  'accepted',
  'declined',
  'expired',
  'superseded'
] as const
export const walkInStatuses = [
  'waiting',
  'called',
  'serving',
  'served',
  'removed',
  'expired'
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
  readonly checkoutPath: 'pay_in_person' | 'online_payment'
  readonly acceptedQuote?: {
    readonly id: string
    readonly version: number
    readonly totalMinor: number
    readonly acceptedAt: string
  }
  readonly policyAcceptance?: {
    readonly policyId: string
    readonly disclosure: string
    readonly acceptedAt: string
  } | null
  readonly cancellationPolicy?: {
    readonly id: string
    readonly version: number
    readonly cancellableUntilMinutesBeforeStart: number
  }
  readonly refundPolicy?: {
    readonly id: string
    readonly version: number
    readonly refundableUntilMinutesBeforeStart: number
    readonly refundBasisPoints: number
  }
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
  bookingConfigJson: text('booking_config_json', { mode: 'json' }).$type<
    Record<string, unknown>
  >(),
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
    bookingAccess: text('booking_access', { enum: providerBookingAccess })
      .default('public')
      .notNull(),
    bookingAccessVerifierHash: text('booking_access_verifier_hash'),
    bookingConfigJson: text('booking_config_json', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
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
    bookingConfigJson: text('booking_config_json', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
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
    routeId: text('route_id'),
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
    locale: text('locale').default('en').notNull(),
    embeddingProfile: text('embedding_profile', {
      enum: ['standalone', 'widget', 'google']
    })
      .default('standalone')
      .notNull(),
    acquisitionJson: text('acquisition_json'),
    createdAt: isoCreatedAt(),
    lastActivityAt: text('last_activity_at').notNull(),
    idleExpiresAt: text('idle_expires_at').notNull(),
    absoluteExpiresAt: text('absolute_expires_at').notNull()
  },
  (table) => [
    uniqueIndex('booking_sessions_route_id_unique').on(table.routeId),
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
    bookingSessionId: text('booking_session_id'),
    bookingPartyId: text('booking_party_id'),
    bookingRequestId: text('booking_request_id').unique(),
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
    index('appointments_booking_session_id_idx').on(table.bookingSessionId),
    index('appointments_booking_party_id_idx').on(table.bookingPartyId),
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
    bookingPartyId: text('booking_party_id'),
    purpose: text('purpose', {
      enum: ['appointment_confirmation', 'party_confirmation']
    })
      .default('appointment_confirmation')
      .notNull(),
    tokenVersion: integer('token_version').default(1).notNull(),
    signingKeyId: text('signing_key_id').notNull(),
    expiresAt: text('expires_at').notNull(),
    exchangedAt: text('exchanged_at'),
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
    notificationIntentId: text('notification_intent_id').unique(),
    kind: text('kind', { enum: ['appointment.created'] }).notNull(),
    traceId: text('trace_id').notNull(),
    createdAt: isoCreatedAt(),
    claimedAt: text('claimed_at'),
    emailStatus: text('email_status')
      .$type<
        | 'pending'
        | 'delivered'
        | 'disabled'
        | 'needs_configuration'
        | 'failed_retryable'
        | 'failed_terminal'
      >()
      .default('pending')
      .notNull(),
    emailFailureCode: text('email_failure_code'),
    emailAttemptCount: integer('email_attempt_count').default(0).notNull(),
    emailNextAttemptAt: text('email_next_attempt_at'),
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
    bookingRequestId: text('booking_request_id'),
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

export const brands = sqliteTable('brands', {
  id: id(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  bookingConfigJson: text('booking_config_json', { mode: 'json' }).$type<
    Record<string, unknown>
  >(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const shops = sqliteTable(
  'shops',
  {
    id: id(),
    brandId: text('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    slug: text('slug').unique().notNull(),
    publicName: text('public_name').notNull(),
    timezone: text('timezone').notNull(),
    currency: text('currency').notNull(),
    bookingConfigJson: text('booking_config_json', { mode: 'json' }).$type<
      Record<string, unknown>
    >(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [index('shops_brand_id_idx').on(table.brandId)]
)

export const shopAddresses = sqliteTable('shop_addresses', {
  id: id(),
  shopId: text('shop_id')
    .unique()
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  addressJson: text('address_json').notNull(),
  latitude: text('latitude'),
  longitude: text('longitude'),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const shopProviders = sqliteTable(
  'shop_providers',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    createdAt: isoCreatedAt()
  },
  (table) => [primaryKey({ columns: [table.shopId, table.providerId] })]
)

export const shopServices = sqliteTable(
  'shop_services',
  {
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    createdAt: isoCreatedAt()
  },
  (table) => [primaryKey({ columns: [table.shopId, table.serviceId] })]
)

export const customerAccounts = sqliteTable(
  'customer_accounts',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    displayName: text('display_name'),
    phone: text('phone'),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('customer_accounts_merchant_email_unique').on(
      table.merchantId,
      table.email
    )
  ]
)

export const marketingConsents = sqliteTable(
  'marketing_consents',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    customerAccountId: text('customer_account_id').references(
      () => customerAccounts.id,
      { onDelete: 'set null' }
    ),
    subjectJson: text('subject_json').notNull(),
    channel: text('channel', { enum: ['email', 'sms'] }).notNull(),
    granted: integer('granted', { mode: 'boolean' }).notNull(),
    policyVersion: text('policy_version').notNull(),
    recordedAt: text('recorded_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('marketing_consents_subject_idx').on(
      table.merchantId,
      table.customerAccountId
    )
  ]
)

export const bookingParties = sqliteTable(
  'booking_parties',
  {
    id: id(),
    bookingSessionId: text('booking_session_id')
      .unique()
      .notNull()
      .references(() => bookingSessions.id, { onDelete: 'cascade' }),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    activeRequestId: text('active_request_id'),
    lifecycle: text('lifecycle', { enum: bookingPartyLifecycles })
      .default('active')
      .notNull(),
    currency: text('currency').notNull(),
    locale: text('locale').default('en').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [index('booking_parties_shop_id_idx').on(table.shopId)]
)

export const bookingRequests = sqliteTable(
  'booking_requests',
  {
    id: id(),
    bookingPartyId: text('booking_party_id')
      .notNull()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    providerPreference: text('provider_preference', { enum: ['specific', 'any'] }),
    providerId: text('provider_id').references(() => providers.id, {
      onDelete: 'set null'
    }),
    primaryServiceId: text('primary_service_id').references(() => services.id, {
      onDelete: 'set null'
    }),
    holdId: text('hold_id'),
    customerAccountId: text('customer_account_id'),
    customerDetailsJson: text('customer_details_json'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('booking_requests_party_position_unique').on(
      table.bookingPartyId,
      table.position
    ),
    index('booking_requests_party_id_idx').on(table.bookingPartyId)
  ]
)

export const bookingRequestServices = sqliteTable(
  'booking_request_services',
  {
    bookingRequestId: text('booking_request_id')
      .notNull()
      .references(() => bookingRequests.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    role: text('role', { enum: ['primary', 'additional'] }).notNull(),
    position: integer('position').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    primaryKey({ columns: [table.bookingRequestId, table.serviceId] }),
    uniqueIndex('booking_request_services_position_unique').on(
      table.bookingRequestId,
      table.position
    )
  ]
)

export const pricingQuotes = sqliteTable(
  'pricing_quotes',
  {
    id: id(),
    bookingPartyId: text('booking_party_id')
      .notNull()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    currency: text('currency').notNull(),
    subtotalMinor: integer('subtotal_minor').notNull(),
    adjustmentMinor: integer('adjustment_minor').default(0).notNull(),
    tipMinor: integer('tip_minor').default(0).notNull(),
    totalMinor: integer('total_minor').notNull(),
    factsJson: text('facts_json').notNull(),
    acceptedAt: text('accepted_at'),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('pricing_quotes_party_version_unique').on(
      table.bookingPartyId,
      table.version
    )
  ]
)

export const pricingAdjustments = sqliteTable(
  'pricing_adjustments',
  {
    id: id(),
    pricingQuoteId: text('pricing_quote_id')
      .notNull()
      .references(() => pricingQuotes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    allocationJson: text('allocation_json').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [index('pricing_adjustments_quote_id_idx').on(table.pricingQuoteId)]
)

export const pricingQuoteAcceptances = sqliteTable('pricing_quote_acceptances', {
  pricingQuoteId: text('pricing_quote_id')
    .primaryKey()
    .references(() => pricingQuotes.id, { onDelete: 'cascade' }),
  bookingPartyId: text('booking_party_id')
    .notNull()
    .references(() => bookingParties.id, { onDelete: 'cascade' }),
  partyVersion: integer('party_version').notNull(),
  acceptedAt: text('accepted_at').notNull(),
  createdAt: isoCreatedAt()
})

export const pricingPolicies = sqliteTable('pricing_policies', {
  shopId: text('shop_id')
    .primaryKey()
    .references(() => shops.id, { onDelete: 'cascade' }),
  taxBasisPoints: integer('tax_basis_points').default(0).notNull(),
  taxLabel: text('tax_label').default('Tax').notNull(),
  feeMinor: integer('fee_minor').default(0).notNull(),
  feeLabel: text('fee_label').default('Fee').notNull(),
  version: integer('version').default(1).notNull(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const promotions = sqliteTable(
  'promotions',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    currency: text('currency').notNull(),
    kind: text('kind', { enum: ['fixed', 'percentage'] }).notNull(),
    value: integer('value').notNull(),
    minimumSubtotalMinor: integer('minimum_subtotal_minor').default(0).notNull(),
    maximumUses: integer('maximum_uses'),
    startsAt: text('starts_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('promotions_merchant_code_unique').on(table.merchantId, table.code),
    check('promotions_valid_window', sql`${table.startsAt} < ${table.expiresAt}`),
    check('promotions_positive_value', sql`${table.value} > 0`)
  ]
)

export const promotionReservations = sqliteTable(
  'promotion_reservations',
  {
    id: id(),
    promotionId: text('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'restrict' }),
    pricingQuoteId: text('pricing_quote_id')
      .notNull()
      .references(() => pricingQuotes.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['active', 'committed', 'released', 'expired'] })
      .default('active')
      .notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('promotion_reservations_quote_unique').on(table.pricingQuoteId),
    index('promotion_reservations_usage_idx').on(table.promotionId, table.status)
  ]
)

export const settlementAllocations = sqliteTable(
  'settlement_allocations',
  {
    id: id(),
    bookingPartyId: text('booking_party_id')
      .notNull()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    tender: text('tender', {
      enum: ['gift_card', 'external_payment', 'pay_in_person']
    }).notNull(),
    referenceId: text('reference_id'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [index('settlement_allocations_party_id_idx').on(table.bookingPartyId)]
)

export const payments = sqliteTable(
  'payments',
  {
    id: id(),
    bookingPartyId: text('booking_party_id').references(() => bookingParties.id, {
      onDelete: 'restrict'
    }),
    pricingQuoteId: text('pricing_quote_id').references(() => pricingQuotes.id, {
      onDelete: 'restrict'
    }),
    amountMinor: integer('amount_minor').default(0).notNull(),
    status: text('status', { enum: paymentStatuses }).default('pending').notNull(),
    currency: text('currency').notNull(),
    authorizedMinor: integer('authorized_minor').default(0).notNull(),
    capturedMinor: integer('captured_minor').default(0).notNull(),
    refundedMinor: integer('refunded_minor').default(0).notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('payments_booking_party_id_unique').on(table.bookingPartyId),
    index('payments_pricing_quote_id_idx').on(table.pricingQuoteId)
  ]
)

export const paymentAttempts = sqliteTable(
  'payment_attempts',
  {
    id: id(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    provider: text('provider').notNull(),
    method: text('method', {
      enum: ['card', 'saved_card', 'apple_pay', 'google_pay', 'cash_app_pay', 'klarna']
    })
      .default('card')
      .notNull(),
    outcome: text('outcome', { enum: ['pending', 'succeeded', 'failed'] }).notNull(),
    providerReference: text('provider_reference'),
    failureCode: text('failure_code'),
    createdAt: isoCreatedAt(),
    completedAt: text('completed_at')
  },
  (table) => [
    index('payment_attempts_payment_id_idx').on(table.paymentId),
    uniqueIndex('payment_attempts_active_payment_unique')
      .on(table.paymentId)
      .where(sql`${table.outcome} <> 'failed'`)
  ]
)

export const paymentTransactions = sqliteTable(
  'payment_transactions',
  {
    id: id(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['authorization', 'capture', 'refund', 'void']
    }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    providerReference: text('provider_reference').notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('payment_transactions_payment_id_idx').on(table.paymentId),
    uniqueIndex('payment_transactions_provider_fact_unique').on(
      table.kind,
      table.providerReference
    )
  ]
)

export const paymentReconciliationEvents = sqliteTable(
  'payment_reconciliation_events',
  {
    id: id(),
    paymentId: text('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    receivedAt: text('received_at').notNull()
  },
  (table) => [
    uniqueIndex('payment_reconciliation_provider_event_unique').on(
      table.provider,
      table.providerEventId
    )
  ]
)

export const giftCardProducts = sqliteTable('gift_card_products', {
  id: id(),
  merchantId: text('merchant_id')
    .notNull()
    .references(() => merchants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  scope: text('scope', { enum: ['merchant', 'brand', 'shop', 'provider'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  presetAmountsJson: text('preset_amounts_json').notNull(),
  allowsCustomAmount: integer('allows_custom_amount', { mode: 'boolean' })
    .default(false)
    .notNull(),
  customAmountMinMinor: integer('custom_amount_min_minor'),
  customAmountMaxMinor: integer('custom_amount_max_minor'),
  active: integer('active', { mode: 'boolean' }).default(true).notNull(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const giftCardSales = sqliteTable('gift_card_sales', {
  id: id(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'restrict' }),
  giftCardProductId: text('gift_card_product_id').references(
    () => giftCardProducts.id,
    { onDelete: 'restrict' }
  ),
  status: text('status', { enum: giftCardSaleStatuses })
    .default('pending_payment')
    .notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: text('currency').notNull(),
  recipientJson: text('recipient_json').notNull(),
  purchaserJson: text('purchaser_json').notNull(),
  paymentId: text('payment_id')
    .unique()
    .references(() => payments.id, { onDelete: 'restrict' }),
  receiptRouteId: text('receipt_route_id').unique(),
  receiptTokenHash: text('receipt_token_hash'),
  receiptSigningKeyId: text('receipt_signing_key_id'),
  receiptExpiresAt: text('receipt_expires_at'),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const giftCards = sqliteTable('gift_cards', {
  id: id(),
  giftCardSaleId: text('gift_card_sale_id')
    .unique()
    .notNull()
    .references(() => giftCardSales.id, { onDelete: 'restrict' }),
  codeHash: text('code_hash').unique().notNull(),
  status: text('status', { enum: giftCardStatuses }).default('active').notNull(),
  currency: text('currency').notNull(),
  scope: text('scope', { enum: ['merchant', 'brand', 'shop', 'provider'] }).notNull(),
  scopeId: text('scope_id').notNull(),
  initialValueMinor: integer('initial_value_minor').notNull(),
  expiresAt: text('expires_at'),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt()
})

export const giftCardLedgerEntries = sqliteTable(
  'gift_card_ledger_entries',
  {
    id: id(),
    giftCardId: text('gift_card_id')
      .notNull()
      .references(() => giftCards.id, { onDelete: 'restrict' }),
    kind: text('kind', {
      enum: ['issuance', 'reservation', 'release', 'redemption', 'refund', 'adjustment']
    }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    bookingPartyId: text('booking_party_id').references(() => bookingParties.id, {
      onDelete: 'restrict'
    }),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [index('gift_card_ledger_gift_card_id_idx').on(table.giftCardId)]
)

export const giftCardReservations = sqliteTable(
  'gift_card_reservations',
  {
    id: id(),
    giftCardId: text('gift_card_id')
      .notNull()
      .references(() => giftCards.id, { onDelete: 'restrict' }),
    bookingPartyId: text('booking_party_id')
      .notNull()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: ['active', 'committed', 'released', 'expired'] })
      .default('active')
      .notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('gift_card_reservations_party_card_unique').on(
      table.bookingPartyId,
      table.giftCardId
    ),
    index('gift_card_reservations_card_status_idx').on(table.giftCardId, table.status)
  ]
)

export const waitingListApplications = sqliteTable('waiting_list_applications', {
  id: id(),
  shopId: text('shop_id')
    .notNull()
    .references(() => shops.id, { onDelete: 'cascade' }),
  status: text('status', { enum: waitingListStatuses }).default('active').notNull(),
  requestJson: text('request_json').notNull(),
  customerSnapshotJson: text('customer_snapshot_json').notNull(),
  createdAt: isoCreatedAt(),
  updatedAt: isoUpdatedAt(),
  expiresAt: text('expires_at').notNull()
})

export const availabilityOffers = sqliteTable(
  'availability_offers',
  {
    id: id(),
    waitingListApplicationId: text('waiting_list_application_id')
      .notNull()
      .references(() => waitingListApplications.id, { onDelete: 'cascade' }),
    status: text('status', { enum: availabilityOfferStatuses })
      .default('pending')
      .notNull(),
    slotJson: text('slot_json').notNull(),
    bookingSessionId: text('booking_session_id').references(() => bookingSessions.id, {
      onDelete: 'set null'
    }),
    createdAt: isoCreatedAt(),
    expiresAt: text('expires_at').notNull(),
    respondedAt: text('responded_at')
  },
  (table) => [
    index('availability_offers_application_id_idx').on(table.waitingListApplicationId),
    uniqueIndex('availability_offers_one_pending_idx')
      .on(table.waitingListApplicationId)
      .where(sql`${table.status} = 'pending'`)
  ]
)

export const walkInEntries = sqliteTable(
  'walk_in_entries',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    status: text('status', { enum: walkInStatuses }).default('waiting').notNull(),
    position: integer('position').notNull(),
    contactKey: text('contact_key'),
    requestJson: text('request_json').notNull(),
    customerSnapshotJson: text('customer_snapshot_json').notNull(),
    expiresAt: text('expires_at'),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('walk_in_entries_active_contact_unique')
      .on(table.shopId, table.contactKey)
      .where(sql`${table.status} IN ('waiting', 'called', 'serving')`),
    index('walk_in_entries_shop_status_position_idx').on(
      table.shopId,
      table.status,
      table.position
    ),
    index('walk_in_entries_shop_status_expiry_idx').on(
      table.shopId,
      table.status,
      table.expiresAt
    )
  ]
)

export const checkoutPolicies = sqliteTable(
  'checkout_policies',
  {
    id: id(),
    merchantId: text('merchant_id').references(() => merchants.id, {
      onDelete: 'cascade'
    }),
    brandId: text('brand_id').references(() => brands.id, {
      onDelete: 'cascade'
    }),
    shopId: text('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['merchant', 'brand', 'shop'] }).notNull(),
    scopeId: text('scope_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    disclosure: text('disclosure').notNull(),
    effectiveAt: text('effective_at').notNull(),
    retiredAt: text('retired_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('checkout_policies_scope_kind_version_unique').on(
      table.scope,
      table.scopeId,
      table.kind,
      table.version
    ),
    check(
      'checkout_policies_exact_scope',
      sql`(${table.scope} = 'merchant' AND ${table.merchantId} = ${table.scopeId} AND ${table.brandId} IS NULL AND ${table.shopId} IS NULL) OR (${table.scope} = 'brand' AND ${table.merchantId} IS NULL AND ${table.brandId} = ${table.scopeId} AND ${table.shopId} IS NULL) OR (${table.scope} = 'shop' AND ${table.merchantId} IS NULL AND ${table.brandId} IS NULL AND ${table.shopId} = ${table.scopeId})`
    )
  ]
)

export const policyAcceptances = sqliteTable(
  'policy_acceptances',
  {
    id: id(),
    bookingPartyId: text('booking_party_id')
      .notNull()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    checkoutPolicyId: text('checkout_policy_id')
      .notNull()
      .references(() => checkoutPolicies.id, { onDelete: 'restrict' }),
    disclosureSnapshot: text('disclosure_snapshot').notNull(),
    acceptedAt: text('accepted_at').notNull()
  },
  (table) => [
    uniqueIndex('policy_acceptances_party_policy_unique').on(
      table.bookingPartyId,
      table.checkoutPolicyId
    )
  ]
)

export const lifecycleHistory = sqliteTable(
  'lifecycle_history',
  {
    id: id(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    reasonCode: text('reason_code'),
    factsJson: text('facts_json').notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('lifecycle_history_aggregate_idx').on(
      table.aggregateType,
      table.aggregateId,
      table.occurredAt
    )
  ]
)

export const cancellationCommands = sqliteTable(
  'cancellation_commands',
  {
    id: id(),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['appointment', 'party'] }).notNull(),
    targetId: text('target_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    resultJson: text('result_json', { mode: 'json' }).$type<{
      readonly appointmentIds: readonly string[]
      readonly refundObligationIds: readonly string[]
    }>(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('cancellation_commands_idempotency_unique').on(
      table.merchantId,
      table.idempotencyKey
    ),
    uniqueIndex('cancellation_commands_target_unique').on(
      table.merchantId,
      table.scope,
      table.targetId
    ),
    index('cancellation_commands_merchant_idx').on(table.merchantId)
  ]
)

export const appointmentCancellations = sqliteTable(
  'appointment_cancellations',
  {
    id: id(),
    appointmentId: text('appointment_id')
      .notNull()
      .unique()
      .references(() => appointments.id, { onDelete: 'cascade' }),
    commandId: text('command_id')
      .notNull()
      .references(() => cancellationCommands.id, { onDelete: 'restrict' }),
    reasonCode: text('reason_code').notNull(),
    cancellationPolicyId: text('cancellation_policy_id').notNull(),
    cancellationPolicyVersion: integer('cancellation_policy_version').notNull(),
    refundPolicyId: text('refund_policy_id').notNull(),
    refundPolicyVersion: integer('refund_policy_version').notNull(),
    cancelledAt: text('cancelled_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [index('appointment_cancellations_command_idx').on(table.commandId)]
)

export const refundObligations = sqliteTable(
  'refund_obligations',
  {
    id: id(),
    appointmentId: text('appointment_id')
      .notNull()
      .unique()
      .references(() => appointments.id, { onDelete: 'restrict' }),
    bookingPartyId: text('booking_party_id').references(() => bookingParties.id, {
      onDelete: 'restrict'
    }),
    status: text('status', {
      enum: [
        'pending',
        'processing',
        'succeeded',
        'failed_retryable',
        'failed_terminal'
      ]
    })
      .default('pending')
      .notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    failureCode: text('failure_code'),
    providerEventId: text('provider_event_id').unique(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('refund_obligations_status_idx').on(table.status, table.updatedAt),
    check('refund_obligations_positive_amount', sql`${table.amountMinor} > 0`)
  ]
)

export const refundObligationEvents = sqliteTable(
  'refund_obligation_events',
  {
    id: id(),
    refundObligationId: text('refund_obligation_id')
      .notNull()
      .references(() => refundObligations.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull(),
    outcome: text('outcome', {
      enum: ['succeeded', 'failed_retryable', 'failed_terminal']
    }).notNull(),
    failureCode: text('failure_code'),
    expectedAttemptCount: integer('expected_attempt_count').notNull(),
    occurredAt: text('occurred_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    uniqueIndex('refund_obligation_events_provider_event_unique').on(
      table.providerEventId
    ),
    index('refund_obligation_events_obligation_idx').on(
      table.refundObligationId,
      table.occurredAt
    )
  ]
)

export const refundObligationAllocations = sqliteTable(
  'refund_obligation_allocations',
  {
    refundObligationId: text('refund_obligation_id')
      .notNull()
      .references(() => refundObligations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    tender: text('tender', {
      enum: ['gift_card', 'external_payment', 'pay_in_person']
    }).notNull(),
    referenceId: text('reference_id'),
    amountMinor: integer('amount_minor').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.refundObligationId, table.position] }),
    check(
      'refund_obligation_allocations_positive_amount',
      sql`${table.amountMinor} > 0`
    )
  ]
)

export const protectedAccessGrants = sqliteTable(
  'protected_access_grants',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    capabilityHash: text('capability_hash').unique().notNull(),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('protected_access_resource_idx').on(table.resourceType, table.resourceId)
  ]
)

export const notificationIntents = sqliteTable(
  'notification_intents',
  {
    id: id(),
    shopId: text('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    recipientJson: text('recipient_json').notNull(),
    payloadJson: text('payload_json').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    deduplicationKey: text('deduplication_key').unique().notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'delivered', 'failed', 'cancelled']
    })
      .default('pending')
      .notNull(),
    availableAt: text('available_at').notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    index('notification_intents_status_available_idx').on(
      table.status,
      table.availableAt
    )
  ]
)

export const scheduledWork = sqliteTable(
  'scheduled_work',
  {
    id: id(),
    shopId: text('shop_id').references(() => shops.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payloadJson: text('payload_json').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'cancelled', 'failed']
    })
      .default('pending')
      .notNull(),
    runAt: text('run_at').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastFailureCode: text('last_failure_code'),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [index('scheduled_work_status_run_at_idx').on(table.status, table.runAt)]
)

/** Platform-wide verified customer identities; separate from Merchant authority. */
export const customerIdentities = sqliteTable(
  'customer_identities',
  {
    id: id(),
    provider: text('provider', { enum: ['google', 'apple'] }).notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    verifiedAt: text('verified_at').notNull(),
    createdAt: isoCreatedAt(),
    updatedAt: isoUpdatedAt()
  },
  (table) => [
    uniqueIndex('customer_identities_provider_subject_unique').on(
      table.provider,
      table.providerSubject
    )
  ]
)

export const customerAccountSessions = sqliteTable(
  'customer_account_sessions',
  {
    id: id(),
    customerAccountId: text('customer_account_id')
      .notNull()
      .references(() => customerIdentities.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('customer_account_sessions_account_idx').on(table.customerAccountId)
  ]
)

export const customerBookingAssociations = sqliteTable(
  'customer_booking_associations',
  {
    bookingPartyId: text('booking_party_id')
      .primaryKey()
      .references(() => bookingParties.id, { onDelete: 'cascade' }),
    customerAccountId: text('customer_account_id')
      .notNull()
      .references(() => customerIdentities.id, { onDelete: 'cascade' }),
    merchantId: text('merchant_id')
      .notNull()
      .references(() => merchants.id, { onDelete: 'cascade' }),
    confirmationRouteId: text('confirmation_route_id').notNull(),
    customerDetailsJson: text('customer_details_json', { mode: 'json' })
      .$type<{
        readonly name: string
        readonly email: string
        readonly phone: string | null
      }>()
      .notNull(),
    associatedAt: text('associated_at').notNull()
  },
  (table) => [
    index('customer_booking_associations_owner_idx').on(
      table.customerAccountId,
      table.merchantId
    )
  ]
)

export const providerAccessProofs = sqliteTable(
  'provider_access_proofs',
  {
    id: id(),
    bookingSessionId: text('booking_session_id')
      .notNull()
      .references(() => bookingSessions.id, { onDelete: 'cascade' }),
    providerId: text('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    proofHash: text('proof_hash').unique().notNull(),
    expiresAt: text('expires_at').notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    index('provider_access_proofs_scope_idx').on(
      table.bookingSessionId,
      table.providerId,
      table.expiresAt
    )
  ]
)
