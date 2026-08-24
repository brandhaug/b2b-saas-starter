import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core'

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const workspaceRoles = ['owner', 'admin', 'member'] as const
/**
 * The Better Auth organization plugin's invitation state machine. `canceled`
 * carries the plugin's single-`l` spelling — the value is written by the
 * plugin, so the enum must match it byte for byte.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const invitationStatuses = [
  'pending',
  'accepted',
  'rejected',
  'canceled'
] as const
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
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** A JSON object payload — the shape of every `mode: 'json'` metadata column. */
export type JsonObject = Readonly<Record<string, JsonValue>>

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const apiTokenScopes = ['read', 'write', 'admin'] as const
export type ApiTokenScopeValue = (typeof apiTokenScopes)[number]
// Shared column helpers. Two timestamp dialects coexist by design: Better Auth
// tables store epoch-seconds in integer columns (its plugin contract), starter
// tables store ISO strings in text columns — see AGENTS.md before normalizing.
// Drizzle column builders are single-use, so every helper returns fresh
// builders per call.
function id() {
  return text('id').primaryKey()
}

function authCreatedAt() {
  return integer('createdAt', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull()
}

function authTimestamps() {
  return {
    createdAt: authCreatedAt(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
  }
}

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
