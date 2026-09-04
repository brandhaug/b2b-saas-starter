import {
  deliveryStatuses,
  invitationStatuses,
  ssoProvisionedRoles,
  systemRoles,
  workspaceExportStatuses,
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
  apiTokenScopes,
  deliveryStatuses,
  invitationStatuses,
  ssoProvisionedRoles,
  systemRoles,
  workspaceExportStatuses,
  workspaceRoles,
  type ApiTokenScopeValue,
  type DeliveryStatus,
  type SsoProvisionedRoleValue,
  type SystemRoleValue,
  type WorkspaceExportStatus
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
    activeOrganizationId: text('activeOrganizationId')
  },
  (table) => [index('session_user_id_idx').on(table.userId)]
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
  (table) => [index('verification_identifier_idx').on(table.identifier)]
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
    inviterId: text('inviterId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' })
  },
  (table) => [
    workspaceIdIndex('workspace_invitations', table.workspaceId),
    index('workspace_invitations_email_idx').on(table.email),
    index('workspace_invitations_inviter_id_idx').on(table.inviterId)
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
    // Free-text subscriptions by design: a producer can add event types
    // without a migration (see webhook-endpoints.AGENTS.md in
    // packages/capabilities). The known vocabulary lives in the capabilities
    // package as `WEBHOOK_EVENT_TYPES` for the management UI.
    events: text('events', { mode: 'json' }).$type<ReadonlyArray<string>>().notNull(),
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
    status: text('status', { enum: deliveryStatuses }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    lastAttemptAt: text('last_attempt_at'),
    nextAttemptAt: text('next_attempt_at'),
    responseStatus: integer('response_status')
  },
  (table) => [index('webhook_deliveries_endpoint_id_idx').on(table.endpointId)]
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
    index('audit_events_actor_user_id_idx').on(table.actorUserId)
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
    index('workspace_exports_requested_by_user_id_idx').on(table.requestedByUserId)
  ]
)

/**
 * The Stripe subscription state one workspace carries: the customer the
 * Billing Portal is opened for, and the subscription item whose quantity
 * mirrors the workspace's member count on a per-seat plan. One row per
 * workspace, written only by the billing capability from provider events;
 * a workspace without a row has never checked out.
 */
export const workspaceSubscriptions = sqliteTable('workspace_subscriptions', {
  workspaceId: workspaceRef().primaryKey(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  // Null once the subscription is deleted: the customer survives (invoices
  // stay reachable in the portal), the seat item does not.
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionItemId: text('stripe_subscription_item_id'),
  // The quantity Stripe last reported. `syncSeats` compares the member count
  // against this before calling the provider.
  seatQuantity: integer('seat_quantity').default(0).notNull(),
  updatedAt: text('updated_at').notNull()
})
