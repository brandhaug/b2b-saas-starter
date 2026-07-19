import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { createDb } from '@b2b-saas-starter/db/client'
import { eq } from 'drizzle-orm'
import { operationsNotificationIntents } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LogEmailDispatcherLayer,
  makeCloudflareEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import {
  OperationsNotificationOutbox,
  makeOperationsNotificationOutboxLayer
} from '@b2b-saas-starter/capabilities/operations'
import {
  processOperationsNotification,
  readCapturedOperationsNotifications,
  resetCapturedOperationsNotifications
} from './operations-notifications.ts'

const now = '2026-07-19T12:00:00.000Z'

describe('Operations impersonation notification delivery', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
  }, 30_000)

  afterAll(async () => testD1?.dispose())
  beforeEach(() => resetCapturedOperationsNotifications())

  const addIntent = async (
    id: string,
    eventType:
      | 'impersonation-started'
      | 'impersonation-stopped'
      | 'impersonation-expired'
      | 'impersonation-revoked' = 'impersonation-started'
  ) => {
    await db.insert(operationsNotificationIntents).values({
      id,
      impersonationId: `imp_${id}`,
      eventType,
      recipientEmail: 'target@merchant.test',
      merchantId: 'mer_notification',
      merchantName: 'Notification Merchant',
      occurredAt: now,
      supportReference: 'SUP-42',
      securityContact: 'security@example.test',
      payloadJson: JSON.stringify({
        merchant: 'Notification Merchant',
        timestamp: now,
        supportReference: 'SUP-42',
        securityContact: 'security@example.test'
      }),
      availableAt: now,
      createdAt: now,
      updatedAt: now
    })
  }

  it('renders sanitized content once and uses the intent as the provider idempotency key', async () => {
    await addIntent('opnti_delivery')
    const send = vi.fn().mockResolvedValue(undefined)
    const program = processOperationsNotification({
      intentId: 'opnti_delivery',
      now,
      providerState: 'configured'
    }).pipe(
      Effect.provide(makeOperationsNotificationOutboxLayer(db)),
      Effect.provide(
        makeCloudflareEmailDispatcherLayer(
          { send },
          { defaultFrom: 'security@example.test' }
        )
      )
    )

    await Effect.runPromise(program)
    await Effect.runPromise(program)

    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]?.[0]
    expect(message).toMatchObject({
      idempotencyKey: 'opnti_delivery',
      to: 'target@merchant.test',
      subject: 'Staff access to Notification Merchant has started'
    })
    expect(message.text).toContain('Notification Merchant')
    expect(message.text).toContain(now)
    expect(message.text).toContain('SUP-42')
    expect(message.text).toContain('security@example.test')
    expect(message.text).not.toContain('Operator')
    expect(message.text).not.toContain('Investigate')
  })

  it('captures deterministically in local development without a provider', async () => {
    await addIntent('opnti_capture')

    await Effect.runPromise(
      processOperationsNotification({
        intentId: 'opnti_capture',
        now,
        providerState: 'capture'
      }).pipe(
        Effect.provide(makeOperationsNotificationOutboxLayer(db)),
        Effect.provide(LogEmailDispatcherLayer)
      )
    )

    expect(readCapturedOperationsNotifications()).toEqual([
      {
        idempotencyKey: 'opnti_capture',
        eventType: 'impersonation-started',
        to: 'target@merchant.test',
        merchant: 'Notification Merchant',
        occurredAt: now,
        supportReference: 'SUP-42',
        securityContact: 'security@example.test'
      }
    ])
  })

  it.each([
    ['impersonation-stopped', 'stopped', 'has stopped'],
    ['impersonation-expired', 'expired', 'has expired'],
    ['impersonation-revoked', 'revoked', 'was revoked']
  ] as const)(
    'renders a sanitized %s target notification',
    async (eventType, idSuffix, wording) => {
      const id = `opnti_${idSuffix}`
      await addIntent(id, eventType)
      const send = vi.fn().mockResolvedValue(undefined)

      await Effect.runPromise(
        processOperationsNotification({
          intentId: id,
          now,
          providerState: 'configured'
        }).pipe(
          Effect.provide(makeOperationsNotificationOutboxLayer(db)),
          Effect.provide(
            makeCloudflareEmailDispatcherLayer(
              { send },
              { defaultFrom: 'security@example.test' }
            )
          )
        )
      )

      const message = send.mock.calls[0]?.[0]
      expect(message.subject).toBe(`Staff access to Notification Merchant ${wording}`)
      expect(message.text).toContain(wording)
      expect(message.text).toContain('Notification Merchant')
      expect(message.text).toContain(now)
      expect(message.text).toContain('SUP-42')
      expect(message.text).toContain('security@example.test')
      expect(message.text).not.toContain('Operator')
      expect(message.text).not.toContain('Investigate')
    }
  )

  it('records provider failure for retry without failing the committed lifecycle', async () => {
    await addIntent('opnti_retry')
    const scheduleRetry = vi.fn().mockResolvedValue(undefined)

    await Effect.runPromise(
      processOperationsNotification({
        intentId: 'opnti_retry',
        now,
        providerState: 'configured',
        scheduleRetry
      }).pipe(
        Effect.provide(makeOperationsNotificationOutboxLayer(db)),
        Effect.provide(
          makeCloudflareEmailDispatcherLayer(
            { send: async () => Promise.reject(new Error('provider unavailable')) },
            { defaultFrom: 'security@example.test' }
          )
        )
      )
    )

    expect(scheduleRetry).toHaveBeenCalledWith('opnti_retry', 30)
  })

  it('ignores completion from a worker whose stale claim was recovered', async () => {
    await addIntent('opnti_claim_ownership')
    const layer = makeOperationsNotificationOutboxLayer(db)
    const first = await Effect.runPromise(
      Effect.flatMap(OperationsNotificationOutbox, (store) =>
        store.claim('opnti_claim_ownership', now)
      ).pipe(Effect.provide(layer))
    )
    const recoveredAt = '2026-07-19T12:01:01.000Z'
    const recovered = await Effect.runPromise(
      Effect.flatMap(OperationsNotificationOutbox, (store) =>
        store.claim('opnti_claim_ownership', recoveredAt)
      ).pipe(Effect.provide(layer))
    )
    expect(first?.claimedAt).toBe(now)
    expect(recovered?.claimedAt).toBe(recoveredAt)

    await Effect.runPromise(
      Effect.flatMap(OperationsNotificationOutbox, (store) =>
        store.delivered('opnti_claim_ownership', recoveredAt, 1, recoveredAt)
      ).pipe(Effect.provide(layer))
    )
    await Effect.runPromise(
      Effect.flatMap(OperationsNotificationOutbox, (store) =>
        store.failed(
          'opnti_claim_ownership',
          now,
          1,
          'stale_worker_failure',
          '2026-07-19T12:02:00.000Z',
          '2026-07-19T12:01:02.000Z'
        )
      ).pipe(Effect.provide(layer))
    )

    const [intent] = await db
      .select()
      .from(operationsNotificationIntents)
      .where(eq(operationsNotificationIntents.id, 'opnti_claim_ownership'))
    expect(intent).toMatchObject({
      status: 'delivered',
      failureCode: null,
      deliveredAt: recoveredAt
    })
  })
})
