import * as TestClock from 'effect/testing/TestClock'
import { type CapabilityServices } from '../layers.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import {
  auditEvents,
  billingNotices,
  notifications,
  workspaceMembers,
  workspaces,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database, RawD1 } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { expect, layer } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { eq, like } from 'drizzle-orm'
import {
  inWorkspace,
  TestDatabase,
  LIVE_SUITE_TIMEOUT
} from '../testing/live-harness.ts'
import { Billing } from './billing.ts'
import {
  initialSnapshot,
  lifecycleContract,
  type LifecycleSnapshot
} from './billing-lifecycle.contract.ts'
import { testItem, testPrice } from './provider-test-fixtures.ts'

const workspaceId = 'wrk_live'
const bindings = {
  billing: {
    secretKey: 'sk_lifecycle',
    priceIds: { team: 'price_team', enterprise: 'price_enterprise' }
  }
}
function providerFixture() {
  let snapshot: LifecycleSnapshot = initialSnapshot
  const seats: Array<string | null> = []
  let unavailable = false
  let archived = false
  function invoice(paid: boolean) {
    const at = snapshot.payment.lastPaymentAt
    let id = 'in_current'
    let amount = 0
    let status = 'open'
    let paidAt: number | null = null
    if (paid) {
      amount = 1200
      status = 'paid'
      if (!snapshot.payment.currentInvoicePaid) {
        id = 'in_previous'
      }
      if (at !== null) {
        paidAt = Date.parse(at) / 1000
      }
    }
    return {
      id,
      customer: 'cus_lifecycle',
      created:
        Date.parse(snapshot.payment.firstFailedAt ?? at ?? '2026-09-01T00:00:00.000Z') /
        1000,
      parent: { subscription_details: { subscription: 'sub_lifecycle' } },
      amount_paid: amount,
      status,
      status_transitions: {
        paid_at: paidAt
      }
    }
  }
  const fetch = vi.fn(
    (input: string, init?: { readonly method?: string; readonly body?: string }) => {
      const url = new URL(input)
      let trialEnd: number | null = null
      if (snapshot.trialEnd !== null) {
        trialEnd = Date.parse(snapshot.trialEnd) / 1000
      }
      const paidInvoices = []
      if (snapshot.payment.lastPaymentAt !== null) {
        paidInvoices.push(invoice(true))
      }
      const failures = []
      if (snapshot.payment.firstFailedAt !== null) {
        failures.push({
          id: 'evt_failure',
          type: 'invoice.payment_failed',
          created: Date.parse(snapshot.payment.firstFailedAt) / 1000,
          data: { object: invoice(false) }
        })
      }
      if (unavailable) {
        return Promise.resolve(Response.json({}, { status: 503 }))
      }
      if (url.pathname === '/v1/customers/cus_lifecycle') {
        return Promise.resolve(
          Response.json({ id: 'cus_lifecycle', metadata: { workspaceId } })
        )
      }
      if (url.pathname === '/v1/subscriptions') {
        return Promise.resolve(
          Response.json({
            has_more: false,
            data: [
              {
                id: 'sub_lifecycle',
                customer: 'cus_lifecycle',
                status: snapshot.status,
                metadata: { workspaceId },
                trial_end: trialEnd,
                cancel_at_period_end: snapshot.cancelAtPeriodEnd,
                latest_invoice: 'in_current',
                items: {
                  data: [
                    {
                      ...testItem,
                      quantity: 0,
                      current_period_end: Date.parse(snapshot.currentPeriodEnd) / 1000,
                      price: { ...testPrice, id: `price_${snapshot.planId}` }
                    }
                  ]
                }
              }
            ]
          })
        )
      }
      if (url.pathname.startsWith('/v1/prices/')) {
        return Promise.resolve(
          Response.json({
            ...testPrice,
            active: !archived,
            id: url.pathname.split('/').at(-1)
          })
        )
      }
      if (url.pathname === '/v1/invoices') {
        return Promise.resolve(
          Response.json({
            has_more: false,
            data: paidInvoices
          })
        )
      }
      if (url.pathname === '/v1/invoices/in_current') {
        return Promise.resolve(
          Response.json(invoice(snapshot.payment.currentInvoicePaid))
        )
      }
      if (url.pathname === '/v1/events') {
        return Promise.resolve(
          Response.json({
            has_more: false,
            data: failures
          })
        )
      }
      if (url.pathname.startsWith('/v1/subscription_items/')) {
        seats.push(new URLSearchParams(init?.body).get('proration_behavior'))
        return Promise.resolve(Response.json({ id: 'si_sync' }))
      }
      return Promise.resolve(Response.json({ error: url.pathname }, { status: 404 }))
    }
  )
  return {
    fetch,
    seats,
    archive: () => {
      archived = true
    },
    set: (next: LifecycleSnapshot) => {
      snapshot = next
    },
    outage: (value: boolean) => {
      unavailable = value
    }
  }
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('Live lifecycle', (it) => {
  it.effect(
    'reconciles full lifecycle, fixed grace, billing notices and suspension independence',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db
          .delete(workspaceSubscriptions)
          .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
        yield* db.insert(workspaceSubscriptions).values({
          workspaceId,
          stripeCustomerId: 'cus_lifecycle',
          updatedAt: '2026-09-01T00:00:00.000Z'
        })
        yield* db
          .update(workspaces)
          .set({ metadata: '{"suspended":true}' })
          .where(eq(workspaces.id, workspaceId))
        yield* db.insert(workspaceMembers).values({
          id: 'mem_lifecycle_admin',
          workspaceId,
          userId: 'usr_audited',
          role: 'admin'
        })
        yield* db.insert(workspaceMembers).values({
          id: 'mem_lifecycle_member',
          workspaceId,
          userId: 'usr_joiner',
          role: 'member'
        })
        const fixture = providerFixture()
        fixture.archive()
        vi.stubGlobal('fetch', fixture.fetch)
        function scoped<A, E>(
          effect: Effect.Effect<
            A,
            E,
            WorkspaceContext | CapabilityServices | Database | RawD1
          >
        ) {
          return inWorkspace('live-lab', effect, undefined, bindings)
        }
        const run = Effect.gen(function* () {
          yield* lifecycleContract(expect, {
            set: (snapshot) => Effect.sync(() => fixture.set(snapshot)),
            sync: (providerEventId) =>
              scoped(
                Effect.gen(function* () {
                  const billing = yield* Billing
                  if (
                    providerEventId === 'failed_renewal' ||
                    providerEventId.startsWith('reconcile_')
                  ) {
                    yield* billing.reconcileWorkspace({
                      workspaceId,
                      reason: 'scheduled_reconciliation'
                    })
                  } else {
                    yield* billing.processProviderEvent({
                      workspaceId,
                      providerEventId,
                      eventType: 'customer.subscription.updated',
                      subscription: { customerId: 'cus_lifecycle' }
                    })
                  }
                })
              ),
            plan: scoped(
              Effect.gen(function* () {
                return (yield* (yield* Billing).currentPlan).id
              })
            ),
            grace: scoped(
              Effect.gen(function* () {
                return (yield* (yield* Billing).lifecycleStatus).graceEndsAt
              })
            )
          })
          const workspace = yield* db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, workspaceId))
          expect(workspace[0]?.metadata).toBe('{"suspended":true}')
          const noticeRows = yield* db
            .select()
            .from(billingNotices)
            .where(eq(billingNotices.workspaceId, workspaceId))
          expect(
            noticeRows.filter((notice) => notice.noticeType === 'grace_expiring')
          ).toHaveLength(1)
          expect(
            noticeRows.filter((notice) => notice.noticeType === 'payment_recovered')
          ).toHaveLength(3)
          expect(noticeRows.every((notice) => notice.deliveredAt !== null)).toBe(true)
          const recipients = yield* db
            .select()
            .from(notifications)
            .where(like(notifications.id, 'not:wrk_live:%'))
          expect(new Set(recipients.map((notice) => notice.userId))).toEqual(
            new Set(['usr_owner', 'usr_audited'])
          )
          const audits = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'billing.grace_expiring'))
          expect(audits).toHaveLength(1)
          expect(fixture.seats.length).toBeGreaterThan(0)
          expect(fixture.seats.every((mode) => mode === 'create_prorations')).toBe(true)
        })
        yield* run.pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
      }),
    30_000
  )
  it.effect(
    'retries notice delivery after the lifecycle batch committed without duplicating notices or audits',
    () =>
      Effect.gen(function* () {
        const db = yield* Database
        const d1 = yield* RawD1
        const fixture = providerFixture()
        const paying: LifecycleSnapshot = {
          ...initialSnapshot,
          status: 'active',
          currentPeriodEnd: '2026-11-01T00:00:00.000Z',
          payment: {
            lastPaymentAt: '2026-10-01T00:00:00.000Z',
            firstFailedAt: null,
            currentInvoicePaid: true
          }
        }
        fixture.set(paying)
        yield* db
          .insert(workspaceSubscriptions)
          .values({
            workspaceId,
            stripeCustomerId: 'cus_lifecycle',
            updatedAt: '2026-10-01T00:00:00.000Z'
          })
          .onConflictDoNothing()
        vi.stubGlobal('fetch', fixture.fetch)
        const sync = inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            return yield* (yield* Billing).reconcileWorkspace({ workspaceId })
          }),
          undefined,
          bindings
        )
        const run = Effect.gen(function* () {
          yield* TestClock.setTime(Date.parse('2026-10-01T00:00:00.000Z'))
          yield* sync
          yield* TestClock.setTime(Date.parse('2026-10-02T00:00:00.000Z'))
          fixture.set({
            ...paying,
            status: 'past_due',
            payment: {
              ...paying.payment,
              currentInvoicePaid: false,
              firstFailedAt: '2026-10-02T00:00:00.000Z'
            }
          })
          yield* Effect.acquireUseRelease(
            Effect.promise(() =>
              d1
                .prepare(
                  "CREATE TRIGGER reject_billing_notice BEFORE INSERT ON notifications WHEN NEW.title = 'Subscription payment failed' BEGIN SELECT RAISE(ABORT, 'notice unavailable'); END"
                )
                .run()
            ),
            () =>
              Effect.gen(function* () {
                expect((yield* Effect.flip(sync))._tag).toBe('CapabilityUnavailable')
                const rows = yield* db
                  .select()
                  .from(workspaceSubscriptions)
                  .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
                expect(rows[0]?.firstFailedAt).toBe('2026-10-02T00:00:00.000Z')
                const pending = yield* db
                  .select()
                  .from(billingNotices)
                  .where(
                    eq(
                      billingNotices.id,
                      'wrk_live:failed:sub_lifecycle:2026-10-02T00:00:00.000Z'
                    )
                  )
                expect(pending[0]?.deliveredAt).toBeNull()
                fixture.set({
                  ...paying,
                  payment: {
                    ...paying.payment,
                    lastPaymentAt: '2026-10-03T00:00:00.000Z'
                  }
                })
                yield* TestClock.setTime(Date.parse('2026-10-03T00:00:00.000Z'))
                expect((yield* Effect.flip(sync))._tag).toBe('CapabilityUnavailable')
                const recovered = yield* db
                  .select()
                  .from(workspaceSubscriptions)
                  .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
                expect(recovered[0]?.lastPaymentAt).toBe('2026-10-03T00:00:00.000Z')
                expect(recovered[0]?.firstFailedAt).toBeNull()
                expect(recovered[0]?.paymentVerified).toBe(true)
                fixture.set({
                  ...paying,
                  payment: {
                    ...paying.payment,
                    lastPaymentAt: '2026-10-04T00:00:00.000Z'
                  }
                })
                yield* TestClock.setTime(Date.parse('2026-10-04T00:00:00.000Z'))
                const webhook = inWorkspace(
                  'live-lab',
                  Effect.gen(function* () {
                    return yield* (yield* Billing).processProviderEvent({
                      workspaceId,
                      providerEventId: 'notice_outage_recovery',
                      eventType: 'invoice.paid',
                      subscription: { customerId: 'cus_lifecycle' }
                    })
                  }),
                  undefined,
                  bindings
                )
                expect((yield* Effect.flip(webhook))._tag).toBe('CapabilityUnavailable')
                const afterWebhook = yield* db
                  .select()
                  .from(workspaceSubscriptions)
                  .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
                expect(afterWebhook[0]?.lastPaymentAt).toBe('2026-10-04T00:00:00.000Z')
              }),
            () =>
              Effect.promise(() =>
                d1.prepare('DROP TRIGGER reject_billing_notice').run()
              )
          )
          yield* sync
          yield* sync
          const notices = yield* db
            .select()
            .from(notifications)
            .where(
              like(notifications.id, '%failed:sub_lifecycle:2026-10-02T00:00:00.000Z')
            )
          expect(
            notices.filter((notice) => notice.userId === 'usr_owner')
          ).toHaveLength(1)
          const recoveryNotices = yield* db
            .select()
            .from(notifications)
            .where(
              like(
                notifications.id,
                '%recovered:sub_lifecycle:2026-10-03T00:00:00.000Z'
              )
            )
          for (const userId of ['usr_owner', 'usr_audited']) {
            expect(
              recoveryNotices.filter((notice) => notice.userId === userId)
            ).toHaveLength(1)
          }
          const audits = yield* db
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.eventType, 'billing.payment_failed'))
          expect(
            audits.filter(
              (audit) =>
                audit.metadata.noticeId ===
                'wrk_live:failed:sub_lifecycle:2026-10-02T00:00:00.000Z'
            )
          ).toHaveLength(1)
        })
        yield* run.pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
      })
  )
})
