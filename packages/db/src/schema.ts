import {
  emailPurposes,
  emailDeliveryStatuses,
  auditActorTypes,
  accountLocales,
  billingCheckoutStatuses,
  billingLifecycleStatuses,
  billingProviderEventStatuses,
  billingSynchronizationStatuses,
  deliveryStatuses,
  deliveryAttemptPhases,
  invitationStatuses,
  notificationChannels,
  notificationKinds,
  ssoProvisionedRoles,
  systemRoles,
  workspaceExportStatuses,
  workspaceSuspensionStatuses,
  workspaceRoles,
  type ApiTokenScopeValue
} from './enums.ts'
import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'

export {
  adminSystemRole,
  accountLocales,
  billingCheckoutStatuses,
  billingProviderEventStatuses,
  billingSynchronizationStatuses,
  apiTokenScopes,
  auditActorTypes,
  deliveryStatuses,
  deliveryAttemptPhases,
  invitationStatuses,
  notificationChannels,
  notificationKinds,
  securityNotificationKinds,
  ssoProvisionedRoles,
  systemRoles,
  workspaceExportStatuses,
  workspaceSuspensionStatuses,
  workspaceRoles,
  type ApiTokenScopeValue,
  type AuditActorTypeValue,
  type AccountLocale,
  type DeliveryStatus,
  type NotificationChannel,
  type NotificationKind,
  type SsoProvisionedRoleValue,
  type SystemRoleValue,
  type WorkspaceExportStatus,
  type WorkspaceSuspensionStatus,
  type BillingCheckoutStatus,
  type BillingProviderEventStatus,
  type BillingSynchronizationStatus
} from './enums.ts'
/**
 * What a `mode: 'json'` text column can hold: exactly what
 * `JSON.stringify`/`JSON.parse` round-trips. Audit metadata is heterogeneous
 * per event type (token name + scopes, webhook url + events, delivery
 * attempts), so "JSON" is the honest column contract — not `unknown`, which
 * would also admit functions, `undefined`, and class instances that D1 cannot
 * store.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

/** A JSON object payload — the shape of every `mode: 'json'` metadata column. */
export type JsonObject = Readonly<Record<string, JsonValue>>

// Shared column helpers. Two timestamp dialects coexist by design: Better Auth
// tables store epoch-seconds in integer columns (its plugin contract), starter
// tables store ISO strings in text columns — see AGENTS.md before normalizing.
// Drizzle column builders are single-use, so every helper returns fresh
// builders per call.
function id() {
  return text('id').primaryKey()
}

