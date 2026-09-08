import {
  billingCheckoutClaims,
  billingSynchronization,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { type AuditActorTypeValue } from '@b2b-saas-starter/db/enums'
import { DateTime, Effect } from 'effect'
import { eq, sql } from 'drizzle-orm'

import { newCapabilityId } from './internal/ids.ts'
import { type BillingLease } from './billing-lease.ts'
import { type makeBillingSyncStore } from './billing-sync-store.ts'
import {
  decideCheckoutClaim,
  type CheckoutClaim,
  type CheckoutClaimInput
} from './checkout-claims.ts'
import {
  checkoutFailure,
  recoverCheckoutClaim,
  type CheckoutDependencies
} from './checkout-recovery.ts'
import {
  createStripeCheckoutSession,
  createStripeCustomer,
  createStripeBillingPortalSession,
  searchStripeCustomersByWorkspace,
  validateStripeCustomerForWorkspace
} from './stripe.ts'

type Actor = {
  readonly actorUserId: string | null
  readonly actorType: AuditActorTypeValue
}
export type DurableCheckoutInput = CheckoutClaimInput &
  Actor & {
    readonly secretKey: string
    readonly returnUrl?: string
  }
type CheckoutServices = CheckoutDependencies & {
  readonly recordFailure: Effect.Success<
    ReturnType<typeof makeBillingSyncStore>
  >['fail']
}
type PortalInput = Actor & {
  readonly workspaceId: string
  readonly secretKey: string
  readonly returnUrl: string
}

const createPortal = Effect.fn('Billing.createPortal')(function* (
  deps: CheckoutDependencies,
  lease: BillingLease,
  input: PortalInput,
  customerId: string
) {
  const session = yield* createStripeBillingPortalSession({
    secretKey: input.secretKey,
    customerId,
    returnUrl: input.returnUrl,
    idempotencyKey: `billing-portal:${lease.owner}`
  })
  const audit = yield* deps.audit.prepareRecord({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorType: input.actorType,
    eventType: 'billing.portal_opened',
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: { customerId }
  })
  yield* deps.lease.fencedBatch(lease, [audit])
  return { url: session.url }
})

const readSubscription = Effect.fn('Billing.readCheckoutSubscription')(function* (
  deps: CheckoutDependencies,
  workspaceId: string
) {
  const rows = yield* deps.unavailable(
    deps.db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1)
  )
  return rows[0]
})

/** Portal ownership follows the same provider validation as checkout. */
export function makeValidatedPortalSession(deps: CheckoutServices) {
  return Effect.fn('Billing.startValidatedPortalSession')(function* (
    input: PortalInput
  ) {
    return yield* deps.lease.withLease(input.workspaceId, (lease) =>
      Effect.gen(function* () {
        const subscription = yield* readSubscription(deps, input.workspaceId)
        if (subscription === undefined) {
          return yield* Effect.fail(checkoutFailure('no_billing_profile'))
        }
        yield* validateStripeCustomerForWorkspace({
          ...input,
          customerId: subscription.stripeCustomerId,
          knownSubscriptionId: subscription.stripeSubscriptionId ?? undefined
        })
        return yield* createPortal(deps, lease, input, subscription.stripeCustomerId)
      }).pipe(
        Effect.tapError((error) =>
          deps
            .recordFailure(lease, error.reason, isConflict(error.reason))
            .pipe(Effect.catchTag('CapabilityUnavailable', () => Effect.void))
        )
      )
    )
  })
}

function isConflict(reason: string) {
  return [
    'customer_deleted',
    'customer_ownership_conflict',
    'subscription_ownership_conflict',
    'multiple_subscriptions',
    'multiple_customers',
    'checkout_recovery_required'
  ].includes(reason)
}

