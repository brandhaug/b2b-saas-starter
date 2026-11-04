import { sql } from 'drizzle-orm'
import { Schema } from 'effect'
import { jsonText } from '../json-column.ts'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import {
  billingProviderEventStatuses,
  billingSynchronizationStatuses,
  billingCheckoutStatuses,
  billingLifecycleStatuses,
  billingIntervals
} from '../enums.ts'
import { workspaceRef, workspaces } from './workspaces.ts'
import { id } from './columns.ts'

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
    interval: text('interval', { enum: billingIntervals }),
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
    apiTokenIds: jsonText(
      'workspace_resource_selections',
      'api_token_ids',
      Schema.Array(ApiTokenId)
    ).notNull(),
    webhookEndpointIds: jsonText(
      'workspace_resource_selections',
      'webhook_endpoint_ids',
      Schema.Array(WebhookEndpointId)
    ).notNull(),
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
import { ApiTokenId, WebhookEndpointId } from '../ids.ts'