/** One Better Auth epoch-seconds timestamp column, defaulted server-side. */
function authTimestamp(column: string) {
  return integer(column, { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull()
}

function authCreatedAt() {
  return authTimestamp('createdAt')
}

function authTimestamps() {
  return {
    createdAt: authCreatedAt(),
    updatedAt: authTimestamp('updatedAt')
  }
}

/**
 * The starter dialect's required creation timestamp: an ISO string in `text`.
 * Nullable ISO timestamps are plain `text(...)` — there is nothing to wrap.
 */
function isoCreatedAt() {
  return text('created_at').notNull()
}

/**
 * The three workspace tables are owned by the organization plugin, so their
 * columns follow Better Auth's camelCase field names (`workspaceId`) rather
 * than the starter's snake_case. Everything else still points at
 * `workspace_id` — hence the parameter.
 */
function workspaceRef(column = 'workspace_id') {
  return text(column)
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' })
}

function workspaceRefNullable() {
  return text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' })
}

function workspaceIdIndex(tableName: string, workspaceId: AnySQLiteColumn) {
  return index(`${tableName}_workspace_id_idx`).on(workspaceId)
}

export const user = sqliteTable('user', {
  id: id(),
  email: text('email').unique().notNull(),
  name: text('name').notNull(),
  image: text('image'),
  username: text('username').unique(),
  displayUsername: text('displayUsername'),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).default(false).notNull(),
  // The admin plugin's system role. Nullable because the plugin declares the
  // field optional — a row written before the default, or by a path that omits
  // it, reads as `null` and means `user`.
  role: text('role', { enum: systemRoles }).default('user'),
  banned: integer('banned', { mode: 'boolean' }).default(false),
  banReason: text('banReason'),
  banExpires: integer('banExpires', { mode: 'timestamp' }),
  // The twoFactor plugin declares this field on `user` (input: false — only
  // its own verify/disable endpoints flip it), so the column must exist for
  // the plugin writes to land.
  twoFactorEnabled: integer('twoFactorEnabled', { mode: 'boolean' })
    .default(false)
    .notNull(),
  // Optional account preferences. Null means the user has not selected a
  // locale or timezone; callers apply the platform defaults (`en`/`UTC`).
  locale: text('locale', { enum: accountLocales }),
  timeZone: text('timeZone'),
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
    impersonatedBy: text('impersonatedBy'),
    // The organization plugin declares this field on `session` unconditionally
    // — there is no config that switches it off — so the column must exist or
    // every plugin write against `session` fails. Whether the starter *reads*
    // it is ticket 03's call; slug-per-request resolution means it probably
    // will not.
    activeOrganizationId: text('activeOrganizationId'),
    passwordVerifiedAt: integer('passwordVerifiedAt', { mode: 'timestamp' }),
    strongAuthAt: integer('strongAuthAt', { mode: 'timestamp' }),
    strongAuthMethod: text('strongAuthMethod'),
    strongAuthCredentialId: text('strongAuthCredentialId'),
    recoveryUntil: integer('recoveryUntil', { mode: 'timestamp' })
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expiry_idx').on(table.expiresAt, table.id)
  ]
)

export const account = sqliteTable(
  'account',
  {
    id: id(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    issuer: text('issuer').notNull(),
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
  (table) => [
    index('account_user_id_idx').on(table.userId),
    uniqueIndex('account_issuer_accountId_uidx').on(table.issuer, table.accountId)
  ]
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
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expiry_idx').on(table.expiresAt, table.id)
  ]
)

// Owned by Better Auth's `twoFactor` plugin — the export key must stay the
// plugin's model name (`twoFactor`) because the drizzle adapter resolves
// `schema[modelName]`. One row per user; the secret is encrypted at rest by
// the plugin with the auth secret.
export const twoFactor = sqliteTable(
  'two_factor',
  {
    id: id(),
    secret: text('secret').notNull(),
    // A JSON string of the hashed backup codes — the plugin encodes and
    // decodes it itself, so plain `text`, like `workspaces.metadata`.
    backupCodes: text('backupCodes').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: integer('verified', { mode: 'boolean' }).default(true).notNull(),
    failedVerificationCount: integer('failedVerificationCount').default(0).notNull(),
    lockedUntil: integer('lockedUntil', { mode: 'timestamp' }),
    ...authTimestamps()
  },
  (table) => [
    index('two_factor_user_id_idx').on(table.userId),
    index('two_factor_secret_idx').on(table.secret)
  ]
)

// Owned by Better Auth's `passkey` plugin — the export key must stay the
// plugin's model name (`passkey`) because the drizzle adapter resolves
// `schema[modelName]`. One row per registered WebAuthn credential; the public
// key is the verifier's input, never a secret. Plugin-owned shape: camelCase
// columns, epoch-integer dates (ADR 0056).
export const passkey = sqliteTable(
  'passkey',
  {
    id: id(),
    // User-chosen label for the management UI; the plugin leaves it absent
    // when the ceremony carried no name.
    name: text('name'),
    publicKey: text('publicKey').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credentialID').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('deviceType').notNull(),
    backedUp: integer('backedUp', { mode: 'boolean' }).notNull(),
    // Comma-separated WebAuthn transport list; the plugin splits and joins it
    // itself, so plain `text`, like `two_factor.backupCodes`.
    transports: text('transports'),
    createdAt: authCreatedAt(),
    // The authenticator model's identifier, best-effort label source.
    aaguid: text('aaguid')
  },
  (table) => [
    index('passkey_user_id_idx').on(table.userId),
    index('passkey_credential_id_idx').on(table.credentialID)
  ]
)

// The three tables below are owned by Better Auth's `organization` plugin.
// The plugin's `organization`, `member`, and `invitation` models are remapped
// onto the starter's `workspace` vocabulary with `modelName` (see
// `packages/auth`), so the domain word never changes but the *shape* is the
// plugin's: its field names, its epoch-integer dates, its surrogate `id` keys.
// Add a column here only by adding an `additionalFields` entry on the plugin
// too — a column the plugin does not know about is invisible to its endpoints.

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  logo: text('logo'),
  // Plugin-owned free-form bag. The plugin JSON-stringifies on write and parses
  // on read itself, so this stays plain `text` — `mode: 'json'` would encode a
  // second time. The starter's own fields are `additionalFields` below, not
  // entries in here.
  metadata: text('metadata'),
  // additionalFields: typed, queryable, defaulted — `planId` is part of the
  // public `Workspace` DTO, so it does not belong in `metadata`.
  planId: text('planId').default('starter').notNull(),
  // Starter-owned, capability-only: when an owner or admin dismissed the
  // workspace's onboarding checklist. Read and written solely by the
  // `workspace-onboarding` capability, never by the plugin — so unlike
  // `planId` it deliberately has no `additionalFields` entry: nothing that
  // goes through a plugin endpoint needs it back. Epoch integer like the
  // rest of this plugin-shaped table.
  onboardingDismissedAt: integer('onboardingDismissedAt', { mode: 'timestamp' }),
  // Capability-owned lifecycle state. Never declare these as organization
  // additionalFields: the plugin must not expose internal reasons to customers.
  suspensionStatus: text('suspensionStatus', { enum: workspaceSuspensionStatuses })
    .default('active')
    .notNull(),
  suspensionInternalReason: text('suspensionInternalReason'),
  suspensionCustomerExplanation: text('suspensionCustomerExplanation'),
  suspensionChangedAt: text('suspensionChangedAt'),
  suspensionTransitionId: text('suspensionTransitionId'),
  suspensionChangedByUserId: text('suspensionChangedByUserId').references(
    () => user.id,
    { onDelete: 'set null' }
  ),
  ...authTimestamps()
})

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    // The plugin addresses members by a surrogate id (`removeMember`,
    // `updateMemberRole`), so the old composite primary key becomes the unique
    // index below. One membership per user per workspace still holds.
    id: id(),
    workspaceId: workspaceRef('workspaceId'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: workspaceRoles }).default('member').notNull(),
    createdAt: authCreatedAt()
  },
  (table) => [
    // Replaces the old primary key. Covers plain workspaceId lookups too
    // (leftmost prefix), so the plugin's index on that column is satisfied.
    uniqueIndex('workspace_members_workspace_id_user_id_idx').on(
      table.workspaceId,
      table.userId
    ),
    index('workspace_members_user_idx').on(table.userId)
  ]
)

