import {
  billingStoreUnavailable,
  type SubscriptionState,
  type ProcessProviderEventInput,
  type ProcessProviderEventResult,
  type ReconcileWorkspaceInput,
  type ReconcileResult
} from './billing.ts'
import { retrievePaymentEvidence } from './stripe-payment.ts'
import { decodeSubscriptionRow } from './subscription-row.ts'
import { validatedStripePrice } from './stripe-pricing.ts'
import {
  billingCheckoutClaims,
  billingProviderEvents,
  billingSynchronization,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Schema } from 'effect'
import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { billingConfigured, type BillingOptions } from './billing-config.ts'
import { resolveBillingState, type PaymentEvidence } from './billing-state.ts'
import { type makeBillingSyncStore } from './billing-sync-store.ts'
import { recoverCheckoutClaim } from './checkout-recovery.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  listStripeCustomerSubscriptions,
  retrieveStripeCustomer,
  retrieveStripeSubscription,
  searchStripeCustomersByWorkspace,
  updateStripeSubscriptionItemQuantity
} from './stripe.ts'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory, not a constructor invocation
class BillingSyncConflict extends Schema.TaggedError<BillingSyncConflict>()(
  'BillingSyncConflict',
  { reason: Schema.String }
) {}

function conflict(reason: string) {
  return Effect.fail(new BillingSyncConflict({ reason }))
}

