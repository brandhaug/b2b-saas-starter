import {
  testPrice,
  testItem,
  testSubscriptionFields,
  paidInvoice
} from '@b2b-saas-starter/billing/provider-test-fixtures'
import {
  auditEvents,
  billingCheckoutClaims,
  billingProviderEvents,
  billingSynchronization,
  workspaceMembers,
  workspaceSubscriptions,
  workspaces
} from '@b2b-saas-starter/db/schema'
import { Database, RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, type Context, Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, layer } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { and, eq } from 'drizzle-orm'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import {
  Billing,
  type ProcessProviderEventInput
} from '@b2b-saas-starter/billing/billing'
import { type StripeSubscriptionResponse } from '@b2b-saas-starter/billing/stripe'

const workspaceId = 'wrk_live'
const customerId = 'cus_sync'
const subscriptionId = 'sub_sync'
const bindings = {
  billing: { secretKey: 'sk_test_sync', priceIds: { team: 'price_team' } }
}

function subscription(
  overrides: Partial<StripeSubscriptionResponse> = {}
): StripeSubscriptionResponse {
  return {
    ...testSubscriptionFields,
    id: subscriptionId,
    customer: customerId,
    status: 'active',
    metadata: { workspaceId },
    items: { data: [{ ...testItem }] },
    ...overrides
  }
}

type StripeFixtureState = {
  subscriptions: Array<StripeSubscriptionResponse>
  customerWorkspaceId: string | undefined
  unavailable: boolean
  seatWrites: Array<number>
  lostSeatResponse: boolean
}

function event(
  id: string,
  overrides: Partial<ProcessProviderEventInput> = {}
): ProcessProviderEventInput {
  return {
    providerEventId: id,
    providerCreatedAt: '2026-09-07T00:00:00.000Z',
    eventType: 'customer.subscription.updated',
    workspaceId,
    subscription: {
      workspaceId,
      customerId,
      subscriptionId,
      subscriptionItemId: 'si_sync',
      quantity: 1
    },
    ...overrides
  }
}

function stripeFixture() {
  const state: StripeFixtureState = {
    subscriptions: [subscription()],
    customerWorkspaceId: workspaceId,
    unavailable: false,
    seatWrites: new Array<number>(),
    lostSeatResponse: false
  }
  function respond(
    input: string,
    init?: { readonly method?: string; readonly body?: string }
  ) {
    const url = new URL(input)
    if (state.unavailable) {
      return Response.json(
        { error: { message: 'secret provider error' } },
        { status: 503 }
      )
    }
    if (url.pathname.startsWith('/v1/prices/')) {
      return Response.json(testPrice)
    }
    if (url.pathname === '/v1/invoices/in_paid') {
      return Response.json(
        paidInvoice(
          state.subscriptions.find(
            (row) => row.status !== 'canceled' && row.status !== 'incomplete_expired'
          ) ?? subscription()
        )
      )
    }
    if (url.pathname === '/v1/invoices') {
      const selected = state.subscriptions.find(
        (row) => row.id === url.searchParams.get('subscription')
      )
      const data = []
      if (selected !== undefined) {
        data.push(paidInvoice(selected))
      }
      return Response.json({
        data,
        has_more: false
      })
    }
    if (url.pathname === '/v1/events') {
      return Response.json({ data: [], has_more: false })
    }
    if (url.pathname === '/v1/customers/search') {
      const data = []
      if (state.customerWorkspaceId !== undefined) {
        data.push({
          id: customerId,
          metadata: { workspaceId: state.customerWorkspaceId }
        })
      }
      return Response.json({
        data,
        has_more: false
      })
    }
    if (url.pathname === `/v1/customers/${customerId}`) {
      return Response.json({
        id: customerId,
        metadata: { workspaceId: state.customerWorkspaceId }
      })
    }
    if (url.pathname === '/v1/customers/cus_other') {
      return Response.json({ id: 'cus_other', metadata: { workspaceId: 'wrk_other' } })
    }
    if (
      url.pathname === '/v1/subscriptions' &&
      url.searchParams.get('customer') === 'cus_other'
    ) {
      return Response.json({
        data: [
          subscription({
            id: 'sub_other',
            customer: 'cus_other',
            metadata: { workspaceId: 'wrk_other' },
            items: {
              data: [
                {
                  ...testItem,
                  id: 'si_other',
                  quantity: 0,
                  price: { ...testPrice, id: 'price_team' }
                }
              ]
            }
          })
        ],
        has_more: false
      })
    }
    if (url.pathname === '/v1/subscriptions') {
      return Response.json({ data: state.subscriptions, has_more: false })
    }
    if (url.pathname.startsWith('/v1/subscriptions/')) {
      const found = state.subscriptions.find((row) =>
        url.pathname.endsWith(`/${row.id}`)
      )
      return Response.json(found ?? subscription({ status: 'canceled' }))
    }
    if (url.pathname === '/v1/subscription_items/si_sync' && init?.method === 'POST') {
      const quantity = Number(new URLSearchParams(init.body ?? '').get('quantity'))
      state.seatWrites.push(quantity)
      state.subscriptions = state.subscriptions.map((row) => ({
        ...row,
        items: { data: row.items.data.map((item) => ({ ...item, quantity })) }
      }))
      if (state.lostSeatResponse) {
        state.lostSeatResponse = false
        throw new Error('lost provider response')
      }
      return Response.json({ id: 'si_sync', quantity })
    }
    throw new Error(
      `Unexpected Stripe request: ${init?.method ?? 'GET'} ${url.pathname}`
    )
  }
  const fetch = vi.fn(
    (input: string, init?: { readonly method?: string; readonly body?: string }) =>
      Promise.resolve(respond(input, init))
  )
  return { state, fetch }
}