export const workspaceInvitations = sqliteTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: workspaceRef('workspaceId'),
    email: text('email').notNull(),
    // Optional in the plugin's schema: an invitation may carry no role and
    // fall back to the plugin's default on accept.
    role: text('role', { enum: workspaceRoles }),
    status: text('status', { enum: invitationStatuses }).default('pending').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    // Database triggers stamp plugin-owned terminal transitions atomically.
    terminalAt: integer('terminalAt', { mode: 'timestamp' }),
    inviterId: text('inviterId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [
    workspaceIdIndex('workspace_invitations', table.workspaceId),
    index('workspace_invitations_email_idx').on(table.email),
    index('workspace_invitations_inviter_id_idx').on(table.inviterId),
    index('workspace_invitations_retention_idx').on(
      sql`CASE WHEN status = 'pending' THEN expiresAt ELSE terminalAt END`,
      table.id
    )
  ]
)

// Owned by Better Auth's `sso` plugin, same rules as the three organization
// tables above: the export key must stay the plugin's model name (`ssoProvider`
// is remapped onto `workspaceSsoConnections` in `packages/auth`), and the
// column shape is the plugin's — camelCase fields, a JSON-stringified config
// per protocol (plain `text`, like `workspaces.metadata`, because the plugin
// stringify/parses it itself), an epoch-integer `createdAt` via
// `additionalFields`. The starter's own columns (`enabled`, `requireSso`,
// `defaultWorkspaceRole`) are plugin `additionalFields`, not stray columns, so
// the plugin's register/update endpoints accept and return them.
export const workspaceSsoConnections = sqliteTable(
  'workspace_sso_connections',
  {
    id: id(),
    issuer: text('issuer').notNull(),
    // JSON-stringified OIDC / SAML config blobs written by the plugin. The
    // OIDC blob carries the client secret — reads go through the capability's
    // sanitized projection, never the raw column.
    oidcConfig: text('oidcConfig'),
    samlConfig: text('samlConfig'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('providerId').unique().notNull(),
    // The plugin names its foreign key `organizationId`; the column spells it
    // the starter's way, remapped in `packages/auth` like `workspaceMembers`.
    workspaceId: workspaceRef('workspaceId'),
    domain: text('domain').notNull(),
    // additionalFields — see the comment above the table.
    enabled: integer('enabled', { mode: 'boolean' }).default(false).notNull(),
    requireSso: integer('requireSso', { mode: 'boolean' }).default(false).notNull(),
    defaultWorkspaceRole: text('defaultWorkspaceRole', {
      enum: ssoProvisionedRoles
    })
      .default('member')
      .notNull(),
    createdAt: authCreatedAt()
  },
  (table) => [
    workspaceIdIndex('workspace_sso_connections', table.workspaceId),
    index('workspace_sso_connections_user_id_idx').on(table.userId),
    // The sign-in domain-routing lookup scans by domain first; the plugin
    // allows one IdP to serve several comma-separated domains, so this is an
    // index, not a unique constraint.
    index('workspace_sso_connections_domain_idx').on(table.domain)
  ]
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
      .$type<ReadonlyArray<ApiTokenScopeValue>>()
      .notNull(),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    replacedByTokenId: text('replaced_by_token_id'),
    revokedAt: text('revoked_at'),
    createdAt: isoCreatedAt(),
    createdByUserId: text('created_by_user_id').references(() => user.id)
  },
  (table) => [
    workspaceIdIndex('api_tokens', table.workspaceId),
    index('api_tokens_created_by_user_id_idx').on(table.createdByUserId),
    index('api_tokens_replaced_by_idx').on(table.replacedByTokenId),
    index('api_tokens_retention_idx').on(
      sql`CASE WHEN revoked_at IS NULL THEN expires_at WHEN expires_at IS NULL THEN revoked_at ELSE min(revoked_at, expires_at) END`,
      table.id
    )
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
    // Rotation grace: the secret a rotation replaced stays valid until
    // `previous_secret_expires_at` so a receiver can roll without dropping
    // deliveries. Both null until the first rotation; cleared once expired.
    previousSigningSecret: text('previous_signing_secret'),
    previousSecretExpiresAt: text('previous_secret_expires_at'),
    enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
    // The failure ladder (ADR 0062 addendum): consecutive failed delivery
    // attempts on this endpoint. Each recorded failure climbs the counter, a
    // delivered attempt resets it to zero. Storage-only bookkeeping for the
    // queue consumer's escalation — deliberately never on the wire projection.
    consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
    // Free-text subscriptions by design: a producer can add event types
    // without a migration (see webhook-endpoints.AGENTS.md in
    // packages/capabilities). The known vocabulary lives in the capabilities
    // package as `WEBHOOK_EVENT_TYPES` for the management UI.
    events: text('events', { mode: 'json' }).$type<ReadonlyArray<string>>().notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    workspaceIdIndex('webhook_endpoints', table.workspaceId),
    index('webhook_endpoints_previous_secret_idx').on(
      table.previousSecretExpiresAt,
      table.id
    )
  ]
)

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: text('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    status: text('status', { enum: deliveryStatuses }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: text('last_attempt_at'),
    nextAttemptAt: text('next_attempt_at'),
    responseStatus: integer('response_status'),
    // Operator tooling: the event payload at rest so a failed delivery can be
    // replayed verbatim, the request headers and a truncated response body
    // from the latest attempt, and the delivery this one was replayed from.
    // `replayed_from` is a plain reference, not a foreign key: the original
    // row may be pruned while its replay is still worth listing. The payload
    // is NOT NULL — every dispatch holds one, and terminal rows record what
    // they never sent or exhausted.
    payload: text('payload', { mode: 'json' }).$type<JsonValue>().notNull(),
    requestHeaders: text('request_headers', { mode: 'json' }).$type<
      Record<string, string>
    >(),
    responseBody: text('response_body'),
    replayedFrom: text('replayed_from'),
    lastAttemptToken: text('last_attempt_token')
  },
  (table) => [
    index('webhook_deliveries_endpoint_id_idx').on(table.endpointId),
    index('webhook_deliveries_retention_idx').on(table.lastAttemptAt, table.id),
    index('webhook_deliveries_recovery_idx').on(
      table.status,
      table.lastAttemptAt,
      table.id
    )
  ]
)