/** All background billing paths share authoritative reads and one atomic commit. */
export const makeBillingSynchronization = Effect.fn('Billing.makeSynchronization')(
  function* (
    options: BillingOptions,
    store: Effect.Success<ReturnType<typeof makeBillingSyncStore>>
  ) {
    const db = yield* Database
    const audit = yield* AuditEventLog
    const unavailable = billingStoreUnavailable

    const members = Effect.fn('Billing.countBillableMembers')(function* (
      workspaceId: string
    ) {
      const rows = yield* unavailable(
        db
          .select({ value: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, workspaceId))
      )
      return rows[0]?.value ?? 0
    })

    const providerKey = Effect.fn('Billing.requireProvider')((): Effect.Effect<
      string,
      CapabilityUnavailable
    > => {
      const secretKey = options.secretKey
      if (!billingConfigured(options) || secretKey === undefined) {
        return Effect.fail(
          new CapabilityUnavailable({
            capability: 'billing',
            reason: 'provider_not_configured'
          })
        )
      }
      return Effect.succeed(secretKey)
    })

    const runWorkspace = Effect.fn('Billing.synchronizeWorkspace')(function* (
      workspaceId: string,
      input: ProcessProviderEventInput | undefined,
      reason: string | undefined,
      recovery: ReconcileWorkspaceInput['recovery']
    ): Effect.fn.Return<
      { readonly result: ReconcileResult; readonly duplicate: boolean },
      CapabilityUnavailable
    > {
      const secretKey = yield* providerKey()
      return yield* store.leases.withLease(workspaceId, (lease) =>
        Effect.gen(function* () {
          if (
            input !== undefined &&
            (yield* store.event(input.providerEventId))?.status === 'completed'
          ) {
            return {
              result: { workspaceId, outcome: 'current', drift: [] },
              duplicate: true
            } satisfies { result: ReconcileResult; duplicate: boolean }
          }
          yield* store.begin(lease, input)
          const synchronize = Effect.gen(function* () {
            const before = yield* store.read(workspaceId)
            if (before === undefined) {
              return yield* conflict('unknown_workspace')
            }
            const hint = input?.subscription
            if (
              before.customerId !== null &&
              hint?.customerId !== undefined &&
              before.customerId !== hint.customerId
            ) {
              return yield* conflict('customer_ownership_mismatch')
            }
            if (
              recovery?.customerId !== undefined &&
              before.customerId !== null &&
              recovery.customerId !== before.customerId
            ) {
              return yield* conflict('customer_ownership_mismatch')
            }
            let customerId =
              before.customerId ?? hint?.customerId ?? recovery?.customerId
            if (customerId === undefined && hint?.subscriptionId !== undefined) {
              const subscription = yield* retrieveStripeSubscription({
                secretKey,
                subscriptionId: hint.subscriptionId
              })
              customerId = subscription.customer
            }
            if (customerId === undefined) {
              const found = yield* searchStripeCustomersByWorkspace({
                secretKey,
                workspaceId
              })
              if (found.has_more || found.data.length > 1) {
                return yield* conflict('multiple_customers')
              }
              customerId = found.data[0]?.id
            }
            const checkout = yield* recoverCheckoutClaim(
              { db, audit, lease: store.leases, unavailable },
              {
                workspaceId,
                secretKey,
                lease,
                customerId,
                checkoutSessionId: recovery?.checkoutSessionId
              }
            ).pipe(
              Effect.mapError((error) => {
                if (
                  error.reason === 'checkout_recovery_required' ||
                  error.reason === 'customer_ownership_conflict' ||
                  error.reason === 'subscription_ownership_conflict' ||
                  error.reason === 'multiple_subscriptions'
                ) {
                  return new BillingSyncConflict({ reason: error.reason })
                }
                return error
              })
            )
            customerId = checkout.customerId
            if (customerId === undefined) {
              if (input !== undefined) {
                return yield* conflict('missing_customer')
              }
              if (!checkout.pending) {
                const now = yield* DateTime.now
                yield* store.leases.fencedBatch(lease, [
                  db
                    .update(billingSynchronization)
                    .set({
                      status: 'current',
                      failureReason: null,
                      conflictReason: null,
                      unresolvedSince: null,
                      failureCount: 0,
                      lastSyncedAt: DateTime.formatIso(now),
                      nextAttemptAt: DateTime.formatIso(
                        DateTime.add(now, { minutes: 5 })
                      )
                    })
                    .where(eq(billingSynchronization.workspaceId, workspaceId))
                ])
                return {
                  result: { workspaceId, outcome: 'current', drift: [] },
                  duplicate: false
                } satisfies { result: ReconcileResult; duplicate: boolean }
              }
              // An interrupted initial checkout has no confirmed customer yet.
              // Search is eventually consistent; an empty result permits no new write,
              // but it is still an unresolved handoff. Record the delayed failure so
              // the first unresolved time and retry deadline survive the 23-hour claim.
              yield* store.fail(lease, 'checkout_pending', false, input)
              return {
                result: {
                  workspaceId,
                  outcome: 'delayed',
                  drift: ['checkout_pending']
                },
                duplicate: false
              } satisfies { result: ReconcileResult; duplicate: boolean }
            }
            const customer = yield* retrieveStripeCustomer({ secretKey, customerId })
            if (
              customer.deleted === true ||
              customer.metadata?.workspaceId !== workspaceId
            ) {
              return yield* conflict('customer_ownership_mismatch')
            }
            const listed = yield* listStripeCustomerSubscriptions({
              secretKey,
              customerId
            })
            const active = listed.data.filter(
              (subscription) =>
                subscription.status !== 'canceled' &&
                subscription.status !== 'incomplete_expired'
            )
            let selected = active[0]
            if (active.length !== 1) {
              selected = undefined
            }
            const now = DateTime.formatIso(yield* DateTime.now)
            let previous: SubscriptionState | null = null
            if (before.subscription !== null) {
              previous = yield* unavailable(decodeSubscriptionRow(before.subscription))
            }
            let payment: PaymentEvidence = {
              lastPaymentAt: null,
              firstFailedAt: null,
              currentInvoicePaid: false
            }
            if (selected !== undefined) {
              payment = yield* retrievePaymentEvidence(
                secretKey,
                selected,
                previous,
                now
              )
            }
            const decision = resolveBillingState({
              workspaceId,
              customerId,
              subscriptions: listed.data,
              hasMore: listed.has_more,
              priceIds: options.priceIds ?? {},
              previous,
              payment,
              now
            })
            if (decision.kind === 'conflict') {
              return yield* conflict(decision.reason)
            }
            if (decision.subscription.priceId !== null) {
              yield* validatedStripePrice(
                secretKey,
                decision.subscription.priceId,
                'subscription'
              )
            }
            if (checkout.pending && decision.subscription.subscriptionId === null) {
              // A still-open checkout has no verified entitlement yet. Keep the
              // stored plan untouched and retain the first unresolved timestamp
              // until the claim is completed or authoritatively expires.
              yield* store.fail(lease, 'checkout_pending', false, input)
              return {
                result: {
                  workspaceId,
                  outcome: 'delayed',
                  drift: ['checkout_pending']
                },
                duplicate: false
              } satisfies { result: ReconcileResult; duplicate: boolean }
            }
            let desiredQuantity = 0
            let repairedProvider = false
            if (decision.subscription.subscriptionItemId !== null) {
              desiredQuantity = yield* members(workspaceId)
              if (decision.subscription.seatQuantity !== desiredQuantity) {
                yield* updateStripeSubscriptionItemQuantity({
                  secretKey,
                  subscriptionItemId: decision.subscription.subscriptionItemId,
                  quantity: desiredQuantity,
                  idempotencyKey: `billing-seats:${workspaceId}:${lease.fence}:${desiredQuantity}`
                })
                repairedProvider = true
              }
            }
            const acknowledged = {
              ...decision,
              verified:
                decision.verified &&
                (!checkout.pending || decision.subscription.subscriptionId !== null),
              subscription: { ...decision.subscription, seatQuantity: desiredQuantity }
            }
            let latestDesired = 0
            if (decision.subscription.subscriptionItemId !== null) {
              latestDesired = yield* members(workspaceId)
            }
            const drift = yield* store.commit(
              lease,
              before,
              acknowledged,
              latestDesired,
              input,
              reason,
              checkout.uncertain
            )
            if (checkout.uncertain) {
              yield* store.fail(lease, 'checkout_pending', false)
              return {
                result: { workspaceId, outcome: 'delayed', drift },
                duplicate: false
              } satisfies { result: ReconcileResult; duplicate: boolean }
            }
            if (repairedProvider && !drift.includes('seat_quantity')) {
              drift.push('seat_quantity')
            }
            let outcome: ReconcileResult['outcome'] = 'current'
            if (drift.length > 0) {
              outcome = 'repaired'
            }
            yield* Effect.logInfo('Billing synchronization completed').pipe(
              Effect.annotateLogs({
                workspaceId,
                stripeEventId: input?.providerEventId,
                billingOutcome: outcome,
                billingDrift: drift,
                billingLifecycleStatus: decision.lifecycleStatus
              })
            )
            return { result: { workspaceId, outcome, drift }, duplicate: false }
          })
          return yield* synchronize.pipe(
            Effect.catchTag('BillingSyncConflict', (error) =>
              store.fail(lease, error.reason, true, input).pipe(
                Effect.as({
                  result: { workspaceId, outcome: 'conflict', drift: [error.reason] },
                  duplicate: false
                } satisfies { result: ReconcileResult; duplicate: boolean })
              )
            ),
            Effect.tapError((error) =>
              store.fail(lease, error.reason, false, input).pipe(
                // If this invocation lost its lease, the successor owns failure state.
                Effect.catchTag('CapabilityUnavailable', () => Effect.void)
              )
            )
          )
        })
      )
    })

    const resolveWorkspace = Effect.fn('Billing.resolveProviderWorkspace')(function* (
      input: ProcessProviderEventInput
    ) {
      if (input.workspaceId !== undefined) {
        const rows = yield* unavailable(
          db
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.id, input.workspaceId))
            .limit(1)
        )
        return rows[0]?.id
      }
      const conditions = []
      if (input.subscription?.customerId !== undefined) {
        conditions.push(
          eq(workspaceSubscriptions.stripeCustomerId, input.subscription.customerId)
        )
      }
      if (input.subscription?.subscriptionId !== undefined) {
        conditions.push(
          eq(
            workspaceSubscriptions.stripeSubscriptionId,
            input.subscription.subscriptionId
          )
        )
      }
      if (conditions.length > 0) {
        const rows = yield* unavailable(
          db
            .select({ workspaceId: workspaceSubscriptions.workspaceId })
            .from(workspaceSubscriptions)
            .where(or(...conditions))
            .limit(2)
        )
        if (rows.length === 1) {
          return rows[0]?.workspaceId
        }
        if (rows.length > 1) {
          return
        }
      }
      let customerId = input.subscription?.customerId
      const secretKey = yield* providerKey()
      if (
        customerId === undefined &&
        input.subscription?.subscriptionId !== undefined
      ) {
        customerId = (yield* retrieveStripeSubscription({
          secretKey,
          subscriptionId: input.subscription.subscriptionId
        })).customer
      }
      if (customerId === undefined) {
        return
      }
      const customer = yield* retrieveStripeCustomer({ secretKey, customerId })
      const workspaceId = customer.metadata?.workspaceId
      if (workspaceId === undefined) {
        return
      }
      const rows = yield* unavailable(
        db
          .select({ id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1)
      )
      return rows[0]?.id
    })

    const processProviderEvent = Effect.fn('Billing.processProviderEvent')(function* (
      input: ProcessProviderEventInput
    ): Effect.fn.Return<ProcessProviderEventResult, CapabilityUnavailable> {
      yield* providerKey()
      if ((yield* store.event(input.providerEventId))?.status === 'completed') {
        return { outcome: 'duplicate', providerEventId: input.providerEventId }
      }
      // Unknown routing also gets durable evidence, without a foreign-key fiction.
      yield* store.recordEvent(input, null)
      const workspaceId = yield* resolveWorkspace(input).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now
            const evidence = yield* store.event(input.providerEventId)
            yield* unavailable(
              db
                .update(billingProviderEvents)
                .set({
                  status: 'failed',
                  failureReason: error.reason,
                  attemptCount: sql`${billingProviderEvents.attemptCount} + 1`,
                  updatedAt: DateTime.formatIso(now)
                })
                .where(eq(billingProviderEvents.providerEventId, input.providerEventId))
            )
            let unresolvedMs = 0
            if (evidence !== undefined) {
              unresolvedMs =
                DateTime.toEpochMillis(now) - Date.parse(evidence.receivedAt)
            }
            yield* Effect.logError('Billing event routing failed').pipe(
              Effect.annotateLogs({
                stripeEventId: input.providerEventId,
                billingFailureReason: error.reason,
                billingUnresolvedMs: unresolvedMs,
                billingTerminalFailure: unresolvedMs >= 900_000
              })
            )
          })
        )
      )
      if (workspaceId === undefined) {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* unavailable(
          db
            .update(billingProviderEvents)
            .set({
              status: 'conflict',
              outcome: 'unknown_workspace',
              failureReason: 'unknown_workspace',
              updatedAt: now
            })
            .where(eq(billingProviderEvents.providerEventId, input.providerEventId))
        )
        yield* Effect.logError('Billing event has no verified workspace').pipe(
          Effect.annotateLogs({
            stripeEventId: input.providerEventId,
            billingTerminalFailure: true
          })
        )
        return {
          outcome: 'conflict',
          providerEventId: input.providerEventId,
          reason: 'unknown_workspace'
        }
      }
      const result = yield* runWorkspace(workspaceId, input, undefined, undefined)
      yield* store.deliverNotices(workspaceId)
      if (result.duplicate) {
        return { outcome: 'duplicate', providerEventId: input.providerEventId }
      }
      if (result.result.outcome === 'conflict') {
        return {
          outcome: 'conflict',
          providerEventId: input.providerEventId,
          reason: result.result.drift[0] ?? 'billing_conflict'
        }
      }
      return { outcome: 'applied', providerEventId: input.providerEventId }
    })

    const reconcileWorkspace = Effect.fn('Billing.reconcileWorkspace')(function* (
      input: ReconcileWorkspaceInput
    ) {
      const result = yield* runWorkspace(
        input.workspaceId,
        undefined,
        input.reason,
        input.recovery
      )
      yield* store.deliverNotices(input.workspaceId)
      return result.result
    })

    const reconcileBatch = Effect.fn('Billing.reconcileBatch')(function* (input?: {
      readonly limit?: number | undefined
    }) {
      if (!billingConfigured(options)) {
        return []
      }
      let limit = 25
      if (input?.limit !== undefined && Number.isFinite(input.limit)) {
        limit = Math.max(1, Math.min(25, Math.floor(input.limit)))
      }
      const now = DateTime.formatIso(yield* DateTime.now)
      // Unknown-workspace conflicts are terminal evidence: there is no safe
      // workspace to reconcile, so selecting them on every cron pass would
      // starve real work. Failed/processing evidence gets a small timestamp
      // floor before the attempt-count backoff is applied below.
      const unresolved = yield* unavailable(
        db
          .select()
          .from(billingProviderEvents)
          .where(
            and(
              isNull(billingProviderEvents.workspaceId),
              inArray(billingProviderEvents.status, ['failed', 'processing']),
              lte(
                billingProviderEvents.updatedAt,
                DateTime.formatIso(DateTime.add(yield* DateTime.now, { minutes: -1 }))
              )
            )
          )
          .orderBy(asc(billingProviderEvents.updatedAt))
          .limit(Math.min(5, limit * 2))
      )
      const retryableUnresolved = unresolved
        .filter((evidence) => {
          const delayMinutes = Math.min(15, 2 ** Math.min(evidence.attemptCount - 1, 4))
          return (
            Date.parse(evidence.updatedAt) + delayMinutes * 60_000 <= Date.parse(now)
          )
        })
        .slice(0, Math.min(5, limit))
      const workspaceBudget = limit - retryableUnresolved.length
      // Oldest attempted first, including failures; one broken customer cannot
      // monopolize a bounded pass. The invocation records lastAttemptAt under lease.
      const rows = yield* unavailable(
        db
          .select({ workspaceId: workspaces.id })
          .from(workspaces)
          .leftJoin(
            billingSynchronization,
            eq(billingSynchronization.workspaceId, workspaces.id)
          )
          .where(
            and(
              sql`EXISTS (SELECT 1 FROM ${workspaceSubscriptions} WHERE ${workspaceSubscriptions.workspaceId} = ${workspaces.id})
        OR EXISTS (SELECT 1 FROM ${billingCheckoutClaims} WHERE ${billingCheckoutClaims.workspaceId} = ${workspaces.id} AND ${billingCheckoutClaims.status} IN ('pending', 'created'))
        OR EXISTS (SELECT 1 FROM ${billingProviderEvents} WHERE ${billingProviderEvents.workspaceId} = ${workspaces.id} AND ${billingProviderEvents.status} <> 'completed')
        OR ${billingSynchronization.status} IN ('pending', 'delayed', 'conflict')`,
              or(
                isNull(billingSynchronization.nextAttemptAt),
                lte(billingSynchronization.nextAttemptAt, now)
              )
            )
          )
          .orderBy(
            asc(sql`coalesce(${billingSynchronization.lastAttemptAt}, '')`),
            asc(workspaces.id)
          )
          .limit(workspaceBudget)
      )
      const results = yield* Effect.forEach(
        rows,
        (row) =>
          reconcileWorkspace(row).pipe(
            Effect.catchTag('CapabilityUnavailable', () =>
              Effect.succeed({
                workspaceId: row.workspaceId,
                outcome: 'delayed',
                drift: ['synchronization_failed']
              } satisfies ReconcileResult)
            )
          ),
        { concurrency: 3 }
      )
      if (retryableUnresolved.length > 0) {
        yield* Effect.forEach(
          retryableUnresolved,
          (evidence) =>
            processProviderEvent({
              providerEventId: evidence.providerEventId,
              eventType: evidence.eventType,
              providerCreatedAt: evidence.providerCreatedAt ?? undefined,
              subscription: {
                customerId: evidence.stripeCustomerId ?? undefined,
                subscriptionId: evidence.stripeSubscriptionId ?? undefined
              }
            }).pipe(Effect.catchTag('CapabilityUnavailable', () => Effect.void)),
          { concurrency: 3, discard: true }
        )
      }
      return results
    })

    return { processProviderEvent, reconcileWorkspace, reconcileBatch }
  }
)
