import {
  testPrice,
  testItem,
  testSubscriptionFields,
  paidInvoice
} from '@b2b-saas-starter/billing/provider-test-fixtures'
// oxlint-disable effect/noNewPromise, effect/noThrowStatement, effect/noNewError, vitest/require-mock-type-parameters

import {
  auditEvents,
  billingCheckoutClaims,
  billingSynchronization,
  workspaceMembers,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database, type EffectDatabase, type RawD1 } from '@b2b-saas-starter/db/service'
import { Effect, Layer } from 'effect'
import { and, eq } from 'drizzle-orm'
import { vi } from 'vite-plus/test'

import { AuditEventLog as BillingAuditEventLog } from '@b2b-saas-starter/billing/ports'
import { orUnavailable } from '@b2b-saas-starter/failure/capability'
import { inWorkspace } from '../testing/live-harness.ts'
import { BillingAuditLayer, BillingNotificationLayer } from '../billing-adapters.ts'
import { makeBillingLease } from '@b2b-saas-starter/billing/billing-lease'
import { makeBillingSyncStore } from '@b2b-saas-starter/billing/billing-sync-store'
import {
  makeDurableCheckout,
  type DurableCheckoutInput
} from '@b2b-saas-starter/billing/checkout.live'

export const workspaceId = 'wrk_live'
// oxlint-disable-next-line react-doctor/no-secrets-in-client-code -- provider key is an inert live-test fixture
export const secretKey = 'sk_test_checkout'

export type FixtureOptions = {
  readonly checkoutExpiresAt?: number
  readonly checkoutStatus?: 'open' | 'complete' | 'expired'
  readonly checkoutUrl?: string | null
  readonly checkoutSubscription?: string | null
  readonly checkoutCustomer?: string
  readonly customerMetadata?: Readonly<Record<string, string>> | null
  readonly customerSubscriptionsHasMore?: boolean
  readonly subscriptionStatus?: string
  readonly checkoutCreateFailure?: boolean
  readonly exposeCreatedSessionOnList?: boolean
  readonly checkoutListHasMore?: boolean
  readonly customersSinceHasMore?: boolean
  readonly customersSince?: ReadonlyArray<{
    readonly id: string
    readonly metadata?: Readonly<Record<string, string>>
  }>
  readonly customerSubscriptions?: ReadonlyArray<{
    readonly id: string
    readonly customer: string
    readonly status: string
    readonly itemId?: string
    readonly quantity?: number
  }>
}

type FixtureSubscription = NonNullable<FixtureOptions['customerSubscriptions']>[number]

function fixtureItems(subscription: FixtureSubscription) {
  if (subscription.itemId === undefined) {
    return []
  }
  return [
    {
      ...testItem,
      id: subscription.itemId,
      quantity: subscription.quantity ?? 1,
      price: testPrice
    }
  ]
}

