import {
  Billing,
  type ReconcileWorkspaceInput,
  type SeatSyncResult
} from '@b2b-saas-starter/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { SeatSyncQueueMessage } from '@b2b-saas-starter/billing/seat-sync'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { processSeatSyncMessage } from './seat-sync-consumer.ts'
import {
  consumerInvocation,
  readDelivery,
  type DeliveryOutcome
} from './queue-consumer.ts'

/**
 * The seat-sync consumer against a recording `Billing` stub: the outcomes the
 * queue acts on. Sync decisions themselves are the capability's (covered in
 * `packages/capabilities/src/billing/billing.test.ts`); what this owns is the
 * boundary — malformed messages ack, honest no-ops ack, provider failures
 * reach the consumer entry's retry fold.
 */

type SyncCall = { readonly workspaceId: string; readonly reason: string }

function stubBilling(
  calls: Array<SyncCall>,
  result: () => Effect.Effect<SeatSyncResult, CapabilityUnavailable>,
  reconciles: Array<ReconcileWorkspaceInput> = []
) {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(false),
    currentPlanForWorkspace: () => Effect.die('unused'),
    lifecycleStatus: Effect.die('unused'),
    displayedPlans: Effect.die('unused'),
    currentPlan: Effect.die('not used here'),
    synchronizationStatus: Effect.die('not used here'),
    processProviderEvent: () => Effect.die('not used here'),
    reconcileWorkspace: (input) =>
      Effect.sync(() => {
        reconciles.push(input)
        return { workspaceId: input.workspaceId, outcome: 'current', drift: [] }
      }),
    reconcileBatch: () => Effect.die('not used here'),
    startCheckout: () => Effect.die('not used here'),
    startPortalSession: () => Effect.die('not used here'),
    syncSeats: (input: SyncCall) =>
      Effect.tap(result(), () => Effect.sync(() => calls.push(input)))
  })
}

function stubAudit(calls: Array<RecordAuditEventInput>) {
  return Layer.succeed(AuditEventLog)({
    get: () => Effect.die('unused in seat-sync tests'),
    list: () => Effect.die('unused in seat-sync tests'),
    listGlobal: Effect.die('unused in seat-sync tests'),
    record: (input) => Effect.sync(() => calls.push(input)),
    prepareRecord: () => Effect.die('unused in seat-sync tests')
  })
}

function run(
  body: unknown,
  billing: Layer.Layer<Billing>,
  audit: Array<RecordAuditEventInput> = []
) {
  return Effect.map(
    processSeatSyncMessage(
      readDelivery(SeatSyncQueueMessage, { id: 'qmsg_seat', body, attempts: 0 })
    ).pipe(Effect.provide(Layer.mergeAll(billing, stubAudit(audit)))),
    (outcome) => ({ outcome })
  )
}

const message = {
  kind: 'billing.seat_sync',
  workspaceId: 'wrk_starter',
  reason: 'member_added'
}

const operatorRetryMessage = {
  kind: 'billing.seat_sync',
  workspaceId: 'wrk_starter',
  reason: 'operator_retry',
  operatorId: 'operator@example.com'
}

describe('readDelivery', () => {
  it('decodes a seat-sync message', () => {
    const delivery = readDelivery(SeatSyncQueueMessage, {
      id: 'qmsg_1',
      body: message,
      attempts: 1
    })
    expect(delivery.kind).toBe('message')
    if (delivery.kind === 'message') {
      expect(delivery.message.workspaceId).toBe('wrk_starter')
    }
  })

  it('reports a malformed body instead of throwing', () => {
    expect(
      readDelivery(SeatSyncQueueMessage, {
        id: 'qmsg_2',
        body: { nope: true },
        attempts: 1
      }).kind
    ).toBe('malformed')
    // A webhook delivery body is not a seat-sync body, even though it decodes
    // as an object — the `kind` discriminant is what the consumer trusts.
    expect(
      readDelivery(SeatSyncQueueMessage, {
        id: 'qmsg_3',
        body: { endpointId: 'wh_1', workspaceId: 'wrk_starter', payload: {} },
        attempts: 1
      }).kind
    ).toBe('malformed')
  })
})

