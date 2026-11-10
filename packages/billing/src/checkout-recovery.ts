import { billingCheckoutClaims } from '@b2b-saas-starter/db/schema/billing'
import { type BillingCheckoutStatus } from '@b2b-saas-starter/db/enums'
import { type EffectDatabase } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import { and, eq, inArray } from 'drizzle-orm'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type AuditPort as AuditEventLogInterface } from './ports.ts'
import { type makeBillingLease, type BillingLease } from './billing-lease.ts'
import { type billingStoreUnavailable } from './billing.ts'
import {
  checkoutClaimEventFromSessionStatus,
  nextCheckoutClaimStatus,
  openCheckoutClaimStatuses,
  type CheckoutClaim
} from './checkout-claims.ts'
import {
  listStripeCustomerCheckoutSessions,
  listStripeCustomersSince,
  retrieveStripeCheckoutSession,
  validateStripeCustomerForWorkspace,
  type StripeCheckoutSession
} from './stripe.ts'

export type CheckoutDependencies = {
  readonly db: EffectDatabase
  readonly audit: AuditEventLogInterface
  readonly lease: Effect.Success<ReturnType<typeof makeBillingLease>>
  readonly unavailable: typeof billingStoreUnavailable
}

export type CheckoutRecovery = {
  readonly pending: boolean
  readonly uncertain: boolean
  readonly customerId: string | undefined
  readonly claim: CheckoutClaim | undefined
  readonly session: StripeCheckoutSession | undefined
}

export function checkoutFailure(reason: string) {
  return new CapabilityUnavailable({ capability: 'billing', reason })
}

/**
 * The expiry write both absence paths share. `readCheckoutClaim` only returns
 * open claims, so the transition is always legal; the typed failure is the
 * guard if that precondition ever breaks.
 */
function expiredByAbsence(
  status: CheckoutClaim['status']
): Effect.Effect<'expired', CapabilityUnavailable> {
  const next = nextCheckoutClaimStatus(status, { kind: 'provider_absence_verified' })
  if (next === 'expired') {
    return Effect.succeed(next)
  }
  return Effect.fail(checkoutFailure('checkout_claim_refused_expiry'))
}

const readCheckoutClaim = Effect.fn('Billing.readCheckoutClaim')(function* (
  deps: CheckoutDependencies,
  workspaceId: string
) {
  const rows = yield* deps.unavailable(
    deps.db
      .select()
      .from(billingCheckoutClaims)
      .where(
        and(
          eq(billingCheckoutClaims.workspaceId, workspaceId),
          inArray(billingCheckoutClaims.status, [...openCheckoutClaimStatuses])
        )
      )
      .limit(1)
  )
  return rows[0]
})