const reset = Effect.gen(function* () {
  const db = yield* Database
  yield* db.delete(billingProviderEvents)
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
  yield* db
    .update(workspaces)
    .set({ planId: 'starter' })
    .where(eq(workspaces.id, workspaceId))
})

function withStripe<A, E, R>(
  run: (fixture: ReturnType<typeof stripeFixture>) => Effect.Effect<A, E, R>
) {
  return Effect.gen(function* () {
    yield* reset
    const fixture = stripeFixture()
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => vi.stubGlobal('fetch', fixture.fetch)),
      () => run(fixture),
      () => Effect.sync(() => vi.unstubAllGlobals())
    )
  })
}

function billingRun<A, E>(
  // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Effect names its public service extraction utility Shape
  run: (billing: Context.Service.Shape<typeof Billing>) => Effect.Effect<A, E>
) {
  return inWorkspace('live-lab', Effect.flatMap(Billing, run), undefined, bindings)
}

const stored = Effect.gen(function* () {
  const db = yield* Database
  return {
    workspace: (yield* db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId)))[0],
    subscription: (yield* db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId)))[0],
    events: yield* db.select().from(billingProviderEvents),
    audits: yield* db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId)),
    synchronization: (yield* db
      .select()
      .from(billingSynchronization)
      .where(eq(billingSynchronization.workspaceId, workspaceId)))[0]
  }
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'durable billing synchronization',
  (it) => {
    it.effect('deduplicates a completed delivery and its business audits', () =>
      withStripe(() =>
        Effect.gen(function* () {
          yield* billingRun((billing) =>
            billing.processProviderEvent(event('evt_duplicate'))
          )
          const first = yield* stored
          const duplicate = yield* billingRun((billing) =>
            billing.processProviderEvent(event('evt_duplicate'))
          )
          const second = yield* stored
          expect(duplicate.outcome).toBe('duplicate')
          expect(second.workspace?.planId).toBe('team')
          expect(second.events).toHaveLength(1)
          expect(second.events[0]?.status).toBe('completed')
          expect(second.audits).toHaveLength(first.audits.length)
          expect(
            first.audits.some((row) => row.eventType === 'billing.plan_changed')
          ).toBe(true)
        })
      )
    )

    it.effect(
      'scheduled reconciliation recovers evidence persisted before enqueue',
      () =>
        withStripe(() =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.recordProviderEvent(event('evt_crash'))
            )
            expect(
              (yield* stored).events.find((row) => row.providerEventId === 'evt_crash')
                ?.status
            ).toBe('processing')
            yield* TestClock.adjust('2 minutes')
            yield* billingRun((billing) => billing.reconcileBatch({ limit: 1 }))
            expect(
              (yield* stored).events.find((row) => row.providerEventId === 'evt_crash')
                ?.status
            ).toBe('completed')
          })
        )
    )

    // Exercise real concurrent D1 requests and the bounded lease retry schedule.
    it.effect(
      'concurrent duplicate deliveries commit one plan change and one event',
      () =>
        withStripe(() =>
          TestClock.withLive(
            Effect.gen(function* () {
              const results = yield* billingRun((billing) =>
                Effect.all(
                  [
                    billing.processProviderEvent(event('evt_concurrent')),
                    billing.processProviderEvent(event('evt_concurrent'))
                  ],
                  { concurrency: 2 }
                )
              )
              expect(results.map((result) => result.outcome).toSorted()).toEqual([
                'applied',
                'duplicate'
              ])
              const result = yield* stored
              expect(result.events).toHaveLength(1)
              expect(
                result.audits.filter((row) => row.eventType === 'billing.plan_changed')
              ).toHaveLength(1)
            })
          )
        )
    )

    it.effect(
      'an old event cannot restore a canceled subscription, even after evidence is deleted',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_old'))
            )
            state.subscriptions = [subscription({ status: 'canceled' })]
            yield* billingRun((billing) =>
              billing.processProviderEvent(
                event('evt_cancel', { eventType: 'customer.subscription.deleted' })
              )
            )
            const db = yield* Database
            yield* db.delete(billingProviderEvents)
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_old'))
            )
            const result = yield* stored
            expect(result.workspace?.planId).toBe('starter')
            expect(result.subscription?.stripeSubscriptionId).toBeNull()
            expect(result.subscription?.stripeCustomerId).toBe(customerId)
          })
        )
    )

    it.effect(
      'same-second events observe current state and stale cancellation cannot revoke a replacement',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_first'))
            )
            state.subscriptions = [
              subscription({ status: 'canceled' }),
              subscription({ id: 'sub_replacement' })
            ]
            yield* billingRun((billing) =>
              billing.processProviderEvent(
                event('evt_same_second', { eventType: 'customer.subscription.deleted' })
              )
            )
            const result = yield* stored
            expect(result.workspace?.planId).toBe('team')
            expect(result.subscription?.stripeSubscriptionId).toBe('sub_replacement')
            expect(result.events).toHaveLength(2)
          })
        )
    )

    it.effect(
      'rolls back related writes when the audit insert fails and recovers the event on retry',
      () =>
        withStripe(() =>
          Effect.gen(function* () {
            const d1 = yield* RawD1
            yield* Effect.promise(() =>
              d1
                .prepare(
                  "CREATE TRIGGER reject_billing_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'billing.plan_changed' BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END"
                )
                .run()
            )
            yield* Effect.acquireUseRelease(
              Effect.void,
              () =>
                Effect.gen(function* () {
                  yield* billingRun((billing) =>
                    Effect.flip(billing.processProviderEvent(event('evt_interrupted')))
                  )
                  const failed = yield* stored
                  expect(failed.workspace?.planId).toBe('starter')
                  expect(failed.subscription).toBeUndefined()
                  expect(failed.events[0]?.status).not.toBe('completed')
                  expect(failed.audits).toHaveLength(0)
                }),
              () =>
                Effect.promise(() =>
                  d1.prepare('DROP TRIGGER reject_billing_audit').run()
                )
            )
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_interrupted'))
            )
            const recovered = yield* stored
            expect(recovered.workspace?.planId).toBe('team')
            expect(recovered.events[0]?.status).toBe('completed')
            expect(
              recovered.audits.filter((row) => row.eventType === 'billing.plan_changed')
            ).toHaveLength(1)
          })
        )
    )

    it.effect(
      'repairs dropped seat work and manual provider quantity drift without another event',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_link'))
            )
            const db = yield* Database
            yield* db.insert(workspaceMembers).values({
              id: 'mem_sync_joiner',
              workspaceId,
              userId: 'usr_joiner',
              role: 'member'
            })
            state.subscriptions = [
              subscription({
                items: {
                  data: [
                    {
                      ...testItem,
                      id: 'si_sync',
                      quantity: 99,
                      price: { ...testPrice, id: 'price_team' }
                    }
                  ]
                }
              })
            ]
            yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
            const result = yield* stored
            expect(state.seatWrites.at(-1)).toBe(2)
            expect(result.subscription?.seatQuantity).toBe(2)
          })
        )
    )

    it.effect(
      'preserves verified entitlements and records durable conflicts for unknown prices',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_known'))
            )
            state.subscriptions = [
              subscription({
                items: {
                  data: [
                    {
                      ...testItem,
                      id: 'si_sync',
                      quantity: 1,
                      price: { ...testPrice, id: 'price_unknown' }
                    }
                  ]
                }
              })
            ]
            const result = yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_unknown_price'))
            )
            expect(result.outcome).toBe('conflict')
            const evidence = yield* stored
            expect(evidence.workspace?.planId).toBe('team')
            expect(evidence.synchronization?.status).toBe('conflict')
            expect(
              evidence.events.find((row) => row.providerEventId === 'evt_unknown_price')
                ?.status
            ).toBe('conflict')
          })
        )
    )

    it.effect(
      'records duplicate subscriptions without choosing one or changing entitlements',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_single'))
            )
            state.subscriptions = [
              subscription(),
              subscription({ id: 'sub_duplicate' })
            ]
            const result = yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_multiple'))
            )
            expect(result.outcome).toBe('conflict')
            const evidence = yield* stored
            expect(evidence.workspace?.planId).toBe('team')
            expect(evidence.subscription?.stripeSubscriptionId).toBe(subscriptionId)
            expect(evidence.synchronization?.status).toBe('conflict')
            expect(state.seatWrites).toHaveLength(0)
          })
        )
    )

    it.effect(
      'rejects a customer owned by another workspace without linking or granting access',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            state.customerWorkspaceId = 'wrk_other'
            const result = yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_foreign'))
            )
            expect(result.outcome).toBe('conflict')
            const evidence = yield* stored
            expect(evidence.workspace?.planId).toBe('starter')
            expect(evidence.subscription).toBeUndefined()
            expect(evidence.events[0]?.status).toBe('conflict')
          })
        )
    )

    it.effect(
      'scheduled reconciliation applies a missed recognized plan change and cancellation',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_baseline'))
            )
            const db = yield* Database
            yield* db
              .update(workspaces)
              .set({ planId: 'starter' })
              .where(eq(workspaces.id, workspaceId))
            yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
            expect((yield* stored).workspace?.planId).toBe('team')
            state.subscriptions = [subscription({ status: 'canceled' })]
            yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
            const canceled = yield* stored
            expect(canceled.workspace?.planId).toBe('starter')
            expect(canceled.subscription?.stripeSubscriptionId).toBeNull()
            expect(canceled.subscription?.stripeCustomerId).toBe(customerId)
          })
        )
    )

    it.effect(
      'the bounded scheduled entry point performs repairs and stays inactive without Stripe',
      () =>
        withStripe(({ state, fetch }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_batch_baseline'))
            )
            state.subscriptions = [
              subscription({
                items: {
                  data: [
                    {
                      ...testItem,
                      id: 'si_sync',
                      quantity: 8,
                      price: { ...testPrice, id: 'price_team' }
                    }
                  ]
                }
              })
            ]
            yield* TestClock.adjust('5 minutes')
            yield* billingRun((billing) => billing.reconcileBatch({ limit: 1 }))
            expect(state.seatWrites.at(-1)).toBe(1)
            const calls = fetch.mock.calls.length
            const inactive = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(Billing, (billing) => billing.reconcileBatch({ limit: 1 }))
            )
            expect(inactive).toEqual([])
            expect(fetch.mock.calls).toHaveLength(calls)
          })
        )
    )

    it.effect(
      'does not call Stripe when the provider configuration is incomplete',
      () =>
        withStripe(({ fetch }) =>
          Effect.gen(function* () {
            const db = yield* Database
            yield* db.insert(workspaceSubscriptions).values({
              workspaceId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              stripeSubscriptionItemId: 'si_sync',
              seatQuantity: 1,
              updatedAt: '2026-09-07T00:00:00.000Z'
            })
            const calls = fetch.mock.calls.length
            const result = yield* inWorkspace(
              'live-lab',
              Effect.flatMap(Billing, (billing) =>
                billing.reconcileBatch({ limit: 1 })
              ),
              undefined,
              { billing: { secretKey: 'sk_test_sync', priceIds: {} } }
            )
            expect(result).toEqual([])
            expect(fetch.mock.calls).toHaveLength(calls)
          })
        )
    )

    it.effect('bounded passes advance fairly across workspaces', () =>
      withStripe(() =>
        Effect.gen(function* () {
          yield* billingRun((billing) =>
            billing.processProviderEvent(event('evt_fair_baseline'))
          )
          const db = yield* Database
          yield* db.insert(workspaceSubscriptions).values({
            workspaceId: 'wrk_other',
            stripeCustomerId: 'cus_other',
            stripeSubscriptionId: 'sub_other',
            stripeSubscriptionItemId: 'si_other',
            seatQuantity: 0,
            updatedAt: '1970-01-01T00:00:00.000Z'
          })
          yield* TestClock.adjust('16 minutes')
          const first = yield* billingRun((billing) =>
            billing.reconcileBatch({ limit: 1 })
          )
          yield* TestClock.adjust('1 minute')
          const second = yield* billingRun((billing) =>
            billing.reconcileBatch({ limit: 1 })
          )
          expect(first).toHaveLength(1)
          expect(second).toHaveLength(1)
          expect(new Set([...first, ...second].map((row) => row.workspaceId))).toEqual(
            new Set([workspaceId, 'wrk_other'])
          )
        })
      )
    )

    it.effect(
      'preserves verified state during an outage and retains the first unresolved time across retries',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_verified'))
            )
            state.unavailable = true
            yield* billingRun((billing) =>
              Effect.flip(billing.processProviderEvent(event('evt_outage')))
            )
            const first = yield* stored
            yield* TestClock.adjust('16 minutes')
            yield* billingRun((billing) =>
              Effect.flip(billing.processProviderEvent(event('evt_outage')))
            )
            const retried = yield* stored
            expect(retried.workspace?.planId).toBe('team')
            expect(retried.synchronization?.status).toBe('delayed')
            expect(retried.synchronization?.unresolvedSince).toBe(
              first.synchronization?.unresolvedSince
            )
            expect(
              retried.events.find((row) => row.providerEventId === 'evt_outage')
                ?.failureReason
            ).toBe('stripe customer.retrieve http:503')
          })
        )
    )

    it.effect(
      'records a delayed unresolved checkout handoff when no customer is discoverable',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            const db = yield* Database
            const now = DateTime.formatIso(yield* DateTime.now)
            state.customerWorkspaceId = undefined
            yield* db
              .update(workspaces)
              .set({ planId: 'team' })
              .where(eq(workspaces.id, workspaceId))
            yield* db.insert(billingCheckoutClaims).values({
              id: 'bill_checkout_pending_sync',
              workspaceId,
              planId: 'team',
              idempotencyKey: 'billing-checkout:pending-sync',
              priceId: 'price_team',
              quantity: 1,
              successUrl: 'https://example.test/success',
              cancelUrl: 'https://example.test/cancel',
              status: 'pending',
              stripeSessionId: null,
              checkoutUrl: null,
              attemptCount: 1,
              failureReason: null,
              expiresAt: DateTime.formatIso(
                DateTime.add(yield* DateTime.now, { hours: 24 })
              ),
              createdAt: now,
              updatedAt: now
            })
            const result = yield* billingRun((billing) =>
              billing.reconcileWorkspace({ workspaceId })
            )
            const evidence = yield* stored
            expect(result).toEqual({
              workspaceId,
              outcome: 'delayed',
              drift: ['checkout_pending']
            })
            expect(evidence.synchronization?.status).toBe('delayed')
            expect(evidence.synchronization?.failureReason).toBe('checkout_pending')
            expect(evidence.synchronization?.unresolvedSince).toBeTruthy()
            expect(evidence.workspace?.planId).toBe('team')
          })
        )
    )

    it.effect(
      'does not retry terminal unknown-workspace evidence in a bounded pass',
      () =>
        withStripe(() =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_terminal'))
            )
            const db = yield* Database
            yield* db
              .update(billingProviderEvents)
              .set({
                workspaceId: null,
                status: 'conflict',
                outcome: 'unknown_workspace'
              })
              .where(eq(billingProviderEvents.providerEventId, 'evt_terminal'))
            const before = yield* db
              .select()
              .from(billingProviderEvents)
              .where(eq(billingProviderEvents.providerEventId, 'evt_terminal'))
            yield* TestClock.adjust('5 minutes')
            const results = yield* billingRun((billing) =>
              billing.reconcileBatch({ limit: 1 })
            )
            const after = yield* db
              .select()
              .from(billingProviderEvents)
              .where(eq(billingProviderEvents.providerEventId, 'evt_terminal'))
            expect(results).toHaveLength(1)
            expect(results[0]?.workspaceId).toBe(workspaceId)
            expect(after[0]?.attemptCount).toBe(before[0]?.attemptCount)
            expect(after[0]?.status).toBe('conflict')
          })
        )
    )

    it.effect('backs off unresolved provider evidence before retrying it', () =>
      withStripe(() =>
        Effect.gen(function* () {
          const db = yield* Database
          const now = DateTime.formatIso(yield* DateTime.now)
          yield* db.insert(billingProviderEvents).values({
            id: 'bill_evt_backoff',
            providerEventId: 'evt_backoff',
            eventType: 'customer.subscription.updated',
            providerCreatedAt: now,
            workspaceId: null,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            status: 'failed',
            outcome: null,
            failureReason: 'stripe request failed',
            attemptCount: 1,
            receivedAt: now,
            completedAt: null,
            resolvedAt: null,
            updatedAt: now
          })
          const immediate = yield* billingRun((billing) =>
            billing.reconcileBatch({ limit: 1 })
          )
          expect(immediate).toEqual([])
          expect(
            (yield* db
              .select()
              .from(billingProviderEvents)
              .where(eq(billingProviderEvents.providerEventId, 'evt_backoff')))[0]
              ?.status
          ).toBe('failed')
          yield* TestClock.adjust('1 minute')
          yield* billingRun((billing) => billing.reconcileBatch({ limit: 1 }))
          expect(
            (yield* db
              .select()
              .from(billingProviderEvents)
              .where(eq(billingProviderEvents.providerEventId, 'evt_backoff')))[0]
              ?.status
          ).toBe('completed')
        })
      )
    )

    it.effect(
      'rereads provider quantity after a lost response before retrying a seat write',
      () =>
        withStripe(({ state }) =>
          Effect.gen(function* () {
            yield* billingRun((billing) =>
              billing.processProviderEvent(event('evt_lost_response'))
            )
            const db = yield* Database
            yield* db.insert(workspaceMembers).values({
              id: 'mem_sync_joiner',
              workspaceId,
              userId: 'usr_joiner',
              role: 'member'
            })
            state.lostSeatResponse = true
            yield* billingRun((billing) =>
              Effect.flip(billing.reconcileWorkspace({ workspaceId }))
            )
            expect(state.seatWrites).toEqual([2])
            yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
            expect(state.seatWrites).toEqual([2])
            expect((yield* stored).subscription?.seatQuantity).toBe(2)
          })
        )
    )

    it.effect('uses a new logical write for each quantity oscillation', () =>
      withStripe(({ state }) =>
        Effect.gen(function* () {
          yield* billingRun((billing) =>
            billing.processProviderEvent(event('evt_oscillation'))
          )
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: 'mem_sync_joiner',
            workspaceId,
            userId: 'usr_joiner',
            role: 'member'
          })
          yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
          yield* db
            .delete(workspaceMembers)
            .where(eq(workspaceMembers.id, 'mem_sync_joiner'))
          yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
          yield* db.insert(workspaceMembers).values({
            id: 'mem_sync_joiner',
            workspaceId,
            userId: 'usr_joiner',
            role: 'member'
          })
          yield* billingRun((billing) => billing.reconcileWorkspace({ workspaceId }))
          expect(state.seatWrites).toEqual([2, 1, 2])
        })
      )
    )
  }
)
