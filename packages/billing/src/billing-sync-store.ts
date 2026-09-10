import { makeBillingNotices } from './billing-notices.live.ts'
import { decodeSubscriptionRow } from './subscription-row.ts'
import {
  billingProviderEvents,
  billingSynchronization,
  workspaceSubscriptions,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database, type BatchStatement } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { AuditEventLog } from './ports.ts'
import { newCapabilityId } from './internal/ids.ts'
import { makeBillingLease, type BillingLease } from './billing-lease.ts'
import {
  billingStoreUnavailable,
  planChangeMetadata,
  seatChangeMetadata,
  type SubscriptionState,
  type ProcessProviderEventInput
} from './billing.ts'
import { type BillingStateDecision } from './billing-state.ts'

/** The atomic storage boundary shared by webhook, queue, and scheduled work. */
export const makeBillingSyncStore = Effect.fn('Billing.makeSyncStore')(function* () {
  const db = yield* Database
  const audit = yield* AuditEventLog
  const leases = yield* makeBillingLease()
  const notices = yield* makeBillingNotices()
  const unavailable = billingStoreUnavailable

  const read = Effect.fn('Billing.readSyncState')(function* (workspaceId: string) {
    const rows = yield* unavailable(
      db
        .select({
          planId: workspaces.planId,
          subscription: workspaceSubscriptions,
          customerId: workspaceSubscriptions.stripeCustomerId,
          subscriptionId: workspaceSubscriptions.stripeSubscriptionId,
          itemId: workspaceSubscriptions.stripeSubscriptionItemId,
          quantity: workspaceSubscriptions.seatQuantity,
          // The whole subscription row rides along above; these are the
          // routing columns the workflow compares directly.
          unresolvedSince: billingSynchronization.unresolvedSince,
          failureCount: billingSynchronization.failureCount
        })
        .from(workspaces)
        .leftJoin(
          workspaceSubscriptions,
          eq(workspaceSubscriptions.workspaceId, workspaces.id)
        )
        .leftJoin(
          billingSynchronization,
          eq(billingSynchronization.workspaceId, workspaces.id)
        )
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
    )
    return rows[0]
  })

  const event = Effect.fn('Billing.readProviderEvidence')(function* (
    providerEventId: string
  ) {
    const rows = yield* unavailable(
      db
        .select()
        .from(billingProviderEvents)
        .where(eq(billingProviderEvents.providerEventId, providerEventId))
        .limit(1)
    )
    return rows[0]
  })

  const recordEvent = Effect.fn('Billing.recordProviderEvidence')(function* (
    input: ProcessProviderEventInput,
    workspaceId: string | null
  ) {
    const now = DateTime.formatIso(yield* DateTime.now)
    yield* unavailable(
      db
        .insert(billingProviderEvents)
        .values({
          id: yield* newCapabilityId('bill_evt'),
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          providerCreatedAt: input.providerCreatedAt ?? null,
          workspaceId,
          stripeCustomerId: input.subscription?.customerId ?? null,
          stripeSubscriptionId: input.subscription?.subscriptionId ?? null,
          status: 'processing',
          attemptCount: 0,
          receivedAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: billingProviderEvents.providerEventId })
    )
  })

  const begin = Effect.fn('Billing.beginSynchronization')(function* (
    lease: BillingLease,
    input?: ProcessProviderEventInput
  ) {
    const now = DateTime.formatIso(yield* DateTime.now)
    const statements: Array<BatchStatement> = [
      db
        .update(billingSynchronization)
        .set({ lastAttemptAt: now, updatedAt: now })
        .where(eq(billingSynchronization.workspaceId, lease.workspaceId))
    ]
    if (input !== undefined) {
      statements.push(
        db
          .update(billingProviderEvents)
          .set({
            workspaceId: lease.workspaceId,
            status: 'processing',
            attemptCount: sql`${billingProviderEvents.attemptCount} + 1`,
            updatedAt: now
          })
          .where(eq(billingProviderEvents.providerEventId, input.providerEventId))
      )
    }
    yield* leases.fencedBatch(lease, statements)
  })

  const fail = Effect.fn('Billing.recordSynchronizationFailure')(function* (
    lease: BillingLease,
    reason: string,
    conflict: boolean,
    input?: ProcessProviderEventInput
  ) {
    const now = DateTime.formatIso(yield* DateTime.now)
    const previous = yield* read(lease.workspaceId)
    const failureCount = (previous?.failureCount ?? 0) + 1
    // Retry deadlines survive worker restarts; Cloudflare owns the wait.
    const delayMinutes = Math.min(15, 2 ** Math.min(failureCount - 1, 4))
    const nextAttemptAt = DateTime.formatIso(
      DateTime.add(yield* DateTime.now, { minutes: delayMinutes })
    )
    let status: 'conflict' | 'delayed' = 'delayed'
    let eventStatus: 'conflict' | 'failed' = 'failed'
    if (conflict) {
      status = 'conflict'
      eventStatus = 'conflict'
    }
    const statements: Array<BatchStatement> = [
      db
        .update(billingSynchronization)
        .set({
          status,
          failureReason: reason,
          conflictReason: null,
          failureCount,
          nextAttemptAt,
          unresolvedSince: sql`coalesce(${billingSynchronization.unresolvedSince}, ${now})`,
          lastAttemptAt: now,
          updatedAt: now
        })
        .where(eq(billingSynchronization.workspaceId, lease.workspaceId))
    ]
    if (conflict) {
      statements.push(
        db
          .update(billingSynchronization)
          .set({ conflictReason: reason })
          .where(eq(billingSynchronization.workspaceId, lease.workspaceId))
      )
    }
    if (input !== undefined) {
      statements.push(
        db
          .update(billingProviderEvents)
          .set({
            status: eventStatus,
            outcome: reason,
            failureReason: reason,
            updatedAt: now,
            resolvedAt: null
          })
          .where(eq(billingProviderEvents.providerEventId, input.providerEventId))
      )
    }
    yield* leases.fencedBatch(lease, statements)
    const state = yield* read(lease.workspaceId)
    let unresolvedMs = 0
    if (state?.unresolvedSince !== null && state?.unresolvedSince !== undefined) {
      unresolvedMs = Date.parse(now) - Date.parse(state.unresolvedSince)
    }
    const fields = {
      workspaceId: lease.workspaceId,
      stripeEventId: input?.providerEventId,
      billingOutcome: status,
      billingFailureReason: reason,
      billingUnresolvedMs: unresolvedMs,
      billingTerminalFailure: conflict || unresolvedMs >= 900_000
    }
    if (fields.billingTerminalFailure) {
      yield* Effect.logError('Billing synchronization requires recovery').pipe(
        Effect.annotateLogs(fields)
      )
    } else {
      yield* Effect.logWarning('Billing synchronization will retry').pipe(
        Effect.annotateLogs(fields)
      )
    }
  })

  const commit = Effect.fn('Billing.commitSynchronization')(function* (
    lease: BillingLease,
    before: NonNullable<Effect.Success<ReturnType<typeof read>>>,
    decision: Extract<BillingStateDecision, { kind: 'resolved' }>,
    desiredQuantity: number,
    input: ProcessProviderEventInput | undefined,
    reason: string | undefined,
    checkoutUncertain: boolean
  ) {
    const now = DateTime.formatIso(yield* DateTime.now)
    const next = decision.subscription
    const lifecycleStatus = next.status
    const effectivePlanId = decision.planId
    let unresolvedSince: string | null = null
    let failureCount = 0
    if (checkoutUncertain) {
      unresolvedSince = before.unresolvedSince
      failureCount = before.failureCount ?? 0
    }
    let synchronizationStatus: 'current' | 'pending' = 'current'
    if (!decision.verified || desiredQuantity !== next.seatQuantity) {
      synchronizationStatus = 'pending'
    }
    let nextAttemptMinutes = 5
    if (synchronizationStatus === 'pending') {
      nextAttemptMinutes = 1
    }
    const statements: Array<BatchStatement> = []
    const drift: Array<string> = []
    const detail = {
      source: 'reconciliation',
      ...input?.detail,
      providerEventId: input?.providerEventId ?? null
    }
    if (reason !== undefined) {
      Object.assign(detail, { reason })
    }
    if (before.planId !== effectivePlanId) {
      drift.push('plan')
      statements.push(
        db
          .update(workspaces)
          .set({ planId: effectivePlanId })
          .where(eq(workspaces.id, lease.workspaceId)),
        yield* audit.prepareRecord({
          workspaceId: lease.workspaceId,
          actorUserId: null,
          actorType: 'system',
          eventType: 'billing.plan_changed',
          targetType: 'workspace',
          targetId: lease.workspaceId,
          metadata: planChangeMetadata(effectivePlanId, detail)
        })
      )
    }
    if (
      before.customerId !== next.customerId ||
      before.subscriptionId !== next.subscriptionId ||
      before.itemId !== next.subscriptionItemId
    ) {
      drift.push('subscription_linkage')
    }
    if ((before.quantity ?? 0) !== next.seatQuantity) {
      drift.push('seat_quantity')
      statements.push(
        yield* audit.prepareRecord({
          workspaceId: lease.workspaceId,
          actorUserId: null,
          actorType: 'system',
          eventType: 'billing.seats_changed',
          targetType: 'workspace',
          targetId: lease.workspaceId,
          metadata: seatChangeMetadata(next.seatQuantity, detail)
        })
      )
    }
    const values = {
      stripeCustomerId: next.customerId,
      stripeSubscriptionId: next.subscriptionId,
      stripeSubscriptionItemId: next.subscriptionItemId,
      seatQuantity: next.seatQuantity,
      status: lifecycleStatus,
      stripePriceId: next.priceId,
      subscribedPlanId: next.subscribedPlanId,
      currentPeriodStart: next.currentPeriodStart ?? null,
      currentPeriodEnd: next.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: next.cancelAtPeriodEnd,
      trialEnd: next.trialEnd ?? null,
      firstFailedAt: next.firstFailedAt,
      graceEndsAt: next.graceEndsAt,
      lastPaymentAt: next.lastPaymentAt,
      paymentVerified: next.paymentVerified,
      updatedAt: now
    }
    statements.push(
      db
        .insert(workspaceSubscriptions)
        .values({ workspaceId: lease.workspaceId, ...values })
        .onConflictDoUpdate({
          target: workspaceSubscriptions.workspaceId,
          set: values
        }),
      db
        .update(billingSynchronization)
        .set({
          status: synchronizationStatus,
          desiredSeatQuantity: desiredQuantity,
          observedSeatQuantity: next.seatQuantity,
          lastSyncedAt: now,
          lastAttemptAt: now,
          failureReason: null,
          conflictReason: null,
          unresolvedSince,
          failureCount,
          nextAttemptAt: DateTime.formatIso(
            DateTime.add(yield* DateTime.now, { minutes: nextAttemptMinutes })
          ),
          updatedAt: now
        })
        .where(eq(billingSynchronization.workspaceId, lease.workspaceId)),
      db
        .update(billingProviderEvents)
        .set({
          status: 'completed',
          outcome: 'reconciled',
          failureReason: null,
          completedAt: now,
          resolvedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(billingProviderEvents.workspaceId, lease.workspaceId),
            inArray(billingProviderEvents.status, ['processing', 'failed', 'conflict']),
            sql`(${billingProviderEvents.stripeCustomerId} IS NULL OR ${billingProviderEvents.stripeCustomerId} = ${next.customerId})`
          )
        )
    )
    // The original event may have omitted the customer; retain the resolved linkage.
    if (input !== undefined) {
      statements.push(
        db
          .update(billingProviderEvents)
          .set({
            stripeCustomerId: next.customerId,
            stripeSubscriptionId:
              input.subscription?.subscriptionId ?? next.subscriptionId,
            status: 'completed',
            outcome: 'applied',
            failureReason: null,
            completedAt: now,
            resolvedAt: now,
            updatedAt: now
          })
          .where(eq(billingProviderEvents.providerEventId, input.providerEventId))
      )
    }
    let previous: SubscriptionState | null = null
    if (before.subscription !== null) {
      previous = yield* unavailable(decodeSubscriptionRow(before.subscription))
    }
    statements.push(...(yield* notices.prepare(lease.workspaceId, previous, next, now)))
    yield* leases.fencedBatch(lease, statements)
    return drift
  })

  return {
    read,
    event,
    recordEvent,
    begin,
    fail,
    commit,
    leases,
    deliverNotices: notices.deliver
  }
})