describe('processSeatSyncMessage', () => {
  it.effect('acks an honest no-op outcome', () =>
    Effect.gen(function* () {
      const calls: Array<SyncCall> = []
      const { outcome } = yield* run(
        message,
        stubBilling(calls, () =>
          Effect.succeed({ outcome: 'no_subscription', quantity: null })
        )
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(calls).toEqual([{ workspaceId: 'wrk_starter', reason: 'member_added' }])
    })
  )

  it.effect('acks a synced outcome', () =>
    Effect.gen(function* () {
      const { outcome } = yield* run(
        message,
        stubBilling([], () => Effect.succeed({ outcome: 'synced', quantity: 5 }))
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
    })
  )

  it.effect('records an operator retry before reconciliation', () =>
    Effect.gen(function* () {
      const audit: Array<RecordAuditEventInput> = []
      const { outcome } = yield* run(
        operatorRetryMessage,
        stubBilling([], () => Effect.die('syncSeats must not run for operator retry')),
        audit
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(audit).toMatchObject([
        {
          workspaceId: 'wrk_starter',
          actorType: 'system',
          eventType: 'billing.sync_retry_requested',
          targetId: 'wrk_starter',
          metadata: {
            operatorId: 'operator@example.com',
            reason: 'operator_retry'
          }
        }
      ])
    })
  )

  it.effect('forwards operator recovery evidence and records it in the audit', () =>
    Effect.gen(function* () {
      const reconciles: Array<ReconcileWorkspaceInput> = []
      const audit: Array<RecordAuditEventInput> = []
      const { outcome } = yield* run(
        {
          ...operatorRetryMessage,
          recovery: {
            customerId: 'cus_starter',
            checkoutSessionId: 'cs_starter'
          }
        },
        stubBilling(
          [],
          () => Effect.die('syncSeats must not run for operator retry'),
          reconciles
        ),
        audit
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(reconciles).toEqual([
        {
          workspaceId: 'wrk_starter',
          reason: 'operator_retry',
          recovery: {
            customerId: 'cus_starter',
            checkoutSessionId: 'cs_starter'
          }
        }
      ])
      expect(audit[0]?.metadata).toMatchObject({
        customerId: 'cus_starter',
        checkoutSessionId: 'cs_starter'
      })
    })
  )

  it.effect('acks an operator retry without identity without syncing', () =>
    Effect.gen(function* () {
      const calls: Array<SyncCall> = []
      const audit: Array<RecordAuditEventInput> = []
      const { outcome } = yield* run(
        {
          kind: 'billing.seat_sync',
          workspaceId: 'wrk_starter',
          reason: 'operator_retry'
        },
        stubBilling(calls, () => Effect.die('not reached')),
        audit
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(calls).toEqual([])
      expect(audit).toEqual([])
    })
  )

  it.effect('acks a malformed message without calling the capability', () =>
    Effect.gen(function* () {
      const calls: Array<SyncCall> = []
      const { outcome } = yield* run(
        { nope: true },
        stubBilling(calls, () => Effect.die('not reached'))
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(calls).toEqual([])
    })
  )

  it.effect('propagates a provider failure for the consumer entry to fold', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(
          message,
          stubBilling([], () =>
            Effect.fail(
              new CapabilityUnavailable({
                capability: 'billing',
                reason: 'stripe request failed'
              })
            )
          )
        )
      )
      expect(error._tag).toBe('CapabilityUnavailable')
    })
  )

  it.effect("folds an escaped provider failure into the entry's retry outcome", () =>
    Effect.gen(function* () {
      // The fold in `consumerInvocation` — outside `withTriggerScope`, so
      // the wide event exits with the cause before it becomes an outcome —
      // went from dead code to the load-bearing path for every retryable
      // consumer when the per-consumer wrapper was deleted. Drive it
      // directly: a program that fails must answer `retry`.
      const outcome = yield* consumerInvocation(
        {},
        {
          event: 'seat_sync',
          delivery: readDelivery(SeatSyncQueueMessage, {
            id: 'qmsg_fold',
            body: message,
            attempts: 1
          }),
          program: Effect.fail(
            new CapabilityUnavailable({
              capability: 'billing',
              reason: 'stripe request failed'
            })
          ),
          onFailure: 'retry'
        }
      )
      expect(outcome).toBe<DeliveryOutcome>('retry')
    })
  )
})
