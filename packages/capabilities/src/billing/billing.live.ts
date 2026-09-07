import {
  billingSynchronization,
  workspaceMembers,
  workspaces,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { count, eq } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { makeBillingSynchronization } from './billing-sync.live.ts'
import { makeBillingSyncStore } from './billing-sync-store.ts'
import { makeDurableCheckout, makeValidatedPortalSession } from './checkout.live.ts'
import { billingConfigured, type BillingOptions } from './billing-config.ts'
import { planById } from './plan-catalog.ts'
import {
  Billing,
  billingStoreUnavailable,
  type BillingInterface,
  type BillingSynchronizationStatus,
  type CheckoutInput
} from './billing.ts'

/**
 * The D1-backed billing adapter: plan reads off `workspaces.planId`,
 * subscription linkage off `workspace_subscriptions`, and the provider calls
 * (`stripe.ts`) for checkout, the Billing Portal, and seat-quantity updates.
 */

function providerNotConfigured(): CapabilityUnavailable {
  return new CapabilityUnavailable({
    capability: 'billing',
    reason: 'provider_not_configured'
  })
}

export function LiveBilling(
  options: BillingOptions = {}
): Layer.Layer<Billing, never, Database | RawD1 | AuditEventLog> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const unavailable = billingStoreUnavailable
      const store = yield* makeBillingSyncStore()
      const synchronization = yield* makeBillingSynchronization(options, store)
      const lease = store.leases
      const checkout = makeDurableCheckout({
        db,
        audit,
        lease,
        unavailable,
        recordFailure: store.fail
      })
      const portal = makeValidatedPortalSession({
        db,
        audit,
        lease,
        unavailable,
        recordFailure: store.fail
      })
      /** Counts the workspace's members — the seat quantity a per-seat plan bills. */
      const countMembers = Effect.fnUntraced(function* (workspaceId: string) {
        const rows = yield* unavailable(
          db
            .select({ value: count() })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaceId))
        )
        return rows[0]?.value ?? 0
      })

      const readSubscription = Effect.fnUntraced(function* (workspaceId: string) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceSubscriptions)
            .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
            .limit(1)
        )
        return rows[0]
      })

      const service: BillingInterface = {
        ...synchronization,
        configured: Effect.fn('Billing.configured')(() =>
          Effect.succeed(billingConfigured(options))
        )(),
        currentPlan: Effect.fn('Billing.currentPlan')(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ planId: workspaces.planId })
              .from(workspaces)
              .where(eq(workspaces.id, ctx.workspace.id))
              .limit(1)
          )
          return planById(rows[0]?.planId ?? ctx.workspace.planId)
        })(),
        synchronizationStatus: Effect.fn('Billing.synchronizationStatus')(function* () {
          const ctx = yield* WorkspaceContext
          if (!billingConfigured(options)) {
            return {
              status: 'current',
              lastSyncedAt: null
            } satisfies BillingSynchronizationStatus
          }
          const rows = yield* unavailable(
            db
              .select({
                status: billingSynchronization.status,
                lastSyncedAt: billingSynchronization.lastSyncedAt
              })
              .from(billingSynchronization)
              .where(eq(billingSynchronization.workspaceId, ctx.workspace.id))
              .limit(1)
          )
          return (
            rows[0] ??
            ({
              status: 'current',
              lastSyncedAt: null
            } satisfies BillingSynchronizationStatus)
          )
        })(),
        startCheckout: Effect.fn('Billing.startCheckout')(function* (
          input: CheckoutInput
        ) {
          const ctx = yield* WorkspaceContext
          const secretKey = options.secretKey
          if (secretKey === undefined || secretKey.length === 0) {
            return yield* Effect.fail(providerNotConfigured())
          }
          const plan = planById(input.planId)
          let priceId: string | undefined
          if (plan.stripePriceEnv !== null) {
            priceId = options.priceIds?.[input.planId]
          }
          if (priceId === undefined || priceId.length === 0) {
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'billing',
                reason: `price_not_configured:${plan.stripePriceEnv ?? input.planId}`
              })
            )
          }
          let quantity = 1
          if (plan.pricing === 'per_seat') {
            quantity = yield* countMembers(ctx.workspace.id)
          }
          return yield* checkout({
            secretKey,
            priceId,
            quantity,
            workspaceId: ctx.workspace.id,
            planId: input.planId,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType
          })
        }),
        startPortalSession: Effect.fn('Billing.startPortalSession')(function* (input: {
          readonly returnUrl: string
        }) {
          const ctx = yield* WorkspaceContext
          const secretKey = options.secretKey
          if (secretKey === undefined || secretKey.length === 0) {
            return yield* Effect.fail(providerNotConfigured())
          }
          return yield* portal({
            workspaceId: ctx.workspace.id,
            secretKey,
            returnUrl: input.returnUrl,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType
          })
        }),
        syncSeats: Effect.fn('Billing.syncSeats')(function* (input: {
          readonly workspaceId: string
          readonly reason: string
        }) {
          const row = yield* readSubscription(input.workspaceId)
          if (row === undefined) {
            return { outcome: 'no_subscription', quantity: null }
          }
          if (!billingConfigured(options)) {
            if (row.stripeSubscriptionItemId === null) {
              return { outcome: 'no_seat_item', quantity: null }
            }
            const members = yield* countMembers(input.workspaceId)
            if (row.seatQuantity === members) {
              return { outcome: 'quantity_unchanged', quantity: members }
            }
            return { outcome: 'provider_not_configured', quantity: null }
          }
          const result = yield* synchronization.reconcileWorkspace({
            workspaceId: input.workspaceId,
            reason: input.reason
          })
          if (result.outcome === 'conflict') {
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'billing',
                reason: result.drift[0] ?? 'billing_conflict'
              })
            )
          }
          const updated = yield* readSubscription(input.workspaceId)
          if (updated?.stripeSubscriptionItemId === null || updated === undefined) {
            return { outcome: 'no_seat_item', quantity: null }
          }
          if (result.drift.includes('seat_quantity')) {
            return { outcome: 'synced', quantity: updated.seatQuantity }
          }
          return { outcome: 'quantity_unchanged', quantity: updated.seatQuantity }
        })
      }
      return Billing.of(service)
    })
  )
}