export const webhookDeliveryAttempts = sqliteTable(
  'webhook_delivery_attempts',
  {
    id: id(),
    deliveryId: text('delivery_id')
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull(),
    phase: text('phase', { enum: deliveryAttemptPhases }).notNull(),
    status: text('status', { enum: deliveryStatuses }).notNull(),
    attemptedAt: text('attempted_at').notNull(),
    durationMs: integer('duration_ms'),
    failureReason: text('failure_reason'),
    responseStatus: integer('response_status'),
    requestHeaders: text('request_headers', { mode: 'json' }).$type<
      Record<string, string>
    >(),
    responseBody: text('response_body')
  },
  (table) => [
    uniqueIndex('webhook_delivery_attempt_identity_idx').on(
      table.deliveryId,
      table.attempts,
      table.phase
    ),
    uniqueIndex('webhook_delivery_terminal_identity_idx')
      .on(table.deliveryId)
      .where(sql`${table.phase} = 'terminal'`)
  ]
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    // What the notification is about; selects the email template and the
    // recipient's channel preference. Rows written before the column existed
    // read as `announcement`.
    kind: text('kind', { enum: notificationKinds }).default('announcement').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    // Structured data for system notifications. Literal announcements use null;
    // event renderers use the recipient's current locale for system events.
    event: text('event', { mode: 'json' }).$type<JsonObject | null>(),
    readAt: text('read_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [
    workspaceIdIndex('notifications', table.workspaceId),
    index('notifications_retention_idx').on(table.createdAt, table.id),
    index('notifications_user_id_idx').on(table.userId)
  ]
)

