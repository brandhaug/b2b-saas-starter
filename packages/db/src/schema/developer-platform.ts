import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  type ApiTokenScopeValue,
  deliveryStatuses,
  deliveryAttemptPhases
} from '../enums.ts'
import { user } from './auth.ts'
import { workspaceRef } from './workspaces.ts'
import { id, isoCreatedAt, workspaceIdIndex } from './columns.ts'
import { type JsonValue, type JsonObject } from './json.ts'

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
    approvedEndpointUrl: text('approved_endpoint_url'),
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

export const webhookInvestigationTasks = sqliteTable(
  'webhook_investigation_tasks',
  {
    id: id(),
    workspaceId: workspaceRef(),
    status: text('status', {
      enum: ['proposed', 'approved', 'cancelled', 'completed']
    }).notNull(),
    record: text('record', { mode: 'json' }).$type<JsonObject>().notNull(),
    replayDeliveryId: text('replay_delivery_id'),
    transitionId: text('transition_id'),
    createdAt: isoCreatedAt(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('webhook_investigation_tasks_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
      table.id
    ),
    uniqueIndex('webhook_investigation_tasks_replay_idx').on(table.replayDeliveryId)
  ]
)