export function stripeFixture(options: FixtureOptions = {}) {
  let customerMetadata: Readonly<Record<string, string>> | null
  if (options.customerMetadata === undefined) {
    customerMetadata = { workspaceId }
  } else {
    customerMetadata = options.customerMetadata
  }
  const state = {
    checkoutStatus: options.checkoutStatus ?? 'open',
    checkoutSubscription: options.checkoutSubscription ?? null,
    checkoutCustomer: options.checkoutCustomer ?? 'cus_checkout',
    checkoutUrl: options.checkoutUrl ?? 'https://checkout.stripe.com/c/pay/claim',
    customerMetadata,
    customerSubscriptionsHasMore: options.customerSubscriptionsHasMore ?? false,
    subscriptionStatus: options.subscriptionStatus ?? 'active',
    customerSubscriptions: [...(options.customerSubscriptions ?? [])],
    customersSince: [...(options.customersSince ?? [])],
    customersSinceHasMore: options.customersSinceHasMore ?? false,
    customerListReads: 0,
    checkoutCreateFailure: options.checkoutCreateFailure ?? false,
    exposeCreatedSessionOnList: options.exposeCreatedSessionOnList ?? false,
    checkoutListHasMore: options.checkoutListHasMore ?? false,
    checkoutCreates: 0,
    customerCreates: 0,
    portalCreates: 0,
    checkoutListReads: 0,
    recoverySessions: new Array<{
      readonly id: string
      readonly url: string | null
      readonly status: 'open' | 'complete' | 'expired'
      readonly expires_at: number
      readonly customer: string
      readonly subscription: string | null
      readonly metadata: Readonly<Record<string, string>>
    }>(),
    checkoutBodies: new Array<string>(),
    checkoutIdempotencyKeys: new Array<string | undefined>(),
    seatQuantities: new Array<number>(),
    checkoutExpiresAt: options.checkoutExpiresAt ?? 4_000_000_000
  }
  function customerResponse() {
    if (state.customerMetadata === null) {
      return { id: 'cus_checkout' }
    }
    return { id: 'cus_checkout', metadata: state.customerMetadata }
  }

  const fetch = vi.fn(
    (
      requestUrl: string,
      init?: {
        readonly method?: string
        readonly body?: string
        readonly headers?: Record<string, string>
      }
    ) => {
      const url = new URL(requestUrl)
      if (url.pathname.startsWith('/v1/prices/')) {
        return Promise.resolve(Response.json(testPrice))
      }
      if (url.pathname === '/v1/invoices/in_paid') {
        return Promise.resolve(
          Response.json(
            paidInvoice({
              id: state.customerSubscriptions[0]?.id ?? 'sub_sync',
              customer: 'cus_checkout'
            })
          )
        )
      }
      if (url.pathname === '/v1/invoices') {
        return Promise.resolve(
          Response.json({
            data: [
              paidInvoice({
                id: url.searchParams.get('subscription') ?? '',
                customer: 'cus_checkout'
              })
            ],
            has_more: false
          })
        )
      }
      if (url.pathname === '/v1/events') {
        return Promise.resolve(Response.json({ data: [], has_more: false }))
      }
      const method = init?.method ?? 'GET'
      if (url.pathname === '/v1/customers' && method === 'POST') {
        state.customerCreates += 1
        return Promise.resolve(Response.json(customerResponse()))
      }
      if (url.pathname === '/v1/customers' && method === 'GET') {
        state.customerListReads += 1
        return Promise.resolve(
          Response.json({
            data: state.customersSince,
            has_more: state.customersSinceHasMore
          })
        )
      }
      if (url.pathname === '/v1/customers/cus_checkout') {
        return Promise.resolve(Response.json(customerResponse()))
      }
      if (url.pathname === '/v1/customers/search') {
        return Promise.resolve(Response.json({ data: [], has_more: false }))
      }
      if (url.pathname === '/v1/subscriptions') {
        return Promise.resolve(
          Response.json({
            data: state.customerSubscriptions.map((subscription) => ({
              ...testSubscriptionFields,
              ...subscription,
              metadata: { workspaceId },
              items: { data: fixtureItems(subscription) }
            })),
            has_more: state.customerSubscriptionsHasMore
          })
        )
      }
      if (url.pathname === '/v1/subscriptions/sub_existing') {
        return Promise.resolve(
          Response.json({
            id: 'sub_existing',
            customer: 'cus_checkout',
            ...testSubscriptionFields,
            status: state.subscriptionStatus,
            metadata: { workspaceId },
            items: {
              data: [{ ...testItem, id: 'si_existing', quantity: 1, price: testPrice }]
            }
          })
        )
      }
      if (url.pathname === '/v1/subscriptions/sub_sync') {
        return Promise.resolve(
          Response.json({
            id: 'sub_sync',
            customer: 'cus_checkout',
            ...testSubscriptionFields,
            status: 'active',
            metadata: { workspaceId },
            items: {
              data: [{ ...testItem, id: 'si_sync', quantity: 1, price: testPrice }]
            }
          })
        )
      }
      if (url.pathname.startsWith('/v1/subscriptions/')) {
        return Promise.resolve(
          Response.json({
            id: url.pathname.split('/').pop() ?? 'sub_unknown',
            customer: 'cus_checkout',
            ...testSubscriptionFields,
            status: 'active',
            metadata: { workspaceId },
            items: {
              data: [{ ...testItem, id: 'si_recovery', quantity: 1, price: testPrice }]
            }
          })
        )
      }
      if (url.pathname === '/v1/billing_portal/sessions' && method === 'POST') {
        state.portalCreates += 1
        return Promise.resolve(
          Response.json({
            id: 'bps_checkout',
            url: 'https://billing.stripe.com/session/checkout'
          })
        )
      }
      if (url.pathname === '/v1/checkout/sessions' && method === 'POST') {
        if (state.checkoutCreateFailure) {
          throw new Error('lost provider response')
        }
        state.checkoutCreates += 1
        const body = init?.body ?? ''
        state.checkoutBodies.push(body)
        state.checkoutIdempotencyKeys.push(init?.headers?.['idempotency-key'])
        if (state.exposeCreatedSessionOnList) {
          const params = new URLSearchParams(body)
          const claimId = params.get('metadata[claimId]')
          if (claimId !== null) {
            state.recoverySessions.push({
              id: 'cs_checkout',
              url: 'https://checkout.stripe.com/c/pay/checkout',
              status: 'open',
              expires_at: state.checkoutExpiresAt,
              customer: state.checkoutCustomer,
              subscription: null,
              metadata: { workspaceId, claimId }
            })
          }
        }
        return Promise.resolve(
          Response.json({
            id: 'cs_checkout',
            url: 'https://checkout.stripe.com/c/pay/checkout',
            status: 'open',
            expires_at: state.checkoutExpiresAt,
            customer: state.checkoutCustomer,
            subscription: null
          })
        )
      }
      if (url.pathname === '/v1/checkout/sessions' && method === 'GET') {
        state.checkoutListReads += 1
        return Promise.resolve(
          Response.json({
            data: state.recoverySessions,
            has_more: state.checkoutListHasMore
          })
        )
      }
      const recoverySession = state.recoverySessions.find(
        (session) => url.pathname === `/v1/checkout/sessions/${session.id}`
      )
      if (recoverySession !== undefined) {
        return Promise.resolve(Response.json(recoverySession))
      }
      if (url.pathname === '/v1/checkout/sessions/cs_claim') {
        let expiresAt = state.checkoutExpiresAt
        if (state.checkoutStatus === 'expired') {
          expiresAt = 1
        }
        return Promise.resolve(
          Response.json({
            id: 'cs_claim',
            url: state.checkoutUrl,
            status: state.checkoutStatus,
            expires_at: expiresAt,
            customer: state.checkoutCustomer,
            subscription: state.checkoutSubscription
          })
        )
      }
      if (url.pathname === '/v1/checkout/sessions/cs_checkout') {
        return Promise.resolve(
          Response.json({
            id: 'cs_checkout',
            url: 'https://checkout.stripe.com/c/pay/checkout',
            status: 'open',
            expires_at: state.checkoutExpiresAt,
            customer: state.checkoutCustomer,
            subscription: null
          })
        )
      }
      if (url.pathname === '/v1/subscription_items/si_sync' && method === 'POST') {
        const quantity = Number(
          new URLSearchParams(init?.body ?? '').get('quantity') ?? '0'
        )
        state.seatQuantities.push(quantity)
        return Promise.resolve(Response.json({ id: 'si_sync', quantity }))
      }
      throw new Error(`Unexpected Stripe request: ${method} ${url.pathname}`)
    }
  )
  return { state, fetch }
}