/**
 * One row per (user, kind) the user has set explicitly. A missing row means
 * the kind's default channel applies (`instant` for the security kinds,
 * `digest` otherwise) — the defaults live in code, not in seeded rows, so a
 * new kind needs no backfill.
 */
export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: notificationKinds }).notNull(),
    channel: text('channel', { enum: notificationChannels }).notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('notification_preferences_user_kind_idx').on(table.userId, table.kind)
  ]
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorType: text('actor_type', { enum: auditActorTypes }).notNull(),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: text('metadata', { mode: 'json' })
      .$type<JsonObject>()
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
    index('audit_events_actor_user_id_idx').on(table.actorUserId),
    index('audit_events_retention_idx').on(table.createdAt, table.id)
  ]
)

/**
 * Workspace data export jobs (ADR 0055). One row per request: `pending` until
 * the background worker builds the archive, then `ready` with the R2 object
 * key, or `failed`. `downloadSecret` is the per-export HMAC key behind the
 * signed download link — both workers share this table, so no cross-worker
 * secret is needed. `expiresAt` mirrors the bucket's lifecycle rule.
 */
export const workspaceExports = sqliteTable(
  'workspace_exports',
  {
    id: id(),
    workspaceId: workspaceRef(),
    // Set null rather than cascade: an export outlives the account that asked
    // for it, and the row is what the audit trail's `targetId` points at.
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null'
    }),
    status: text('status', { enum: workspaceExportStatuses })
      .default('pending')
      .notNull(),
    objectKey: text('object_key'),
    sizeBytes: integer('size_bytes'),
    downloadSecret: text('download_secret').notNull(),
    failureReason: text('failure_reason'),
    createdAt: isoCreatedAt(),
    completedAt: text('completed_at'),
    expiresAt: text('expires_at')
  },
  (table) => [
    workspaceIdIndex('workspace_exports', table.workspaceId),
    index('workspace_exports_requested_by_user_id_idx').on(table.requestedByUserId),
    index('workspace_exports_retention_idx').on(table.completedAt, table.id),
    index('workspace_exports_secret_expiry_idx').on(
      sql`CASE WHEN status = 'failed' THEN completed_at ELSE expires_at END`,
      table.id
    ),
    index('workspace_exports_recovery_idx').on(table.status, table.createdAt, table.id)
  ]
)

/*
 * Better Auth `jwt` plugin and `@better-auth/mcp` (the OAuth 2.1 provider it is
 * built on) — ADR 0055. Plugin-owned shape: camelCase columns, epoch-integer
 * dates, surrogate `id` keys, `string[]`/`json` fields as JSON text. The
 * export keys are the plugin's model names, which is what the drizzle adapter
 * resolves models by; the SQL names are snake_case like every other table.
 */

/** A Better Auth `string[]` field: JSON text holding a string array. */
function authStringArray(column: string) {
  return text(column, { mode: 'json' }).$type<ReadonlyArray<string>>()
}

/** A Better Auth `json` field with no declared shape beyond "JSON". */
function authJson(column: string) {
  return text(column, { mode: 'json' }).$type<JsonValue>()
}

/** The jwt plugin's signing keys; the public halves are served at `/api/auth/jwks`. */
export const jwks = sqliteTable('jwks', {
  id: id(),
  publicKey: text('publicKey').notNull(),
  privateKey: text('privateKey').notNull(),
  createdAt: authCreatedAt(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }),
  alg: text('alg'),
  crv: text('crv')
})