/** One claim observation, one ownership decision, and at most one retry-safe creation. */
export function makeDurableCheckout(deps: CheckoutServices) {
  return Effect.fn('Billing.startCheckoutDurable')(function* (
    input: DurableCheckoutInput
  ) {
    return yield* deps.lease.withLease(input.workspaceId, (lease) => {
      let attemptId: string | undefined
      const program = Effect.gen(function* () {
        const now = yield* DateTime.now
        const timestamp = DateTime.formatIso(now)
        const stored = yield* readSubscription(deps, input.workspaceId)
        let customerId = stored?.stripeCustomerId
        if (customerId === undefined) {
          const found = yield* searchStripeCustomersByWorkspace(input)
          if (found.has_more || found.data.length > 1) {
            return yield* Effect.fail(checkoutFailure('multiple_customers'))
          }
          customerId = found.data[0]?.id
        }
        const recovery = yield* recoverCheckoutClaim(deps, {
          ...input,
          lease,
          customerId
        })
        customerId = recovery.customerId
        attemptId = recovery.claim?.id
        const persistCustomer = Effect.fnUntraced(function* (confirmedId: string) {
          if (stored !== undefined) {
            return
          }
          yield* deps.lease.fencedBatch(lease, [
            deps.db.insert(workspaceSubscriptions).values({
              workspaceId: input.workspaceId,
              stripeCustomerId: confirmedId,
              stripeSubscriptionId: null,
              stripeSubscriptionItemId: null,
              seatQuantity: 0,
              updatedAt: timestamp
            })
          ])
        })
        const portalInput = { ...input, returnUrl: input.returnUrl ?? input.cancelUrl }
        if (customerId !== undefined) {
          const profile = yield* validateStripeCustomerForWorkspace({
            ...input,
            customerId,
            knownSubscriptionId:
              stored?.stripeSubscriptionId ??
              recovery.session?.subscription ??
              undefined
          })
          if (profile.activeSubscriptions.length > 0) {
            yield* persistCustomer(customerId)
            return yield* createPortal(deps, lease, portalInput, customerId)
          }
        }
        const decision = decideCheckoutClaim(input, recovery.claim, timestamp)
        if (decision.outcome === 'conflict') {
          return yield* Effect.fail(checkoutFailure(decision.reason))
        }
        if (decision.outcome === 'reuse') {
          const url = recovery.session?.url
          if (url === null || url === undefined) {
            return yield* Effect.fail(checkoutFailure('checkout_session_uncertain'))
          }
          return { url }
        }
        let claim: CheckoutClaim
        if (decision.outcome === 'retry') {
          claim = decision.claim
          yield* deps.lease.fencedBatch(lease, [
            deps.db
              .update(billingCheckoutClaims)
              .set({
                attemptCount: sql`${billingCheckoutClaims.attemptCount} + 1`,
                updatedAt: timestamp
              })
              .where(eq(billingCheckoutClaims.id, claim.id))
          ])
        } else {
          const id = yield* newCapabilityId('bill_checkout')
          claim = {
            id,
            workspaceId: input.workspaceId,
            planId: input.planId,
            priceId: input.priceId,
            quantity: input.quantity,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            idempotencyKey: `billing-checkout:${id}`,
            status: 'pending',
            stripeSessionId: null,
            checkoutUrl: null,
            attemptCount: 1,
            failureReason: null,
            expiresAt: DateTime.formatIso(DateTime.add(now, { hours: 24 })),
            createdAt: timestamp,
            updatedAt: timestamp
          }
          yield* deps.lease.fencedBatch(lease, [
            deps.db.insert(billingCheckoutClaims).values(claim),
            deps.db
              .update(billingSynchronization)
              .set({ status: 'pending', updatedAt: timestamp })
              .where(eq(billingSynchronization.workspaceId, input.workspaceId))
          ])
        }
        attemptId = claim.id
        if (customerId === undefined) {
          customerId = (yield* createStripeCustomer({
            secretKey: input.secretKey,
            workspaceId: input.workspaceId,
            idempotencyKey: `billing-customer:${claim.id}`
          })).id
          const profile = yield* validateStripeCustomerForWorkspace({
            ...input,
            customerId
          })
          if (profile.activeSubscriptions.length > 0) {
            yield* persistCustomer(customerId)
            return yield* createPortal(deps, lease, portalInput, customerId)
          }
        }
        yield* persistCustomer(customerId)
        const session = yield* createStripeCheckoutSession({
          secretKey: input.secretKey,
          customerId,
          workspaceId: claim.workspaceId,
          planId: claim.planId,
          priceId: claim.priceId,
          quantity: claim.quantity,
          successUrl: claim.successUrl,
          cancelUrl: claim.cancelUrl,
          claimId: claim.id,
          idempotencyKey: claim.idempotencyKey
        })
        const audit = yield* deps.audit.prepareRecord({
          workspaceId: input.workspaceId,
          actorUserId: input.actorUserId,
          actorType: input.actorType,
          eventType: 'billing.checkout_started',
          targetType: 'workspace',
          targetId: input.workspaceId,
          metadata: {
            planId: claim.planId,
            quantity: claim.quantity,
            checkoutSessionId: session.id
          }
        })
        yield* deps.lease.fencedBatch(lease, [
          deps.db
            .update(billingCheckoutClaims)
            .set({
              status: 'created',
              stripeSessionId: session.id,
              checkoutUrl: session.url,
              expiresAt: DateTime.formatIso(
                DateTime.makeUnsafe(session.expiresAt * 1000)
              ),
              failureReason: null,
              updatedAt: timestamp
            })
            .where(eq(billingCheckoutClaims.id, claim.id)),
          deps.db
            .update(billingSynchronization)
            .set({
              status: 'pending',
              unresolvedSince: null,
              failureReason: null,
              conflictReason: null,
              failureCount: 0,
              nextAttemptAt: DateTime.formatIso(DateTime.add(now, { minutes: 1 })),
              updatedAt: timestamp
            })
            .where(eq(billingSynchronization.workspaceId, input.workspaceId)),
          audit
        ])
        return { url: session.url }
      })
      return program.pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            if (error.reason === 'checkout_in_progress') {
              return
            }
            if (attemptId !== undefined) {
              yield* deps.lease.fencedBatch(lease, [
                deps.db
                  .update(billingCheckoutClaims)
                  .set({
                    failureReason: error.reason,
                    updatedAt: DateTime.formatIso(yield* DateTime.now)
                  })
                  .where(eq(billingCheckoutClaims.id, attemptId))
              ])
            }
            yield* deps.recordFailure(lease, error.reason, isConflict(error.reason))
          }).pipe(Effect.catchTag('CapabilityUnavailable', () => Effect.void))
        )
      )
    })
  })
}