export const reset = Effect.gen(function* () {
  const db = yield* Database
  yield* db.delete(billingCheckoutClaims)
  yield* db.delete(billingSynchronization)
  yield* db.delete(workspaceSubscriptions)
  yield* db.delete(auditEvents).where(eq(auditEvents.workspaceId, workspaceId))
  yield* db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, 'usr_joiner')
      )
    )
})

export function checkoutInput(
  overrides: Partial<DurableCheckoutInput> = {}
): DurableCheckoutInput {
  return {
    workspaceId,
    planId: 'team',
    priceId: 'price_team',
    quantity: 1,
    successUrl: 'https://example.test/success',
    cancelUrl: 'https://example.test/cancel',
    secretKey,
    actorUserId: 'usr_owner',
    actorType: 'user',
    ...overrides
  }
}

export function baseClaim(
  overrides: Partial<typeof billingCheckoutClaims.$inferInsert> = {}
) {
  return {
    id: 'claim_existing',
    workspaceId,
    planId: 'team',
    idempotencyKey: 'billing-checkout:claim_existing',
    priceId: 'price_team',
    quantity: 1,
    successUrl: 'https://example.test/success',
    cancelUrl: 'https://example.test/cancel',
    status: 'created',
    stripeSessionId: 'cs_claim',
    checkoutUrl: 'https://checkout.stripe.com/c/pay/claim',
    expiresAt: '2026-09-08T00:00:00.000Z',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  } satisfies typeof billingCheckoutClaims.$inferInsert
}

export function durable<A, E>(
  run: (
    checkout: ReturnType<typeof makeDurableCheckout>,
    db: EffectDatabase
  ) => Effect.Effect<A, E, Database | RawD1>
) {
  return inWorkspace(
    'live-lab',
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* BillingAuditEventLog
      const leases = yield* makeBillingLease()
      const syncStore = yield* makeBillingSyncStore()
      const checkout = makeDurableCheckout({
        db,
        audit,
        lease: leases,
        unavailable: orUnavailable('billing'),
        recordFailure: syncStore.fail
      })
      return yield* run(checkout, db)
    }).pipe(Effect.provide(Layer.merge(BillingAuditLayer, BillingNotificationLayer))),
    { userId: 'usr_owner' }
  )
}

export function withStripe<A, E, R>(
  fixture: ReturnType<typeof stripeFixture>,
  effect: Effect.Effect<A, E, R>
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => vi.stubGlobal('fetch', fixture.fetch)),
    () => effect,
    () => Effect.sync(() => vi.unstubAllGlobals())
  )
}