/** An OAuth client — for MCP, discovered from a Client ID Metadata Document. */
export const oauthClient = sqliteTable(
  'oauth_client',
  {
    id: id(),
    clientId: text('clientId').unique().notNull(),
    clientSecret: text('clientSecret'),
    clientDiscoveryId: text('clientDiscoveryId'),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skipConsent', { mode: 'boolean' }),
    enableEndSession: integer('enableEndSession', { mode: 'boolean' }),
    subjectType: text('subjectType'),
    scopes: authStringArray('scopes'),
    clientCredentialsScopes: authStringArray('clientCredentialsScopes').default(
      sql`'[]'`
    ),
    userId: text('userId').references(() => user.id),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: authStringArray('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('softwareId'),
    softwareVersion: text('softwareVersion'),
    softwareStatement: text('softwareStatement'),
    redirectUris: authStringArray('redirectUris').notNull(),
    postLogoutRedirectUris: authStringArray('postLogoutRedirectUris'),
    backchannelLogoutUri: text('backchannelLogoutUri'),
    backchannelLogoutSessionRequired: integer('backchannelLogoutSessionRequired', {
      mode: 'boolean'
    }),
    tokenEndpointAuthMethod: text('tokenEndpointAuthMethod'),
    applicationType: text('applicationType'),
    jwks: text('jwks'),
    jwksUri: text('jwksUri'),
    grantTypes: authStringArray('grantTypes'),
    responseTypes: authStringArray('responseTypes'),
    requirePKCE: integer('requirePKCE', { mode: 'boolean' }),
    dpopBoundAccessTokens: integer('dpopBoundAccessTokens', {
      mode: 'boolean'
    }).default(false),
    referenceId: text('referenceId'),
    metadata: authJson('metadata')
  },
  (table) => [index('oauth_client_user_id_idx').on(table.userId)]
)

/** A protected resource (RFC 8707) — the MCP server's `/mcp` URL is seeded at boot. */
export const oauthResource = sqliteTable('oauth_resource', {
  id: id(),
  identifier: text('identifier').unique().notNull(),
  name: text('name').notNull(),
  accessTokenTtl: integer('accessTokenTtl'),
  refreshTokenTtl: integer('refreshTokenTtl'),
  signingAlgorithm: text('signingAlgorithm'),
  signingKeyId: text('signingKeyId'),
  allowedScopes: authStringArray('allowedScopes'),
  customClaims: authJson('customClaims'),
  dpopBoundAccessTokensRequired: integer('dpopBoundAccessTokensRequired', {
    mode: 'boolean'
  }).default(false),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  createdAt: integer('createdAt', { mode: 'timestamp' }),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
  policyVersion: integer('policyVersion').default(1),
  metadata: authJson('metadata')
})

/** Which clients may request which resources (the plugin links MCP clients on registration). */
export const oauthClientResource = sqliteTable(
  'oauth_client_resource',
  {
    id: id(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resourceId')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: authJson('metadata'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
  },
  (table) => [
    index('oauth_client_resource_resource_id_idx').on(table.resourceId),
    uniqueIndex('oauth_client_resource_client_resource_idx').on(
      table.clientId,
      table.resourceId
    )
  ]
)

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    id: id(),
    token: text('token').unique().notNull(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('sessionId').references(() => session.id, { onDelete: 'set null' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    revoked: integer('revoked', { mode: 'timestamp' }),
    rotatedAt: integer('rotatedAt', { mode: 'timestamp' }),
    rotationReplayResponse: text('rotationReplayResponse'),
    rotationReplayExpiresAt: integer('rotationReplayExpiresAt', { mode: 'timestamp' }),
    authTime: integer('authTime', { mode: 'timestamp' }),
    confirmation: authJson('confirmation'),
    scopes: authStringArray('scopes').notNull()
  },
  (table) => [
    index('oauth_refresh_token_client_id_idx').on(table.clientId),
    index('oauth_refresh_token_session_id_idx').on(table.sessionId),
    index('oauth_refresh_token_user_id_idx').on(table.userId),
    index('oauth_refresh_token_authorization_code_id_idx').on(table.authorizationCodeId)
  ]
)

/** Opaque access tokens only; MCP access tokens are JWTs and never land here. */
export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: id(),
    token: text('token').unique().notNull(),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text('sessionId').references(() => session.id, { onDelete: 'set null' }),
    userId: text('userId').references(() => user.id),
    referenceId: text('referenceId'),
    authorizationCodeId: text('authorizationCodeId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    refreshId: text('refreshId').references(() => oauthRefreshToken.id),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: authCreatedAt(),
    revoked: integer('revoked', { mode: 'timestamp' }),
    confirmation: authJson('confirmation'),
    scopes: authStringArray('scopes').notNull()
  },
  (table) => [
    index('oauth_access_token_client_id_idx').on(table.clientId),
    index('oauth_access_token_session_id_idx').on(table.sessionId),
    index('oauth_access_token_user_id_idx').on(table.userId),
    index('oauth_access_token_authorization_code_id_idx').on(table.authorizationCodeId),
    index('oauth_access_token_refresh_id_idx').on(table.refreshId),
    index('oauth_access_token_expiry_idx').on(table.expiresAt, table.id)
  ]
)

/**
 * The Stripe subscription state one workspace carries: the customer the
 * Billing Portal is opened for, and the subscription item whose quantity
 * mirrors the workspace's member count on a per-seat plan. One row per
 * workspace, written only by the billing capability from provider events;
 * a workspace without a row has never checked out.
 */
export const workspaceSubscriptions = sqliteTable(
  'workspace_subscriptions',
  {
    workspaceId: workspaceRef().primaryKey(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    // Null once the subscription is deleted: the customer survives (invoices
    // stay reachable in the portal), the seat item does not.
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeSubscriptionItemId: text('stripe_subscription_item_id'),
    status: text('status', { enum: billingLifecycleStatuses })
      .default('canceled')
      .notNull(),
    stripePriceId: text('stripe_price_id'),
    subscribedPlanId: text('subscribed_plan_id').default('starter').notNull(),
    currentPeriodStart: text('current_period_start'),
    currentPeriodEnd: text('current_period_end'),
    cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' })
      .default(false)
      .notNull(),
    trialEnd: text('trial_end'),
    firstFailedAt: text('first_failed_at'),
    graceEndsAt: text('grace_ends_at'),
    lastPaymentAt: text('last_payment_at'),
    paymentVerified: integer('payment_verified', { mode: 'boolean' })
      .default(false)
      .notNull(),
    // The quantity Stripe last reported. `syncSeats` compares the member count
    // against this before calling the provider.
    seatQuantity: integer('seat_quantity').default(0).notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    // One Stripe customer belongs to one workspace in this baseline. A
    // violation is surfaced as durable conflict evidence instead of repaired.
    uniqueIndex('workspace_subscriptions_stripe_customer_idx').on(
      table.stripeCustomerId
    )
  ]
)

/**
 * Starter downgrade selections. Resource rows remain untouched when a plan
 * changes; this table only records which ids may execute while a category is
 * over its Starter ceiling.
 */
export const workspaceResourceSelections = sqliteTable(
  'workspace_resource_selections',
  {
    workspaceId: workspaceRef().primaryKey(),
    apiTokenIds: text('api_token_ids', { mode: 'json' })
      .$type<ReadonlyArray<string>>()
      .notNull(),
    webhookEndpointIds: text('webhook_endpoint_ids', { mode: 'json' })
      .$type<ReadonlyArray<string>>()
      .notNull(),
    updatedAt: text('updated_at').notNull()
  }
)

/**
 * Minimal, replay-safe evidence for one inbound Stripe event. The raw webhook
 * body is intentionally not retained: Stripe can be queried during recovery,
 * while this row is enough to deduplicate, inspect, and retry processing.
 */
export const billingProviderEvents = sqliteTable(
  'billing_provider_events',
  {
    id: id(),
    providerEventId: text('provider_event_id').unique().notNull(),
    eventType: text('event_type').notNull(),
    providerCreatedAt: text('provider_created_at'),
    // Provider evidence survives workspace deletion for the retention window;
    // the workspace link is cleared while the event identity remains inspectable.
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'set null'
    }),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    status: text('status', { enum: billingProviderEventStatuses })
      .default('processing')
      .notNull(),
    outcome: text('outcome'),
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').default(1).notNull(),
    receivedAt: text('received_at').notNull(),
    completedAt: text('completed_at'),
    resolvedAt: text('resolved_at'),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('billing_provider_events_status_idx').on(table.status, table.updatedAt),
    index('billing_provider_events_workspace_idx').on(
      table.workspaceId,
      table.receivedAt
    ),
    index('billing_provider_events_retention_idx').on(
      sql`coalesce(resolved_at, completed_at)`,
      table.id
    )
  ]
)

/**
 * Per-workspace convergence state. `leaseFence` is monotonically increasing;
 * a stale worker can never commit after another worker has claimed the lease.
 */
export const billingSynchronization = sqliteTable(
  'billing_synchronization',
  {
    workspaceId: workspaceRef().primaryKey(),
    status: text('status', { enum: billingSynchronizationStatuses })
      .default('pending')
      .notNull(),
    desiredSeatQuantity: integer('desired_seat_quantity'),
    observedSeatQuantity: integer('observed_seat_quantity'),
    lastSyncedAt: text('last_synced_at'),
    lastAttemptAt: text('last_attempt_at'),
    unresolvedSince: text('unresolved_since'),
    failureCount: integer('failure_count').default(0).notNull(),
    nextAttemptAt: text('next_attempt_at'),
    failureReason: text('failure_reason'),
    conflictReason: text('conflict_reason'),
    leaseOwner: text('lease_owner'),
    leaseFence: integer('lease_fence').default(0).notNull(),
    leaseExpiresAt: text('lease_expires_at'),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('billing_synchronization_unresolved_status_idx').on(
      table.unresolvedSince,
      table.status
    )
  ]
)

/**
 * Durable checkout handoff. A pending/created row lets an interrupted request
 * safely reuse a Stripe session instead of creating another subscription.
 */
export const billingCheckoutClaims = sqliteTable(
  'billing_checkout_claims',
  {
    id: id(),
    workspaceId: workspaceRef(),
    planId: text('plan_id').notNull(),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    priceId: text('price_id').notNull(),
    quantity: integer('quantity').notNull(),
    successUrl: text('success_url').notNull(),
    cancelUrl: text('cancel_url').notNull(),
    status: text('status', { enum: billingCheckoutStatuses })
      .default('pending')
      .notNull(),
    stripeSessionId: text('stripe_session_id'),
    checkoutUrl: text('checkout_url'),
    attemptCount: integer('attempt_count').default(1).notNull(),
    failureReason: text('failure_reason'),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('billing_checkout_claims_workspace_open_idx')
      .on(table.workspaceId)
      .where(sql`${table.status} in ('pending', 'created')`),
    index('billing_checkout_claims_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt
    ),
    index('billing_checkout_claims_retention_idx').on(table.updatedAt, table.id)
  ]
)

/**
 * One user's standing consent to one MCP Client. `referenceId` is the chosen
 * workspace id (the consent page's pick, carried by the plugin's reference
 * mechanism — see `packages/auth`), so a client consented for workspace A holds
 * no consent for workspace B.
 */
export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: id(),
    // DB trigger increments on consent changes, including same-second updates.
    grantVersion: integer('grant_version').notNull().default(0),
    clientId: text('clientId')
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text('userId').references(() => user.id),
    referenceId: text('referenceId'),
    resources: authStringArray('resources'),
    requestedUserInfoClaims: authStringArray('requestedUserInfoClaims'),
    scopes: authStringArray('scopes').notNull(),
    ...authTimestamps()
  },
  (table) => [
    index('oauth_consent_client_id_idx').on(table.clientId),
    index('oauth_consent_user_id_idx').on(table.userId)
  ]
)