/** Resolve one durable claim from provider evidence; never create a financial resource. */
export const recoverCheckoutClaim = Effect.fn('Billing.recoverCheckoutClaim')(
  function* (
    deps: CheckoutDependencies,
    input: {
      readonly workspaceId: string
      readonly secretKey: string
      readonly lease: BillingLease
      readonly customerId?: string | undefined
      readonly checkoutSessionId?: string | undefined
    }
  ): Effect.fn.Return<CheckoutRecovery, CapabilityUnavailable> {
    const claim = yield* readCheckoutClaim(deps, input.workspaceId)
    let customerId = input.customerId
    if (claim === undefined) {
      if (input.checkoutSessionId !== undefined) {
        return yield* Effect.fail(checkoutFailure('checkout_recovery_required'))
      }
      return { pending: false, uncertain: false, customerId, claim, session: undefined }
    }
    const now = yield* DateTime.now
    const timestamp = DateTime.formatIso(now)
    const old =
      DateTime.toEpochMillis(now) - Date.parse(claim.createdAt) >= 23 * 60 * 60 * 1000
    // Search can find a customer quickly but cannot prove absence. Once the
    // idempotency window is unsafe, require a complete authoritative list.
    if (customerId === undefined && old && input.checkoutSessionId === undefined) {
      const listed = yield* listStripeCustomersSince({
        secretKey: input.secretKey,
        createdAfter: Math.max(0, Math.floor(Date.parse(claim.createdAt) / 1000) - 60)
      })
      const matches = listed.data.filter(
        (customer) => customer.metadata?.workspaceId === input.workspaceId
      )
      if (listed.has_more || matches.length > 1) {
        return yield* Effect.fail(checkoutFailure('checkout_recovery_required'))
      }
      customerId = matches[0]?.id
      if (customerId === undefined) {
        const expired = yield* expiredByAbsence(claim.status)
        yield* deps.lease.fencedBatch(input.lease, [
          deps.db
            .update(billingCheckoutClaims)
            .set({
              status: expired,
              failureReason: 'verified_no_customer',
              updatedAt: timestamp
            })
            .where(eq(billingCheckoutClaims.id, claim.id))
        ])
        return {
          pending: false,
          uncertain: false,
          customerId,
          claim: undefined,
          session: undefined
        }
      }
    }
    let session: StripeCheckoutSession | undefined
    const sessionId = input.checkoutSessionId ?? claim.stripeSessionId
    if (sessionId !== null) {
      session = yield* retrieveStripeCheckoutSession({
        secretKey: input.secretKey,
        sessionId
      })
    } else if (customerId !== undefined) {
      yield* validateStripeCustomerForWorkspace({ ...input, customerId })
      const listed = yield* listStripeCustomerCheckoutSessions({
        secretKey: input.secretKey,
        customerId
      })
      const matches = listed.data.filter(
        (candidate) =>
          candidate.metadata?.workspaceId === input.workspaceId &&
          candidate.metadata.claimId === claim.id
      )
      if (listed.hasMore || matches.length > 1) {
        return yield* Effect.fail(checkoutFailure('checkout_recovery_required'))
      }
      session = matches[0]
      if (session === undefined && old) {
        const expired = yield* expiredByAbsence(claim.status)
        yield* deps.lease.fencedBatch(input.lease, [
          deps.db
            .update(billingCheckoutClaims)
            .set({
              status: expired,
              failureReason: 'verified_no_session',
              updatedAt: timestamp
            })
            .where(eq(billingCheckoutClaims.id, claim.id))
        ])
        return {
          pending: false,
          uncertain: false,
          customerId,
          claim: undefined,
          session
        }
      }
    }
    if (session === undefined) {
      return { pending: true, uncertain: true, customerId, claim, session }
    }
    if (
      input.checkoutSessionId !== undefined &&
      (session.metadata?.workspaceId !== input.workspaceId ||
        session.metadata.claimId !== claim.id)
    ) {
      return yield* Effect.fail(checkoutFailure('checkout_recovery_required'))
    }
    if (
      session.customer === null ||
      (customerId !== undefined && session.customer !== customerId)
    ) {
      return yield* Effect.fail(checkoutFailure('customer_ownership_conflict'))
    }
    customerId = session.customer
    yield* validateStripeCustomerForWorkspace({ ...input, customerId })
    // The session state is provider evidence for the claim machine; the
    // transition owner classifies it, and anything it cannot classify — or a
    // terminal claim refusing it — stays a recovery problem.
    const claimEvent = checkoutClaimEventFromSessionStatus(session.status)
    let status: BillingCheckoutStatus | null = null
    if (claimEvent !== null) {
      status = nextCheckoutClaimStatus(claim.status, claimEvent)
    }
    if (status === null) {
      return yield* Effect.fail(checkoutFailure('checkout_recovery_required'))
    }
    const pending = session.status === 'open'
    const statements = [
      deps.db
        .update(billingCheckoutClaims)
        .set({
          status,
          stripeSessionId: session.id,
          checkoutUrl: session.url,
          expiresAt: DateTime.formatIso(DateTime.makeUnsafe(session.expiresAt * 1000)),
          failureReason: null,
          updatedAt: timestamp
        })
        .where(eq(billingCheckoutClaims.id, claim.id))
    ]
    // A lost creation response also lost its original local audit commit.
    // Record that handoff exactly once when provider evidence recovers it.
    const auditStatements = []
    if (claim.status === 'pending') {
      auditStatements.push(
        yield* deps.audit.prepareRecord({
          workspaceId: input.workspaceId,
          actorUserId: null,
          actorType: 'system',
          eventType: 'billing.checkout_started',
          targetType: 'workspace',
          targetId: input.workspaceId,
          metadata: {
            planId: claim.planId,
            quantity: claim.quantity,
            checkoutSessionId: session.id,
            reason: 'checkout_recovered'
          }
        })
      )
    }
    yield* deps.lease.fencedBatch(input.lease, [...statements, ...auditStatements])
    let openClaim: CheckoutClaim | undefined
    if (pending) {
      openClaim = {
        ...claim,
        status,
        stripeSessionId: session.id,
        checkoutUrl: session.url
      }
    }
    return { pending, uncertain: false, customerId, claim: openClaim, session }
  }
)