/** Replay guard for `private_key_jwt` client assertions (`jti` + expiry). */
export const oauthClientAssertion = sqliteTable(
  'oauth_client_assertion',
  {
    id: id(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull()
  },
  (table) => [index('oauth_client_assertion_expiry_idx').on(table.expiresAt, table.id)]
)

/** Durable billing notice outbox, committed with the lifecycle projection. */
export const billingNotices = sqliteTable(
  'billing_notices',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef().notNull(),
    noticeType: text('notice_type').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    createdAt: text('created_at').notNull(),
    deliveredAt: text('delivered_at')
  },
  (table) => [
    index('billing_notices_retention_idx').on(table.deliveredAt, table.id),
    index('billing_notices_workspace_delivered_idx').on(
      table.workspaceId,
      table.deliveredAt
    )
  ]
)

/** Sanitized delivery evidence. Never stores message contents or credentials. */
export const emailDeliveries = sqliteTable(
  'email_deliveries',
  {
    id: text('id').primaryKey(),
    referenceId: text('reference_id'),
    purpose: text('purpose', { enum: emailPurposes }).notNull(),
    recipient: text('recipient').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade'
    }),
    status: text('status', { enum: emailDeliveryStatuses }).notNull(),
    providerMessageId: text('provider_message_id'),
    lastEventId: text('last_event_id'),
    lastEventAt: text('last_event_at'),
    reason: text('reason'),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    retryUntil: text('retry_until').notNull(),
    nextAttemptAt: text('next_attempt_at').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    uncertain: integer('uncertain', { mode: 'boolean' }).notNull(),
    token: text('token'),
    revision: integer('revision').notNull()
  },
  (table) => [
    index('email_deliveries_user_idx').on(table.userId, table.createdAt),
    index('email_deliveries_workspace_idx').on(
      table.workspaceId,
      table.purpose,
      table.createdAt
    ),
    index('email_deliveries_provider_idx').on(table.providerMessageId, table.recipient),
    index('email_deliveries_accepted_updated_idx').on(
      table.acceptedAt,
      table.updatedAt
    ),
    index('email_deliveries_status_created_idx').on(table.status, table.createdAt),
    index('email_deliveries_retention_idx').on(table.createdAt, table.id)
  ]
)

/** Operator housekeeping cursors, separate from customer and recovery evidence. */
export const retentionProgress = sqliteTable('retention_progress', {
  recordClass: text('record_class').primaryKey(),
  policyDigest: text('policy_digest').notNull(),
  cursorClock: text('cursor_clock'),
  cursorId: text('cursor_id'),
  lastSuccessAt: text('last_success_at'),
  lastEvaluatedAt: text('last_evaluated_at').notNull(),
  hasMore: integer('has_more', { mode: 'boolean' }).notNull(),
  failure: text('failure')
})
